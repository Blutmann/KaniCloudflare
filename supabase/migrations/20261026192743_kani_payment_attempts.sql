-- Authorized target: Kani Barber (Pruebas), iockpxtkflyjfagkvgnr only.
-- No card/token/credential/authentication data is stored in this ledger.
create table public.payment_attempts (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid not null references public.appointments(id) on delete restrict,
  provider text not null check (provider in ('PAYWAY', 'MERCADO_PAGO')),
  site_transaction_id text not null check (site_transaction_id ~ '^[A-Za-z0-9]{1,39}$'),
  provider_transaction_id text check (provider_transaction_id ~ '^[A-Za-z0-9_-]{1,100}$'),
  provider_site_id text check (provider_site_id ~ '^[0-9]{1,20}$'),
  amount_ars numeric(12,2) not null check (amount_ars > 0),
  amount_minor_units bigint not null check (amount_minor_units > 0 and amount_minor_units = amount_ars * 100),
  currency text not null default 'ARS' check (currency = 'ARS'),
  state text not null default 'CREATED' check (state in ('CREATED','PROCESSING','APPROVED','REJECTED','UNKNOWN','CANCELLED')),
  provider_status text check (provider_status ~ '^[A-Za-z0-9_-]{1,40}$'),
  provider_code text check (provider_code ~ '^[A-Za-z0-9_-]{1,40}$'),
  confirmation_status text not null default 'NOT_CONFIRMED'
    check (confirmation_status in ('NOT_CONFIRMED','CONFIRMED','ALREADY_CONFIRMED','PAID_CANCELLED_REVIEW','PAID_LATE_REVIEW')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  processing_started_at timestamptz,
  expires_at timestamptz not null default (now() + interval '10 minutes'),
  unique (provider, site_transaction_id),
  unique (provider, provider_transaction_id),
  check (state <> 'APPROVED' or provider_transaction_id is not null)
);
-- Historical rejected/cancelled attempts coexist. Only unresolved/paid attempts exclude another.
create unique index payment_attempts_one_active_per_appointment on public.payment_attempts(appointment_id)
  where state in ('CREATED','PROCESSING','UNKNOWN','APPROVED');
create index payment_attempts_appointment_history on public.payment_attempts(appointment_id,created_at desc);
alter table public.payment_attempts enable row level security;
revoke all on public.payment_attempts from public, anon, authenticated;
grant select on public.payment_attempts to authenticated;
grant select, insert, update on public.payment_attempts to service_role;
create policy payment_attempts_admin_read on public.payment_attempts for select to authenticated
  using ((select public.is_admin()));

create function public.guard_payment_attempt_transition() returns trigger
language plpgsql set search_path = '' as $$
begin
  if (new.id,new.appointment_id,new.provider,new.site_transaction_id,new.amount_ars,new.amount_minor_units,new.currency,new.provider_site_id,new.created_at,new.expires_at)
     is distinct from
     (old.id,old.appointment_id,old.provider,old.site_transaction_id,old.amount_ars,old.amount_minor_units,old.currency,old.provider_site_id,old.created_at,old.expires_at) then
    raise exception 'PAYMENT_ATTEMPT_IMMUTABLE';
  end if;
  if old.provider_transaction_id is not null and new.provider_transaction_id is distinct from old.provider_transaction_id then
    raise exception 'PAYMENT_TRANSACTION_IMMUTABLE';
  end if;
  if new.state <> old.state and not (
    (old.state = 'CREATED' and new.state in ('PROCESSING','CANCELLED')) or
    (old.state = 'PROCESSING' and new.state in ('APPROVED','REJECTED','UNKNOWN'))
  ) then raise exception 'PAYMENT_TRANSITION_INVALID'; end if;
  new.updated_at := clock_timestamp();
  return new;
end; $$;
create trigger payment_attempts_guard before update on public.payment_attempts
  for each row execute function public.guard_payment_attempt_transition();
revoke all on function public.guard_payment_attempt_transition() from public,anon,authenticated;

create function public.prepare_payway_attempt(
  p_attempt_id uuid, p_site_id text, p_barber_name text, p_service_name text,
  p_booking_date date, p_start_time time, p_client_name text, p_client_phone text,
  p_client_email text, p_notes text default null, p_existing_appointment_id uuid default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid; v_appt public.appointments%rowtype; v_attempt public.payment_attempts%rowtype;
  v_barber text; v_price integer; v_deposit numeric;
begin
  if p_site_id is null or p_site_id !~ '^[0-9]{1,20}$' or p_attempt_id is null then raise exception 'PAYMENT_CONFIGURATION_INVALID'; end if;
  if p_existing_appointment_id is null then
    -- Existing booking RPC validates interval availability, clients and business rules.
    -- Appointment and ledger insert commit together or both roll back.
    select r.appointment_id into v_id from public.request_appointment(
      p_barber_name,p_service_name,p_booking_date,p_start_time,p_client_name,p_client_phone,p_client_email,p_notes
    ) r;
  else
    v_id := p_existing_appointment_id;
  end if;
  select * into strict v_appt from public.appointments where id=v_id;
  perform pg_advisory_xact_lock(hashtextextended(v_appt.barber_id::text || '|' || v_appt.booking_date::text,0));
  select * into strict v_appt from public.appointments where id=v_id for update;
  if not exists (
    select 1 from public.appointments a join public.barbers b on b.id=a.barber_id
    join public.services s on s.id=a.service_id join public.clients c on c.id=a.client_id
    where a.id=v_id and b.name=trim(p_barber_name) and s.name=trim(p_service_name)
      and a.booking_date=p_booking_date and a.start_time=p_start_time
      and c.name=trim(p_client_name) and lower(c.email)=lower(trim(p_client_email)) and c.phone=trim(p_client_phone)
      and coalesce(a.notes,'')=trim(coalesce(p_notes,''))
  ) then raise exception 'CHECKOUT_RESERVATION_CHANGED'; end if;
  if v_appt.status <> 'PENDING' or v_appt.deposit_paid or v_appt.created_at+interval '10 minutes' <= clock_timestamp() then
    raise exception 'APPOINTMENT_NOT_PAYABLE';
  end if;
  if exists(select 1 from public.appointment_payment_orders where appointment_id=v_id) then raise exception 'PAYMENT_PROVIDER_CONFLICT'; end if;
  select * into v_attempt from public.payment_attempts where appointment_id=v_id
    and state in ('CREATED','PROCESSING','APPROVED','UNKNOWN') for update;
  if found then
    if v_attempt.state <> 'CREATED' or v_attempt.expires_at <= clock_timestamp() then raise exception 'PAYMENT_REVIEW_REQUIRED'; end if;
    return to_jsonb(v_attempt);
  end if;
  select b.name,s.price_ars into v_barber,v_price from public.barbers b join public.services s on s.id=v_appt.service_id where b.id=v_appt.barber_id;
  v_deposit := public.read_public_deposit_amount(v_barber);
  if v_deposit is null or v_deposit <= 0 or v_deposit > v_price then raise exception 'DEPOSIT_CONFIGURATION_INVALID'; end if;
  insert into public.payment_attempts(id,appointment_id,provider,site_transaction_id,provider_site_id,amount_ars,amount_minor_units,expires_at)
    values(p_attempt_id,v_id,'PAYWAY','KANI'||replace(p_attempt_id::text,'-',''),p_site_id,v_deposit,(v_deposit*100)::bigint,v_appt.created_at+interval '10 minutes')
    returning * into v_attempt;
  return to_jsonb(v_attempt);
end; $$;

create function public.claim_payway_attempt(p_attempt_id uuid,p_appointment_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_appt public.appointments%rowtype; v_attempt public.payment_attempts%rowtype; v_acquired boolean := false; v_price integer;
begin
  select * into strict v_appt from public.appointments where id=p_appointment_id;
  perform pg_advisory_xact_lock(hashtextextended(v_appt.barber_id::text||'|'||v_appt.booking_date::text,0));
  select * into strict v_appt from public.appointments where id=p_appointment_id for update;
  select * into strict v_attempt from public.payment_attempts where id=p_attempt_id and appointment_id=p_appointment_id and provider='PAYWAY' for update;
  if v_attempt.state='CREATED' and v_attempt.expires_at>clock_timestamp() and v_appt.status='PENDING' and not v_appt.deposit_paid
    and not exists(select 1 from public.appointment_payment_orders where appointment_id=p_appointment_id)
    and v_appt.booking_date+v_appt.start_time>timezone('America/Argentina/Buenos_Aires',clock_timestamp()) then
    update public.payment_attempts set state='PROCESSING',processing_started_at=clock_timestamp() where id=p_attempt_id returning * into v_attempt;
    v_acquired := true;
  end if;
  select price_ars into v_price from public.services where id=v_appt.service_id;
  return jsonb_build_object('acquired',v_acquired,'attempt',to_jsonb(v_attempt),'appointment',
    jsonb_build_object('id',v_appt.id,'status',v_appt.status,'deposit_ars',v_attempt.amount_ars,'service_price_ars',v_price,'deposit_paid',v_appt.deposit_paid));
end; $$;

create function public.settle_payway_attempt(p_attempt_id uuid,p_state text,p_provider_id text default null,p_provider_status text default null,p_provider_code text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_attempt public.payment_attempts%rowtype;
begin
  if p_state not in ('APPROVED','REJECTED','UNKNOWN') then raise exception 'PAYMENT_TRANSITION_INVALID'; end if;
  select * into strict v_attempt from public.payment_attempts where id=p_attempt_id and provider='PAYWAY' for update;
  if v_attempt.state=p_state and (p_provider_id is null or v_attempt.provider_transaction_id=p_provider_id) then return; end if;
  if v_attempt.state <> 'PROCESSING' then raise exception 'PAYMENT_TRANSITION_INVALID'; end if;
  update public.payment_attempts set state=p_state,provider_transaction_id=p_provider_id,
    provider_status=p_provider_status,provider_code=p_provider_code where id=p_attempt_id;
end; $$;

-- Shared confirmation core: same schedule lock, interval collision, cancelled/late
-- checks and outbox as the existing MP function. Its public signature stays intact.
create function public.confirm_verified_appointment_payment(p_appointment_id uuid,p_provider text,p_reference text,p_paid_amount numeric)
returns table(appointment_status public.appointment_status,result_code text,notification_claim_token text)
language plpgsql security definer set search_path = '' as $$
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
    and other.status in ('CONFIRMED','COMPLETED') and other.start_time<v_appt.end_time and other.end_time>v_appt.start_time)
    or v_appt.booking_date+v_appt.start_time<=timezone('America/Argentina/Buenos_Aires',now()) then v_resolution := 'PAID_LATE_REVIEW';
  end if;
  if v_resolution is not null then
    if p_provider='MERCADO_PAGO' then update public.appointment_payment_orders set reconciliation_status=v_resolution,updated_at=now() where appointment_id=p_appointment_id;
    else update public.payment_attempts set confirmation_status=v_resolution where id=v_attempt.id; end if;
    return query select v_appt.status,case when v_resolution='PAID_CANCELLED_REVIEW' then 'APPOINTMENT_CANCELLED' else 'SLOT_COLLISION_LATE_PAYMENT' end,null::text; return;
  end if;
  update public.appointments set status='CONFIRMED',deposit_paid=true,deposit_amount_ars=p_paid_amount::integer,updated_at=now() where id=p_appointment_id;
  if p_provider='MERCADO_PAGO' then update public.appointment_payment_orders set reconciliation_status='CONFIRMED',updated_at=now() where appointment_id=p_appointment_id;
  else update public.payment_attempts set confirmation_status='CONFIRMED' where id=v_attempt.id; end if;
  v_token := public.create_appointment_notification_event(p_appointment_id,'CONFIRMED');
  return query select 'CONFIRMED'::public.appointment_status,'CONFIRMED'::text,v_token;
end; $$;

create or replace function public.confirm_appointment_from_payment(p_appointment_id uuid,p_order_id text default null,p_paid_amount integer default null)
returns table(appointment_status public.appointment_status,result_code text,notification_claim_token text)
language sql security definer set search_path = '' as $$
  select * from public.confirm_verified_appointment_payment(p_appointment_id,'MERCADO_PAGO',p_order_id,p_paid_amount::numeric);
$$;

create function public.confirm_payway_attempt(p_appointment_id uuid,p_attempt_id uuid,p_provider_id text,p_amount_minor bigint)
returns table(appointment_status public.appointment_status,result_code text,notification_claim_token text)
language plpgsql security definer set search_path = '' as $$
begin
  if not exists(select 1 from public.payment_attempts where id=p_attempt_id and appointment_id=p_appointment_id and provider='PAYWAY'
    and state='APPROVED' and provider_transaction_id=p_provider_id and amount_minor_units=p_amount_minor) then
    return query select null::public.appointment_status,'PAYMENT_MISMATCH'::text,null::text; return;
  end if;
  return query select * from public.confirm_verified_appointment_payment(p_appointment_id,'PAYWAY',p_attempt_id::text,p_amount_minor::numeric/100);
end; $$;

-- Only new cross-provider races are refused; MP orders and MP API contracts stay unchanged.
create function public.guard_mercadopago_attempt_conflict() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_appt public.appointments%rowtype;
begin
  select * into v_appt from public.appointments where id=new.appointment_id;
  if found then
    perform pg_advisory_xact_lock(hashtextextended(v_appt.barber_id::text||'|'||v_appt.booking_date::text,0));
    perform 1 from public.appointments where id=new.appointment_id for update;
    if exists(select 1 from public.payment_attempts where appointment_id=new.appointment_id and state in ('CREATED','PROCESSING','APPROVED','UNKNOWN')) then
      raise exception 'PAYMENT_PROVIDER_CONFLICT';
    end if;
  end if;
  return new;
end; $$;
create trigger mp_order_attempt_conflict before insert on public.appointment_payment_orders
  for each row execute function public.guard_mercadopago_attempt_conflict();

revoke all on function public.prepare_payway_attempt(uuid,text,text,text,date,time,text,text,text,text,uuid) from public,anon,authenticated;
revoke all on function public.claim_payway_attempt(uuid,uuid) from public,anon,authenticated;
revoke all on function public.settle_payway_attempt(uuid,text,text,text,text) from public,anon,authenticated;
revoke all on function public.confirm_verified_appointment_payment(uuid,text,text,numeric) from public,anon,authenticated;
revoke all on function public.confirm_appointment_from_payment(uuid,text,integer) from public,anon,authenticated;
revoke all on function public.confirm_payway_attempt(uuid,uuid,text,bigint) from public,anon,authenticated;
revoke all on function public.guard_mercadopago_attempt_conflict() from public,anon,authenticated;
grant execute on function public.prepare_payway_attempt(uuid,text,text,text,date,time,text,text,text,text,uuid) to service_role;
grant execute on function public.claim_payway_attempt(uuid,uuid) to service_role;
grant execute on function public.settle_payway_attempt(uuid,text,text,text,text) to service_role;
grant execute on function public.confirm_verified_appointment_payment(uuid,text,text,numeric) to service_role;
grant execute on function public.confirm_appointment_from_payment(uuid,text,integer) to service_role;
grant execute on function public.confirm_payway_attempt(uuid,uuid,text,bigint) to service_role;
