import { afterEach, describe, expect, it, vi } from 'vitest';
import { arsToPaywayAmount, PAYWAY_MESSAGES, validatePaywayPayment, validatePaywayDraft } from './kani-payway';
import { createPaywayService, newPaywayAttemptId, paywayTransactionId, readPaywayConfig, runtimePaywayService,
  queryPaywayPayment, type PaywayConfig, type PaywayStore } from './kani-payway.server';

const appointmentId = '123e4567-e89b-42d3-a456-426614174000';
const attemptId = 'a'.repeat(32);
const input = { appointmentId, attemptId, accessToken: 'x'.repeat(43), token: 'f0000000-0000-4000-8000-000000000000', bin: '450799', paymentMethodId: 1 };
const draft = { barber: 'Lautaro', serviceName: 'Corte', date: '2026-10-27', time: '10:00', name: 'Prueba Test', email: 'prueba@example.test', phone: '+5491128436014', notes: '' };
const config: PaywayConfig = { apiBaseUrl: 'https://developers-ventasonline.payway.com.ar/api/v2', publicKey: 'public-fixture', privateKey: 'private-fixture-not-real', siteId: '12345678', methods: [{ id: 1, label: 'Visa' }] };
function setup(patch = {}) {
  const appointment = {
    id: appointmentId,
    status: 'PENDING',
    depositArs: 5000,
    servicePriceArs: 25000,
    depositPaid: false,
    origin: 'PUBLIC_WEB',
    clientId: '55eb8b8c-c803-41eb-a464-7f503d89a3cc',
    clientEmail: 'prueba@example.test',
    ...patch
  };
  const attempt = { id: attemptId, appointmentId, siteTransactionId: paywayTransactionId(attemptId), amount: 500000, state: 'processing' as const };
  const store = {
    prepare: vi.fn().mockResolvedValue({ appointmentId, attemptId, accessToken: input.accessToken, depositArs: 5000 }),
    claim: vi.fn().mockResolvedValue({ acquired: true, appointment, attempt }),
    settle: vi.fn().mockResolvedValue(undefined), confirm: vi.fn().mockResolvedValue(true),
  } satisfies PaywayStore;
  const payment = { id: 42, status: 'approved', site_transaction_id: attempt.siteTransactionId, amount: 500000, currency: 'ars', site_id: config.siteId };
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(payment), { status: 201 }));
  return { store, payment, attempt, appointment, fetcher, service: createPaywayService({ config, store, fetcher }) };
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('Payway laboratory, synthetic responses only', () => {
  it('converts the appointment deposit instead of using a fixed charge', async () => {
    expect(arsToPaywayAmount(5000)).toBe(500000);
    expect(arsToPaywayAmount(1250.45)).toBe(125045);
    const s = setup({ depositArs: 3000 }); s.attempt.amount = 300000; s.payment.amount = 300000;
    s.fetcher.mockResolvedValue(new Response(JSON.stringify(s.payment), { status: 201 }));
    expect((await s.service.pay(input)).state).toBe('approved');
    expect(JSON.parse(s.fetcher.mock.calls[0]![1].body).amount).toBe(300000);
  });
  it.each([0, -1, NaN, Infinity, .001, Number.MAX_SAFE_INTEGER])('rejects invalid amount %s', value => expect(() => arsToPaywayAmount(value)).toThrow());
  it('generates independent IDs within the documented alphanumeric limit', () => {
    const a = newPaywayAttemptId(), b = newPaywayAttemptId();
    expect(a).not.toBe(b); expect(paywayTransactionId(a)).toMatch(/^[a-z0-9]{36}$/i);
  });
  it('passes only token and non-sensitive payment metadata; persists before confirming', async () => {
    const s = setup();
    const log = vi.spyOn(console, 'log'); const error = vi.spyOn(console, 'error');
    expect(await s.service.pay(input)).toEqual({ state: 'approved', message: PAYWAY_MESSAGES.approved, appointmentConfirmed: true });
    expect(s.store.claim).toHaveBeenCalledWith({ appointmentId, attemptId, accessToken: input.accessToken });
    const [url, request] = s.fetcher.mock.calls[0];
    expect(url).toBe(`${config.apiBaseUrl}/payments`);
    expect(request.headers.apikey).toBe(config.privateKey);
    expect(JSON.parse(request.body)).toEqual({
      site_transaction_id: paywayTransactionId(attemptId),
      token: input.token,
      payment_method_id: 1,
      bin: input.bin,
      amount: 500000,
      currency: 'ARS',
      installments: 1,
      description: 'Seña turno Kani Barber Studio',
      payment_type: 'single',
      sub_payments: [],
      fraud_detection: {
        send_to_cs: false,
      },
      customer: {
        id: '55eb8b8cc80341eba4647f503d89a3cc',
        email: 'prueba@example.test',
      },
    });
    expect(s.store.settle).toHaveBeenCalledWith(attemptId, 'approved', '42', 'approved');
    expect(s.store.confirm).toHaveBeenCalledWith(appointmentId, attemptId, '42', 500000);
    expect(s.store.settle.mock.invocationCallOrder[0]!).toBeLessThan(s.store.confirm.mock.invocationCallOrder[0]!);
    expect(log).not.toHaveBeenCalled(); expect(error).not.toHaveBeenCalled();
  });
  it('explicitly sends fraud_detection with send_to_cs: false to bypass CyberSource screening', async () => {
    const s = setup();
    await s.service.pay(input);
    const [, request] = s.fetcher.mock.calls[0];
    const parsed = JSON.parse(request.body);
    expect(parsed.fraud_detection).toEqual({ send_to_cs: false });
  });
  it.each(['pending', 'pre_approved', 'accredited', 'AUTHORIZED', '', undefined])('does not confirm unrecognized status %s', async status => {
    const s = setup(); s.fetcher.mockResolvedValue(new Response(JSON.stringify({ ...s.payment, status }), { status: 201 }));
    expect((await s.service.pay(input)).state).toBe('unknown'); expect(s.store.confirm).not.toHaveBeenCalled();
  });
  it('shows a simulated explicit rejection without confirming or retrying', async () => {
    const s = setup(); s.fetcher.mockResolvedValue(new Response(JSON.stringify({ ...s.payment, status: 'rejected' }), { status: 402 }));
    expect((await s.service.pay(input)).state).toBe('rejected');
    expect(s.store.confirm).not.toHaveBeenCalled(); expect(s.fetcher).toHaveBeenCalledTimes(1);
  });
  it.each([{ amount: 1 }, { currency: 'USD' }, { site_id: 'another-site' }, { site_transaction_id: 'another-attempt' }, { id: null }])('rejects mismatched evidence %j', async patch => {
    const s = setup(); s.fetcher.mockResolvedValue(new Response(JSON.stringify({ ...s.payment, ...patch }), { status: 201 }));
    expect((await s.service.pay(input)).state).toBe('unknown'); expect(s.store.confirm).not.toHaveBeenCalled();
  });
  it('treats timeout as uncertain and never sends a second payment', async () => {
    const s = setup(); s.fetcher.mockRejectedValue(new DOMException('timeout', 'TimeoutError'));
    const result = await s.service.pay(input);
    expect(result).toEqual({ state: 'unknown', message: PAYWAY_MESSAGES.unknown });
    expect(s.store.settle).toHaveBeenCalledWith(attemptId, 'unknown', undefined, 'unknown', expect.any(String)); expect(s.store.confirm).not.toHaveBeenCalled(); expect(s.fetcher).toHaveBeenCalledTimes(1);
  });
  it('does not turn an approved payment into a confirmed appointment when DB refuses a late payment', async () => {
    const s = setup(); s.store.confirm.mockResolvedValue(false);
    expect((await s.service.pay(input)).state).toBe('unknown');
  });
  it('preserves saved approval evidence if appointment confirmation fails', async () => {
    const s = setup(); s.store.confirm.mockRejectedValue(new Error('database fixture'));
    expect((await s.service.pay(input)).state).toBe('unknown');
    expect(s.store.settle).toHaveBeenCalledExactlyOnceWith(attemptId, 'approved', '42', 'approved');
  });
  it('cannot charge an expired/cancelled/already-paid or nonmatching appointment', async () => {
    for (const patch of [{ status: 'CANCELLED' }, { depositPaid: true }, { origin: 'MANUAL' }, { id: 'other' }, { servicePriceArs: 100 }]) {
      const s = setup(patch); expect((await s.service.pay(input)).state).toBe('unknown'); expect(s.fetcher).not.toHaveBeenCalled();
    }
  });
  it('concurrent requests charge only the winner of the durable claim', async () => {
    const s = setup(); let claimed = false;
    s.store.claim.mockImplementation(async () => { const acquired = !claimed; claimed = true; return { acquired, appointment: s.appointment, attempt: s.attempt }; });
    const results = await Promise.all([s.service.pay(input), s.service.pay(input)]);
    expect(s.fetcher).toHaveBeenCalledTimes(1); expect(results.map(r => r.state).sort()).toEqual(['approved', 'unknown']);
  });
  it('does not infer permission from a browser amount, status, card number or provider URL', async () => {
    for (const extra of [{ amount: 1 }, { status: 'approved' }, { card_number: 'test-not-a-real-card' }, { security_code: 'fixture' }, { apiBaseUrl: 'https://example.test' }]) {
      expect(() => validatePaywayPayment({ ...input, ...extra })).toThrow();
      expect(() => validatePaywayDraft({ ...draft, ...extra })).toThrow();
      const s = setup(); expect((await s.service.pay({ ...input, ...extra })).state).toBe('recoverable'); expect(s.fetcher).not.toHaveBeenCalled();
    }
  });
  it('blocks the deployed service even if keys are configured until a durable adapter is approved', async () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    const service = createPaywayService({ config, store: null });
    expect((await service.prepare(draft)).ready).toBe(false); expect((await service.pay(input)).state).toBe('unavailable');
    expect((await (await runtimePaywayService()).prepare(draft)).ready).toBe(false); expect(fetcher).not.toHaveBeenCalled();
  });
  it('configuration accepts only test DB and explicitly selected sandbox hosts', () => {
    const env: Record<string, string> = { PAYWAY_SANDBOX_ENABLED: 'true', PAYWAY_ENVIRONMENT: 'sandbox', PAYWAY_API_BASE_URL: config.apiBaseUrl,
      PAYWAY_PUBLIC_API_KEY: config.publicKey, PAYWAY_PRIVATE_API_KEY: config.privateKey, PAYWAY_SITE_ID: config.siteId,
      PAYWAY_PAYMENT_METHODS: JSON.stringify(config.methods), SUPABASE_URL: 'https://iockpxtkflyjfagkvgnr.supabase.co' };
    expect(readPaywayConfig(key => env[key])).toEqual(config);
    // Auto-normalizes without trailing /api/v2
    expect(readPaywayConfig(key => key === 'PAYWAY_API_BASE_URL' ? 'https://developers-ventasonline.payway.com.ar' : env[key])).toEqual(config);
    for (const patch of [{ PAYWAY_SANDBOX_ENABLED: 'false' }, { PAYWAY_SANDBOX_ENABLED: '' }, { PAYWAY_ENVIRONMENT: 'production' }, { PAYWAY_API_BASE_URL: 'https://ventasonline.payway.com.ar/api/v2' },
      { SUPABASE_URL: 'https://production.supabase.co' }, { PAYWAY_PAYMENT_METHODS: '[]' }, { PAYWAY_PRIVATE_API_KEY: '' }]) {
      const altered: Record<string, string> = { ...env, ...patch }; expect(readPaywayConfig(key => altered[key])).toBeNull();
    }
  });

  it('accepts string provider ID and omitted site_id from Payway gateway responses', async () => {
    const s = setup();
    s.payment.id = '971344';
    delete (s.payment as any).site_id;
    s.payment.amount = 5000; // in pesos (5000.00)
    s.fetcher.mockResolvedValue(new Response(JSON.stringify(s.payment), { status: 201 }));
    const result = await s.service.pay(input);
    expect(result).toEqual({ state: 'approved', message: PAYWAY_MESSAGES.approved, appointmentConfirmed: true });
    expect(s.store.settle).toHaveBeenCalledWith(attemptId, 'approved', '971344', 'approved');
  });

  it('queries Payway by siteOperationId for reconciliation', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      results: [
        { id: 888123, site_transaction_id: 'KANItest123', status: 'approved', amount: 500000, currency: 'ARS' }
      ]
    }), { status: 200 }));
    const res = await queryPaywayPayment(config, 'KANItest123', fetcher);
    expect(res).toEqual({ matches: true, providerId: '888123', status: 'approved' });
    expect(fetcher).toHaveBeenCalledWith(
      `${config.apiBaseUrl}/payments?siteOperationId=KANItest123`,
      expect.objectContaining({ method: 'GET', headers: expect.objectContaining({ apikey: config.privateKey }) })
    );

    // Rejected query
    fetcher.mockResolvedValueOnce(new Response(JSON.stringify({
      results: [
        { id: 888124, site_transaction_id: 'KANItest124', status: 'rejected', amount: 500000, currency: 'ARS' }
      ]
    }), { status: 200 }));
    const resRej = await queryPaywayPayment(config, 'KANItest124', fetcher);
    expect(resRej).toEqual({ matches: true, providerId: '888124', status: 'rejected' });

    // Not found query
    fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ results: [] }), { status: 200 }));
    const resEmpty = await queryPaywayPayment(config, 'KANItest999', fetcher);
    expect(resEmpty).toEqual({ matches: false, providerId: null, status: 'not_found' });
  });

  it('rejects attempt safely before provider call if appointment email is missing or invalid', async () => {
    for (const invalidEmail of ['', '   ', 'not-an-email', undefined]) {
      const s = setup({ clientEmail: invalidEmail });
      const res = await s.service.pay(input);
      expect(res.state).toBe('recoverable');
      expect(res.message).toContain('email');
      expect(s.fetcher).not.toHaveBeenCalled();
      expect(s.store.confirm).not.toHaveBeenCalled();
    }
  });

  it('classifies explicit HTTP 400 validation error without payment ID as technical rejection, not UNKNOWN', async () => {
    const s = setup();
    s.fetcher.mockResolvedValue(new Response(JSON.stringify({
      error_type: 'invalid_request_error',
      validation_errors: [{ code: 'missing', param: 'customer' }]
    }), { status: 400 }));

    const res = await s.service.pay(input);
    expect(res.state).toBe('rejected');
    expect(res.message).toBe(PAYWAY_MESSAGES.technical_error);
    expect(s.store.settle).toHaveBeenCalledWith(attemptId, 'rejected', undefined, 'rejected', 'missing');
    expect(s.store.confirm).not.toHaveBeenCalled();
  });

  it('retains UNKNOWN fail-closed handling for true network or server uncertainty', async () => {
    // 1. Timeout
    const sTimeout = setup();
    sTimeout.fetcher.mockRejectedValue(new DOMException('The operation timed out', 'TimeoutError'));
    const resTimeout = await sTimeout.service.pay(input);
    expect(resTimeout.state).toBe('unknown');
    expect(resTimeout.message).toBe(PAYWAY_MESSAGES.unknown);
    expect(sTimeout.store.settle).toHaveBeenCalledWith(attemptId, 'unknown', undefined, 'unknown', expect.any(String));
    expect(sTimeout.store.confirm).not.toHaveBeenCalled();

    // 2. HTTP 500, 502, 503, 504 Gateway errors
    for (const status of [500, 502, 503, 504]) {
      const sGate = setup();
      sGate.fetcher.mockResolvedValue(new Response(`Gateway Error ${status}`, { status }));
      const resGate = await sGate.service.pay(input);
      expect(resGate.state).toBe('unknown');
      expect(resGate.message).toBe(PAYWAY_MESSAGES.unknown);
      expect(sGate.store.settle).toHaveBeenCalledWith(attemptId, 'unknown', undefined, 'unknown', `HTTP_${status}_GATEWAY_ERROR`);
      expect(sGate.store.confirm).not.toHaveBeenCalled();
    }
  });

  describe('Payway explicit state classification and security guarantees', () => {
    it('1. Approved válido -> APPROVED, appointment CONFIRMED, depositPaid true', async () => {
      const s = setup();
      s.payment.status = 'approved';
      s.payment.id = 971500;
      s.payment.amount = 500000;
      s.payment.currency = 'ARS';
      s.payment.site_id = config.siteId;
      s.fetcher.mockResolvedValue(new Response(JSON.stringify(s.payment), { status: 200 }));

      const res = await s.service.pay(input);
      expect(res.state).toBe('approved');
      expect(res.appointmentConfirmed).toBe(true);
      expect(s.store.settle).toHaveBeenCalledWith(attemptId, 'approved', '971500', 'approved');
      expect(s.store.confirm).toHaveBeenCalledWith(appointmentId, attemptId, '971500', 500000);
    });

    it('2. Rejected explícito -> REJECTED, appointment PENDING, NO UNKNOWN', async () => {
      // 2a. Direct status: 'rejected'
      const sDirect = setup();
      sDirect.fetcher.mockResolvedValue(new Response(JSON.stringify({
        id: 971501,
        site_transaction_id: paywayTransactionId(attemptId),
        status: 'rejected',
        amount: 500000,
        currency: 'ARS',
        status_details: { error: { type: 'card_declined', reason: { id: 10, description: 'Fondos insuficientes' } } }
      }), { status: 400 }));

      const resDirect = await sDirect.service.pay(input);
      expect(resDirect.state).toBe('rejected');
      expect(resDirect.message).toBe(PAYWAY_MESSAGES.rejected);
      expect(sDirect.store.settle).toHaveBeenCalledWith(attemptId, 'rejected', '971501', 'rejected', '10');
      expect(sDirect.store.confirm).not.toHaveBeenCalled();

      // 2b. Wrapped inside data_response
      const sWrapped = setup();
      sWrapped.fetcher.mockResolvedValue(new Response(JSON.stringify({
        data_response: {
          id: 971502,
          site_transaction_id: paywayTransactionId(attemptId),
          status: 'rejected',
          amount: 500000,
          currency: 'ARS',
        }
      }), { status: 200 }));

      const resWrapped = await sWrapped.service.pay(input);
      expect(resWrapped.state).toBe('rejected');
      expect(resWrapped.message).toBe(PAYWAY_MESSAGES.rejected);
      expect(sWrapped.store.settle).toHaveBeenCalledWith(attemptId, 'rejected', '971502', 'rejected', undefined);
      expect(sWrapped.store.confirm).not.toHaveBeenCalled();
    });

    it('3. 400/422 validation error -> technical recoverable rejection, NO UNKNOWN', async () => {
      for (const status of [400, 422]) {
        const s = setup();
        s.fetcher.mockResolvedValue(new Response(JSON.stringify({
          error_type: 'invalid_request_error',
          validation_errors: [{ code: 'param_invalid', param: 'bin' }]
        }), { status }));

        const res = await s.service.pay(input);
        expect(res.state).toBe('rejected');
        expect(res.message).toBe(PAYWAY_MESSAGES.technical_error);
        expect(s.store.settle).toHaveBeenCalledWith(attemptId, 'rejected', undefined, 'rejected', 'param_invalid');
        expect(s.store.confirm).not.toHaveBeenCalled();
      }
    });

    it('4. Evidence mismatch en supuesto APPROVED -> jamás confirmar, settles as UNKNOWN', async () => {
      // Currency mismatch
      const sCurr = setup();
      sCurr.fetcher.mockResolvedValue(new Response(JSON.stringify({
        id: 971503,
        site_transaction_id: paywayTransactionId(attemptId),
        status: 'approved',
        amount: 500000,
        currency: 'USD',
      }), { status: 200 }));
      expect((await sCurr.service.pay(input)).state).toBe('unknown');
      expect(sCurr.store.confirm).not.toHaveBeenCalled();

      // Amount mismatch
      const sAmt = setup();
      sAmt.fetcher.mockResolvedValue(new Response(JSON.stringify({
        id: 971504,
        site_transaction_id: paywayTransactionId(attemptId),
        status: 'approved',
        amount: 100000, // Should be 500000
        currency: 'ARS',
      }), { status: 200 }));
      expect((await sAmt.service.pay(input)).state).toBe('unknown');
      expect(sAmt.store.confirm).not.toHaveBeenCalled();

      // Site transaction mismatch
      const sTx = setup();
      sTx.fetcher.mockResolvedValue(new Response(JSON.stringify({
        id: 971505,
        site_transaction_id: 'KANI_WRONG_TRANSACTION',
        status: 'approved',
        amount: 500000,
        currency: 'ARS',
      }), { status: 200 }));
      expect((await sTx.service.pay(input)).state).toBe('unknown');
      expect(sTx.store.confirm).not.toHaveBeenCalled();

      // Site ID mismatch
      const sSite = setup();
      sSite.fetcher.mockResolvedValue(new Response(JSON.stringify({
        id: 971506,
        site_transaction_id: paywayTransactionId(attemptId),
        status: 'approved',
        amount: 500000,
        currency: 'ARS',
        site_id: '99999999',
      }), { status: 200 }));
      expect((await sSite.service.pay(input)).state).toBe('unknown');
      expect(sSite.store.confirm).not.toHaveBeenCalled();
    });

    it('5. Status review o error técnico -> clasificado con observabilidad en provider_code', async () => {
      // 5a. Status: 'review'
      const sRev = setup();
      sRev.fetcher.mockResolvedValue(new Response(JSON.stringify({
        id: 971507,
        site_transaction_id: paywayTransactionId(attemptId),
        status: 'review',
        amount: 500000,
        currency: 'ARS',
      }), { status: 200 }));
      const resRev = await sRev.service.pay(input);
      expect(resRev.state).toBe('unknown');
      expect(sRev.store.settle).toHaveBeenCalledWith(attemptId, 'unknown', '971507', 'unknown', 'PAYWAY_STATUS_REVIEW');
      expect(sRev.store.confirm).not.toHaveBeenCalled();

      // 5b. HTTP 400 sin providerId -> technical recoverable rejection
      const sErr = setup();
      sErr.fetcher.mockResolvedValue(new Response(JSON.stringify({
        error: 'card_declined',
      }), { status: 400 }));
      const resErr = await sErr.service.pay(input);
      expect(resErr.state).toBe('rejected');
      expect(sErr.store.settle).toHaveBeenCalledWith(attemptId, 'rejected', undefined, 'rejected', 'card_declined');
      expect(sErr.store.confirm).not.toHaveBeenCalled();
    });
  });
});
