import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockRpc = vi.fn();
const mockFrom = vi.fn();
const mockSupabase = { from: mockFrom, rpc: mockRpc };

vi.mock('./kani-payment-db.server', () => ({
  createPaymentSupabaseClient: vi.fn(async () => mockSupabase),
}));

const mockGetRuntimeEnv = vi.fn((key: string) => {
  if (key === 'SUPABASE_URL') return 'https://iockpxtkflyjfagkvgnr.supabase.co';
  if (key === 'PAYWAY_SANDBOX_ENABLED') return 'true';
  if (key === 'PAYWAY_ENVIRONMENT') return 'sandbox';
  if (key === 'PAYWAY_API_BASE_URL') return 'https://developers-ventasonline.payway.com.ar/api/v2';
  if (key === 'PAYWAY_PUBLIC_API_KEY') return 'test_public_key';
  if (key === 'PAYWAY_PRIVATE_API_KEY') return 'test_private_key';
  if (key === 'PAYWAY_SITE_ID') return '93146639';
  if (key === 'PAYWAY_PAYMENT_METHODS') return JSON.stringify([{ id: 1, label: 'Visa' }]);
  return undefined;
});

vi.mock('./kani-mercadopago.server', () => ({
  getRuntimeEnv: (key: string) => mockGetRuntimeEnv(key),
  verifyAndConfirmAppointmentPayment: vi.fn(),
}));

const mockQueryPaywayPayment = vi.fn();
vi.mock('./kani-payway.server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./kani-payway.server')>();
  return {
    ...actual,
    queryPaywayPayment: (...args: unknown[]) => mockQueryPaywayPayment(...args),
  };
});

import { reconcilePendingPayments } from './kani-payment-maintenance.server';

describe('Payway reconciliation & cron maintenance', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRpc.mockResolvedValue({ data: null, error: null });
  });

  it('reconciles UNKNOWN attempt to APPROVED with idempotent confirmation', async () => {
    const unknownAttempt = {
      id: '22222222-2222-4222-8222-222222222222',
      appointment_id: 'appt-1111',
      site_transaction_id: 'KANI22222222222242228222222222222222',
      amount_minor_units: 500000,
      state: 'UNKNOWN',
    };

    mockFrom.mockImplementation((table: string) => {
      if (table === 'appointment_payment_orders') {
        return {
          select: () => ({
            eq: () => ({
              lt: () => ({
                limit: vi.fn().mockResolvedValue({ data: [], error: null }),
              }),
            }),
          }),
        };
      }
      if (table === 'payment_attempts') {
        return {
          select: () => ({
            eq: () => ({
              in: () => ({
                lt: () => ({
                  limit: vi.fn().mockResolvedValue({ data: [unknownAttempt], error: null }),
                }),
              }),
            }),
          }),
        };
      }
      return {};
    });

    mockQueryPaywayPayment.mockResolvedValueOnce({
      matches: true,
      providerId: '987654',
      status: 'approved',
    });

    await reconcilePendingPayments();

    expect(mockQueryPaywayPayment).toHaveBeenCalledWith(
      expect.objectContaining({ siteId: '93146639' }),
      unknownAttempt.site_transaction_id,
      expect.anything(),
      unknownAttempt.amount_minor_units
    );

    // Settle approved
    expect(mockRpc).toHaveBeenCalledWith('settle_payway_attempt', {
      p_attempt_id: unknownAttempt.id,
      p_state: 'APPROVED',
      p_provider_id: '987654',
      p_provider_status: 'approved',
      p_provider_code: 'reconciled_approved',
    });

    // Confirm appointment
    expect(mockRpc).toHaveBeenCalledWith('confirm_payway_attempt', {
      p_appointment_id: unknownAttempt.appointment_id,
      p_attempt_id: unknownAttempt.id,
      p_provider_id: '987654',
      p_amount_minor: 500000,
    });
  });

  it('reconciles UNKNOWN attempt to REJECTED without confirming appointment', async () => {
    const unknownAttempt = {
      id: '33333333-3333-4333-8333-333333333333',
      appointment_id: 'appt-2222',
      site_transaction_id: 'KANI33333333333343338333333333333333',
      amount_minor_units: 500000,
      state: 'UNKNOWN',
    };

    mockFrom.mockImplementation((table: string) => {
      if (table === 'appointment_payment_orders') {
        return {
          select: () => ({
            eq: () => ({
              lt: () => ({ limit: vi.fn().mockResolvedValue({ data: [], error: null }) }),
            }),
          }),
        };
      }
      if (table === 'payment_attempts') {
        return {
          select: () => ({
            eq: () => ({
              in: () => ({
                lt: () => ({ limit: vi.fn().mockResolvedValue({ data: [unknownAttempt], error: null }) }),
              }),
            }),
          }),
        };
      }
      return {};
    });

    mockQueryPaywayPayment.mockResolvedValueOnce({
      matches: true,
      providerId: '987655',
      status: 'rejected',
    });

    await reconcilePendingPayments();

    // Settle rejected
    expect(mockRpc).toHaveBeenCalledWith('settle_payway_attempt', {
      p_attempt_id: unknownAttempt.id,
      p_state: 'REJECTED',
      p_provider_id: '987655',
      p_provider_status: 'rejected',
      p_provider_code: 'reconciled_rejected',
    });

    // Confirm appointment must NEVER be called
    expect(mockRpc).not.toHaveBeenCalledWith('confirm_payway_attempt', expect.anything());
  });

  it('explicitly excludes historical test attempts from reconciliation', async () => {
    const historicalAttempts = [
      { id: '1123fda5-abff-4775-8313-aa250967ec12', site_transaction_id: 'KANI1', state: 'UNKNOWN' },
      { id: '0d3f50b8-baac-4cf9-b88a-7e5bac2f2313', site_transaction_id: 'KANI2', state: 'UNKNOWN' },
    ];

    mockFrom.mockImplementation((table: string) => {
      if (table === 'appointment_payment_orders') {
        return {
          select: () => ({
            eq: () => ({
              lt: () => ({ limit: vi.fn().mockResolvedValue({ data: [], error: null }) }),
            }),
          }),
        };
      }
      if (table === 'payment_attempts') {
        return {
          select: () => ({
            eq: () => ({
              in: () => ({
                lt: () => ({ limit: vi.fn().mockResolvedValue({ data: historicalAttempts, error: null }) }),
              }),
            }),
          }),
        };
      }
      return {};
    });

    await reconcilePendingPayments();

    // Query must never be called for historical attempts
    expect(mockQueryPaywayPayment).not.toHaveBeenCalled();
    // Neither settle nor confirm should be called
    expect(mockRpc).not.toHaveBeenCalledWith('settle_payway_attempt', expect.anything());
    expect(mockRpc).not.toHaveBeenCalledWith('confirm_payway_attempt', expect.anything());
  });

  it('leaves attempt as UNKNOWN if remote status is indeterminate or error', async () => {
    const unknownAttempt = {
      id: '44444444-4444-4444-8444-444444444444',
      appointment_id: 'appt-3333',
      site_transaction_id: 'KANI44444444444444448444444444444444',
      amount_minor_units: 500000,
      state: 'UNKNOWN',
    };

    mockFrom.mockImplementation((table: string) => {
      if (table === 'appointment_payment_orders') {
        return {
          select: () => ({
            eq: () => ({
              lt: () => ({ limit: vi.fn().mockResolvedValue({ data: [], error: null }) }),
            }),
          }),
        };
      }
      if (table === 'payment_attempts') {
        return {
          select: () => ({
            eq: () => ({
              in: () => ({
                lt: () => ({ limit: vi.fn().mockResolvedValue({ data: [unknownAttempt], error: null }) }),
              }),
            }),
          }),
        };
      }
      return {};
    });

    // Indeterminate / network failure
    mockQueryPaywayPayment.mockResolvedValueOnce(null);

    await reconcilePendingPayments();

    // Must NOT alter attempt
    expect(mockRpc).not.toHaveBeenCalledWith('settle_payway_attempt', expect.anything());
    expect(mockRpc).not.toHaveBeenCalledWith('confirm_payway_attempt', expect.anything());
  });

  it('server scheduled export triggers reconciliation end-to-end', async () => {
    const serverModule = await import('../server');
    const scheduledHandler = serverModule.default.scheduled;
    expect(typeof scheduledHandler).toBe('function');

    const mockCtx = { waitUntil: vi.fn() };
    await scheduledHandler({}, {}, mockCtx);

    expect(mockCtx.waitUntil).toHaveBeenCalled();
  });
});
