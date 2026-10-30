-- Migration: 20261030210000_kani_fix_claim_appointment_notification_recipient_phone.sql
-- Kani Barber Studio — Restaurar recipient_phone en claim_appointment_notification
-- Permite que el Worker de Cloudflare reciba el número de WhatsApp del cliente para el despacho vía Pontiun.

drop function if exists public.claim_appointment_notification(uuid, text);

create function public.claim_appointment_notification(
  p_appointment_id uuid,
  p_claim_token text
)
returns table (
  notification_id uuid,
  notification_type public.notification_type,
  recipient_email text,
  recipient_phone text,
  client_name text,
  barber_name text,
  service_name text,
  booking_date date,
  start_time time without time zone,
  end_time time without time zone,
  client_notes text,
  service_price_ars integer,
  service_duration_minutes integer,
  down_payment_ars integer,
  transfer_alias text,
  transfer_cuit text,
  transfer_holder_name text,
  dispatch_status text,
  attempt integer
)
language plpgsql
security definer
set search_path = 'pg_catalog', 'extensions'
as $$
declare
  v_event public.appointment_notification_events%rowtype;
begin
  if p_claim_token is null or length(trim(p_claim_token)) < 20 then
    raise exception using errcode = '42501', message = 'NOTIFICATION_CLAIM_INVALID';
  end if;

  select e.* into v_event
  from public.appointment_notification_events e
  where e.appointment_id = p_appointment_id
    and e.claim_token_digest = encode(digest(p_claim_token, 'sha256'), 'hex')
  for update;

  if not found then
    raise exception using errcode = '42501', message = 'NOTIFICATION_CLAIM_INVALID';
  end if;

  if v_event.status = 'SENT' then
    return query
    select v_event.id, v_event.notification_type, v_event.recipient_email,
           v_event.recipient_phone, v_event.client_name, v_event.barber_name,
           v_event.service_name, v_event.booking_date, v_event.start_time,
           v_event.end_time, v_event.client_notes, v_event.service_price_ars,
           v_event.service_duration_minutes, v_event.down_payment_ars,
           v_event.transfer_alias, v_event.transfer_cuit,
           v_event.transfer_holder_name, 'ALREADY_SENT'::text, v_event.attempts;
    return;
  end if;

  if v_event.status = 'SENDING' and v_event.updated_at > now() - interval '10 minutes' then
    return query
    select v_event.id, v_event.notification_type, v_event.recipient_email,
           v_event.recipient_phone, v_event.client_name, v_event.barber_name,
           v_event.service_name, v_event.booking_date, v_event.start_time,
           v_event.end_time, v_event.client_notes, v_event.service_price_ars,
           v_event.service_duration_minutes, v_event.down_payment_ars,
           v_event.transfer_alias, v_event.transfer_cuit,
           v_event.transfer_holder_name, 'IN_PROGRESS'::text, v_event.attempts;
    return;
  end if;

  update public.appointment_notification_events as updated
  set status = 'SENDING', attempts = updated.attempts + 1,
      last_error = null, updated_at = now()
  where updated.id = v_event.id;

  return query
  select v_event.id, v_event.notification_type, v_event.recipient_email,
         v_event.recipient_phone, v_event.client_name, v_event.barber_name,
         v_event.service_name, v_event.booking_date, v_event.start_time,
         v_event.end_time, v_event.client_notes, v_event.service_price_ars,
         v_event.service_duration_minutes, v_event.down_payment_ars,
         v_event.transfer_alias, v_event.transfer_cuit,
         v_event.transfer_holder_name, 'READY'::text, v_event.attempts + 1;
end;
$$;

revoke all on function public.claim_appointment_notification(uuid, text) from public;
grant execute on function public.claim_appointment_notification(uuid, text) to anon, authenticated, service_role;

comment on function public.claim_appointment_notification(uuid, text) is
  'Claims a pending appointment notification event and marks it SENDING. Returns event payload including recipient_phone.';

-- Register migration in Supabase ledger:
insert into supabase_migrations.schema_migrations (version)
values ('20261030210000')
on conflict (version) do nothing;

notify pgrst, 'reload schema';
