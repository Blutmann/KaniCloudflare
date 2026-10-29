import type { createPaymentSupabaseClient } from './kani-payment-db.server';
import type { PaywaySession } from './kani-payway-session.server';
import type { PaywayStore, PaywayAttempt } from './kani-payway.server';
import type { PaywayResult } from './kani-payway';
import { PAYWAY_MESSAGES } from './kani-payway';

type Db = Awaited<ReturnType<typeof createPaymentSupabaseClient>>;
type AttemptRow = { id:string; appointment_id:string; site_transaction_id:string; amount_ars:number; amount_minor_units:number;
  state:string; provider_transaction_id:string|null; confirmation_status:string; expires_at:string; provider_site_id:string };
type SessionAccess = { read:()=>Promise<PaywaySession|null>; write:(value:PaywaySession)=>Promise<void>; clear?:()=>Promise<void>|void };
const uuid = (id: string) => id.replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5');

export function createPaywayStore(db:Db,siteId:string,session:SessionAccess):PaywayStore {
  return {
    async prepare(draft) {
      let previous=await session.read();
      const attemptId=crypto.randomUUID();
      const args={p_attempt_id:attemptId,p_site_id:siteId,p_barber_name:draft.barber,p_service_name:draft.serviceName,
        p_booking_date:draft.date,p_start_time:draft.time,p_client_name:draft.name,p_client_phone:draft.phone,
        p_client_email:draft.email,p_notes:draft.notes,p_existing_appointment_id:previous?.appointmentId??null};
      const prepare = async (parameters:typeof args) => {
        try { return await db.rpc('prepare_payway_attempt',parameters); }
        catch { throw new Error('PAYMENT_REVIEW_REQUIRED'); } // The DB may have committed before the connection failed.
      };
      const prepareWithServiceFallback = async (parameters:typeof args) => {
        let res=await prepare(parameters);
        if(res.error?.message.includes('BARBER_OR_SERVICE_NOT_FOUND')&&['Corte y barba','Corte + barba'].includes(draft.serviceName)) {
          res=await prepare({...parameters,p_service_name:draft.serviceName==='Corte y barba'?'Corte + barba':'Corte y barba'});
        }
        return res;
      };
      let response=await prepareWithServiceFallback(args);
      if(previous&&(response.error?.message.includes('CHECKOUT_RESERVATION_CHANGED')||response.error?.message.includes('APPOINTMENT_NOT_PAYABLE'))) {
        previous=null;
        response=await prepareWithServiceFallback({...args,p_existing_appointment_id:null});
      }
      if(response.error||!response.data)throw new Error(response.error?.message.includes('PAYMENT_REVIEW_REQUIRED')?'PAYMENT_REVIEW_REQUIRED':'PAYMENT_PREPARATION_FAILED');
      const row=response.data as AttemptRow;
      const accessToken=previous?.accessToken??crypto.randomUUID().replaceAll('-','')+crypto.randomUUID().replaceAll('-','');
      try { await session.write({appointmentId:row.appointment_id,accessToken,expiresAt:new Date(row.expires_at).getTime()}); }
      catch { throw new Error('PAYMENT_REVIEW_REQUIRED'); }
      return {appointmentId:row.appointment_id,attemptId:row.id.replaceAll('-',''),accessToken,depositArs:Number(row.amount_ars)};
    },
    async claim(input) {
      const owner=await session.read();
      if(!owner||owner.appointmentId!==input.appointmentId||owner.accessToken!==input.accessToken)throw new Error('PAYWAY_CHECKOUT_NOT_OWNED');
      const {data,error}=await db.rpc('claim_payway_attempt',{p_attempt_id:uuid(input.attemptId),p_appointment_id:input.appointmentId});
      if(error||!data)throw new Error('PAYMENT_CLAIM_FAILED');
      const row=data.attempt as AttemptRow;
      if(row.provider_site_id!==siteId)throw new Error('PAYMENT_SITE_MISMATCH');
      const stateMap:Record<string,PaywayAttempt['state']>={CREATED:'prepared',PROCESSING:'processing',APPROVED:'approved',REJECTED:'rejected',UNKNOWN:'unknown',CANCELLED:'unknown'};
      let result:PaywayResult|undefined;
      if(row.state==='APPROVED'&&['CONFIRMED','ALREADY_CONFIRMED'].includes(row.confirmation_status))result={state:'approved',message:PAYWAY_MESSAGES.approved,appointmentConfirmed:true};
      else if(row.state==='REJECTED')result={state:'rejected',message:PAYWAY_MESSAGES.rejected};

      let clientId: string | undefined;
      let clientEmail: string | undefined;
      if (typeof db.from === 'function') {
        try {
          const { data: apptWithClient } = await db
            .from('appointments')
            .select('client_id, clients(id, email)')
            .eq('id', input.appointmentId)
            .maybeSingle();
          if (apptWithClient) {
            clientId = apptWithClient.client_id;
            const c = Array.isArray(apptWithClient.clients) ? apptWithClient.clients[0] : apptWithClient.clients;
            clientEmail = c?.email ? String(c.email).trim().toLowerCase() : undefined;
          }
        } catch {
          /* Fall back cleanly if client query is unavailable */
        }
      }

      return {acquired:data.acquired===true,appointment:{id:data.appointment.id,status:data.appointment.status,
        depositArs:Number(data.appointment.deposit_ars),servicePriceArs:Number(data.appointment.service_price_ars),depositPaid:data.appointment.deposit_paid,origin:'PUBLIC_WEB',
        clientId,clientEmail},
        attempt:{id:row.id.replaceAll('-',''),appointmentId:row.appointment_id,siteTransactionId:row.site_transaction_id,amount:Number(row.amount_minor_units),state:stateMap[row.state]??'unknown',...(result?{result}:{})}};
    },
    async settle(attemptId,state,providerId,providerStatus,providerCode) {
      const {error}=await db.rpc('settle_payway_attempt',{p_attempt_id:uuid(attemptId),p_state:state.toUpperCase(),
        p_provider_id:providerId??null,p_provider_status:providerStatus??null,p_provider_code:providerCode??null});
      if(error)throw new Error('PAYMENT_SETTLEMENT_FAILED');
    },
    async confirm(appointmentId,attemptId,providerId,amount) {
      const {data,error}=await db.rpc('confirm_payway_attempt',{p_appointment_id:appointmentId,p_attempt_id:uuid(attemptId),p_provider_id:providerId,p_amount_minor:amount});
      const result=data?.[0];
      if(error||!result)return false;
      if(result.notification_claim_token){
        const {dispatchAppointmentNotification}=await import('./kani-notifications.functions');
        try{await dispatchAppointmentNotification({appointmentId,claimToken:result.notification_claim_token});}catch{/* Durable outbox retains notification for recovery. */}
      }
      const confirmed=['CONFIRMED','ALREADY_CONFIRMED'].includes(result.result_code);
      if(confirmed){
        try{await session.clear?.();}catch{/* Best-effort session cleanup after terminal confirmation. */}
      }
      return confirmed;
    },
  };
}
