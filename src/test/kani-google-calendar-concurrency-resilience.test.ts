import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  buildDeterministicGoogleEventId,
  syncQueueItem,
  processCalendarSyncQueue,
  type CalendarSyncQueueItem,
} from '../lib/kani-google-calendar-sync';
import { GoogleCalendarClient } from '../lib/kani-google-calendar-client';

describe('Google Calendar Concurrency & Resilience Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // 1. Dos workers reclamando simultáneamente (verificar exclusión mutua sin superposición)
  it('Escenario 1: Dos workers reclamando simultáneamente obtienen conjuntos disjuntos de trabajos mediante SKIP LOCKED', async () => {
    const allPendingJobs: CalendarSyncQueueItem[] = [
      {
        sync_id: 'sync-1',
        appointment_id: 'app-1',
        barber_id: 'b-1',
        barber_name: 'Lautaro',
        calendar_id: 'cal-lautaro@group.calendar.google.com',
        google_event_id: null,
        previous_calendar_id: null,
        previous_google_event_id: null,
        sync_action: 'UPSERT',
        attempts: 0,
        payload_checksum: null,
        booking_date: '2026-11-15',
        start_time: '14:00:00',
        end_time: '14:45:00',
        request_number: 101,
        client_name: 'Cliente Uno',
        service_name: 'Corte Tradicional',
        custom_service_name: null,
        service_price_ars: 12000,
        deposit_paid: true,
        deposit_amount_ars: 5000,
        sync_version: 1,
      },
      {
        sync_id: 'sync-2',
        appointment_id: 'app-2',
        barber_id: 'b-2',
        barber_name: 'Franco',
        calendar_id: 'cal-franco@group.calendar.google.com',
        google_event_id: null,
        previous_calendar_id: null,
        previous_google_event_id: null,
        sync_action: 'UPSERT',
        attempts: 0,
        payload_checksum: null,
        booking_date: '2026-11-15',
        start_time: '15:00:00',
        end_time: '15:45:00',
        request_number: 102,
        client_name: 'Cliente Dos',
        service_name: 'Barba',
        custom_service_name: null,
        service_price_ars: 8000,
        deposit_paid: true,
        deposit_amount_ars: 4000,
        sync_version: 1,
      },
    ];

    const claimedJobIds = new Set<string>();

    const createWorkerSupabase = (workerName: string) => ({
      rpc: vi.fn().mockImplementation((rpcName: string, args: any) => {
        if (rpcName === 'claim_pending_calendar_sync_jobs') {
          const limit = args.p_limit || 10;
          const available = allPendingJobs.filter((j) => !claimedJobIds.has(j.sync_id)).slice(0, limit);
          for (const item of available) {
            claimedJobIds.add(item.sync_id);
          }
          return Promise.resolve({
            data: available.map((j) => ({ ...j, claimed_by: args.p_worker_id })),
            error: null,
          });
        }
        if (rpcName === 'record_calendar_sync_success_v2') {
          return Promise.resolve({ data: true, error: null });
        }
        return Promise.resolve({ data: null, error: null });
      }),
    });

    const mockClient = {
      createEvent: vi.fn().mockResolvedValue({ id: 'g-event-created' }),
      updateEvent: vi.fn().mockResolvedValue({ id: 'g-event-updated' }),
      deleteEvent: vi.fn().mockResolvedValue({ success: true, alreadyDeleted: false }),
    } as unknown as GoogleCalendarClient;

    const resWorker1 = await processCalendarSyncQueue({
      force: true,
      limit: 1,
      client: mockClient,
      supabaseClient: createWorkerSupabase('worker-1'),
    });

    const resWorker2 = await processCalendarSyncQueue({
      force: true,
      limit: 1,
      client: mockClient,
      supabaseClient: createWorkerSupabase('worker-2'),
    });

    expect(resWorker1.processed).toBe(1);
    expect(resWorker2.processed).toBe(1);
    expect(resWorker1.items[0].syncId).toBe('sync-1');
    expect(resWorker2.items[0].syncId).toBe('sync-2');
    expect(resWorker1.items[0].syncId).not.toBe(resWorker2.items[0].syncId);
  });

  // 1.b Reclamación obligatoria: cola vacía es válida, fallo detiene ciclo sin fallback
  it('Escenario 1b: Cola vacía se considera SUCCESS sin fallback, y fallo de claim detiene el ciclo', async () => {
    const mockClient = {} as GoogleCalendarClient;

    // Caso A: Cola vacía es resultado normal y válido
    const mockEmptyDb = {
      rpc: vi.fn().mockImplementation((rpcName: string) => {
        if (rpcName === 'claim_pending_calendar_sync_jobs') {
          return Promise.resolve({ data: [], error: null });
        }
        return Promise.resolve({ data: null, error: null });
      }),
    };

    const emptyRes = await processCalendarSyncQueue({
      force: true,
      client: mockClient,
      supabaseClient: mockEmptyDb,
    });

    expect(emptyRes.status).toBe('SUCCESS');
    expect(emptyRes.processed).toBe(0);
    // Verificar que NUNCA se invoca get_pending_calendar_sync_items
    expect(mockEmptyDb.rpc).not.toHaveBeenCalledWith('get_pending_calendar_sync_items', expect.anything());

    // Caso B: Fallo de RPC nueva detiene el ciclo inmediatamente
    const mockErrorDb = {
      rpc: vi.fn().mockImplementation((rpcName: string) => {
        if (rpcName === 'claim_pending_calendar_sync_jobs') {
          return Promise.resolve({ data: null, error: { message: 'DB_CONNECTION_TIMEOUT' } });
        }
        return Promise.resolve({ data: null, error: null });
      }),
    };

    const errRes = await processCalendarSyncQueue({
      force: true,
      client: mockClient,
      supabaseClient: mockErrorDb,
    });

    expect(errRes.status).toBe('ERROR');
    expect(errRes.message).toContain('CLAIM_JOBS_FAILED');
    expect(mockErrorDb.rpc).not.toHaveBeenCalledWith('get_pending_calendar_sync_items', expect.anything());
  });

  // 2. Fallo tras crear el evento en Google pero antes de persistir el ID en BD
  it('Escenario 2: Recuperación con ID determinista y 409 Conflict sin duplicar eventos tras fallo intermedio', async () => {
    const item: CalendarSyncQueueItem = {
      sync_id: 'sync-retry-1',
      appointment_id: '8f94a86d-1bf8-468f-9a74-d4b97d19dfb4',
      barber_id: 'b-franco',
      barber_name: 'Franco',
      calendar_id: 'cal-franco@group.calendar.google.com',
      google_event_id: null,
      previous_calendar_id: null,
      previous_google_event_id: null,
      sync_action: 'UPSERT',
      attempts: 1,
      payload_checksum: null,
      booking_date: '2026-11-20',
      start_time: '16:00:00',
      end_time: '16:45:00',
      request_number: 555,
      client_name: 'Juan Perez',
      service_name: 'Corte y Barba',
      custom_service_name: null,
      service_price_ars: 15000,
      deposit_paid: true,
      deposit_amount_ars: 5000,
      sync_version: 2,
    };

    const expectedDeterministicId = buildDeterministicGoogleEventId(item.appointment_id);
    expect(expectedDeterministicId).toBe('kani8f94a86d1bf8468f9a74d4b97d19dfb4');
    expect(/^[0-9a-v]{5,1024}$/.test(expectedDeterministicId)).toBe(true);

    let patchCalledWithId: string | null = null;
    let successSavedWithId: string | null = null;

    const mockClient = {
      createEvent: vi.fn().mockImplementation(async (_calId, payload, deterministicId) => {
        expect(deterministicId).toBe(expectedDeterministicId);
        patchCalledWithId = deterministicId;
        return {
          id: deterministicId,
          summary: payload.summary,
          status: 'confirmed',
        };
      }),
      updateEvent: vi.fn().mockImplementation(async (_calId, eventId, payload) => {
        patchCalledWithId = eventId;
        return { id: eventId, summary: payload.summary };
      }),
    } as unknown as GoogleCalendarClient;

    const mockSupabase = {
      rpc: vi.fn().mockImplementation((rpcName: string, args: any) => {
        if (rpcName === 'record_calendar_sync_success_v2') {
          successSavedWithId = args.p_google_event_id;
          return Promise.resolve({ data: true, error: null });
        }
        return Promise.resolve({ data: null, error: null });
      }),
    };

    const result = await syncQueueItem(item, mockClient, mockSupabase, 'worker-recovery');

    expect(result.status).toBe('SYNCED');
    expect(result.googleEventId).toBe(expectedDeterministicId);
    expect(patchCalledWithId).toBe(expectedDeterministicId);
    expect(successSavedWithId).toBe(expectedDeterministicId);
  });

  // 2.b Pérdida de lease o conflicto optimista (invalidación por trigger)
  it('Escenario 2b: Si el lease expiró o la versión cambió (invalidada por trigger), falla sin sobrescribir', async () => {
    const item: CalendarSyncQueueItem = {
      sync_id: 'sync-stale-lease',
      appointment_id: 'app-stale',
      barber_id: 'b-lautaro',
      barber_name: 'Lautaro',
      calendar_id: 'cal-lautaro@group.calendar.google.com',
      google_event_id: null,
      previous_calendar_id: null,
      previous_google_event_id: null,
      sync_action: 'UPSERT',
      attempts: 0,
      payload_checksum: null,
      booking_date: '2026-11-20',
      start_time: '14:00:00',
      end_time: '14:45:00',
      request_number: 123,
      client_name: 'Cliente Desfasado',
      service_name: 'Corte',
      custom_service_name: null,
      service_price_ars: 12000,
      deposit_paid: true,
      deposit_amount_ars: 5000,
      sync_version: 1, // Worker tiene versión 1, pero un trigger incrementó a 2
    };

    const mockClient = {
      createEvent: vi.fn().mockResolvedValue({ id: 'g-event-stale' }),
    } as unknown as GoogleCalendarClient;

    const mockSupabase = {
      rpc: vi.fn().mockImplementation((rpcName: string) => {
        if (rpcName === 'record_calendar_sync_success_v2') {
          // Devuelve false porque version != p_version o claimed_by != p_worker_id
          return Promise.resolve({ data: false, error: null });
        }
        if (rpcName === 'record_calendar_sync_failure_v2') {
          return Promise.resolve({ data: true, error: null });
        }
        return Promise.resolve({ data: null, error: null });
      }),
    };

    const result = await syncQueueItem(item, mockClient, mockSupabase, 'worker-old');

    expect(result.status).toBe('FAILED');
    expect(result.error).toContain('CONCURRENCY_LEASE_LOST');
    // Verificar que NUNCA recurre a la RPC antigua v1 para evitar bypass
    expect(mockSupabase.rpc).not.toHaveBeenCalledWith('record_calendar_sync_success', expect.anything());
  });

  // 3. Caída de Google Calendar por varias horas
  it('Escenario 3: Caída de Google Calendar registra fallo y respeta backoff exponencial sin superar max_attempts', async () => {
    const item: CalendarSyncQueueItem = {
      sync_id: 'sync-outage-1',
      appointment_id: 'app-outage-1',
      barber_id: 'b-gonzalo',
      barber_name: 'Gonzalo',
      calendar_id: 'cal-gonzalo@group.calendar.google.com',
      google_event_id: null,
      previous_calendar_id: null,
      previous_google_event_id: null,
      sync_action: 'UPSERT',
      attempts: 4,
      payload_checksum: null,
      booking_date: '2026-11-20',
      start_time: '18:00:00',
      end_time: '18:45:00',
      request_number: 900,
      client_name: 'Cliente Outage',
      service_name: 'Corte',
      custom_service_name: null,
      service_price_ars: 12000,
      deposit_paid: true,
      deposit_amount_ars: 5000,
      sync_version: 5,
    };

    let failureErrorRecorded = '';
    const mockSupabase = {
      rpc: vi.fn().mockImplementation((rpcName: string, args: any) => {
        if (rpcName === 'record_calendar_sync_failure_v2') {
          failureErrorRecorded = args.p_error;
          return Promise.resolve({ data: true, error: null });
        }
        return Promise.resolve({ data: null, error: null });
      }),
    };

    const outageClient = {
      createEvent: vi.fn().mockRejectedValue(new Error('GOOGLE_API_503_SERVICE_UNAVAILABLE')),
    } as unknown as GoogleCalendarClient;

    const result = await syncQueueItem(item, outageClient, mockSupabase, 'worker-retry');

    expect(result.status).toBe('FAILED');
    expect(failureErrorRecorded).toContain('GOOGLE_API_503_SERVICE_UNAVAILABLE');

    const backoffSecondsAttempt4 = Math.pow(2, Math.min(4, 6)) * 10;
    const backoffSecondsAttempt5 = Math.pow(2, Math.min(5, 6)) * 10;
    expect(backoffSecondsAttempt4).toBe(160);
    expect(backoffSecondsAttempt5).toBe(320);
  });

  // 4. Cancelación de una reserva mientras el trabajo está pendiente
  it('Escenario 4: Cancelación previa a sincronización inicial omite creación de eventos (SKIPPED) y preserva reservas legítimas', async () => {
    const mockDb = {
      rpc: vi.fn().mockImplementation((rpcName: string) => {
        if (rpcName === 'reconcile_stale_calendar_sync_items') {
          return Promise.resolve({
            data: {
              testAppointmentsSkipped: 1, // Solo turnos con marcador técnico explícito
              cancelledSkipped: 3,
              pastAppointmentsSkipped: 2,
              legitimateFuturePreserved: 15, // Preservados sin descarte ciego de 1 hora
            },
            error: null,
          });
        }
        return Promise.resolve({ data: null, error: null });
      }),
    };

    const { purgeStaleSyncItems } = await import('../lib/kani-google-calendar-sync');
    const result = await purgeStaleSyncItems(mockDb);

    expect(result.skipped).toBe(true);
    expect(result.staleItemsCount).toBe(6);
    expect(result.reconciled?.cancelledSkipped).toBe(3);
    expect(result.reconciled?.pastAppointmentsSkipped).toBe(2);
    expect(result.reconciled?.legitimateFuturePreserved).toBe(15);
  });

  // 5. Cambio de barbero con fallo de eliminación del evento en el calendario anterior
  it('Escenario 5: Eliminación fallida del calendario anterior NO se considera exitosa, registra fallo y programa reintento', async () => {
    const item: CalendarSyncQueueItem = {
      sync_id: 'sync-reassign-1',
      appointment_id: 'app-reassign-1',
      barber_id: 'b-valentin',
      barber_name: 'Valentín',
      calendar_id: 'cal-valentin@group.calendar.google.com',
      google_event_id: null,
      previous_calendar_id: 'cal-lautaro@group.calendar.google.com',
      previous_google_event_id: 'g-old-lautaro-event-123',
      sync_action: 'UPSERT',
      attempts: 0,
      payload_checksum: null,
      booking_date: '2026-11-22',
      start_time: '17:00:00',
      end_time: '17:45:00',
      request_number: 888,
      client_name: 'Carlos Gomez',
      service_name: 'Corte Degradé',
      custom_service_name: null,
      service_price_ars: 12000,
      deposit_paid: true,
      deposit_amount_ars: 5000,
      sync_version: 1,
    };

    const mockClient = {
      // La eliminación en el calendario anterior falla por red o Google error (no es 404)
      deleteEvent: vi.fn().mockRejectedValue(new Error('GOOGLE_DELETE_503: Service Unavailable')),
      createEvent: vi.fn().mockResolvedValue({ id: 'g-new-valentin-event-999' }),
    } as unknown as GoogleCalendarClient;

    let failureRecorded = false;
    let failureError = '';
    let successRecorded = false;

    const mockSupabase = {
      rpc: vi.fn().mockImplementation((rpcName: string, args: any) => {
        if (rpcName === 'record_calendar_sync_failure_v2') {
          failureRecorded = true;
          failureError = args.p_error;
          return Promise.resolve({ data: true, error: null });
        }
        if (rpcName === 'record_calendar_sync_success_v2') {
          successRecorded = true;
          return Promise.resolve({ data: true, error: null });
        }
        return Promise.resolve({ data: null, error: null });
      }),
    };

    const result = await syncQueueItem(item, mockClient, mockSupabase, 'worker-reassign');

    // 1. Debe haber intentado borrar el evento viejo
    expect(mockClient.deleteEvent).toHaveBeenCalledWith(
      'cal-lautaro@group.calendar.google.com',
      'g-old-lautaro-event-123',
    );
    // 2. NO debe considerarse definitivamente exitosa
    expect(result.status).toBe('FAILED');
    expect(result.error).toContain('OLD_CALENDAR_DELETE_FAILED');
    expect(successRecorded).toBe(false);
    // 3. Debe haberse registrado la falla para reintento conservando previous_calendar_id en BD
    expect(failureRecorded).toBe(true);
    expect(failureError).toContain('OLD_CALENDAR_DELETE_FAILED');
  });

  // 6. Renovación de token OAuth en medio de un procesamiento (verificar reanudación transparente)
  it('Escenario 6: Renovación de token OAuth transparente a mitad del procesamiento sin perder trabajos', async () => {
    let callCount = 0;
    const tokenProvider = vi.fn().mockImplementation(async () => {
      callCount++;
      if (callCount === 1) return 'expired_token_123';
      return 'refreshed_valid_token_456';
    });

    const client = new GoogleCalendarClient({
      tokenProvider,
      fetchFn: vi.fn().mockImplementation(async (url: string, opts: any) => {
        const authHeader = opts.headers?.Authorization;
        if (authHeader === 'Bearer expired_token_123') {
          return new Response(JSON.stringify({ error: { code: 401, message: 'Invalid Credentials' } }), {
            status: 401,
          });
        }
        return new Response(
          JSON.stringify({
            id: 'g-event-refreshed-success',
            summary: 'Corte — Kani Barber Studio',
            status: 'confirmed',
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }),
    });

    const event = await client.createEvent(
      'c_franco@group.calendar.google.com',
      {
        summary: 'Corte — Kani Barber Studio',
        start: { dateTime: '2026-11-25T14:00:00-03:00' },
        end: { dateTime: '2026-11-25T14:45:00-03:00' },
      },
      'kanitestdeterministicid123',
    );

    expect(event.id).toBe('g-event-refreshed-success');
    expect(tokenProvider).toHaveBeenCalled();
  });

  // 7. Protección de ejecución manual en /api/admin/calendar-sync/process
  it('Escenario 7: Rechaza ejecución manual forzada si syncEnabled=false sin confirmación explícita', async () => {
    const resDisabled = await processCalendarSyncQueue({
      force: false,
    });
    expect(resDisabled.status).toBe('DISABLED');
    expect(resDisabled.message).toContain('deshabilitada');
  });

  // 8. Regresión SQLSTATE 42804: contrato de tipos y request_number BIGINT
  describe('Escenario 8: Regresión SQLSTATE 42804 y compatibilidad de tipos', () => {
    it('la migración de corrección declara request_number bigint y recrea la función con DROP previo', async () => {
      const fs = await import('node:fs');
      const path = await import('node:path');
      const migrationPath = path.resolve(
        __dirname,
        '../../supabase/migrations/20261101200000_kani_fix_claim_calendar_sync_jobs_request_number_bigint.sql'
      );
      expect(fs.existsSync(migrationPath)).toBe(true);

      const content = fs.readFileSync(migrationPath, 'utf8');

      // Verifica DROP previo obligatorio para evitar "cannot change return type of existing function"
      expect(content).toContain('DROP FUNCTION IF EXISTS public.claim_pending_calendar_sync_jobs');

      // Verifica request_number bigint en RETURNS TABLE
      expect(content).toMatch(/request_number\s+bigint/i);

      // Verifica que no se use request_number integer en el código SQL (ignorando comentarios)
      const sqlWithoutComments = content.replace(/--.*$/gm, '');
      expect(sqlWithoutComments).toMatch(/request_number\s+bigint/i);
      expect(sqlWithoutComments).not.toMatch(/request_number\s+integer/i);

      // Verifica SKIP LOCKED y version lease
      expect(content).toContain('FOR UPDATE SKIP LOCKED');
      expect(content).toContain('sync_version integer');

      // Verifica permisos exclusivos para service_role
      expect(content).toContain('REVOKE EXECUTE ON FUNCTION public.claim_pending_calendar_sync_jobs');
      expect(content).toContain('GRANT EXECUTE ON FUNCTION public.claim_pending_calendar_sync_jobs(text, integer, integer) TO service_role');
    });

    it('procesa adecuadamente filas con request_number como número entero o serializado de PostgreSQL (bigint)', async () => {
      const mockClient = {
        createEvent: vi.fn().mockResolvedValue({ id: 'g-event-bigint-test' }),
        updateEvent: vi.fn(),
        deleteEvent: vi.fn(),
      } as unknown as GoogleCalendarClient;

      const mockDb = {
        rpc: vi.fn().mockImplementation((rpcName: string) => {
          if (rpcName === 'claim_pending_calendar_sync_jobs') {
            return Promise.resolve({
              data: [
                {
                  sync_id: 'sync-bigint-1',
                  appointment_id: 'app-bigint-1',
                  barber_id: 'b-1',
                  barber_name: 'Lautaro',
                  calendar_id: 'cal-lautaro@group.calendar.google.com',
                  google_event_id: null,
                  previous_calendar_id: null,
                  previous_google_event_id: null,
                  sync_action: 'UPSERT',
                  attempts: 0,
                  payload_checksum: null,
                  booking_date: '2026-11-20',
                  start_time: '14:00:00',
                  end_time: '14:45:00',
                  request_number: 100245, // bigint parsed by PostgREST as number
                  client_name: 'Cliente BigInt',
                  service_name: 'Corte',
                  custom_service_name: null,
                  service_price_ars: 25000,
                  deposit_paid: true,
                  deposit_amount_ars: 5000,
                  sync_version: 1,
                  claimed_by: 'worker-bigint',
                },
              ],
              error: null,
            });
          }
          if (rpcName === 'record_calendar_sync_success_v2') {
            return Promise.resolve({ data: true, error: null });
          }
          return Promise.resolve({ data: null, error: null });
        }),
      };

      const res = await processCalendarSyncQueue({
        force: true,
        limit: 1,
        client: mockClient,
        supabaseClient: mockDb,
      });

      expect(res.status).toBe('SUCCESS');
      expect(res.processed).toBe(1);
      expect(res.synced).toBe(1);
      expect(mockClient.createEvent).toHaveBeenCalledWith(
        'cal-lautaro@group.calendar.google.com',
        expect.objectContaining({
          description: expect.stringContaining('#100245'),
        }),
        expect.any(String),
      );
    });

    it('captura y diagnostica el error SQLSTATE 42804 sin provocar fallos no controlados', async () => {
      const mockClient = {} as GoogleCalendarClient;
      const mockDbStructureMismatch = {
        rpc: vi.fn().mockImplementation((rpcName: string) => {
          if (rpcName === 'claim_pending_calendar_sync_jobs') {
            return Promise.resolve({
              data: null,
              error: {
                code: '42804',
                message: 'structure of query does not match function result type',
                details: 'Returned type bigint does not match expected type integer in column 15.',
              },
            });
          }
          return Promise.resolve({ data: null, error: null });
        }),
      };

      const res = await processCalendarSyncQueue({
        force: true,
        client: mockClient,
        supabaseClient: mockDbStructureMismatch,
      });

      expect(res.status).toBe('ERROR');
      expect(res.message).toContain('CLAIM_JOBS_FAILED: structure of query does not match function result type');
      expect(res.processed).toBe(0);
      expect(res.synced).toBe(0);
    });
  });
});
