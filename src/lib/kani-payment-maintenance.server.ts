import { createPaymentSupabaseClient } from './kani-payment-db.server';
import { getRuntimeEnv, verifyAndConfirmAppointmentPayment } from './kani-mercadopago.server';
import { getMercadoPagoOrder, type MercadoPagoOrderDetails } from './kani-mercadopago';

/** Only an authoritative terminal Orders response can release an MP hold. */
export function isUnpaidTerminalOrder(order: MercadoPagoOrderDetails): boolean {
  return ['expired', 'canceled'].includes(order.status)
    && Number(order.total_paid_amount) === 0 && order.total_paid_amount !== undefined
    && (order.transactions?.payments ?? []).every(p =>
      ['failed', 'canceled'].includes(p.status ?? '') && p.paid_amount !== undefined && Number(p.paid_amount) === 0);
}

export async function reconcilePendingPayments() {
  // This maintenance is deliberately limited to the authorized Test project.
  if (getRuntimeEnv('SUPABASE_URL') !== 'https://iockpxtkflyjfagkvgnr.supabase.co') return;
  const db = await createPaymentSupabaseClient();
  const { data, error } = await db.from('appointment_payment_orders')
    .select('appointment_id, order_id').eq('reconciliation_status', 'PENDING')
    .lt('created_at', new Date(Date.now() - 10 * 60_000).toISOString()).limit(100);
  if (error) throw new Error('PAYMENT_MAINTENANCE_READ_FAILED');
  for (const intent of data ?? []) {
    if (!intent.order_id) continue;
    try {
      const { order, success } = await getMercadoPagoOrder({ orderId: intent.order_id, accessToken: getRuntimeEnv('MERCADOPAGO_ACCESS_TOKEN') });
      if (!success || !order || order.id !== intent.order_id || order.external_reference !== intent.appointment_id) continue;
      if (isUnpaidTerminalOrder(order)) {
        // Do not overwrite an approval recorded by a concurrent webhook.
        const result = await db.from('appointment_payment_orders').update({ reconciliation_status: 'UNPAID_TERMINAL' })
          .eq('appointment_id', intent.appointment_id).eq('reconciliation_status', 'PENDING').is('paid_amount_ars', null);
        if (result.error) throw new Error('PAYMENT_MAINTENANCE_WRITE_FAILED');
      } else {
        await verifyAndConfirmAppointmentPayment({ appointmentId: intent.appointment_id, orderId: intent.order_id });
      }
    } catch { console.error('[Kani maintenance] payment requires reconciliation'); }
  }
  const expired = await db.rpc('expire_unpaid_appointments');
  if (expired.error) throw new Error('PAYMENT_EXPIRATION_FAILED');
}
