import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockRpc = vi.fn();
const mockFrom = vi.fn();
vi.mock('./kani-payment-db.server', () => ({
  createPaymentSupabaseClient: vi.fn(async () => ({ from: mockFrom, rpc: mockRpc })),
}));
const environment: Record<string, string> = {
  SUPABASE_URL: 'https://iockpxtkflyjfagkvgnr.supabase.co',
  PAYWAY_SANDBOX_ENABLED: 'true', PAYWAY_ENVIRONMENT: 'sandbox',
  PAYWAY_API_BASE_URL: 'https://developers-ventasonline.payway.com.ar/api/v2',
  PAYWAY_PUBLIC_API_KEY: 'test_public_key', PAYWAY_PRIVATE_API_KEY: 'test_private_key',
  PAYWAY_SITE_ID: '93146639', PAYWAY_PAYMENT_METHODS: JSON.stringify([{ id: 1, label: 'Visa' }]),
};
vi.mock('./kani-mercadopago.server', () => ({
  getRuntimeEnv: (key: string) => environment[key], verifyAndConfirmAppointmentPayment: vi.fn(),
}));
const mockQueryPaywayPayment = vi.fn();
vi.mock('./kani-payway.server', async importOriginal => ({
  ...await importOriginal<typeof import('./kani-payway.server')>(),
  queryPaywayPayment: (...args: unknown[]) => mockQueryPaywayPayment(...args),
}));
import { reconcilePendingPayments } from './kani-payment-maintenance.server';

const attempt = {
  id: '22222222-2222-4222-8222-222222222222', appointment_id: 'appt-fixture',
  site_transaction_id: 'KANI22222222222242228222222222222222',
  provider_site_id: '93146639', amount_minor_units: 500000, state: 'UNKNOWN',
  provider_transaction_id: null as string | null,
};
function mockLedger(pending = [attempt], approved: typeof attempt[] = []) {
  const queries: { table: string; eq: ReturnType<typeof vi.fn> }[] = [];
  let attemptQuery = 0;
  mockFrom.mockImplementation((table: string) => {
    const data = table === 'payment_attempts' ? (++attemptQuery === 1 ? pending : approved) : [];
    const query = {
      select: vi.fn(() => query), eq: vi.fn(() => query), in: vi.fn(() => query),
      is: vi.fn(() => query), lt: vi.fn(() => query),
      limit: vi.fn(async () => ({ data, error: null })),
    };
    queries.push({ table, eq: query.eq });
    return query;
  });
  return queries;
}

describe('Payway reconciliation & cron maintenance', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRpc.mockResolvedValue({ data: null, error: null });
    mockQueryPaywayPayment.mockResolvedValue(null);
    delete environment.PAYWAY_PRODUCTION_ENABLED;
    delete environment.PAYWAY_CHECKOUT_SECRET;
    Object.assign(environment, { PAYWAY_SANDBOX_ENABLED: 'true', PAYWAY_ENVIRONMENT: 'sandbox',
      PAYWAY_API_BASE_URL: 'https://developers-ventasonline.payway.com.ar/api/v2', PAYWAY_SITE_ID: '93146639' });
  });

  it('reconciles UNKNOWN to APPROVED and confirms once with the verified amount', async () => {
    const queries = mockLedger();
    mockQueryPaywayPayment.mockResolvedValue({ matches: true, providerId: '987654', status: 'approved' });
    await reconcilePendingPayments();
    expect(mockQueryPaywayPayment).toHaveBeenCalledWith(expect.objectContaining({ siteId: '93146639' }),
      attempt.site_transaction_id, expect.anything(), 500000);
    expect(mockRpc).toHaveBeenCalledWith('settle_payway_attempt', expect.objectContaining({
      p_attempt_id: attempt.id, p_state: 'APPROVED', p_provider_id: '987654' }));
    expect(mockRpc).toHaveBeenCalledWith('confirm_payway_attempt', {
      p_appointment_id: attempt.appointment_id, p_attempt_id: attempt.id, p_provider_id: '987654', p_amount_minor: 500000 });
    for (const query of queries.filter(q => q.table === 'payment_attempts')) {
      expect(query.eq).toHaveBeenCalledWith('provider_site_id', '93146639');
    }
  });

  it('records an authoritative rejection without confirming', async () => {
    mockLedger();
    mockQueryPaywayPayment.mockResolvedValue({ matches: true, providerId: '987655', status: 'rejected' });
    await reconcilePendingPayments();
    expect(mockRpc).toHaveBeenCalledWith('settle_payway_attempt', expect.objectContaining({ p_state: 'REJECTED' }));
    expect(mockRpc).not.toHaveBeenCalledWith('confirm_payway_attempt', expect.anything());
  });

  it('preserves the explicitly excluded historical attempts', async () => {
    mockLedger(['1123fda5-abff-4775-8313-aa250967ec12', '0d3f50b8-baac-4cf9-b88a-7e5bac2f2313'].map(id => ({ ...attempt, id })));
    await reconcilePendingPayments();
    expect(mockQueryPaywayPayment).not.toHaveBeenCalled();
    expect(mockRpc).not.toHaveBeenCalledWith('settle_payway_attempt', expect.anything());
  });

  it.each([null, { matches: false, providerId: null, status: 'unknown' }, { matches: false, providerId: null, status: 'not_found' }])(
    'never rejects or confirms an indeterminate response %j', async result => {
      mockLedger(); mockQueryPaywayPayment.mockResolvedValue(result);
      await reconcilePendingPayments();
      expect(mockRpc).not.toHaveBeenCalledWith('settle_payway_attempt', expect.anything());
      expect(mockRpc).not.toHaveBeenCalledWith('confirm_payway_attempt', expect.anything());
    });

  it('isolates production from sandbox in both pending and approved recovery queries', async () => {
    Object.assign(environment, { PAYWAY_PRODUCTION_ENABLED: 'true', PAYWAY_SANDBOX_ENABLED: 'false',
      PAYWAY_ENVIRONMENT: 'production', PAYWAY_API_BASE_URL: 'https://ventasonline.payway.com.ar/api/v2',
      PAYWAY_SITE_ID: '99999999', PAYWAY_CHECKOUT_SECRET: 's'.repeat(64) });
    const queries = mockLedger([attempt], [{ ...attempt, state: 'APPROVED', provider_transaction_id: 'fixture' }]);
    await reconcilePendingPayments();
    expect(mockQueryPaywayPayment).not.toHaveBeenCalled();
    expect(mockRpc).not.toHaveBeenCalledWith('settle_payway_attempt', expect.anything());
    expect(mockRpc).not.toHaveBeenCalledWith('confirm_payway_attempt', expect.anything());
    for (const query of queries.filter(q => q.table === 'payment_attempts')) {
      expect(query.eq).toHaveBeenCalledWith('provider_site_id', '99999999');
    }
  });

  it('recovers an approved payment from the current merchant', async () => {
    mockLedger([], [{ ...attempt, state: 'APPROVED', provider_transaction_id: '987654' }]);
    await reconcilePendingPayments();
    expect(mockRpc).toHaveBeenCalledWith('confirm_payway_attempt', expect.objectContaining({ p_provider_id: '987654' }));
  });

  it('server scheduled export triggers reconciliation end-to-end', async () => {
    mockLedger([]);
    const serverModule = await import('../server');
    const ctx = { waitUntil: vi.fn() };
    await serverModule.default.scheduled({}, {}, ctx);
    expect(ctx.waitUntil).toHaveBeenCalled();
  });
});
