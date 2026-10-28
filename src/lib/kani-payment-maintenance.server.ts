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

  // Payway reconciliation for stranded UNKNOWN or PROCESSING attempts
  try {
    const { readPaywayConfig, queryPaywayPayment } = await import('./kani-payway.server');
    const paywayConfig = readPaywayConfig(getRuntimeEnv);
    if (paywayConfig) {
      const { data: attempts } = await db.from('payment_attempts')
        .select('id, appointment_id, site_transaction_id, amount_minor_units, state')
        .eq('provider', 'PAYWAY')
        .in('state', ['UNKNOWN', 'PROCESSING'])
        .lt('created_at', new Date(Date.now() - 5 * 60_000).toISOString())
        .limit(20);

      // Preserve historical diagnostic test attempts completely untouched
      const HISTORICAL_EXCLUDED_ATTEMPTS = [
        '1123fda5-abff-4775-8313-aa250967ec12',
        '0d3f50b8-baac-4cf9-b88a-7e5bac2f2313',
      ];

      for (const att of attempts ?? []) {
        if (HISTORICAL_EXCLUDED_ATTEMPTS.includes(att.id)) {
          continue;
        }
        const query = await queryPaywayPayment(paywayConfig, att.site_transaction_id);
        if (!query) continue;

        if (query.matches && query.providerId && query.status === 'approved') {
          await db.rpc('settle_payway_attempt', {
            p_attempt_id: att.id,
            p_state: 'APPROVED',
            p_provider_id: query.providerId,
            p_provider_status: 'approved',
            p_provider_code: 'reconciled_approved',
          });
          await db.rpc('confirm_payway_attempt', {
            p_appointment_id: att.appointment_id,
            p_attempt_id: att.id,
            p_provider_id: query.providerId,
            p_amount_minor: att.amount_minor_units,
          });
        } else if (query.matches && query.status === 'rejected') {
          await db.rpc('settle_payway_attempt', {
            p_attempt_id: att.id,
            p_state: 'REJECTED',
            p_provider_id: query.providerId ?? null,
            p_provider_status: 'rejected',
            p_provider_code: 'reconciled_rejected',
          });
        } else if (query.status === 'not_found' && att.state === 'PROCESSING') {
          await db.rpc('settle_payway_attempt', {
            p_attempt_id: att.id,
            p_state: 'REJECTED',
            p_provider_id: null,
            p_provider_status: 'not_found',
            p_provider_code: 'reconciled_not_found',
          });
        }
      }
    }
  } catch {
    /* Payway maintenance continues silently to expiration RPC */
  }

  const expired = await db.rpc('expire_unpaid_appointments');
  if (expired.error) throw new Error('PAYMENT_EXPIRATION_FAILED');
}
