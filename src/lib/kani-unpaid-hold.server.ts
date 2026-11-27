import { createPaymentSupabaseClient } from './kani-payment-db.server';
import { getRuntimeEnv } from './kani-mercadopago.server';
import { getMercadoPagoOrder, type MercadoPagoOrderDetails } from './kani-mercadopago';
import { isUnpaidTerminalOrder } from './kani-payment-maintenance.server';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ReleaseUnpaidHoldResult = {
  released: boolean;
  status:
    | 'RELEASED'
    | 'INVALID_APPOINTMENT_ID'
    | 'NOT_FOUND'
    | 'NOT_PENDING'
    | 'PAYMENT_IN_PROGRESS_OR_PAID'
    | 'MERCADO_PAGO_ACTIVE_OR_PAID'
    | 'ERROR';
};

function isMercadoPagoOrderActiveOrPaid(order: MercadoPagoOrderDetails): boolean {
  if (order.total_paid_amount !== undefined && Number(order.total_paid_amount) > 0) {
    return true;
  }
  const orderStatus = String(order.status ?? '').toLowerCase();
  if (['processed', 'authorized', 'in_process', 'action_required', 'approved'].includes(orderStatus)) {
    return true;
  }
  const payments = order.transactions?.payments ?? [];
  return payments.some((p) => {
    const pStatus = String(p.status ?? '').toLowerCase();
    return (
      (p.paid_amount !== undefined && Number(p.paid_amount) > 0) ||
      ['approved', 'authorized', 'in_process', 'processed', 'action_required'].includes(pStatus)
    );
  });
}

export async function releaseAbandonedUnpaidHoldServer(input: {
  appointmentId: string;
}): Promise<ReleaseUnpaidHoldResult> {
  const appointmentId = String(input?.appointmentId ?? '').trim();
  if (!UUID_PATTERN.test(appointmentId)) {
    return { released: false, status: 'INVALID_APPOINTMENT_ID' };
  }

  try {
    const db = await createPaymentSupabaseClient();

    const { data: appt, error: apptErr } = await db
      .from('appointments')
      .select('id, status, deposit_paid')
      .eq('id', appointmentId)
      .maybeSingle();

    if (apptErr || !appt) {
      return { released: false, status: apptErr ? 'ERROR' : 'NOT_FOUND' };
    }

    // Never touch CONFIRMED, COMPLETED, CANCELLED, or already paid appointments.
    if (appt.status !== 'PENDING' || appt.deposit_paid === true) {
      return { released: false, status: 'NOT_PENDING' };
    }

    // Never release if there is any Payway attempt in APPROVED, PROCESSING, or UNKNOWN.
    const { data: activeAttempts, error: attErr } = await db
      .from('payment_attempts')
      .select('id, state')
      .eq('appointment_id', appointmentId)
      .in('state', ['APPROVED', 'PROCESSING', 'UNKNOWN'])
      .limit(1);

    if (attErr) {
      return { released: false, status: 'ERROR' };
    }
    if (Array.isArray(activeAttempts) && activeAttempts.length > 0) {
      return { released: false, status: 'PAYMENT_IN_PROGRESS_OR_PAID' };
    }

    // Check Mercado Pago order if one exists.
    const { data: mpOrder, error: mpErr } = await db
      .from('appointment_payment_orders')
      .select('appointment_id, order_id, paid_amount_ars, reconciliation_status')
      .eq('appointment_id', appointmentId)
      .maybeSingle();

    if (mpErr) {
      return { released: false, status: 'ERROR' };
    }

    if (mpOrder) {
      if (
        mpOrder.paid_amount_ars != null ||
        ['CONFIRMED', 'PAID_LATE_REVIEW', 'PAID_CANCELLED_REVIEW'].includes(
          String(mpOrder.reconciliation_status ?? ''),
        )
      ) {
        return { released: false, status: 'PAYMENT_IN_PROGRESS_OR_PAID' };
      }

      if (mpOrder.order_id) {
        const accessToken = getRuntimeEnv('MERCADOPAGO_ACCESS_TOKEN');
        if (accessToken) {
          const orderLookup = await getMercadoPagoOrder({
            orderId: mpOrder.order_id,
            accessToken,
          });
          if (orderLookup.success && orderLookup.order) {
            if (isMercadoPagoOrderActiveOrPaid(orderLookup.order)) {
              return { released: false, status: 'MERCADO_PAGO_ACTIVE_OR_PAID' };
            }
            if (isUnpaidTerminalOrder(orderLookup.order)) {
              await db
                .from('appointment_payment_orders')
                .update({ reconciliation_status: 'UNPAID_TERMINAL' })
                .eq('appointment_id', appointmentId)
                .eq('reconciliation_status', 'PENDING')
                .is('paid_amount_ars', null);
            }
          }
        }
      }
    }

    // Prefer atomic DB RPC (advisory lock + row lock + double-check).
    if (typeof db.rpc === 'function') {
      const rpcRes = await db.rpc('release_abandoned_unpaid_hold', {
        p_appointment_id: appointmentId,
      });
      if (!rpcRes.error && typeof rpcRes.data === 'string') {
        const code = rpcRes.data as ReleaseUnpaidHoldResult['status'];
        return { released: code === 'RELEASED', status: code };
      }
    }

    // Safe guarded fallback if the new SQL RPC is not yet deployed on the DB.
    await db
      .from('payment_attempts')
      .update({ state: 'CANCELLED' })
      .eq('appointment_id', appointmentId)
      .eq('state', 'CREATED');

    const nowIso = new Date().toISOString();
    const { data: updated, error: updateErr } = await db
      .from('appointments')
      .update({
        status: 'CANCELLED',
        cancellation_reason: 'HOLD_ABANDONED',
        cancelled_at: nowIso,
        updated_at: nowIso,
      })
      .eq('id', appointmentId)
      .eq('status', 'PENDING')
      .eq('deposit_paid', false)
      .select('id');

    if (updateErr) {
      return { released: false, status: 'ERROR' };
    }
    const released = Array.isArray(updated) && updated.length > 0;
    return { released, status: released ? 'RELEASED' : 'NOT_PENDING' };
  } catch (err) {
    console.warn('[Kani hold release] Failed to release unpaid hold:', err);
    return { released: false, status: 'ERROR' };
  }
}
