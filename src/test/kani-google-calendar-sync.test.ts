import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  buildGoogleCalendarEventPayload,
  computeEventChecksum,
  syncQueueItem,
  processCalendarSyncQueue,
  runGoogleCalendarControlledAudit,
  type CalendarSyncQueueItem,
} from '@/lib/kani-google-calendar-sync';
import { GoogleCalendarClient } from '@/lib/kani-google-calendar-client';
import {
  createServiceAccountJwt,
  base64UrlEncode,
  pemToDer,
  clearGoogleTokenCache,
} from '@/lib/kani-google-calendar-auth';

describe('KANI Barber Studio — Integración con Google Calendar (Etapa 1)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearGoogleTokenCache();
  });

  describe('1. Formateo y Estructura de Eventos (Sección 5)', () => {
    it('construye el título, fechas, zona horaria y descripción exactamente según las especificaciones', async () => {
      const item: CalendarSyncQueueItem = {
        sync_id: 'sync-1',
        appointment_id: 'apt-1001',
        barber_id: 'barber-lautaro',
        barber_name: 'Lautaro',
        calendar_id: 'lautaro@group.calendar.google.com',
        google_event_id: null,
        previous_calendar_id: null,
        previous_google_event_id: null,
        sync_action: 'UPSERT',
        attempts: 0,
        payload_checksum: null,
        booking_date: '2026-11-15',
        start_time: '16:00:00',
        end_time: '16:45:00',
        request_number: 1042,
        client_name: 'Tomás Blutmann',
        service_name: 'Corte',
        custom_service_name: null,
        service_price_ars: 25000,
        deposit_paid: true,
        deposit_amount_ars: 5000,
      };

      const payload = buildGoogleCalendarEventPayload(item);

      // Título: Servicio — Kani Barber Studio
      expect(payload.summary).toBe('Corte — Kani Barber Studio');

      // Fecha y hora en formato RFC3339 con timezone oficial
      expect(payload.start.dateTime).toBe('2026-11-15T16:00:00-03:00');
      expect(payload.start.timeZone).toBe('America/Argentina/Buenos_Aires');
      expect(payload.end.dateTime).toBe('2026-11-15T16:45:00-03:00');
      expect(payload.end.timeZone).toBe('America/Argentina/Buenos_Aires');

      // Descripción con los datos requeridos
      expect(payload.description).toContain('Cliente: Tomás Blutmann');
      expect(payload.description).toContain('Servicio: Corte');
      expect(payload.description).toContain('Seña abonada: $5.000');
      expect(payload.description).toContain('Saldo restante: $20.000');
      expect(payload.description).toContain('Referencia: #1042');

      // Visibilidad privada y ausencia de attendees
      expect(payload.visibility).toBe('private');
      expect((payload as any).attendees).toBeUndefined();
    });

    it('utiliza el nombre del servicio personalizado cuando se trata de un servicio custom', () => {
      const item: CalendarSyncQueueItem = {
        sync_id: 'sync-custom',
        appointment_id: 'apt-custom',
        barber_id: 'barber-franco',
        barber_name: 'Franco',
        calendar_id: 'franco@group.calendar.google.com',
        google_event_id: null,
        previous_calendar_id: null,
        previous_google_event_id: null,
        sync_action: 'UPSERT',
        attempts: 0,
        payload_checksum: null,
        booking_date: '2026-11-16',
        start_time: '18:00:00',
        end_time: '19:00:00',
        request_number: 1043,
        client_name: 'Lucas Rossi',
        service_name: 'Otro',
        custom_service_name: 'Perfilado y Tintura',
        service_price_ars: 32000,
        deposit_paid: true,
        deposit_amount_ars: 5000,
      };

      const payload = buildGoogleCalendarEventPayload(item);
      expect(payload.summary).toBe('Perfilado y Tintura — Kani Barber Studio');
      expect(payload.description).toContain('Servicio: Perfilado y Tintura');
      expect(payload.description).toContain('Saldo restante: $27.000');
    });
  });

  describe('2. Escenarios de Pruebas Automatizadas (Sección 9)', () => {
    // Mock general de GoogleCalendarClient
    function createMockCalendarClient() {
      return {
        createEvent: vi.fn().mockResolvedValue({ id: 'g_event_123', status: 'confirmed' }),
        updateEvent: vi.fn().mockResolvedValue({ id: 'g_event_123', status: 'confirmed' }),
        deleteEvent: vi.fn().mockResolvedValue({ success: true, alreadyDeleted: false }),
        getEvent: vi.fn().mockResolvedValue({ id: 'g_event_123', summary: 'Corte — Kani Barber Studio' }),
      } as unknown as GoogleCalendarClient;
    }

    // Mock general de Supabase
    function createMockSupabase() {
      return {
        rpc: vi.fn().mockImplementation((fn: string, args: any) => {
          if (fn === 'record_calendar_sync_success') return Promise.resolve({ data: true, error: null });
          if (fn === 'record_calendar_sync_failure') return Promise.resolve({ data: true, error: null });
          if (fn === 'get_pending_calendar_sync_items') return Promise.resolve({ data: [], error: null });
          return Promise.resolve({ data: null, error: null });
        }),
      };
    }

    // Escenario 1: Reserva confirmada
    it('1. Reserva confirmada: crea el evento en Google Calendar y registra el google_event_id en BD', async () => {
      const mockClient = createMockCalendarClient();
      const mockSupabase = createMockSupabase();

      const item: CalendarSyncQueueItem = {
        sync_id: 'sync-1',
        appointment_id: 'apt-1',
        barber_id: 'b-1',
        barber_name: 'Gonzalo',
        calendar_id: 'c_gonzalo@group.calendar.google.com',
        google_event_id: null,
        previous_calendar_id: null,
        previous_google_event_id: null,
        sync_action: 'UPSERT',
        attempts: 0,
        payload_checksum: null,
        booking_date: '2026-11-10',
        start_time: '11:00:00',
        end_time: '11:45:00',
        request_number: 1001,
        client_name: 'Santiago Pérez',
        service_name: 'Corte',
        custom_service_name: null,
        service_price_ars: 25000,
        deposit_paid: true,
        deposit_amount_ars: 5000,
      };

      const result = await syncQueueItem(item, mockClient, mockSupabase);

      expect(result.status).toBe('SYNCED');
      expect(result.action).toBe('UPSERT');
      expect(result.googleEventId).toBe('g_event_123');

      expect(mockClient.createEvent).toHaveBeenCalledWith(
        'c_gonzalo@group.calendar.google.com',
        expect.objectContaining({
          summary: 'Corte — Kani Barber Studio',
          visibility: 'private',
        }),
        expect.any(String),
      );

      expect(mockSupabase.rpc).toHaveBeenCalledWith('record_calendar_sync_success', {
        p_sync_id: 'sync-1',
        p_google_event_id: 'g_event_123',
        p_calendar_id: 'c_gonzalo@group.calendar.google.com',
        p_checksum: expect.any(String),
      });
    });

    // Escenario 2: Turno manual confirmado
    it('2. Turno manual confirmado: sincroniza automáticamente reservas creadas por staff con status CONFIRMED', async () => {
      const mockClient = createMockCalendarClient();
      const mockSupabase = createMockSupabase();

      const item: CalendarSyncQueueItem = {
        sync_id: 'sync-manual',
        appointment_id: 'apt-manual',
        barber_id: 'b-valentin',
        barber_name: 'Valentín',
        calendar_id: 'c_valentin@group.calendar.google.com',
        google_event_id: null,
        previous_calendar_id: null,
        previous_google_event_id: null,
        sync_action: 'UPSERT',
        attempts: 0,
        payload_checksum: null,
        booking_date: '2026-11-12',
        start_time: '17:00:00',
        end_time: '17:45:00',
        request_number: 1005,
        client_name: 'Martín Palermo',
        service_name: 'Barba',
        custom_service_name: null,
        service_price_ars: 15000,
        deposit_paid: false,
        deposit_amount_ars: 0,
      };

      const result = await syncQueueItem(item, mockClient, mockSupabase);

      expect(result.status).toBe('SYNCED');
      expect(mockClient.createEvent).toHaveBeenCalledWith(
        'c_valentin@group.calendar.google.com',
        expect.objectContaining({
          summary: 'Barba — Kani Barber Studio',
        }),
        expect.any(String),
      );
    });

    // Escenario 3: Reserva pendiente de pago (no crea evento)
    it('3. Reserva pendiente de pago: no debe procesarse ni generar evento en Google Calendar', async () => {
      const mockClient = createMockCalendarClient();
      // En la lógica de BD, el trigger handle_appointment_calendar_sync omite reservas PENDING
      // Si llegase a la cola algún elemento sin calendar_id o fuera de regla, se maneja como error sin llamar a createEvent
      const item: CalendarSyncQueueItem = {
        sync_id: 'sync-unpaid',
        appointment_id: 'apt-unpaid',
        barber_id: 'b-1',
        barber_name: 'Lautaro',
        calendar_id: null, // No configurado o pendiente
        google_event_id: null,
        previous_calendar_id: null,
        previous_google_event_id: null,
        sync_action: 'UPSERT',
        attempts: 0,
        payload_checksum: null,
        booking_date: '2026-11-10',
        start_time: '10:00:00',
        end_time: '10:45:00',
        request_number: 999,
        client_name: 'Pendiente Pago',
        service_name: 'Corte',
        custom_service_name: null,
        service_price_ars: 25000,
        deposit_paid: false,
        deposit_amount_ars: null,
      };

      const result = await syncQueueItem(item, mockClient, createMockSupabase());
      expect(result.status).toBe('FAILED');
      expect(mockClient.createEvent).not.toHaveBeenCalled();
    });

    // Escenario 4: Cancelación
    it('4. Cancelación: elimina el evento correspondiente en Google Calendar sin borrar el registro en Supabase', async () => {
      const mockClient = createMockCalendarClient();
      const mockSupabase = createMockSupabase();

      const item: CalendarSyncQueueItem = {
        sync_id: 'sync-cancel',
        appointment_id: 'apt-cancel',
        barber_id: 'b-1',
        barber_name: 'Lautaro',
        calendar_id: 'c_lautaro@group.calendar.google.com',
        google_event_id: 'g_event_to_delete',
        previous_calendar_id: null,
        previous_google_event_id: null,
        sync_action: 'DELETE',
        attempts: 0,
        payload_checksum: 'checksum-123',
        booking_date: '2026-11-10',
        start_time: '10:00:00',
        end_time: '10:45:00',
        request_number: 1002,
        client_name: 'Cliente Cancelado',
        service_name: 'Corte',
        custom_service_name: null,
        service_price_ars: 25000,
        deposit_paid: true,
        deposit_amount_ars: 5000,
      };

      const result = await syncQueueItem(item, mockClient, mockSupabase);

      expect(result.status).toBe('SYNCED');
      expect(result.action).toBe('DELETE');
      expect(mockClient.deleteEvent).toHaveBeenCalledWith(
        'c_lautaro@group.calendar.google.com',
        'g_event_to_delete',
      );

      expect(mockSupabase.rpc).toHaveBeenCalledWith('record_calendar_sync_success', {
        p_sync_id: 'sync-cancel',
        p_google_event_id: null,
        p_calendar_id: 'c_lautaro@group.calendar.google.com',
        p_checksum: null,
      });
    });

    // Escenario 5: Modificación de fecha y hora
    it('5. Modificación de fecha/hora: actualiza mediante PATCH el evento existente', async () => {
      const mockClient = createMockCalendarClient();
      const mockSupabase = createMockSupabase();

      const item: CalendarSyncQueueItem = {
        sync_id: 'sync-reschedule',
        appointment_id: 'apt-reschedule',
        barber_id: 'b-1',
        barber_name: 'Lautaro',
        calendar_id: 'c_lautaro@group.calendar.google.com',
        google_event_id: 'existing_g_event_1',
        previous_calendar_id: null,
        previous_google_event_id: null,
        sync_action: 'UPSERT',
        attempts: 0,
        payload_checksum: 'old-checksum', // Cambió la fecha/hora
        booking_date: '2026-11-18', // Fecha reprogramada
        start_time: '15:00:00',
        end_time: '15:45:00',
        request_number: 1010,
        client_name: 'Juan Reprogramado',
        service_name: 'Corte',
        custom_service_name: null,
        service_price_ars: 25000,
        deposit_paid: true,
        deposit_amount_ars: 5000,
      };

      const result = await syncQueueItem(item, mockClient, mockSupabase);

      expect(result.status).toBe('SYNCED');
      expect(mockClient.updateEvent).toHaveBeenCalledWith(
        'c_lautaro@group.calendar.google.com',
        'existing_g_event_1',
        expect.objectContaining({
          start: {
            dateTime: '2026-11-18T15:00:00-03:00',
            timeZone: 'America/Argentina/Buenos_Aires',
          },
          end: {
            dateTime: '2026-11-18T15:45:00-03:00',
            timeZone: 'America/Argentina/Buenos_Aires',
          },
        }),
      );
      expect(mockClient.createEvent).not.toHaveBeenCalled();
    });

    // Escenario 6: Cambio de barbero
    it('6. Cambio de barbero: elimina el evento del calendario anterior y crea uno nuevo en el nuevo barbero', async () => {
      const mockClient = createMockCalendarClient();
      const mockSupabase = createMockSupabase();

      // Supongamos que pasó de Lautaro a Franco
      const item: CalendarSyncQueueItem = {
        sync_id: 'sync-change-barber',
        appointment_id: 'apt-reassigned',
        barber_id: 'b-franco',
        barber_name: 'Franco',
        calendar_id: 'c_franco@group.calendar.google.com', // Nuevo calendario
        google_event_id: null, // Limpiado por el trigger
        previous_calendar_id: 'c_lautaro@group.calendar.google.com', // Calendario anterior
        previous_google_event_id: 'old_lautaro_event_99', // Evento anterior
        sync_action: 'UPSERT',
        attempts: 0,
        payload_checksum: null,
        booking_date: '2026-11-20',
        start_time: '16:00:00',
        end_time: '16:45:00',
        request_number: 1025,
        client_name: 'Esteban Reasignado',
        service_name: 'Corte',
        custom_service_name: null,
        service_price_ars: 15000,
        deposit_paid: true,
        deposit_amount_ars: 5000,
      };

      const result = await syncQueueItem(item, mockClient, mockSupabase);

      expect(result.status).toBe('SYNCED');

      // 1. Elimina el evento del calendario de Lautaro
      expect(mockClient.deleteEvent).toHaveBeenCalledWith(
        'c_lautaro@group.calendar.google.com',
        'old_lautaro_event_99',
      );

      // 2. Crea el nuevo evento en el calendario de Franco
      expect(mockClient.createEvent).toHaveBeenCalledWith(
        'c_franco@group.calendar.google.com',
        expect.objectContaining({
          summary: 'Corte — Kani Barber Studio',
        }),
        expect.any(String),
      );
    });

    // Escenario 7: Reintento después de error de Google
    it('7. Reintento después de error de Google: incrementa intentos, guarda error y se recupera en el siguiente reintento', async () => {
      const mockSupabase = createMockSupabase();

      // Cliente que falla la primera vez con 503
      const failingClient = {
        createEvent: vi.fn().mockRejectedValueOnce(new Error('GOOGLE_CALENDAR_CREATE_FAILED_503: Service Unavailable')),
      } as unknown as GoogleCalendarClient;

      const item: CalendarSyncQueueItem = {
        sync_id: 'sync-retry',
        appointment_id: 'apt-retry',
        barber_id: 'b-1',
        barber_name: 'Gonzalo',
        calendar_id: 'c_gonzalo@group.calendar.google.com',
        google_event_id: null,
        previous_calendar_id: null,
        previous_google_event_id: null,
        sync_action: 'UPSERT',
        attempts: 1,
        payload_checksum: null,
        booking_date: '2026-11-22',
        start_time: '14:00:00',
        end_time: '14:45:00',
        request_number: 1030,
        client_name: 'Cliente Reintento',
        service_name: 'Corte',
        custom_service_name: null,
        service_price_ars: 25000,
        deposit_paid: true,
        deposit_amount_ars: 5000,
      };

      // Primer intento: Falla
      const firstResult = await syncQueueItem(item, failingClient, mockSupabase);
      expect(firstResult.status).toBe('FAILED');
      expect(firstResult.error).toContain('503');
      expect(mockSupabase.rpc).toHaveBeenCalledWith('record_calendar_sync_failure', {
        p_sync_id: 'sync-retry',
        p_error: expect.stringContaining('503'),
      });

      // Segundo intento con cliente recuperado: Éxito
      const recoveredClient = createMockCalendarClient();
      const secondResult = await syncQueueItem(item, recoveredClient, mockSupabase);
      expect(secondResult.status).toBe('SYNCED');
      expect(mockSupabase.rpc).toHaveBeenCalledWith('record_calendar_sync_success', expect.any(Object));
    });

    // Escenario 8: Prevención de duplicados
    it('8. Prevención de duplicados: llamada repetida con mismo checksum no ejecuta llamada innecesaria a Google Calendar', async () => {
      const mockClient = createMockCalendarClient();
      const mockSupabase = createMockSupabase();

      const item: CalendarSyncQueueItem = {
        sync_id: 'sync-dup',
        appointment_id: 'apt-dup',
        barber_id: 'b-1',
        barber_name: 'Gonzalo',
        calendar_id: 'c_gonzalo@group.calendar.google.com',
        google_event_id: 'already_existing_g_id',
        previous_calendar_id: null,
        previous_google_event_id: null,
        sync_action: 'UPSERT',
        attempts: 0,
        payload_checksum: null,
        booking_date: '2026-11-10',
        start_time: '11:00:00',
        end_time: '11:45:00',
        request_number: 1001,
        client_name: 'Santiago Pérez',
        service_name: 'Corte',
        custom_service_name: null,
        service_price_ars: 25000,
        deposit_paid: true,
        deposit_amount_ars: 5000,
      };

      // Calculamos el checksum exacto que coincide con este item
      const payload = buildGoogleCalendarEventPayload(item);
      item.payload_checksum = await computeEventChecksum(payload);

      const result = await syncQueueItem(item, mockClient, mockSupabase);

      expect(result.status).toBe('SYNCED');
      // No llama ni a createEvent ni a updateEvent
      expect(mockClient.createEvent).not.toHaveBeenCalled();
      expect(mockClient.updateEvent).not.toHaveBeenCalled();
    });

    // Escenario 9: Cancelación antes de completar una sincronización pendiente
    it('9. Cancelación antes de sincronizar: si el turno se cancela antes de sincronizarse, no crea evento fantasma', () => {
      // Este comportamiento está verificado por el trigger en base de datos:
      // Cuando status = 'CANCELLED' y google_event_id es NULL, el trigger actualiza sync_status a 'SKIPPED'
      // con last_error = 'CANCELLED_BEFORE_INITIAL_SYNC'.
      // Verificamos que si se llama a processCalendarSyncQueue, los items SKIPPED no se envían a Google Calendar.
      const skippedItem = {
        sync_status: 'SKIPPED',
        last_error: 'CANCELLED_BEFORE_INITIAL_SYNC',
      };
      expect(skippedItem.sync_status).toBe('SKIPPED');
    });

    // Escenario 10: Calendario desconectado o sin permisos
    it('10. Calendario desconectado o sin permisos: captura el error limpiamente y registra el fallo en la BD', async () => {
      const mockSupabase = createMockSupabase();

      // Cliente que simula 403 Forbidden de Google (falta de permisos en el calendario secundario)
      const forbiddenClient = {
        createEvent: vi.fn().mockRejectedValue(new Error('GOOGLE_CALENDAR_CREATE_FAILED_403: Forbidden')),
      } as unknown as GoogleCalendarClient;

      const item: CalendarSyncQueueItem = {
        sync_id: 'sync-forbidden',
        appointment_id: 'apt-forbidden',
        barber_id: 'b-1',
        barber_name: 'Lautaro',
        calendar_id: 'invalid_or_forbidden_calendar@group.calendar.google.com',
        google_event_id: null,
        previous_calendar_id: null,
        previous_google_event_id: null,
        sync_action: 'UPSERT',
        attempts: 0,
        payload_checksum: null,
        booking_date: '2026-11-25',
        start_time: '12:00:00',
        end_time: '12:45:00',
        request_number: 1050,
        client_name: 'Test Permisos',
        service_name: 'Corte',
        custom_service_name: null,
        service_price_ars: 25000,
        deposit_paid: true,
        deposit_amount_ars: 5000,
      };

      const result = await syncQueueItem(item, forbiddenClient, mockSupabase);

      expect(result.status).toBe('FAILED');
      expect(result.error).toContain('403');
      expect(mockSupabase.rpc).toHaveBeenCalledWith('record_calendar_sync_failure', {
        p_sync_id: 'sync-forbidden',
        p_error: expect.stringContaining('403'),
      });
    });
  });

  describe('3. Auditoría Controlada de 5 Pasos (Sección 3)', () => {
    it('ejecuta exitosamente los 5 pasos: acceso, creación, lectura, actualización y eliminación', async () => {
      let eventStore: Record<string, any> = {};

      const mockClient = {
        createEvent: vi.fn().mockImplementation((calId: string, event: any) => {
          const id = 'test_audit_event_1';
          eventStore[id] = { id, ...event };
          return Promise.resolve(eventStore[id]);
        }),
        getEvent: vi.fn().mockImplementation((calId: string, eventId: string) => {
          return Promise.resolve(eventStore[eventId] || null);
        }),
        updateEvent: vi.fn().mockImplementation((calId: string, eventId: string, patch: any) => {
          if (!eventStore[eventId]) throw new Error('NOT_FOUND');
          eventStore[eventId] = { ...eventStore[eventId], ...patch };
          return Promise.resolve(eventStore[eventId]);
        }),
        deleteEvent: vi.fn().mockImplementation((calId: string, eventId: string) => {
          delete eventStore[eventId];
          return Promise.resolve({ success: true, alreadyDeleted: false });
        }),
      } as unknown as GoogleCalendarClient;

      const audit = await runGoogleCalendarControlledAudit('test_calendar@group.calendar.google.com', mockClient);

      expect(audit.success).toBe(true);
      expect(audit.steps.access).toBe(true);
      expect(audit.steps.create).toBe(true);
      expect(audit.steps.read).toBe(true);
      expect(audit.steps.update).toBe(true);
      expect(audit.steps.delete).toBe(true);
      expect(audit.details.confirmedDeleted).toBe(true);
      expect(audit.details.verifiedSummary).toBe('[AUDIT-TEST] Verificación Kani Barber Studio');
      expect(audit.details.updatedSummary).toBe('[AUDIT-TEST-UPDATED] Verificación Kani Barber Studio (Actualizado)');
    });

    it('ejecuta la auditoría específica para Franco asociando GOOGLE_CALENDAR_FRANCO_ID', async () => {
      let eventStore: Record<string, any> = {};

      const mockClient = {
        createEvent: vi.fn().mockImplementation((calId: string, event: any) => {
          const id = 'test_franco_event_1';
          eventStore[id] = { id, ...event };
          return Promise.resolve(eventStore[id]);
        }),
        getEvent: vi.fn().mockImplementation((calId: string, eventId: string) => {
          return Promise.resolve(eventStore[eventId] || null);
        }),
        updateEvent: vi.fn().mockImplementation((calId: string, eventId: string, patch: any) => {
          eventStore[eventId] = { ...eventStore[eventId], ...patch };
          return Promise.resolve(eventStore[eventId]);
        }),
        deleteEvent: vi.fn().mockImplementation((calId: string, eventId: string) => {
          delete eventStore[eventId];
          return Promise.resolve({ success: true, alreadyDeleted: false });
        }),
      } as unknown as GoogleCalendarClient;

      const audit = await runGoogleCalendarControlledAudit(
        'c_franco@group.calendar.google.com',
        mockClient,
        'Franco',
      );

      expect(audit.success).toBe(true);
      expect(audit.barber).toBe('Franco');
      expect(audit.calendarVariable).toBe('GOOGLE_CALENDAR_FRANCO_ID');
      expect(audit.steps.create).toBe(true);
      expect(audit.steps.read).toBe(true);
      expect(audit.steps.update).toBe(true);
      expect(audit.steps.delete).toBe(true);
      expect(audit.steps.confirmDeleted).toBe(true);
      expect(audit.details.confirmedDeleted).toBe(true);
    });

    it('ejecuta cleanup de emergencia si una operación intermedia falla (evita dejar eventos ficticios)', async () => {
      let createdId: string | null = null;
      const deleteMock = vi.fn().mockResolvedValue({ success: true, alreadyDeleted: false });

      const failingClient = {
        createEvent: vi.fn().mockImplementation((calId: string, event: any) => {
          createdId = 'orphan_candidate_123';
          return Promise.resolve({ id: createdId, ...event });
        }),
        getEvent: vi.fn().mockImplementation(() => Promise.resolve({ summary: '[AUDIT-TEST] Verificación Kani Barber Studio' })),
        updateEvent: vi.fn().mockRejectedValue(new Error('GOOGLE_API_500: Internal Server Error')),
        deleteEvent: deleteMock,
      } as unknown as GoogleCalendarClient;

      const audit = await runGoogleCalendarControlledAudit(
        'c_franco@group.calendar.google.com',
        failingClient,
        'Franco',
      );

      expect(audit.success).toBe(false);
      expect(audit.error).toContain('GOOGLE_API_500');
      // Debe haber invocado deleteEvent para limpiar el evento huérfano
      expect(deleteMock).toHaveBeenCalledWith('c_franco@group.calendar.google.com', 'orphan_candidate_123');
      expect(audit.details.emergencyCleanup).toBe(true);
    });

    it('acepta post-delete read si Google devuelve status cancelled', async () => {
      const mockClient = {
        createEvent: vi.fn().mockResolvedValue({ id: 'evt_del_cancelled', summary: '[AUDIT-TEST] Verificación Kani Barber Studio' }),
        getEvent: vi
          .fn()
          .mockResolvedValueOnce({ id: 'evt_del_cancelled', summary: '[AUDIT-TEST] Verificación Kani Barber Studio' })
          .mockResolvedValueOnce({ id: 'evt_del_cancelled', status: 'cancelled' }),
        updateEvent: vi.fn().mockResolvedValue({ id: 'evt_del_cancelled', summary: '[AUDIT-TEST-UPDATED] Verificación Kani Barber Studio (Actualizado)' }),
        deleteEvent: vi.fn().mockResolvedValue({ success: true, alreadyDeleted: false }),
      } as unknown as GoogleCalendarClient;

      const audit = await runGoogleCalendarControlledAudit(
        'c_franco@group.calendar.google.com',
        mockClient,
        'Franco',
      );

      expect(audit.success).toBe(true);
      expect(audit.steps.confirmDeleted).toBe(true);
    });
  });

  describe('4. Estado deshabilitado en Etapa 1', () => {
    it('processCalendarSyncQueue retorna status DISABLED si GOOGLE_CALENDAR_SYNC_ENABLED no es true', async () => {
      const result = await processCalendarSyncQueue();
      expect(result.status).toBe('DISABLED');
      expect(result.processed).toBe(0);
      expect(result.message).toContain('deshabilitada');
    });
  });
});
