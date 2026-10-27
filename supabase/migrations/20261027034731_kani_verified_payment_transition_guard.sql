CREATE OR REPLACE FUNCTION public.confirm_verified_appointment_payment(p_appointment_id uuid, p_provider text, p_reference text, p_paid_amount numeric)
 RETURNS TABLE(appointment_status appointment_status, result_code text, notification_claim_token text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_appt public.appointments%rowtype; v_order public.appointment_payment_orders%rowtype;
  v_attempt public.payment_attempts%rowtype; v_token text; v_resolution text;
begin
  select * into v_appt from public.appointments where id=p_appointment_id;
  if not found then return query select null::public.appointment_status,'APPOINTMENT_NOT_FOUND'::text,null::text; return; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_appt.barber_id::text||'|'||v_appt.booking_date::text,0));
  select * into v_appt from public.appointments where id=p_appointment_id for update;
  if p_provider='MERCADO_PAGO' then
    select * into v_order from public.appointment_payment_orders where appointment_id=p_appointment_id for update;
    if not found or p_reference is null or v_order.order_id is distinct from p_reference or p_paid_amount is distinct from v_order.expected_amount_ars::numeric then
      return query select v_appt.status,'PAYMENT_MISMATCH'::text,null::text; return;
    end if;
    update public.appointment_payment_orders set paid_amount_ars=p_paid_amount::integer,updated_at=now() where appointment_id=p_appointment_id;
  elsif p_provider='PAYWAY' then
    select * into v_attempt from public.payment_attempts where id=p_reference::uuid and appointment_id=p_appointment_id and provider='PAYWAY' for update;
    if not found or v_attempt.state<>'APPROVED' or v_attempt.provider_transaction_id is null or p_paid_amount is distinct from v_attempt.amount_ars then
      return query select v_appt.status,'PAYMENT_MISMATCH'::text,null::text; return;
    end if;
  else return query select v_appt.status,'PAYMENT_MISMATCH'::text,null::text; return; end if;
  if v_appt.status in ('CONFIRMED','COMPLETED') then
    if not v_appt.deposit_paid then update public.appointments set deposit_paid=true,deposit_amount_ars=p_paid_amount::integer,updated_at=now() where id=p_appointment_id; end if;
    if p_provider='PAYWAY' then update public.payment_attempts set confirmation_status='ALREADY_CONFIRMED' where id=v_attempt.id; end if;
    return query select v_appt.status,'ALREADY_CONFIRMED'::text,null::text; return;
  end if;
  if v_appt.status='CANCELLED' then v_resolution := 'PAID_CANCELLED_REVIEW';
  elsif exists(select 1 from public.appointments other where other.barber_id=v_appt.barber_id and other.booking_date=v_appt.booking_date and other.id<>v_appt.id
    and other.status in ('PENDING','CONFIRMED','COMPLETED') and other.start_time<v_appt.end_time and other.end_time>v_appt.start_time)
    or v_appt.booking_date+v_appt.start_time<=timezone('America/Argentina/Buenos_Aires',now()) then v_resolution := 'PAID_LATE_REVIEW';
  end if;
  if v_resolution is not null then
    if p_provider='MERCADO_PAGO' then update public.appointment_payment_orders set reconciliation_status=v_resolution,updated_at=now() where appointment_id=p_appointment_id;
    else update public.payment_attempts set confirmation_status=v_resolution where id=v_attempt.id; end if;
    return query select v_appt.status,case when v_resolution='PAID_CANCELLED_REVIEW' then 'APPOINTMENT_CANCELLED' else 'SLOT_COLLISION_LATE_PAYMENT' end,null::text; return;
  end if;
  perform set_config('kani.verified_payment_appointment',p_appointment_id::text,true);
  update public.appointments set status='CONFIRMED',deposit_paid=true,deposit_amount_ars=p_paid_amount::integer,updated_at=now() where id=p_appointment_id;
  perform set_config('kani.verified_payment_appointment','',true);
  if p_provider='MERCADO_PAGO' then update public.appointment_payment_orders set reconciliation_status='CONFIRMED',updated_at=now() where appointment_id=p_appointment_id;
  else update public.payment_attempts set confirmation_status='CONFIRMED' where id=v_attempt.id; end if;
  v_token := public.create_appointment_notification_event(p_appointment_id,'CONFIRMED');
  return query select 'CONFIRMED'::public.appointment_status,'CONFIRMED'::text,v_token;
end; $function$
;
create function public.guard_pending_payment_transition() returns trigger
language plpgsql set search_path='' as $$
begin
  if old.status='PENDING' and new.status in ('CONFIRMED','COMPLETED') and
    (current_setting('kani.verified_payment_appointment',true) is distinct from new.id::text or not new.deposit_paid)
  then raise exception using errcode='42501',message='VERIFIED_PAYMENT_REQUIRED'; end if;
  return new;
end; $$;
revoke all on function public.guard_pending_payment_transition() from public,anon,authenticated;
create trigger appointments_verified_payment_guard before update of status on public.appointments
for each row execute function public.guard_pending_payment_transition();

