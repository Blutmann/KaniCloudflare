import { createPaymentSupabaseClient } from './kani-payment-db.server';
import { getRuntimeEnv } from './kani-notifications.server';
import { buildBarberConfirmedEmail, type BarberConfirmationPayload } from './kani-barber-confirmed-email';

type Job = { job_id:string; lease_id:string; recipient_email:string; payload:BarberConfirmationPayload;
  provider_request:Record<string,unknown> | null; is_test:boolean };

/** Called by the existing confirmation and scheduled recovery paths. Never throws into a booking. */
export async function dispatchBarberConfirmationEmails(options: { limit?:number; appointmentId?:string } = {}) {
  const result = { processed:0, accepted:0, failed:0 };
  try {
    const db = await createPaymentSupabaseClient();
    const { data, error } = await db.rpc('claim_barber_confirmation_emails', {
      p_limit:options.limit ?? 10, p_appointment_id:options.appointmentId ?? null,
    });
    if (error) throw error;
    for (const job of (data || []) as Job[]) {
      result.processed++;
      try {
        const apiKey = getRuntimeEnv('RESEND_API_KEY');
        const from = getRuntimeEnv('RESEND_FROM_EMAIL');
        if (!apiKey || !from) throw new Error('RESEND_CONFIGURATION_MISSING');
        const email = buildBarberConfirmedEmail(job.payload, {
          appUrl:getRuntimeEnv('KANI_APP_URL') || getRuntimeEnv('APP_URL') || 'https://www.kanibarber.com',
          calendarSyncEnabled:getRuntimeEnv('GOOGLE_CALENDAR_SYNC_ENABLED') === 'true', isTest:job.is_test,
        });
        const { data:request, error:prepareError } = await db.rpc('prepare_barber_confirmation_email', {
          p_id:job.job_id, p_lease:job.lease_id, p_request:job.provider_request || {
            from, to:[job.recipient_email], subject:email.subject, html:email.html, text:email.text,
          }, p_diagnostic:email.diagnostic,
        });
        if (prepareError || !request) throw new Error('BARBER_EMAIL_PREPARE_FAILED');
        const response = await fetch('https://api.resend.com/emails', {
          method:'POST', headers:{ Authorization:`Bearer ${apiKey}`, 'Content-Type':'application/json',
            'Idempotency-Key':`barber-confirmed/${job.job_id}` },
          body:JSON.stringify(request), signal:AbortSignal.timeout(15000),
        });
        const receipt = await response.json().catch(()=>null) as { id?:string } | null;
        if (!response.ok || !receipt?.id) throw new Error(`RESEND_HTTP_${response.status}`);
        const { data:finished,error:finishError } = await db.rpc('finish_barber_confirmation_email', {
          p_id:job.job_id,p_lease:job.lease_id,p_status:'PROVIDER_ACCEPTED',p_message_id:receipt.id,p_error:null,
        });
        if (finishError || !finished) throw new Error('BARBER_EMAIL_RECEIPT_NOT_SAVED');
        result.accepted++;
      } catch (error) {
        // Do not log addresses, provider bodies, appointment contacts or secrets.
        const code = error instanceof Error && /^[A-Z_0-9]+$/.test(error.message) ? error.message : 'BARBER_EMAIL_SEND_FAILED';
        const { error:writeError } = await db.rpc('finish_barber_confirmation_email', {
          p_id:job.job_id,p_lease:job.lease_id,p_status:'FAILED',p_message_id:null,p_error:code,
        });
        if (writeError) console.warn('[Barber Email] Durable lease retained for recovery');
        result.failed++;
      }
    }
  } catch {
    console.warn('[Barber Email] Recovery temporarily unavailable; confirmed bookings preserved');
    result.failed++;
  }
  return result;
}
