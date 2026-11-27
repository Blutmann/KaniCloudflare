// @vitest-environment jsdom
import fs from 'node:fs';
import path from 'node:path';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveBookingPaymentGateway } from '@/lib/kani-payment-routing';

const mocks = vi.hoisted(() => ({
  createPaymentSupabaseClient: vi.fn(),
  getMercadoPagoOrder: vi.fn(),
  getRuntimeEnv: vi.fn((key: string) => {
    if (key === 'MERCADOPAGO_ACCESS_TOKEN') return 'TEST-TOKEN';
    if (key === 'SUPABASE_URL') return 'https://iockpxtkflyjfagkvgnr.supabase.co';
    return undefined;
  }),
  releaseUnpaidBookingHoldFn: vi.fn(),
}));

vi.mock('@/lib/kani-payment-db.server', () => ({
  createPaymentSupabaseClient: (...args: any[]) => mocks.createPaymentSupabaseClient(...args),
}));

vi.mock('@/lib/kani-mercadopago.server', () => ({
  getRuntimeEnv: (key: string) => mocks.getRuntimeEnv(key),
  verifyAndConfirmAppointmentPayment: vi.fn(),
}));

vi.mock('@/lib/kani-mercadopago', async () => {
  const actual = await vi.importActual<typeof import('@/lib/kani-mercadopago')>('@/lib/kani-mercadopago');
  return {
    ...actual,
    getMercadoPagoOrder: (...args: any[]) => mocks.getMercadoPagoOrder(...args),
  };
});

vi.mock('@/lib/kani-payway.functions', () => ({
  releaseUnpaidBookingHoldFn: (...args: any[]) => mocks.releaseUnpaidBookingHoldFn(...args),
}));

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (opts: any) => opts,
  Link: ({ children, to, ...rest }: any) => <a href={to} {...rest}>{children}</a>,
}));

vi.mock('@/components/kani/experimental/liquid-glass-shell', () => ({
  LiquidGlassShell: ({ children }: any) => <div data-testid="shell">{children}</div>,
}));

import { releaseAbandonedUnpaidHoldServer } from '@/lib/kani-unpaid-hold.server';
import { PagoErrorPage } from '@/routes/pago.error';

const APT_ID = '11111111-2222-4333-8444-555555555555';

function makeDbMock(config: {
  appointment?: { id: string; status: string; deposit_paid: boolean } | null;
  activeAttempts?: Array<{ id: string; state: string }>;
  mpOrder?: {
    appointment_id: string;
    order_id: string | null;
    paid_amount_ars: number | null;
    reconciliation_status: string;
  } | null;
  rpcResult?: string;
}) {
  const rpc = vi.fn().mockResolvedValue({ data: config.rpcResult ?? 'RELEASED', error: null });
  const from = vi.fn((table: string) => {
    const chain: any = {
      select: () => chain,
      update: () => chain,
      eq: () => chain,
      in: () => chain,
      is: () => chain,
      limit: () => chain,
      maybeSingle: async () => {
        if (table === 'appointments') return { data: config.appointment ?? null, error: null };
        if (table === 'appointment_payment_orders') return { data: config.mpOrder ?? null, error: null };
        return { data: null, error: null };
      },
      then: (resolve: any, reject: any) => {
        if (table === 'payment_attempts') {
          return Promise.resolve({ data: config.activeAttempts ?? [], error: null }).then(resolve, reject);
        }
        return Promise.resolve({ data: [], error: null }).then(resolve, reject);
      },
    };
    return chain;
  });
  return { from, rpc };
}

describe('Unpaid 7-minute hold expiration & immediate release', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.replaceState({}, '', '/pago/error');
    window.sessionStorage.clear();
  });

  afterEach(() => {
    cleanup();
  });

  it('releases an abandoned PENDING unpaid hold via atomic RPC when no payment is in progress', async () => {
    const db = makeDbMock({
      appointment: { id: APT_ID, status: 'PENDING', deposit_paid: false },
      activeAttempts: [],
      mpOrder: null,
      rpcResult: 'RELEASED',
    });
    mocks.createPaymentSupabaseClient.mockResolvedValue(db);

    const res = await releaseAbandonedUnpaidHoldServer({ appointmentId: APT_ID });
    expect(res).toEqual({ released: true, status: 'RELEASED' });
    expect(db.rpc).toHaveBeenCalledWith('release_abandoned_unpaid_hold', {
      p_appointment_id: APT_ID,
    });
  });

  it('blocks release if appointment is CONFIRMED or deposit_paid = true', async () => {
    const db = makeDbMock({
      appointment: { id: APT_ID, status: 'CONFIRMED', deposit_paid: true },
    });
    mocks.createPaymentSupabaseClient.mockResolvedValue(db);

    const res = await releaseAbandonedUnpaidHoldServer({ appointmentId: APT_ID });
    expect(res).toEqual({ released: false, status: 'NOT_PENDING' });
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it('blocks release if Payway has an attempt in PROCESSING, APPROVED, or UNKNOWN', async () => {
    const db = makeDbMock({
      appointment: { id: APT_ID, status: 'PENDING', deposit_paid: false },
      activeAttempts: [{ id: 'att-1', state: 'PROCESSING' }],
    });
    mocks.createPaymentSupabaseClient.mockResolvedValue(db);

    const res = await releaseAbandonedUnpaidHoldServer({ appointmentId: APT_ID });
    expect(res).toEqual({ released: false, status: 'PAYMENT_IN_PROGRESS_OR_PAID' });
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it('checks live Mercado Pago order and blocks release if paid or active, but releases if canceled unpaid', async () => {
    const dbActive = makeDbMock({
      appointment: { id: APT_ID, status: 'PENDING', deposit_paid: false },
      activeAttempts: [],
      mpOrder: {
        appointment_id: APT_ID,
        order_id: 'mp-order-active',
        paid_amount_ars: null,
        reconciliation_status: 'PENDING',
      },
    });
    mocks.createPaymentSupabaseClient.mockResolvedValue(dbActive);
    mocks.getMercadoPagoOrder.mockResolvedValueOnce({
      success: true,
      order: { id: 'mp-order-active', status: 'processed', total_paid_amount: '5000.00' },
    });

    const activeRes = await releaseAbandonedUnpaidHoldServer({ appointmentId: APT_ID });
    expect(activeRes).toEqual({ released: false, status: 'MERCADO_PAGO_ACTIVE_OR_PAID' });
    expect(dbActive.rpc).not.toHaveBeenCalled();

    const dbCanceled = makeDbMock({
      appointment: { id: APT_ID, status: 'PENDING', deposit_paid: false },
      activeAttempts: [],
      mpOrder: {
        appointment_id: APT_ID,
        order_id: 'mp-order-canceled',
        paid_amount_ars: null,
        reconciliation_status: 'PENDING',
      },
      rpcResult: 'RELEASED',
    });
    mocks.createPaymentSupabaseClient.mockResolvedValue(dbCanceled);
    mocks.getMercadoPagoOrder.mockResolvedValueOnce({
      success: true,
      order: {
        id: 'mp-order-canceled',
        status: 'canceled',
        total_paid_amount: '0.00',
        transactions: { payments: [{ status: 'canceled', paid_amount: '0.00' }] },
      },
    });

    const canceledRes = await releaseAbandonedUnpaidHoldServer({ appointmentId: APT_ID });
    expect(canceledRes).toEqual({ released: true, status: 'RELEASED' });
    expect(dbCanceled.rpc).toHaveBeenCalledWith('release_abandoned_unpaid_hold', {
      p_appointment_id: APT_ID,
    });
  });

  it('PagoErrorPage immediately releases abandoned MP hold on mount, clears sessionStorage, and shows 7-minute copy', async () => {
    window.history.replaceState({}, '', `/pago/error?appointment_id=${APT_ID}`);
    window.sessionStorage.setItem(
      'kani:mercadopago:reservar-active-attempt',
      JSON.stringify({ appointmentId: APT_ID, timestamp: Date.now() }),
    );
    mocks.releaseUnpaidBookingHoldFn.mockResolvedValueOnce({ released: true, status: 'RELEASED' });

    render(<PagoErrorPage />);

    await waitFor(() => {
      expect(mocks.releaseUnpaidBookingHoldFn).toHaveBeenCalledWith({
        data: { appointmentId: APT_ID },
      });
    });

    expect(
      await screen.findByText(/Liberamos la reserva temporal de ese horario/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/Tiempo de sesión de pago expirado \(7 minutos\)/i)).toBeInTheDocument();
    expect(window.sessionStorage.getItem('kani:mercadopago:reservar-active-attempt')).toBeNull();
  });

  it('preserves direct confirmation for $0 benefit bookings (NO_DEPOSIT / FREE_SERVICE)', () => {
    expect(
      resolveBookingPaymentGateway({
        barberName: 'Gonzalo',
        benefitType: 'NO_DEPOSIT',
        onlineDepositArs: 0,
      }),
    ).toBe('DIRECT_ZERO_DEPOSIT');
    expect(
      resolveBookingPaymentGateway({
        barberName: 'Lautaro',
        benefitType: 'FREE_SERVICE',
        onlineDepositArs: 0,
      }),
    ).toBe('DIRECT_ZERO_DEPOSIT');
  });

  it('SQL migration unifies 7-minute hold window, fixes MP PENDING expiration, adds release_abandoned_unpaid_hold, and keeps late-payment recovery', () => {
    const sqlPath = path.resolve(
      process.cwd(),
      'supabase/migrations/20261127000300_kani_unpaid_hold_7m_and_release.sql',
    );
    const sql = fs.readFileSync(sqlPath, 'utf8');

    expect(sql).toContain("SET DEFAULT (now() + interval '7 minutes')");
    expect(sql).toContain("created_at <= now() - interval '7 minutes'");
    expect(sql).toContain("reconciliation_status IN ('CONFIRMED', 'PAID_LATE_REVIEW', 'PAID_CANCELLED_REVIEW')");
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.release_abandoned_unpaid_hold(p_appointment_id uuid)');
    expect(sql).toContain("cancellation_reason = 'HOLD_ABANDONED'");
    expect(sql).toContain("coalesce(v_appt.cancellation_reason, '') NOT IN ('PAYMENT_EXPIRED', 'HOLD_ABANDONED')");
    expect(sql).toContain("v_resolution := 'PAID_LATE_REVIEW'");
    expect(sql).toContain("v_appt.created_at + interval '7 minutes'");
    expect(sql).toContain("OR existing.created_at + interval '7 minutes' > clock_timestamp()");
    expect(sql).not.toContain("interval '10 minutes'");
  });
});
