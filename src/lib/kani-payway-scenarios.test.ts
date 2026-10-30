import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createPaywayService,
  queryPaywayPayment,
  paywayTransactionId,
  type PaywayConfig,
  type PaywayStore,
} from './kani-payway.server';
import { PAYWAY_MESSAGES } from './kani-payway';

describe('PayWay Flow Scenarios (Official Support Verification)', () => {
  const config: PaywayConfig = {
    apiBaseUrl: 'https://developers-ventasonline.payway.com.ar/api/v2',
    publicKey: 'pk_test_123456789',
    privateKey: 'sk_test_987654321',
    siteId: '93146639',
    methods: [{ id: 1, label: 'Visa' }, { id: 104, label: 'Mastercard' }],
  };

  const attemptId = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
  const siteTx = paywayTransactionId(attemptId);
  const appointmentId = '00000000-0000-4000-8000-000000000001';
  const accessToken = 'durable_test_access_token_32chars_long';

  const baseInput = {
    appointmentId,
    attemptId,
    accessToken,
    token: '6d7732a1-cf5e-49b8-a15d-16a7f8ca3115',
    bin: '450799',
    paymentMethodId: 1,
  };

  let mockStore: {
    prepare: ReturnType<typeof vi.fn>;
    claim: ReturnType<typeof vi.fn>;
    getAttemptStatus: ReturnType<typeof vi.fn>;
    settle: ReturnType<typeof vi.fn>;
    confirm: ReturnType<typeof vi.fn>;
  };

  let mockFetcher: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockFetcher = vi.fn();
    mockStore = {
      prepare: vi.fn(),
      claim: vi.fn().mockResolvedValue({
        acquired: true,
        appointment: {
          id: appointmentId,
          status: 'PENDING',
          depositArs: 5000,
          servicePriceArs: 25000,
          depositPaid: false,
          origin: 'PUBLIC_WEB',
          clientId: 'client-1',
          clientEmail: 'cliente@test.com',
        },
        attempt: {
          id: attemptId,
          appointmentId,
          siteTransactionId: siteTx,
          amount: 500000,
          state: 'processing',
        },
      }),
      getAttemptStatus: vi.fn(),
      settle: vi.fn().mockResolvedValue(undefined),
      confirm: vi.fn().mockResolvedValue(true),
    };
  });

  it('1. Aprobación normal: valida monto, moneda, comercio y confirma con idempotencia', async () => {
    mockFetcher.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: 971101,
          site_transaction_id: siteTx,
          amount: 500000,
          currency: 'ARS',
          site_id: '93146639',
          status: 'approved',
        }),
        { status: 201 }
      )
    );

    const service = createPaywayService({ config, store: mockStore as unknown as PaywayStore, fetcher: mockFetcher as any });
    const result = await service.pay(baseInput);

    expect(result.state).toBe('approved');
    expect(result.appointmentConfirmed).toBe(true);
    expect(mockStore.settle).toHaveBeenCalledWith(attemptId, 'approved', '971101', 'approved');
    expect(mockStore.confirm).toHaveBeenCalledWith(appointmentId, attemptId, '971101', 500000);
  });

  it('2. Timeout en pago y aprobación posterior en consulta (REQ000007122053)', async () => {
    // 2.1: Initial payment POST encounters gateway timeout
    mockFetcher.mockRejectedValueOnce(new DOMException('Gateway timeout', 'TimeoutError'));

    const service = createPaywayService({ config, store: mockStore as unknown as PaywayStore, fetcher: mockFetcher as any });
    const initialResult = await service.pay(baseInput);

    // Initial result must fail closed into UNKNOWN, never assume rejection or send another payment
    expect(initialResult.state).toBe('unknown');
    expect(initialResult.message).toBe(PAYWAY_MESSAGES.unknown);
    expect(mockStore.settle).toHaveBeenCalledWith(attemptId, 'unknown', undefined, 'unknown', expect.any(String));
    expect(mockStore.confirm).not.toHaveBeenCalled();

    // 2.2: Status check queries Payway via GET /payments?siteOperationId=<siteTx>
    mockStore.getAttemptStatus.mockResolvedValueOnce({
      appointment: {
        id: appointmentId,
        status: 'PENDING',
        depositArs: 5000,
        servicePriceArs: 25000,
        depositPaid: false,
        origin: 'PUBLIC_WEB',
      },
      attempt: {
        id: attemptId,
        appointmentId,
        siteTransactionId: siteTx,
        amount: 500000,
        state: 'unknown',
      },
    });

    mockFetcher.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          results: [
            {
              id: 971102,
              site_transaction_id: siteTx,
              amount: 500000,
              currency: 'ARS',
              site_id: '93146639',
              status: 'approved',
            },
          ],
        }),
        { status: 200 }
      )
    );

    const checkResult = await service.checkPaymentStatus({
      appointmentId,
      attemptId,
      accessToken,
    });

    expect(checkResult.state).toBe('approved');
    expect(checkResult.appointmentConfirmed).toBe(true);
    expect(mockStore.settle).toHaveBeenCalledWith(attemptId, 'approved', '971102', 'approved', 'status_check');
    expect(mockStore.confirm).toHaveBeenCalledWith(appointmentId, attemptId, '971102', 500000);
  });

  it('3. Rechazo confirmado: registra REJECTED sin confirmar turno y permite intentar nuevamente', async () => {
    mockFetcher.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: 971103,
          site_transaction_id: siteTx,
          amount: 500000,
          currency: 'ARS',
          site_id: '93146639',
          status: 'rejected',
          status_details: {
            error: {
              type: 'card_declined',
              reason: { id: 10, description: 'Fondos insuficientes' },
            },
          },
        }),
        { status: 400 }
      )
    );

    const service = createPaywayService({ config, store: mockStore as unknown as PaywayStore, fetcher: mockFetcher as any });
    const result = await service.pay(baseInput);

    expect(result.state).toBe('rejected');
    expect(result.message).toBe(PAYWAY_MESSAGES.rejected);
    expect(mockStore.settle).toHaveBeenCalledWith(attemptId, 'rejected', '971103', 'rejected', '10');
    expect(mockStore.confirm).not.toHaveBeenCalled();
  });

  it('4. Consulta temporalmente vacía: respuesta vacía NO se interpreta como rechazo', async () => {
    mockStore.getAttemptStatus.mockResolvedValueOnce({
      appointment: {
        id: appointmentId,
        status: 'PENDING',
        depositArs: 5000,
        servicePriceArs: 25000,
        depositPaid: false,
        origin: 'PUBLIC_WEB',
      },
      attempt: {
        id: attemptId,
        appointmentId,
        siteTransactionId: siteTx,
        amount: 500000,
        state: 'unknown',
      },
    });

    // Payway returns empty array (payment indexing lag or not reached)
    mockFetcher.mockResolvedValueOnce(
      new Response(JSON.stringify({ results: [] }), { status: 200 })
    );

    const service = createPaywayService({ config, store: mockStore as unknown as PaywayStore, fetcher: mockFetcher as any });
    const checkResult = await service.checkPaymentStatus({
      appointmentId,
      attemptId,
      accessToken,
    });

    // Must return verifying state and NEVER mark attempt as rejected
    expect(checkResult.state).toBe('verifying');
    expect(checkResult.message).toBe('Estamos verificando tu pago. Podés cerrar esta ventana; seguiremos comprobándolo. No vuelvas a pagar mientras la verificación esté pendiente.');
    expect(mockStore.settle).not.toHaveBeenCalledWith(attemptId, 'rejected', expect.anything(), expect.anything());
    expect(mockStore.confirm).not.toHaveBeenCalled();
  });

  it('5. Cierre del navegador: cron en servidor concilia intento UNKNOWN automáticamente', async () => {
    // queryPaywayPayment helper tested directly as executed by cron maintenance
    mockFetcher.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          results: [
            {
              id: '971105',
              site_transaction_id: siteTx,
              amount: 500000,
              currency: 'ARS',
              site_id: '93146639',
              status: 'approved',
            },
          ],
        }),
        { status: 200 }
      )
    );

    const query = await queryPaywayPayment(config, siteTx, mockFetcher as any, 500000);
    expect(query).toEqual({
      matches: true,
      providerId: '971105',
      status: 'approved',
    });
  });

  it('6. Verificaciones concurrentes: si ya está CONFIRMED, devuelve approved sin duplicar confirmaciones', async () => {
    mockStore.getAttemptStatus.mockResolvedValueOnce({
      appointment: {
        id: appointmentId,
        status: 'CONFIRMED',
        depositArs: 5000,
        servicePriceArs: 25000,
        depositPaid: true,
        origin: 'PUBLIC_WEB',
      },
      attempt: {
        id: attemptId,
        appointmentId,
        siteTransactionId: siteTx,
        amount: 500000,
        state: 'approved',
        result: { state: 'approved', message: PAYWAY_MESSAGES.approved, appointmentConfirmed: true },
      },
    });

    const service = createPaywayService({ config, store: mockStore as unknown as PaywayStore, fetcher: mockFetcher as any });
    const checkResult = await service.checkPaymentStatus({
      appointmentId,
      attemptId,
      accessToken,
    });

    expect(checkResult.state).toBe('approved');
    expect(checkResult.appointmentConfirmed).toBe(true);
    // Does not re-query or re-settle or re-confirm
    expect(mockFetcher).not.toHaveBeenCalled();
    expect(mockStore.settle).not.toHaveBeenCalled();
    expect(mockStore.confirm).not.toHaveBeenCalled();
  });

  it('7. Pago aprobado después de perder disponibilidad: no confirma falso turno, deriva a revisión', async () => {
    mockStore.getAttemptStatus.mockResolvedValueOnce({
      appointment: {
        id: appointmentId,
        status: 'CANCELLED',
        depositArs: 5000,
        servicePriceArs: 25000,
        depositPaid: false,
        origin: 'PUBLIC_WEB',
      },
      attempt: {
        id: attemptId,
        appointmentId,
        siteTransactionId: siteTx,
        amount: 500000,
        state: 'unknown',
      },
    });

    mockFetcher.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          results: [
            {
              id: 971107,
              site_transaction_id: siteTx,
              amount: 500000,
              currency: 'ARS',
              site_id: '93146639',
              status: 'approved',
            },
          ],
        }),
        { status: 200 }
      )
    );

    // DB refuses confirmation due to lost slot (collision/late payment)
    mockStore.confirm.mockResolvedValueOnce(false);

    const service = createPaywayService({ config, store: mockStore as unknown as PaywayStore, fetcher: mockFetcher as any });
    const checkResult = await service.checkPaymentStatus({
      appointmentId,
      attemptId,
      accessToken,
    });

    // Settle approval in ledger for accounting/refund record
    expect(mockStore.settle).toHaveBeenCalledWith(attemptId, 'approved', '971107', 'approved', 'status_check');
    // But result returned to client must be review, NOT a false confirmation
    expect(checkResult.state).toBe('review');
    expect(checkResult.appointmentConfirmed).toBeFalsy();
    expect(checkResult.message).toBe(PAYWAY_MESSAGES.late_review);
  });

  it('8. Reserva vencida a los 10m (PAYMENT_EXPIRED) recuperable: si horario sigue libre, confirmación tardía aprueba turno atómicamente', async () => {
    mockStore.getAttemptStatus.mockResolvedValueOnce({
      appointment: {
        id: appointmentId,
        status: 'CANCELLED',
        depositArs: 5000,
        servicePriceArs: 25000,
        depositPaid: false,
        origin: 'PUBLIC_WEB',
      },
      attempt: {
        id: attemptId,
        appointmentId,
        siteTransactionId: siteTx,
        amount: 500000,
        state: 'unknown',
      },
    });

    mockFetcher.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          results: [
            {
              id: 971108,
              site_transaction_id: siteTx,
              amount: 500000,
              currency: 'ARS',
              site_id: '93146639',
              status: 'approved',
            },
          ],
        }),
        { status: 200 }
      )
    );

    // Slot is still free and valid, DB atomically recovers and confirms appointment
    mockStore.confirm.mockResolvedValueOnce(true);

    const service = createPaywayService({ config, store: mockStore as unknown as PaywayStore, fetcher: mockFetcher as any });
    const checkResult = await service.checkPaymentStatus({
      appointmentId,
      attemptId,
      accessToken,
    });

    expect(mockStore.settle).toHaveBeenCalledWith(attemptId, 'approved', '971108', 'approved', 'status_check');
    expect(mockStore.confirm).toHaveBeenCalledWith(appointmentId, attemptId, '971108', 500000);
    expect(checkResult.state).toBe('approved');
    expect(checkResult.appointmentConfirmed).toBe(true);
    expect(checkResult.message).toBe(PAYWAY_MESSAGES.approved);
  });

  it('9. Discrepancia de unidad de importe en GET /payments: amount: 5000 NO confirma seña esperada de 500000', async () => {
    mockStore.getAttemptStatus.mockResolvedValueOnce({
      appointment: {
        id: appointmentId,
        status: 'PENDING',
        depositArs: 5000,
        servicePriceArs: 25000,
        depositPaid: false,
        origin: 'PUBLIC_WEB',
      },
      attempt: {
        id: attemptId,
        appointmentId,
        siteTransactionId: siteTx,
        amount: 500000,
        state: 'unknown',
      },
    });

    // Payway returns amount 5000 instead of 500000 centavos
    mockFetcher.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          results: [
            {
              id: 971109,
              site_transaction_id: siteTx,
              amount: 5000,
              currency: 'ARS',
              site_id: '93146639',
              status: 'approved',
            },
          ],
        }),
        { status: 200 }
      )
    );

    const service = createPaywayService({ config, store: mockStore as unknown as PaywayStore, fetcher: mockFetcher as any });
    const checkResult = await service.checkPaymentStatus({
      appointmentId,
      attemptId,
      accessToken,
    });

    // Mismatched amount must NOT confirm and must NOT settle as approved
    expect(mockStore.confirm).not.toHaveBeenCalled();
    expect(checkResult.state).toBe('verifying');
    expect(checkResult.appointmentConfirmed).toBeFalsy();
  });
});
