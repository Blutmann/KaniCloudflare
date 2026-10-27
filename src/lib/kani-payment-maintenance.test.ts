import { describe, it, expect, vi } from 'vitest';
vi.mock('./kani-payment-db.server', () => ({ createPaymentSupabaseClient: vi.fn() }));
vi.mock('./kani-mercadopago.server', () => ({ getRuntimeEnv: vi.fn(), verifyAndConfirmAppointmentPayment: vi.fn() }));
import { isUnpaidTerminalOrder } from './kani-payment-maintenance.server';

describe('safe MP reconciliation evidence', () => {
  it('releases only authoritative terminal and explicitly unpaid orders', () => {
    expect(isUnpaidTerminalOrder({ id:'1',status:'expired',total_paid_amount:'0' })).toBe(true);
    expect(isUnpaidTerminalOrder({ id:'1',status:'canceled',total_paid_amount:'0',transactions:{payments:[{status:'failed',paid_amount:'0'}]} })).toBe(true);
  });
  it('keeps ambiguous, processing, partially paid, or approved evidence reserved', () => {
    for(const order of [
      {status:'created',total_paid_amount:'0'}, {status:'processing',total_paid_amount:'0'},
      {status:'expired'}, {status:'expired',total_paid_amount:'5000'},
      {status:'canceled',total_paid_amount:'0',transactions:{payments:[{status:'processed',paid_amount:'5000'}]}},
    ]) expect(isUnpaidTerminalOrder({id:'1',...order})).toBe(false);
  });
});
