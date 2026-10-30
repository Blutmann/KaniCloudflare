-- Target: iockpxtkflyjfagkvgnr (Supabase Test)
-- 1. Release availability hold after 10 minutes even if attempt is in PROCESSING/UNKNOWN,
--    while preserving the attempt untouched for reconciliation and preventing double charges.
-- 2. On delayed approval confirmation:
--    - Atomically confirm if slot is still free, time has not passed, and cancellation was due to expired hold.
--    - Flag as PAID_CANCELLED_REVIEW if appointment was manually cancelled.
--    - Flag as PAID_LATE_REVIEW if slot is occupied or time has passed.

create or replace function public.expire_unpaid_appointments() returns integer
language plpgsql security definer set search_path = '' as $$
declare a record; n integer:=0;
begin
  for a in select id,barber_id,booking_date from public.appointments
    where status='PENDING' and not deposit_paid and created_at <= now()-interval '10 minutes'
    order by barber_id,booking_date,id limit 500
  loop
    perform pg_advisory_xact_lock(hashtextextended(a.barber_id::text||'|'||a.booking_date::text,0));
    perform 1 from public.appointments where id=a.id for update;
    if exists(select 1 from public.appointments where id=a.id and status='PENDING' and not deposit_paid
        and created_at<=now()-interval '10 minutes')
      and not exists(select 1 from public.payment_attempts where appointment_id=a.id and state = 'APPROVED')
      and not exists(select 1 from public.appointment_payment_orders where appointment_id=a.id
        and (paid_amount_ars is not null or reconciliation_status not in ('UNPAID_TERMINAL')))
    then
      -- Only cancel CREATED attempts; preserve PROCESSING and UNKNOWN attempts untouched
      update public.payment_attempts set state='CANCELLED' where appointment_id=a.id and state='CREATED';
      update public.appointments set status='CANCELLED', cancellation_reason='PAYMENT_EXPIRED',cancelled_at=now(),updated_at=now()
        where id=a.id;
      n:=n+1;
    end if;
  end loop;
  return n;
end; $$;

create or replace function public.confirm_verified_appointment_payment(p_appointment_id uuid,p_provider text,p_reference text,p_paid_amount numeric)
returns table(appointment_status public.appointment_status,result_code text,notification_claim_token text)
language plpgsql security definer set search_path = '' as $$
declare
  v_appt public.appointments%rowtype; v_order public.appointment_payment_orders%rowtype;
  v_attempt public.payment_attempts%rowtype; v_token text; v_resolution text;
  v_collision boolean; v_past boolean;
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

  v_collision := exists(
    select 1 from public.appointments other
    where other.barber_id=v_appt.barber_id and other.booking_date=v_appt.booking_date and other.id<>v_appt.id
      and other.status in ('PENDING','CONFIRMED','COMPLETED')
      and other.start_time<v_appt.end_time and other.end_time>v_appt.start_time
  );
  v_past := (v_appt.booking_date+v_appt.start_time <= timezone('America/Argentina/Buenos_Aires',now()));

  if v_appt.status='CANCELLED' and coalesce(v_appt.cancellation_reason, '') <> 'PAYMENT_EXPIRED' then
    v_resolution := 'PAID_CANCELLED_REVIEW';
  elsif v_collision or v_past then
    v_resolution := 'PAID_LATE_REVIEW';
  end if;

  if v_resolution is not null then
    if p_provider='MERCADO_PAGO' then update public.appointment_payment_orders set reconciliation_status=v_resolution,updated_at=now() where appointment_id=p_appointment_id;
    else update public.payment_attempts set confirmation_status=v_resolution where id=v_attempt.id; end if;
    return query select v_appt.status,case when v_resolution='PAID_CANCELLED_REVIEW' then 'APPOINTMENT_CANCELLED' else 'SLOT_COLLISION_LATE_PAYMENT' end,null::text; return;
  end if;

  update public.appointments set status='CONFIRMED',deposit_paid=true,deposit_amount_ars=p_paid_amount::integer,
    cancellation_reason=null,cancelled_at=null,cancelled_by=null,updated_at=now() where id=p_appointment_id;
  if p_provider='MERCADO_PAGO' then update public.appointment_payment_orders set reconciliation_status='CONFIRMED',updated_at=now() where appointment_id=p_appointment_id;
  else update public.payment_attempts set confirmation_status='CONFIRMED' where id=v_attempt.id; end if;
  v_token := public.create_appointment_notification_event(p_appointment_id,'CONFIRMED');
  return query select 'CONFIRMED'::public.appointment_status,'CONFIRMED'::text,v_token;
end; $$;
