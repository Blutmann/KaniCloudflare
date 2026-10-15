-- KANI Barber Studio — Fase 4.3: destinatarios correctos y reintento acotado del outbox.
-- NEW_REQUEST se envía al email Auth del barbero; CONFIRMED/CANCELLED al cliente.
-- Si falta un email de staff, el evento registra FAILED sin revertir la reserva.

alter table public.appointment_notification_events
  add column if not exists client_notes text;

alter table public.appointment_notification_events
  alter column recipient_email drop not null;

alter table public.appointment_notification_events
  drop constraint if exists appointment_notification_events_recipient_email_check;
alter table public.appointment_notification_events
  add constraint appointment_notification_events_recipient_email_check
  check (recipient_email is null or position('@' in recipient_email) > 1);

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
  v_client_name text;
  v_barber_name text;
  v_service_name text;
  v_booking_date date;
  v_start_time time;
  v_end_time time;
  v_client_notes text;
begin
  if p_notification_type = 'NEW_REQUEST' then
    select u.email, c.name, b.name, s.name, a.booking_date, a.start_time, a.end_time, a.notes
      into v_recipient_email, v_client_name, v_barber_name, v_service_name,
           v_booking_date, v_start_time, v_end_time, v_client_notes
    from public.appointments a
    join public.clients c on c.id = a.client_id
    join public.barbers b on b.id = a.barber_id
    join public.services s on s.id = a.service_id
    left join public.staff_profiles sp on sp.barber_id = a.barber_id
      and sp.role = 'BARBER' and sp.active = true
    left join auth.users u on u.id = sp.user_id
    where a.id = p_appointment_id;
  else
    select c.email, c.name, b.name, s.name, a.booking_date, a.start_time, a.end_time, a.notes
      into v_recipient_email, v_client_name, v_barber_name, v_service_name,
           v_booking_date, v_start_time, v_end_time, v_client_notes
    from public.appointments a
    join public.clients c on c.id = a.client_id
    join public.barbers b on b.id = a.barber_id
    join public.services s on s.id = a.service_id
    where a.id = p_appointment_id;
  end if;

  if not found then
    raise exception using errcode = 'P0001', message = 'APPOINTMENT_NOT_FOUND';
  end if;

  insert into public.appointment_notification_events (
    appointment_id, notification_type, recipient_email, client_name, barber_name,
    service_name, booking_date, start_time, end_time, client_notes, claim_token_digest
  ) values (
    p_appointment_id, p_notification_type, v_recipient_email, v_client_name,
    v_barber_name, v_service_name, v_booking_date, v_start_time, v_end_time,
    v_client_notes, encode(digest(v_token, 'sha256'), 'hex')
  ) on conflict (appointment_id, notification_type) do nothing;

  if found then
    return v_token;
  end if;
  return null;
end;
$$;

-- Cambia el tipo de retorno de la RPC (no se puede hacer con CREATE OR REPLACE).
drop function if exists public.claim_appointment_notification(uuid, text);

create function public.claim_appointment_notification(
  p_appointment_id uuid,
  p_claim_token text
)
returns table (
  notification_id uuid,
  notification_type public.notification_type,
  recipient_email text,
  client_name text,
  barber_name text,
  service_name text,
  booking_date date,
  start_time time,
  end_time time,
  client_notes text,
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
    select v_event.id, v_event.notification_type, v_event.recipient_email, v_event.client_name,
           v_event.barber_name, v_event.service_name, v_event.booking_date, v_event.start_time,
           v_event.end_time, v_event.client_notes, 'ALREADY_SENT'::text, v_event.attempts;
    return;
  end if;

  if v_event.status = 'SENDING' and v_event.updated_at > now() - interval '10 minutes' then
    return query
    select v_event.id, v_event.notification_type, v_event.recipient_email, v_event.client_name,
           v_event.barber_name, v_event.service_name, v_event.booking_date, v_event.start_time,
           v_event.end_time, v_event.client_notes, 'IN_PROGRESS'::text, v_event.attempts;
    return;
  end if;

  update public.appointment_notification_events as updated
  set status = 'SENDING', attempts = updated.attempts + 1, last_error = null, updated_at = now()
  where updated.id = v_event.id;

  return query
  select v_event.id, v_event.notification_type, v_event.recipient_email, v_event.client_name,
         v_event.barber_name, v_event.service_name, v_event.booking_date, v_event.start_time,
         v_event.end_time, v_event.client_notes, 'READY'::text, v_event.attempts + 1;
end;
$$;

revoke all on function public.claim_appointment_notification(uuid, text) from public;
grant execute on function public.claim_appointment_notification(uuid, text) to anon, authenticated;

-- Solo staff activo y dueño de la agenda (o ADMIN) puede recuperar un evento no enviado.
-- El ID del evento y su Idempotency-Key de Resend se conservan al rotar el token.
create or replace function public.retry_appointment_notification(p_appointment_id uuid)
returns text
language plpgsql
security definer
set search_path = pg_catalog, extensions
as $$
declare
  v_token text := gen_random_uuid()::text;
  v_event_id uuid;
begin
  if (select auth.uid()) is null then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;
  select e.id into v_event_id
  from public.appointments a
  join public.appointment_notification_events e on e.appointment_id = a.id
  where a.id = p_appointment_id
    and (public.is_admin() or a.barber_id = public.current_staff_barber_id())
    and e.notification_type = case a.status
      when 'PENDING' then 'NEW_REQUEST'::public.notification_type
      when 'CONFIRMED' then 'CONFIRMED'::public.notification_type
      when 'CANCELLED' then 'CANCELLED'::public.notification_type
      else null::public.notification_type
    end
    and (e.status in ('PENDING', 'FAILED') or
         (e.status = 'SENDING' and e.updated_at <= now() - interval '10 minutes'))
  limit 1
  for update of e;

  if v_event_id is null then
    return null;
  end if;
  update public.appointment_notification_events as e
  set claim_token_digest = encode(digest(v_token, 'sha256'), 'hex'),
      status = 'PENDING', updated_at = now()
  where e.id = v_event_id;
  return v_token;
end;
$$;
revoke all on function public.retry_appointment_notification(uuid) from public, anon;
grant execute on function public.retry_appointment_notification(uuid) to authenticated;
