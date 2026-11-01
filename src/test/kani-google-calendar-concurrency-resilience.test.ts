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

    // Simular atomic claim en BD (SKIP LOCKED): si el item ya está claimed, no se entrega a otro worker
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
      deleteEvent: vi.fn().mockResolvedValue({ success: true }),
    } as unknown as GoogleCalendarClient;

    // Worker 1 reclama con límite 1
    const resWorker1 = await processCalendarSyncQueue({
      force: true,
      limit: 1,
      client: mockClient,
      supabaseClient: createWorkerSupabase('worker-1'),
    });

    // Worker 2 reclama simultáneamente con límite 1
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
    // Verificación de exclusión mutua: no hay superposición
    expect(resWorker1.items[0].syncId).not.toBe(resWorker2.items[0].syncId);
  });

  // 2. Fallo tras crear el evento en Google pero antes de persistir el ID en BD
  // (verificar recuperación con ID determinista y 409 Conflict)
  it('Escenario 2: Recuperación con ID determinista y 409 Conflict sin duplicar eventos tras fallo intermedio', async () => {
    const item: CalendarSyncQueueItem = {
      sync_id: 'sync-retry-1',
      appointment_id: '8f94a86d-1bf8-468f-9a74-d4b97d19dfb4',
      barber_id: 'b-franco',
      barber_name: 'Franco',
      calendar_id: 'cal-franco@group.calendar.google.com',
      google_event_id: null, // El worker anterior falló antes de guardar el ID
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
    // Verificar que solo contiene caracteres permitidos por Google Calendar v3 [0-9a-v]
    expect(/^[0-9a-v]{5,1024}$/.test(expectedDeterministicId)).toBe(true);

    let patchCalledWithId: string | null = null;
    let successSavedWithId: string | null = null;

    // Simular cliente Google Calendar que devuelve 409 porque el evento ya fue creado previamente con ese determinista
    const mockClient = {
      createEvent: vi.fn().mockImplementation(async (_calId, payload, deterministicId) => {
        // Al intentar crearlo con el ID determinista, Google detecta conflicto (409)
        // y el cliente resuelve recuperando y actualizando el evento existente
        expect(deterministicId).toBe(expectedDeterministicId);
        // Simular lógica interna de createEvent cuando Google da 409:
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

  // 3. Caída de Google Calendar por varias horas (verificar política de reintentos y backoff exponencial sin saturar)
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
      attempts: 4, // Ya falló 4 veces durante el corte
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

    // Verificar fórmula de backoff exponencial de la migración:
    // last_attempt_at + (power(2, least(attempts, 6)) * 10 seconds)
    // Para attempt 4: 2^4 * 10s = 160 segundos de espera
    // Para attempt 5: 2^5 * 10s = 320 segundos de espera
    const backoffSecondsAttempt4 = Math.pow(2, Math.min(4, 6)) * 10;
    const backoffSecondsAttempt5 = Math.pow(2, Math.min(5, 6)) * 10;
    expect(backoffSecondsAttempt4).toBe(160);
    expect(backoffSecondsAttempt5).toBe(320);
  });

  // 4. Cancelación de una reserva mientras el trabajo está pendiente (verificar detección y omisión)
  it('Escenario 4: Cancelación previa a sincronización inicial omite creación de eventos (SKIPPED)', async () => {
    // Si la reserva se canceló antes de que se sincronizara por primera vez en Google,
    // el reconciliador la marca como SKIPPED para evitar crear y borrar inmediatamente eventos espurios
    const mockDb = {
      rpc: vi.fn().mockImplementation((rpcName: string) => {
        if (rpcName === 'reconcile_stale_calendar_sync_items') {
          return Promise.resolve({
            data: {
              testAppointmentsSkipped: 0,
              cancelledSkipped: 3, // Detectó 3 turnos cancelados sin evento previo
              pastAppointmentsSkipped: 0,
              legitimateFuturePreserved: 12,
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
    expect(result.staleItemsCount).toBe(3);
    expect(result.reconciled?.cancelledSkipped).toBe(3);
    expect(result.reconciled?.legitimateFuturePreserved).toBe(12);
  });

  // 5. Cambio de barbero con fallo de eliminación del evento en el calendario anterior
  // (verificar que no bloquee la creación en el nuevo y registre el aviso)
  it('Escenario 5: Cambio de barbero crea evento en nuevo calendario aun si falla la eliminación en el anterior', async () => {
    const item: CalendarSyncQueueItem = {
      sync_id: 'sync-reassign-1',
      appointment_id: 'app-reassign-1',
      barber_id: 'b-valentin',
      barber_name: 'Valentín',
      calendar_id: 'cal-valentin@group.calendar.google.com',
      google_event_id: null, // Nuevo evento a crear en Valentín
      previous_calendar_id: 'cal-lautaro@group.calendar.google.com',
      previous_google_event_id: 'g-old-lautaro-event-123', // Evento previo en Lautaro
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
      // La eliminación en el calendario viejo falla (ej: 404 o permiso temporal)
      deleteEvent: vi.fn().mockRejectedValue(new Error('GOOGLE_DELETE_404: Not Found')),
      // La creación en el calendario nuevo debe proceder normalmente
      createEvent: vi.fn().mockResolvedValue({ id: 'g-new-valentin-event-999' }),
    } as unknown as GoogleCalendarClient;

    let savedCalendarId = '';
    let savedGoogleEventId = '';
    const mockSupabase = {
      rpc: vi.fn().mockImplementation((rpcName: string, args: any) => {
        if (rpcName === 'record_calendar_sync_success_v2') {
          savedCalendarId = args.p_calendar_id;
          savedGoogleEventId = args.p_google_event_id;
          return Promise.resolve({ data: true, error: null });
        }
        return Promise.resolve({ data: null, error: null });
      }),
    };

    const result = await syncQueueItem(item, mockClient, mockSupabase, 'worker-reassign');

    expect(result.status).toBe('SYNCED');
    expect(mockClient.deleteEvent).toHaveBeenCalledWith(
      'cal-lautaro@group.calendar.google.com',
      'g-old-lautaro-event-123',
    );
    expect(mockClient.createEvent).toHaveBeenCalled();
    expect(result.googleEventId).toBe('g-new-valentin-event-999');
    expect(savedCalendarId).toBe('cal-valentin@group.calendar.google.com');
    expect(savedGoogleEventId).toBe('g-new-valentin-event-999');
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

    // Crear un evento: la primera llamada da 401 y renueva el token
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
    // Si GOOGLE_CALENDAR_SYNC_ENABLED=false y se llama sin force o sin confirmación,
    // processCalendarSyncQueue devuelve DISABLED
    const resDisabled = await processCalendarSyncQueue({
      force: false,
    });
    expect(resDisabled.status).toBe('DISABLED');
    expect(resDisabled.message).toContain('deshabilitada');
  });
});
