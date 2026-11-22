import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  computeCancellationSignature,
  verifyCancellationSignature,
  buildCancellationUrl,
} from '../lib/kani-cancellation-token';

const mocks = vi.hoisted(() => ({
  supabaseSelect: vi.fn(),
  supabaseUpdate: vi.fn(),
  supabaseRpc: vi.fn(),
  dispatchNotification: vi.fn(),
}));

vi.mock('../lib/kani-notifications.server', () => ({
  getRuntimeEnv: vi.fn((key: string) => {
    if (key === 'KANI_APP_URL') return 'https://www.kanibarber.com';
    return undefined;
  }),
  createRequestSupabaseClient: vi.fn(async () => ({
    from: vi.fn((table: string) => {
      if (table === 'appointments') {
        return {
          select: mocks.supabaseSelect,
          update: mocks.supabaseUpdate,
        };
      }
      return {};
    }),
    rpc: mocks.supabaseRpc,
  })),
}));

vi.mock('../lib/kani-notifications.functions', () => ({
  dispatchAppointmentNotification: mocks.dispatchNotification,
  formatSpanishDateNatural: vi.fn((d: string) => `fecha ${d}`),
}));

import {
  handleGetCancellationDetails,
  handleConfirmCancellation,
  getCancellationDetailsFn,
  confirmCancellationFn,
} from '../lib/kani-cancellation.functions';

describe('Flujo de Cancelación desde Enlace Único de Kani Barber Studio', () => {
  const appointmentId = '7b96b27e-399b-432d-905d-6c589a07a123';
  let validToken: string;

  beforeEach(() => {
    vi.clearAllMocks();
    validToken = computeCancellationSignature(appointmentId);
  });

  describe('1. Seguridad del Token Criptográfico HMAC-SHA256', () => {
    it('genera enlace canónico https://www.kanibarber.com/cancelar-turno?id={uuid}&token={hmac}', () => {
      const url = buildCancellationUrl(appointmentId);
      expect(url).toBe(
        `https://www.kanibarber.com/cancelar-turno?id=${appointmentId}&token=${validToken}`
      );
      expect(url).not.toContain('email');
      expect(url).not.toContain('phone');
      expect(url).not.toContain('nombre');
    });

    it('invalida el token si se adultera el ID de reserva', () => {
      const alteredId = '7b96b27e-399b-432d-905d-6c589a07a999';
      expect(verifyCancellationSignature(alteredId, validToken)).toBe(false);
    });

    it('invalida el token si se modifica la firma', () => {
      const forgedToken = validToken.slice(0, -6) + '000000';
      expect(verifyCancellationSignature(appointmentId, forgedToken)).toBe(false);
    });
  });

  describe('2. Consulta de detalles (Abrir el enlace NO cancela el turno)', () => {
    it('rechaza consulta con token inválido', async () => {
      const result = await handleGetCancellationDetails({
        appointmentId,
        token: 'invalid-token-123',
      });
      expect(result.ok).toBe(false);
      expect(result.error).toBe('INVALID_TOKEN');
      expect(mocks.supabaseSelect).not.toHaveBeenCalled();
    });

    it('retorna los datos del turno de forma no destructiva sin cancelar', async () => {
      mocks.supabaseSelect.mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({
            data: {
              id: appointmentId,
              booking_date: '2026-12-15',
              start_time: '14:00:00',
              status: 'CONFIRMED',
              cancellation_reason: null,
              barber: { name: 'Lautaro' },
              service: { name: 'Corte y barba' },
            },
            error: null,
          }),
        }),
      });

      const result = await handleGetCancellationDetails({
        appointmentId,
        token: validToken,
      });

      expect(result.ok).toBe(true);
      expect(result.appointment).toEqual({
        id: appointmentId,
        serviceName: 'Corte y barba',
        barberName: 'Lautaro',
        bookingDate: '2026-12-15',
        startTime: '14:00:00',
        status: 'CONFIRMED',
        isPast: false,
        isWithin24Hours: false,
        canCancel: true,
        hoursUntil: expect.any(Number),
        cancellationReason: null,
      });

      // Asegura que no se haya llamado a update ni a dispatch de cancelación
      expect(mocks.supabaseUpdate).not.toHaveBeenCalled();
      expect(mocks.dispatchNotification).not.toHaveBeenCalled();
    });

    it('identifica cuando faltan menos de 24 horas y no permite cancelación autónoma', async () => {
      // Mock de fecha cercana (hoy + 2 horas)
      const now = new Date();
      const todayIso = now.toISOString().slice(0, 10);
      const apptHour = String((now.getUTCHours() - 3 + 2 + 24) % 24).padStart(2, '0');

      mocks.supabaseSelect.mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({
            data: {
              id: appointmentId,
              booking_date: todayIso,
              start_time: `${apptHour}:00:00`,
              status: 'CONFIRMED',
              cancellation_reason: null,
              barber: { name: 'Lautaro' },
              service: { name: 'Corte' },
            },
            error: null,
          }),
        }),
      });

      const result = await handleGetCancellationDetails({
        appointmentId,
        token: validToken,
      });

      expect(result.ok).toBe(true);
      expect(result.appointment?.isWithin24Hours).toBe(true);
      expect(result.appointment?.canCancel).toBe(false);
    });
  });

  describe('3. Confirmación de Cancelación e Idempotencia', () => {
    it('rechaza confirmación con token inválido', async () => {
      const result = await handleConfirmCancellation({
        appointmentId,
        token: 'forged-token',
      });
      expect(result.ok).toBe(false);
      expect(result.error).toBe('INVALID_TOKEN');
      expect(mocks.supabaseUpdate).not.toHaveBeenCalled();
    });

    it('es idempotente: si el turno ya fue cancelado, no duplica notificación ni falla', async () => {
      mocks.supabaseSelect.mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({
            data: {
              id: appointmentId,
              status: 'CANCELLED',
              booking_date: '2026-12-15',
              start_time: '14:00:00',
              client_phone: '+5491112345678',
            },
            error: null,
          }),
        }),
      });

      const result = await handleConfirmCancellation({
        appointmentId,
        token: validToken,
      });

      expect(result.ok).toBe(true);
      expect(result.alreadyCancelled).toBe(true);
      expect(mocks.supabaseUpdate).not.toHaveBeenCalled();
      expect(mocks.dispatchNotification).not.toHaveBeenCalled();
    });

    it('no permite cancelar turnos pasados', async () => {
      mocks.supabaseSelect.mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({
            data: {
              id: appointmentId,
              status: 'CONFIRMED',
              booking_date: '2025-01-01', // Pasado
              start_time: '10:00:00',
              client_phone: '+5491112345678',
            },
            error: null,
          }),
        }),
      });

      const result = await handleConfirmCancellation({
        appointmentId,
        token: validToken,
      });

      expect(result.ok).toBe(false);
      expect(result.error).toBe('APPOINTMENT_PAST');
      expect(mocks.supabaseUpdate).not.toHaveBeenCalled();
    });

    it('no permite confirmar cancelación con menos de 24 horas de anticipación', async () => {
      // Mock de turno hoy dentro de 3 horas
      const now = new Date();
      const todayIso = now.toISOString().slice(0, 10);
      const apptHour = String((now.getUTCHours() - 3 + 3 + 24) % 24).padStart(2, '0');

      mocks.supabaseSelect.mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({
            data: {
              id: appointmentId,
              status: 'CONFIRMED',
              booking_date: todayIso,
              start_time: `${apptHour}:00:00`,
              client_phone: '+5491112345678',
            },
            error: null,
          }),
        }),
      });

      const result = await handleConfirmCancellation({
        appointmentId,
        token: validToken,
      });

      expect(result.ok).toBe(false);
      expect(result.error).toBe('WITHIN_24_HOURS');
      expect(result.message).toContain('24 horas');
      expect(mocks.supabaseUpdate).not.toHaveBeenCalled();
    });

    it('cancela exitosamente turno CONFIRMED: actualiza estado, emite outbox y despacha notificación', async () => {
      // 1. Lectura del turno actual
      mocks.supabaseSelect.mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({
            data: {
              id: appointmentId,
              status: 'CONFIRMED',
              booking_date: '2026-12-20',
              start_time: '16:00:00',
              client_phone: '+5491198765432',
            },
            error: null,
          }),
        }),
      });

      // 2. Update a CANCELLED
      mocks.supabaseUpdate.mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: null }),
      });

      // 3. Outbox RPC para evento CANCELLED
      mocks.supabaseRpc.mockResolvedValue({
        data: 'claim-token-cancel-abc',
        error: null,
      });

      mocks.dispatchNotification.mockResolvedValue({ sent: true, status: 'SENT' });

      const result = await handleConfirmCancellation({
        appointmentId,
        token: validToken,
      });

      expect(result.ok).toBe(true);
      expect(mocks.supabaseUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'CANCELLED',
          cancellation_reason: 'CLIENT_CANCELLED',
        })
      );
      expect(mocks.supabaseRpc).toHaveBeenCalledWith('create_appointment_notification_event', {
        p_appointment_id: appointmentId,
        p_notification_type: 'CANCELLED',
      });
      expect(mocks.dispatchNotification).toHaveBeenCalledWith({
        appointmentId,
        claimToken: 'claim-token-cancel-abc',
        clientPhone: '+5491198765432',
      });
    });
  });

  describe('4. Accesibilidad, contraste Light/Dark y targets >= 44 px en /cancelar-turno', () => {
    it('incluye role="alert" en cancelErrorMessage, contraste legible y botones >= 44 px en modal y Estado 2', async () => {
      const fs = await import('node:fs');
      const path = await import('node:path');
      const cancelPageCode = fs.readFileSync(
        path.resolve(__dirname, '../routes/cancelar-turno.tsx'),
        'utf-8',
      );
      const routesCss = fs.readFileSync(
        path.resolve(__dirname, '../components/kani/experimental/liquid-glass-routes.css'),
        'utf-8',
      );

      expect(cancelPageCode).toMatch(/role="alert"\s+className="cancellation-error-alert/);
      expect(cancelPageCode).toContain('cancellation-status-badge');
      expect(cancelPageCode).toContain('cancellation-status-icon');
      expect(cancelPageCode).toMatch(/min-h-\[44px\] h-12 rounded-xl[\s\S]*?Volver al inicio/);
      expect(cancelPageCode).toMatch(/min-h-\[44px\] h-12 rounded-xl[\s\S]*?No, conservar turno/);
      expect(cancelPageCode).toMatch(/min-h-\[44px\] h-12 rounded-xl[\s\S]*?'Sí, cancelar turno'/);

      expect(routesCss).toMatch(/html\[data-theme="light"\][\s\S]*?\.cancellation-status-badge[\s\S]*?color:\s*#702b3a\s*!important;/);
      expect(routesCss).toMatch(/html\[data-theme="light"\][\s\S]*?\.cancellation-error-alert[\s\S]*?color:\s*#9f1239\s*!important;/);
    });
  });
});
