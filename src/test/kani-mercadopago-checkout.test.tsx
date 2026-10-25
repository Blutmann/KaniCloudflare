import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  handleGetAppointmentPaymentStatus,
  handleCreateBookingOrder,
} from '@/lib/kani-mercadopago.server';

const mockRpc = vi.fn();
const mockFrom = vi.fn();

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    rpc: (...args: unknown[]) => mockRpc(...args),
    from: (...args: unknown[]) => mockFrom(...args),
  },
}));

vi.mock('@/lib/kani-down-payment', () => ({
  getDynamicDownPayment: async () => 5000,
}));

describe('Mercado Pago Checkout Pro Return Flow & Status Resolution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('Case A & E: returns isConfirmed: true and appointment details when already confirmed (refresh safe)', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'appointments') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: {
                  id: 'apt_confirmed_123',
                  request_number: 450,
                  status: 'CONFIRMED',
                  booking_date: '2026-10-28',
                  start_time: '14:30',
                  end_time: '15:15',
                  barber_id: 'barber_1',
                  service_id: 'service_1',
                  client_id: 'client_1',
                },
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === 'barbers') {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { name: 'Lautaro' } }) }) }) };
      }
      if (table === 'services') {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { name: 'Corte', price_ars: 15000 } }) }) }) };
      }
      if (table === 'clients') {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { name: 'Juan Perez', phone: '+5491100000000', email: 'juan@test.com' } }) }) }) };
      }
      return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) };
    });

    const res = await handleGetAppointmentPaymentStatus({
      appointmentId: 'apt_confirmed_123',
    });

    expect(res.success).toBe(true);
    expect(res.isConfirmed).toBe(true);
    expect(res.appointmentStatus).toBe('CONFIRMED');
    expect(res.appointment?.barberName).toBe('Lautaro');
    expect(res.appointment?.serviceName).toBe('Corte');
    expect(res.appointment?.requestNumber).toBe(450);
  });

  it('Case F: refuses to confirm appointment when query parameter status=approved is sent but order is not verified', async () => {
    // Appointment is in PENDING state in Supabase
    mockFrom.mockImplementation((table: string) => {
      if (table === 'appointments') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: {
                  id: 'apt_fake_hack',
                  request_number: 999,
                  status: 'PENDING',
                  booking_date: '2026-10-28',
                  start_time: '14:30',
                  end_time: '15:15',
                  barber_id: 'barber_1',
                  service_id: 'service_1',
                  client_id: 'client_1',
                },
                error: null,
              }),
            }),
          }),
        };
      }
      return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { name: 'Test' } }) }) }) };
    });

    // Caller provides no valid orderId or fake order
    const res = await handleGetAppointmentPaymentStatus({
      appointmentId: 'apt_fake_hack',
    });

    // Even if URL has ?status=approved in the browser, backend returns isConfirmed: false!
    expect(res.success).toBe(true);
    expect(res.isConfirmed).toBe(false);
    expect(res.appointmentStatus).toBe('PENDING');
  });

  it('Case C: returns isConfirmed: false with status PENDING when appointment is still pending', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'appointments') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: {
                  id: 'apt_pending_789',
                  request_number: 101,
                  status: 'PENDING',
                  booking_date: '2026-10-29',
                  start_time: '16:00',
                  end_time: '16:45',
                  barber_id: 'barber_1',
                  service_id: 'service_1',
                  client_id: 'client_1',
                },
                error: null,
              }),
            }),
          }),
        };
      }
      return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { name: 'Test' } }) }) }) };
    });

    const res = await handleGetAppointmentPaymentStatus({
      appointmentId: 'apt_pending_789',
    });

    expect(res.success).toBe(true);
    expect(res.isConfirmed).toBe(false);
    expect(res.appointmentStatus).toBe('PENDING');
  });

  it('creates order with returnUrls pointing to /pago/exito, /pago/error, /pago/pendiente and auto_return all', async () => {
    const globalObj = globalThis as typeof globalThis & { __env__?: Record<string, string> };
    globalObj.__env__ = {
      MERCADOPAGO_ACCESS_TOKEN: 'TEST-TOKEN-123456',
      KANI_APP_URL: 'https://kanibarberstudio-cloudflare.kanibarber.workers.dev',
    };

    let capturedPayload: any = null;
    global.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.includes('/v1/orders')) {
        capturedPayload = JSON.parse(init?.body as string);
        return {
          ok: true,
          json: async () => ({
            id: 'order_mp_888999',
            checkout_url: 'https://www.mercadopago.com.ar/checkout/v1/redirect?order_id=order_mp_888999',
          }),
        };
      }
      return { ok: true, json: async () => ({}) };
    });

    const res = await handleCreateBookingOrder({
      appointmentId: 'apt_order_urls_test',
      serviceName: 'Corte',
      barberName: 'Lautaro',
      servicePrice: 15000,
      clientName: 'Martin',
      clientEmail: 'martin@test.com',
      clientPhone: '+5491112345678',
    });

    expect(res.success).toBe(true);
    expect(capturedPayload).toBeDefined();
    expect(capturedPayload.config?.online?.auto_return).toBe('all');
    expect(capturedPayload.config?.online?.success_url).toBe(
      'https://kanibarberstudio-cloudflare.kanibarber.workers.dev/pago/exito?appointment_id=apt_order_urls_test'
    );
    expect(capturedPayload.config?.online?.failure_url).toBe(
      'https://kanibarberstudio-cloudflare.kanibarber.workers.dev/pago/error?appointment_id=apt_order_urls_test'
    );
    expect(capturedPayload.config?.online?.pending_url).toBe(
      'https://kanibarberstudio-cloudflare.kanibarber.workers.dev/pago/pendiente?appointment_id=apt_order_urls_test'
    );

    delete globalObj.__env__;
  });
});
