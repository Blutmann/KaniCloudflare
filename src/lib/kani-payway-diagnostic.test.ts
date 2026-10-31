import { describe, expect, it, vi } from 'vitest';
import { createPaywayService, type PaywayConfig, type PaywayStore } from './kani-payway.server';
import { PAYWAY_MESSAGES, type PaywayDraft } from './kani-payway';

describe('Payway Prepare Diagnostic and Error Recovery', () => {
  const config: PaywayConfig = {
    apiBaseUrl: 'https://developers-ventasonline.payway.com.ar/api/v2',
    publicKey: 'pub_test_123',
    privateKey: 'prv_test_456',
    siteId: '12345678',
    methods: [{ id: 1, label: 'Visa' }],
  };

  const draft: PaywayDraft = {
    barber: 'Lautaro',
    serviceName: 'Corte',
    date: '2026-11-02',
    time: '10:45:00',
    name: 'Lautaro Test',
    email: 'lautaro@test.com',
    phone: '+5491122334455',
    notes: '',
  };

  it('devuelve correlationId y stage cuando config es null', async () => {
    const service = createPaywayService({ config: null, store: null });
    const res = await service.prepare(draft);

    expect(res.ready).toBe(false);
    if (!res.ready) {
      expect(res.message).toBe(PAYWAY_MESSAGES.unavailable);
      expect(res.correlationId).toBeDefined();
      expect(res.stage).toBe('config_validation');
    }
  });

  it('no expone detalles SQL 42702 al cliente pero registra diagnóstico', async () => {
    const mockStore: PaywayStore = {
      prepare: vi.fn().mockRejectedValue(
        Object.assign(new Error('column reference "start_time" is ambiguous'), {
          code: '42702',
          stage: 'prepare_payway_attempt',
          functionName: 'prepare_payway_attempt',
        })
      ),
      claim: vi.fn(),
      settle: vi.fn(),
      confirm: vi.fn(),
    };

    const service = createPaywayService({ config, store: mockStore });
    const res = await service.prepare(draft);

    expect(res.ready).toBe(false);
    if (!res.ready) {
      // El mensaje para el usuario no dice "Sandbox no disponible" ni expone el SQL
      expect(res.message).toContain('No pudimos procesar la reserva temporalmente');
      expect(res.message).not.toContain('start_time');
      expect(res.message).not.toContain('42702');
      expect(res.correlationId).toBeDefined();
      expect(res.stage).toBe('prepare_payway_attempt');
    }
  });

  it('maneja SLOT_UNAVAILABLE con mensaje comprensible y estado recoverable', async () => {
    const mockStore: PaywayStore = {
      prepare: vi.fn().mockRejectedValue(
        Object.assign(new Error('SLOT_UNAVAILABLE'), {
          code: 'P0001',
          stage: 'prepare_payway_attempt',
        })
      ),
      claim: vi.fn(),
      settle: vi.fn(),
      confirm: vi.fn(),
    };

    const service = createPaywayService({ config, store: mockStore });
    const res = await service.prepare(draft);

    expect(res.ready).toBe(false);
    if (!res.ready) {
      expect(res.state).toBe('recoverable');
      expect(res.message).toContain('ya no se encuentra disponible');
      expect(res.correlationId).toBeDefined();
    }
  });

  it('genera checkout exitoso con $5.000 de seña cuando la preparación es válida', async () => {
    const mockStore: PaywayStore = {
      prepare: vi.fn().mockResolvedValue({
        appointmentId: 'apt-1234-5678',
        attemptId: 'att-1234-5678',
        accessToken: 'token-abc',
        depositArs: 5000,
      }),
      claim: vi.fn(),
      settle: vi.fn(),
      confirm: vi.fn(),
    };

    const service = createPaywayService({ config, store: mockStore });
    const res = await service.prepare(draft);

    expect(res.ready).toBe(true);
    if (res.ready) {
      expect(res.checkout.depositArs).toBe(5000);
      expect(res.checkout.appointmentId).toBe('apt-1234-5678');
      expect(res.checkout.methods).toHaveLength(1);
    }
  });
});
