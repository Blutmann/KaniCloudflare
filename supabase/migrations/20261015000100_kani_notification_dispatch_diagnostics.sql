-- Persist notification failures that happen before the outbox claim increments attempts.
-- The one-time claim token is required; no secret or recipient data is returned.
create or replace function public.record_appointment_notification_dispatch_error(
  p_appointment_id uuid,
  p_claim_token text,
  p_error text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, extensions
as $$
declare
  v_updated integer;
begin
  if p_claim_token is null or length(trim(p_claim_token)) < 20 then
    raise exception using errcode = '42501', message = 'NOTIFICATION_CLAIM_INVALID';
  end if;

  update public.appointment_notification_events
  set status = 'FAILED',
      last_error = left(coalesce(nullif(trim(p_error), ''), 'NOTIFICATION_DISPATCH_FAILED'), 500),
      updated_at = now()
  where appointment_id = p_appointment_id
    and claim_token_digest = encode(digest(p_claim_token, 'sha256'), 'hex')
    and (status = 'PENDING' or (status = 'FAILED' and last_error is null));

  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$$;

revoke all on function public.record_appointment_notification_dispatch_error(uuid, text, text) from public;
grant execute on function public.record_appointment_notification_dispatch_error(uuid, text, text) to anon, authenticated;

comment on function public.record_appointment_notification_dispatch_error(uuid, text, text) is
  'Stores a token-authenticated dispatch error when notification processing fails before the normal claim/attempt counter.';
