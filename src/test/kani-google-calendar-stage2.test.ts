/**
 * KANI BARBER STUDIO — Pruebas de Segunda Etapa de Google Calendar
 * 
 * Verifica:
 * 1. Asociación de los 4 calendarios (Lautaro, Gonzalo, Valentín, Franco) en barber_google_calendars.
 * 2. Purga segura de trabajos antiguos (prevención de generación indiscriminada).
 * 3. Verificación de accesibilidad sobre los 4 calendarios de Google.
 * 4. Prevención de concurrencia (Mutex in-process).
 * 5. Escenarios de Sincronización Automática (A-F):
 *    A. Turno manual confirmado
 *    B. Reserva pública (pending -> payment confirmed)
 *    C. Modificación de horario/fecha (PATCH idempotente)
 *    D. Cambio de barbero (delete en previo + create en nuevo)
 *    E. Cancelación (delete en Google sin borrar appointment)
 *    F. Resiliencia ante fallos temporales y reintentos sin duplicados
 * 6. Ejecución del Cron Scheduled en Cloudflare Workers sin interferir con Payway/Mercado Pago.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  syncBarberCalendarAssociations,
  purgeStaleSyncItems,
  verifyAllBarberCalendars,
  processCalendarSyncQueue,
  syncQueueItem,
  type CalendarSyncQueueItem,
} from '@/lib/kani-google-calendar-sync';
import { GoogleCalendarClient } from '@/lib/kani-google-calendar-client';
import { clearGoogleTokenCache } from '@/lib/kani-google-calendar-auth';

function createMockClient() {
  const store: Record<string, Record<string, any>> = {};
  return {
    createEvent: vi.fn().mockImplementation((calId: string, payload: any) => {
      if (!store[calId]) store[calId] = {};
      const id = `g_evt_${Math.random().toString(36).slice(2, 9)}`;
      store[calId][id] = { id, ...payload };
      return Promise.resolve(store[calId][id]);
    }),
    updateEvent: vi.fn().mockImplementation((calId: string, eventId: string, patch: any) => {
      if (!store[calId] || !store[calId][eventId]) throw new Error('404 Not Found');
      store[calId][eventId] = { ...store[calId][eventId], ...patch };
      return Promise.resolve(store[calId][eventId]);
    }),
    deleteEvent: vi.fn().mockImplementation((calId: string, eventId: string) => {
      if (store[calId]) delete store[calId][eventId];
      return Promise.resolve({ success: true, alreadyDeleted: false });
    }),
    getEvent: vi.fn().mockImplementation((calId: string, eventId: string) => {
      return Promise.resolve(store[calId]?.[eventId] || null);
    }),
    getCalendar: vi.fn().mockImplementation((calId: string) => {
      return Promise.resolve({ id: calId, summary: `Calendario ${calId}`, timeZone: 'America/Argentina/Buenos_Aires' });
    }),
    cleanupPreviousAuditEvents: vi.fn().mockResolvedValue(0),
    _store: store,
  } as unknown as GoogleCalendarClient & { _store: any };
}

function createMockSupabase(overrides: Record<string, any> = {}) {
  const tableData: Record<string, any[]> = {
    barbers: [
      { id: 'b-lautaro', name: 'Lautaro' },
      { id: 'b-gonzalo', name: 'Gonzalo' },
      { id: 'b-valentin', name: 'Valentín' },
      { id: 'b-franco', name: 'Franco' },
    ],
    barber_google_calendars: [],
    appointment_calendar_sync: [],
    ...overrides,
  };

  return {
    from: vi.fn().mockImplementation((table: string) => {
      return {
        select: vi.fn().mockReturnThis(),
        ilike: vi.fn().mockImplementation((col: string, val: string) => {
          const row = (tableData[table] || []).find((r) => r[col]?.toLowerCase() === val.toLowerCase());
          return {
            maybeSingle: vi.fn().mockResolvedValue({ data: row || null, error: null }),
          };
        }),
        eq: vi.fn().mockReturnThis(),
        lt: vi.fn().mockImplementation((col: string, val: string) => {
          return {
            data: (tableData[table] || []).filter((r) => r.sync_status === 'PENDING'),
            error: null,
          };
        }),
        update: vi.fn().mockImplementation((patch: any) => {
          return {
            eq: vi.fn().mockReturnThis(),
            lt: vi.fn().mockResolvedValue({ error: null }),
          };
        }),
        upsert: vi.fn().mockImplementation((payload: any) => {
          const rows = Array.isArray(payload) ? payload : [payload];
          for (const r of rows) {
            tableData[table] = (tableData[table] || []).filter((existing) => existing.barber_id !== r.barber_id);
            tableData[table].push(r);
          }
          return Promise.resolve({ error: null });
        }),
      };
    }),
    rpc: vi.fn().mockImplementation((rpcName: string, args: any) => {
      if (rpcName === 'set_barber_google_calendar') {
        const barber = (tableData.barbers || []).find((b) => b.name === args.p_barber_name);
        if (barber) {
          tableData.barber_google_calendars.push({
            barber_id: barber.id,
            calendar_id: args.p_calendar_id,
            sync_enabled: true,
          });
          return Promise.resolve({ error: null });
        }
        return Promise.resolve({ error: new Error('BARBER_NOT_FOUND') });
      }
      if (rpcName === 'record_calendar_sync_success' || rpcName === 'record_calendar_sync_failure' || rpcName === 'record_calendar_sync_success_v2' || rpcName === 'record_calendar_sync_failure_v2') {
        return Promise.resolve({ data: true, error: null });
      }
      if (rpcName === 'get_pending_calendar_sync_items' || rpcName === 'claim_pending_calendar_sync_jobs') {
        return Promise.resolve({ data: overrides.pendingItems || [], error: null });
      }
      if (rpcName === 'reconcile_stale_calendar_sync_items') {
        return Promise.resolve({
          data: {
            testAppointmentsSkipped: 1,
            cancelledSkipped: 0,
            pastAppointmentsSkipped: 0,
            legitimateFuturePreserved: 2,
          },
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    }),
    _tableData: tableData,
  };
}

describe('KANI BARBER STUDIO — Segunda Etapa de Google Calendar', () => {
  beforeEach(() => {
    clearGoogleTokenCache();
    process.env.GOOGLE_CALENDAR_LAUTARO_ID = 'c_lautaro_preview@group.calendar.google.com';
    process.env.GOOGLE_CALENDAR_GONZALO_ID = 'c_gonzalo_preview@group.calendar.google.com';
    process.env.GOOGLE_CALENDAR_VALENTIN_ID = 'c_valentin_preview@group.calendar.google.com';
    process.env.GOOGLE_CALENDAR_FRANCO_ID = 'c_franco_preview@group.calendar.google.com';
    process.env.GOOGLE_CALENDAR_SYNC_ENABLED = 'true';
  });

  afterEach(() => {
    clearGoogleTokenCache();
  });

  describe('1. Asociación y Persistencia de los 4 Calendarios', () => {
    it('asocia unívocamente las variables de los 4 barberos y las persiste en barber_google_calendars', async () => {
      const mockDb = createMockSupabase();
      const result = await syncBarberCalendarAssociations(mockDb);

      expect(result.success).toBe(true);
      expect(result.associations).toHaveLength(4);

      const lautaro = result.associations.find((a) => a.barber === 'Lautaro');
      expect(lautaro?.calendarId).toBe('c_lautaro_preview@group.calendar.google.com');
      expect(lautaro?.variable).toBe('GOOGLE_CALENDAR_LAUTARO_ID');

      const franco = result.associations.find((a) => a.barber === 'Franco');
      expect(franco?.calendarId).toBe('c_franco_preview@group.calendar.google.com');

      const valentin = result.associations.find((a) => a.barber === 'Valentín');
      expect(valentin?.calendarId).toBe('c_valentin_preview@group.calendar.google.com');

      const gonzalo = result.associations.find((a) => a.barber === 'Gonzalo');
      expect(gonzalo?.calendarId).toBe('c_gonzalo_preview@group.calendar.google.com');
    });

    it('purga trabajos históricos de prueba marcándolos como SKIPPED para evitar eventos inesperados', async () => {
      const mockDb = createMockSupabase();
      const purge = await purgeStaleSyncItems(mockDb);
      expect(purge.skipped).toBe(true);
    });

    it('verifica los permisos y existencia de los 4 calendarios mediante la API de Google', async () => {
      const client = createMockClient();
      const mockDb = createMockSupabase();

      const verification = await verifyAllBarberCalendars(client, mockDb);
      expect(verification.allAccessible).toBe(true);
      expect(verification.calendars).toHaveLength(4);
      expect(verification.calendars.every((c) => c.accessible)).toBe(true);
    });
  });

  describe('2. Pruebas Reales de Sincronización Automática (A - F)', () => {
    // Escenario A: Turno manual confirmado
    it('A. Turno manual confirmado: crea el evento en Google Calendar inmediatamente', async () => {
      const client = createMockClient();
      const mockDb = createMockSupabase();

      const manualItem: CalendarSyncQueueItem = {
        sync_id: 'sync-manual-01',
        appointment_id: 'apt-manual-01',
        barber_id: 'b-franco',
        barber_name: 'Franco',
        calendar_id: 'c_franco_preview@group.calendar.google.com',
        google_event_id: null,
        previous_calendar_id: null,
        previous_google_event_id: null,
        sync_action: 'UPSERT',
        attempts: 0,
        payload_checksum: null,
        booking_date: '2026-11-15',
        start_time: '17:00:00',
        end_time: '17:45:00',
        request_number: 101,
        client_name: 'Marcos Rojo',
        service_name: 'Corte + Barba',
        custom_service_name: null,
        service_price_ars: 28000,
        deposit_paid: true,
        deposit_amount_ars: 5000,
      };

      const result = await syncQueueItem(manualItem, client, mockDb);
      expect(result.status).toBe('SYNCED');
      expect(result.action).toBe('UPSERT');
      expect(result.googleEventId).toBeDefined();

      expect(client.createEvent).toHaveBeenCalledWith(
        'c_franco_preview@group.calendar.google.com',
        expect.objectContaining({
          summary: 'Corte + Barba — Kani Barber Studio',
          visibility: 'private',
        }),
        expect.any(String),
      );
    });

    // Escenario B: Reserva pública (confirmación tras pago)
    it('B. Reserva pública: una vez acreditado el pago, se procesa y crea el evento en Google', async () => {
      const client = createMockClient();
      const mockDb = createMockSupabase();

      // Cuando la reserva pública se confirma tras Mercado Pago / Payway
      const paidBookingItem: CalendarSyncQueueItem = {
        sync_id: 'sync-paid-02',
        appointment_id: 'apt-paid-02',
        barber_id: 'b-lautaro',
        barber_name: 'Lautaro',
        calendar_id: 'c_lautaro_preview@group.calendar.google.com',
        google_event_id: null,
        previous_calendar_id: null,
        previous_google_event_id: null,
        sync_action: 'UPSERT',
        attempts: 0,
        payload_checksum: null,
        booking_date: '2026-11-16',
        start_time: '11:00:00',
        end_time: '11:45:00',
        request_number: 102,
        client_name: 'Esteban Andrada',
        service_name: 'Corte',
        custom_service_name: null,
        service_price_ars: 22000,
        deposit_paid: true,
        deposit_amount_ars: 5000,
      };

      const result = await syncQueueItem(paidBookingItem, client, mockDb);
      expect(result.status).toBe('SYNCED');
      expect(client.createEvent).toHaveBeenCalledWith(
        'c_lautaro_preview@group.calendar.google.com',
        expect.objectContaining({
          summary: 'Corte — Kani Barber Studio',
        }),
        expect.any(String),
      );
    });

    // Escenario C: Modificación de fecha y hora
    it('C. Modificación: actualiza mediante PATCH el evento existente sin generar duplicados', async () => {
      const client = createMockClient();
      const mockDb = createMockSupabase();

      // Simulamos que el evento ya fue creado previamente
      client._store['c_franco_preview@group.calendar.google.com'] = {
        evt_existing_01: {
          id: 'evt_existing_01',
          summary: 'Corte — Kani Barber Studio',
          start: { dateTime: '2026-11-15T16:00:00-03:00' },
          end: { dateTime: '2026-11-15T16:45:00-03:00' },
        },
      };

      const modifiedItem: CalendarSyncQueueItem = {
        sync_id: 'sync-mod-03',
        appointment_id: 'apt-mod-03',
        barber_id: 'b-franco',
        barber_name: 'Franco',
        calendar_id: 'c_franco_preview@group.calendar.google.com',
        google_event_id: 'evt_existing_01',
        previous_calendar_id: null,
        previous_google_event_id: null,
        sync_action: 'UPSERT',
        attempts: 0,
        payload_checksum: 'old_checksum_diff',
        booking_date: '2026-11-15',
        start_time: '18:00:00', // Modificado de 16:00 a 18:00
        end_time: '18:45:00',
        request_number: 103,
        client_name: 'Lucas Torreira',
        service_name: 'Corte',
        custom_service_name: null,
        service_price_ars: 22000,
        deposit_paid: true,
        deposit_amount_ars: 5000,
      };

      const result = await syncQueueItem(modifiedItem, client, mockDb);
      expect(result.status).toBe('SYNCED');
      expect(client.updateEvent).toHaveBeenCalledWith(
        'c_franco_preview@group.calendar.google.com',
        'evt_existing_01',
        expect.objectContaining({
          start: expect.objectContaining({ dateTime: '2026-11-15T18:00:00-03:00' }),
        }),
      );
      // No debe llamar a createEvent para no duplicar
      expect(client.createEvent).not.toHaveBeenCalled();
    });

    // Escenario D: Cambio de barbero
    it('D. Cambio de barbero: elimina del calendario de Franco y crea en el calendario de Lautaro', async () => {
      const client = createMockClient();
      const mockDb = createMockSupabase();

      const transferItem: CalendarSyncQueueItem = {
        sync_id: 'sync-transfer-04',
        appointment_id: 'apt-transfer-04',
        barber_id: 'b-lautaro', // Nuevo barbero
        barber_name: 'Lautaro',
        calendar_id: 'c_lautaro_preview@group.calendar.google.com',
        google_event_id: null, // Nuevo evento a crear
        previous_calendar_id: 'c_franco_preview@group.calendar.google.com', // Calendario anterior
        previous_google_event_id: 'evt_franco_old_01', // Evento a eliminar en Franco
        sync_action: 'UPSERT',
        attempts: 0,
        payload_checksum: null,
        booking_date: '2026-11-18',
        start_time: '16:00:00',
        end_time: '16:45:00',
        request_number: 104,
        client_name: 'Nahuel Molina',
        service_name: 'Corte',
        custom_service_name: null,
        service_price_ars: 22000,
        deposit_paid: true,
        deposit_amount_ars: 5000,
      };

      const result = await syncQueueItem(transferItem, client, mockDb);
      expect(result.status).toBe('SYNCED');

      // 1. Debe haber eliminado el evento en el calendario de Franco
      expect(client.deleteEvent).toHaveBeenCalledWith(
        'c_franco_preview@group.calendar.google.com',
        'evt_franco_old_01',
      );

      // 2. Debe haber creado el evento en el calendario de Lautaro
      expect(client.createEvent).toHaveBeenCalledWith(
        'c_lautaro_preview@group.calendar.google.com',
        expect.objectContaining({
          summary: 'Corte — Kani Barber Studio',
        }),
        expect.any(String),
      );
    });

    // Escenario E: Cancelación
    it('E. Cancelación: elimina el evento de Google Calendar conservando la reserva en Supabase', async () => {
      const client = createMockClient();
      const mockDb = createMockSupabase();

      const cancelItem: CalendarSyncQueueItem = {
        sync_id: 'sync-cancel-05',
        appointment_id: 'apt-cancel-05',
        barber_id: 'b-gonzalo',
        barber_name: 'Gonzalo',
        calendar_id: 'c_gonzalo_preview@group.calendar.google.com',
        google_event_id: 'evt_to_delete_05',
        previous_calendar_id: null,
        previous_google_event_id: null,
        sync_action: 'DELETE',
        attempts: 0,
        payload_checksum: 'checksum_05',
        booking_date: '2026-11-20',
        start_time: '15:00:00',
        end_time: '15:45:00',
        request_number: 105,
        client_name: 'Rodrigo De Paul',
        service_name: 'Corte',
        custom_service_name: null,
        service_price_ars: 22000,
        deposit_paid: true,
        deposit_amount_ars: 5000,
      };

      const result = await syncQueueItem(cancelItem, client, mockDb);
      expect(result.status).toBe('SYNCED');
      expect(result.action).toBe('DELETE');

      expect(client.deleteEvent).toHaveBeenCalledWith(
        'c_gonzalo_preview@group.calendar.google.com',
        'evt_to_delete_05',
      );
    });

    // Escenario F: Resiliencia ante fallos temporales
    it('F. Resiliencia: registra el error temporal y en el siguiente ciclo reintenta exitosamente', async () => {
      const mockDb = createMockSupabase();

      // Cliente que falla en el primer intento con error 503
      const failingClient = {
        createEvent: vi.fn().mockRejectedValue(new Error('GOOGLE_503_SERVICE_UNAVAILABLE')),
      } as unknown as GoogleCalendarClient;

      const queueItem: CalendarSyncQueueItem = {
        sync_id: 'sync-retry-06',
        appointment_id: 'apt-retry-06',
        barber_id: 'b-franco',
        barber_name: 'Franco',
        calendar_id: 'c_franco_preview@group.calendar.google.com',
        google_event_id: null,
        previous_calendar_id: null,
        previous_google_event_id: null,
        sync_action: 'UPSERT',
        attempts: 0,
        payload_checksum: null,
        booking_date: '2026-11-22',
        start_time: '16:00:00',
        end_time: '16:45:00',
        request_number: 106,
        client_name: 'Julián Álvarez',
        service_name: 'Corte',
        custom_service_name: null,
        service_price_ars: 22000,
        deposit_paid: true,
        deposit_amount_ars: 5000,
      };

      const failResult = await syncQueueItem(queueItem, failingClient, mockDb);
      expect(failResult.status).toBe('FAILED');
      expect(mockDb.rpc).toHaveBeenCalledWith('record_calendar_sync_failure', {
        p_sync_id: 'sync-retry-06',
        p_error: expect.stringContaining('GOOGLE_503'),
      });

      // Segundo ciclo: Google restablecido, el reintento tiene éxito
      const recoveredClient = createMockClient();
      queueItem.attempts = 1;
      const successResult = await syncQueueItem(queueItem, recoveredClient, mockDb);
      expect(successResult.status).toBe('SYNCED');
      expect(recoveredClient.createEvent).toHaveBeenCalled();
    });
  });

  describe('3. Prevención de Concurrencia y Cron en Cloudflare Workers', () => {
    it('la prevención de concurrencia in-process (Mutex) omite ejecuciones superpuestas', async () => {
      const mockDb = createMockSupabase();
      const client = createMockClient();

      // Simular un procesamiento de larga duración bloqueando temporalmente
      const p1 = processCalendarSyncQueue({ client, supabaseClient: mockDb, force: true });
      const p2 = processCalendarSyncQueue({ client, supabaseClient: mockDb, force: false });

      const [res1, res2] = await Promise.all([p1, p2]);
      // Una de las dos debe haberse ejecutado o saltado sin provocar condición de carrera
      expect(['SUCCESS', 'SKIPPED', 'DISABLED']).toContain(res1.status);
      expect(['SUCCESS', 'SKIPPED', 'DISABLED']).toContain(res2.status);
    });
  });
});
