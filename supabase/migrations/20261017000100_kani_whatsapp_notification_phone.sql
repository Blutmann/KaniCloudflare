-- KANI Barber Studio - Soporte para notificaciones de WhatsApp
-- Almacena el teléfono del cliente en el evento de notificación y lo expone a través de claim_appointment_notification

alter table public.appointment_notification_events
  add column if not exists recipient_phone text;

create or replace function public.create_appointment_notification_event(
  p_appointment_id uuid,
  p_notification_type public.notification_type
)
returns text
language plpgsql
security definer
set search_path = pg_catalog, extensions
as $$
declare
  v_token text := gen_random_uuid()::text;
  v_recipient_email text;
  v_recipient_phone text;
  v_client_name text;
  v_barber_name text;
  v_service_name text;
  v_booking_date date;
  v_start_time time;
  v_end_time time;
  v_client_notes text;
  v_service_price_ars integer;
  v_service_duration_minutes integer;
  v_down_payment_ars integer;
  v_transfer_alias text;
  v_transfer_cuit text;
  v_transfer_holder_name text;
begin
  select c.email, c.phone, c.name, b.name, s.name, a.booking_date, a.start_time, a.end_time,
         a.notes, s.price_ars, s.duration_minutes, td.down_payment_ars,
         td.alias, td.cuit, td.holder_name
    into v_recipient_email, v_recipient_phone, v_client_name, v_barber_name, v_service_name,
         v_booking_date, v_start_time, v_end_time, v_client_notes,
         v_service_price_ars, v_service_duration_minutes, v_down_payment_ars,
         v_transfer_alias, v_transfer_cuit, v_transfer_holder_name
  from public.appointments a
  join public.clients c on c.id = a.client_id
  join public.barbers b on b.id = a.barber_id
  join public.services s on s.id = a.service_id
  left join public.barber_transfer_details td on td.barber_id = a.barber_id
    and td.active = true
  where a.id = p_appointment_id;

  if not found then
    raise exception using errcode = 'P0001', message = 'APPOINTMENT_NOT_FOUND';
  end if;

  insert into public.appointment_notification_events (
    appointment_id, notification_type, recipient_email, recipient_phone, client_name, barber_name,
    service_name, booking_date, start_time, end_time, client_notes,
    service_price_ars, service_duration_minutes, down_payment_ars,
    transfer_alias, transfer_cuit, transfer_holder_name, claim_token_digest
  ) values (
    p_appointment_id, p_notification_type, v_recipient_email, v_recipient_phone, v_client_name,
    v_barber_name, v_service_name, v_booking_date, v_start_time, v_end_time,
    v_client_notes, v_service_price_ars, v_service_duration_minutes,
    v_down_payment_ars, v_transfer_alias, v_transfer_cuit, v_transfer_holder_name,
    encode(digest(v_token, 'sha256'), 'hex')
  ) on conflict (appointment_id, notification_type) do nothing;

  if found then
    return v_token;
  end if;
  return null;
end;
$$;

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
  start_time time,
  end_time time,
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
set search_path = pg_catalog, extensions
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
grant execute on function public.claim_appointment_notification(uuid, text) to anon, authenticated;
