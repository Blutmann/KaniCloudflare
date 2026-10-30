-- Target: iockpxtkflyjfagkvgnr (Supabase Test)
-- Enable durable reconciliation of Payway payment attempts from UNKNOWN to terminal APPROVED/REJECTED.

create or replace function public.guard_payment_attempt_transition() returns trigger
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
    (old.state = 'PROCESSING' and new.state in ('APPROVED','REJECTED','UNKNOWN')) or
    (old.state = 'UNKNOWN' and new.state in ('APPROVED','REJECTED'))
  ) then raise exception 'PAYMENT_TRANSITION_INVALID'; end if;
  new.updated_at := clock_timestamp();
  return new;
end; $$;

create or replace function public.settle_payway_attempt(
  p_attempt_id uuid,
  p_state text,
  p_provider_id text default null,
  p_provider_status text default null,
  p_provider_code text default null
)
returns void language plpgsql security definer set search_path = '' as $$
declare v_attempt public.payment_attempts%rowtype;
begin
  if p_state not in ('APPROVED','REJECTED','UNKNOWN') then raise exception 'PAYMENT_TRANSITION_INVALID'; end if;
  select * into strict v_attempt from public.payment_attempts where id=p_attempt_id and provider='PAYWAY' for update;
  if v_attempt.state=p_state and (p_provider_id is null or v_attempt.provider_transaction_id=p_provider_id) then return; end if;
  if v_attempt.state not in ('PROCESSING', 'UNKNOWN') then raise exception 'PAYMENT_TRANSITION_INVALID'; end if;
  update public.payment_attempts set state=p_state,provider_transaction_id=p_provider_id,
    provider_status=p_provider_status,provider_code=p_provider_code,updated_at=clock_timestamp() where id=p_attempt_id;
end; $$;
