-- KANI Barber Studio — Fase 4: notificaciones transaccionales idempotentes
-- La reserva/estado se confirma en Supabase; el email se procesa después desde el servidor.
-- No se almacenan claves de Resend ni se expone contenido privado al cliente.

create type public.notification_type as enum ('NEW_REQUEST', 'CONFIRMED', 'CANCELLED');
create type public.notification_delivery_status as enum ('PENDING', 'SENDING', 'SENT', 'FAILED');

create table public.appointment_notification_events (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid not null references public.appointments(id) on delete cascade,
  notification_type public.notification_type not null,
  recipient_email text not null check (position('@' in recipient_email) > 1),
  client_name text not null,
  barber_name text not null,
  service_name text not null,
  booking_date date not null,
  start_time time not null,
  end_time time not null,
  claim_token_digest text not null,
  status public.notification_delivery_status not null default 'PENDING',
  attempts integer not null default 0 check (attempts >= 0),
  provider_message_id text,
  last_error text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (appointment_id, notification_type)
);

create index appointment_notification_events_status_idx
  on public.appointment_notification_events (status, created_at);
create index appointment_notification_events_appointment_idx
  on public.appointment_notification_events (appointment_id, created_at desc);

alter table public.appointment_notification_events enable row level security;
revoke all on table public.appointment_notification_events from anon, authenticated;

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
begin
  select c.email, c.name, b.name, s.name, a.booking_date, a.start_time, a.end_time
    into v_recipient_email, v_client_name, v_barber_name, v_service_name,
         v_booking_date, v_start_time, v_end_time
  from public.appointments a
  join public.clients c on c.id = a.client_id
  join public.barbers b on b.id = a.barber_id
  join public.services s on s.id = a.service_id
  where a.id = p_appointment_id;

  if not found then
    raise exception using errcode = 'P0001', message = 'APPOINTMENT_NOT_FOUND';
  end if;

  insert into public.appointment_notification_events (
    appointment_id,
    notification_type,
    recipient_email,
    client_name,
    barber_name,
    service_name,
    booking_date,
    start_time,
    end_time,
    claim_token_digest
  )
  values (
    p_appointment_id,
    p_notification_type,
    v_recipient_email,
    v_client_name,
    v_barber_name,
    v_service_name,
    v_booking_date,
    v_start_time,
    v_end_time,
    encode(digest(v_token, 'sha256'), 'hex')
  )
  on conflict (appointment_id, notification_type) do nothing;

  if found then
    return v_token;
  end if;

  -- El evento ya existe; nunca se revela nuevamente su token.
  return null;
end;
$$;

revoke all on function public.create_appointment_notification_event(uuid, public.notification_type) from public, anon, authenticated;

-- Cambia el retorno de la RPC pública para entregar un token de un solo uso al servidor de emails.
drop function if exists public.request_appointment(text, text, date, time, text, text, text, text);

create function public.request_appointment(
  p_barber_name text,
  p_service_name text,
  p_booking_date date,
  p_start_time time,
  p_client_name text,
  p_client_phone text,
  p_client_email text,
  p_notes text default null
)
returns table (
  appointment_id uuid,
  appointment_status public.appointment_status,
  booking_date date,
  start_time time,
  end_time time,
  notification_claim_token text
)
language plpgsql
security definer
set search_path = pg_catalog, extensions
as $$
declare
  v_barber public.barbers%rowtype;
  v_service public.services%rowtype;
  v_client_id uuid;
begin
  if p_barber_name is null or length(trim(p_barber_name)) = 0 then
    raise exception using errcode = '22023', message = 'BARBER_REQUIRED';
  end if;
  if p_service_name is null or length(trim(p_service_name)) = 0 then
    raise exception using errcode = '22023', message = 'SERVICE_REQUIRED';
  end if;
  if p_client_name is null or length(trim(p_client_name)) < 3 then
    raise exception using errcode = '22023', message = 'CLIENT_NAME_INVALID';
  end if;
  if p_client_phone is null or length(trim(p_client_phone)) < 8 then
    raise exception using errcode = '22023', message = 'CLIENT_PHONE_INVALID';
  end if;
  if p_client_email is null or position('@' in trim(p_client_email)) <= 1 then
    raise exception using errcode = '22023', message = 'CLIENT_EMAIL_INVALID';
  end if;
  if p_booking_date < current_date or p_booking_date > current_date + 21 then
    raise exception using errcode = '22023', message = 'BOOKING_DATE_OUT_OF_RANGE';
  end if;
  if extract(isodow from p_booking_date) = 7 then
    raise exception using errcode = '22023', message = 'SUNDAY_CLOSED';
  end if;
  if p_start_time < time '10:00' or p_start_time >= time '20:00' or extract(second from p_start_time) <> 0 then
    raise exception using errcode = '22023', message = 'START_TIME_INVALID';
  end if;

  select b.* into strict v_barber
  from public.barbers b
  where b.name = trim(p_barber_name) and b.active = true;

  select s.* into strict v_service
  from public.services s
  where s.name = trim(p_service_name) and s.active = true;

  if p_start_time + (v_service.duration_minutes * interval '1 minute') > time '20:00' then
    raise exception using errcode = '22023', message = 'SERVICE_OUTSIDE_BUSINESS_HOURS';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_barber.id::text || '|' || p_booking_date::text, 0));

  if not exists (
    select 1
    from public.barber_availability_slots slot
    where slot.barber_id = v_barber.id
      and slot.slot_date = p_booking_date
      and slot.start_time <= p_start_time
      and slot.end_time >= p_start_time + (v_service.duration_minutes * interval '1 minute')
      and slot.status = 'AVAILABLE'
  ) then
    raise exception using errcode = 'P0001', message = 'SLOT_UNAVAILABLE';
  end if;

  if exists (
    select 1
    from public.appointments a
    where a.barber_id = v_barber.id
      and a.booking_date = p_booking_date
      and a.status <> 'CANCELLED'
      and a.start_time < p_start_time + (v_service.duration_minutes * interval '1 minute')
      and a.end_time > p_start_time
  ) then
    raise exception using errcode = '23P01', message = 'SLOT_ALREADY_BOOKED';
  end if;

  select c.id into v_client_id
  from public.clients c
  where lower(trim(c.email)) = lower(trim(p_client_email))
    and regexp_replace(c.phone, '[^0-9+]', '', 'g') = regexp_replace(trim(p_client_phone), '[^0-9+]', '', 'g')
  order by c.created_at asc
  limit 1;

  if v_client_id is null then
    insert into public.clients (name, phone, email)
    values (trim(p_client_name), trim(p_client_phone), lower(trim(p_client_email)))
    returning id into v_client_id;
  else
    update public.clients
    set name = trim(p_client_name), phone = trim(p_client_phone), email = lower(trim(p_client_email)), updated_at = now()
    where id = v_client_id;
  end if;

  insert into public.appointments as inserted (client_id, barber_id, service_id, booking_date, start_time, end_time, status, notes)
  values (v_client_id, v_barber.id, v_service.id, p_booking_date, p_start_time, p_start_time + (v_service.duration_minutes * interval '1 minute'), 'PENDING', nullif(trim(coalesce(p_notes, '')), ''))
  returning inserted.id, inserted.status, inserted.booking_date, inserted.start_time, inserted.end_time
  into appointment_id, appointment_status, booking_date, start_time, end_time;

  notification_claim_token := public.create_appointment_notification_event(appointment_id, 'NEW_REQUEST');
  return next;
exception
  when no_data_found then
    raise exception using errcode = 'P0001', message = 'BARBER_OR_SERVICE_NOT_FOUND';
end;
$$;

revoke execute on function public.request_appointment(text, text, date, time, text, text, text, text) from public;
grant execute on function public.request_appointment(text, text, date, time, text, text, text, text) to anon, authenticated;

-- El retorno incluye un nuevo token solo cuando la transición crea un evento nuevo.
drop function if exists public.update_appointment_status(uuid, public.appointment_status);

create function public.update_appointment_status(
  p_appointment_id uuid,
  p_status public.appointment_status
)
returns table (
  appointment_status public.appointment_status,
  notification_claim_token text
)
language plpgsql
security definer
set search_path = pg_catalog, extensions
as $$
declare
  v_current_status public.appointment_status;
  v_barber_id uuid;
  v_booking_date date;
begin
  if (select auth.uid()) is null then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;
  if p_status not in ('CONFIRMED', 'CANCELLED', 'COMPLETED') then
    raise exception using errcode = '22023', message = 'STATUS_NOT_ALLOWED';
  end if;

  select a.status, a.barber_id, a.booking_date
    into v_current_status, v_barber_id, v_booking_date
  from public.appointments a
  where a.id = p_appointment_id
    and (public.is_admin() or a.barber_id = public.current_staff_barber_id())
  for update;

  if v_barber_id is null then
    raise exception using errcode = '42501', message = 'APPOINTMENT_NOT_ALLOWED';
  end if;

  if v_current_status = p_status then
    appointment_status := v_current_status;
    notification_claim_token := null;
    return next;
    return;
  end if;

  if p_status = 'CONFIRMED' and v_current_status <> 'PENDING' then
    raise exception using errcode = '22023', message = 'STATUS_TRANSITION_NOT_ALLOWED';
  end if;
  if p_status = 'CANCELLED' and v_current_status not in ('PENDING', 'CONFIRMED') then
    raise exception using errcode = '22023', message = 'STATUS_TRANSITION_NOT_ALLOWED';
  end if;
  if p_status = 'COMPLETED' and v_current_status <> 'CONFIRMED' then
    raise exception using errcode = '22023', message = 'STATUS_TRANSITION_NOT_ALLOWED';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_barber_id::text || '|' || v_booking_date::text, 0));

  update public.appointments as updated
  set status = p_status, updated_at = now()
  where updated.id = p_appointment_id
  returning updated.status into appointment_status;

  if appointment_status = 'CONFIRMED' then
    notification_claim_token := public.create_appointment_notification_event(p_appointment_id, 'CONFIRMED');
  elsif appointment_status = 'CANCELLED' then
    notification_claim_token := public.create_appointment_notification_event(p_appointment_id, 'CANCELLED');
  else
    notification_claim_token := null;
  end if;

  return next;
end;
$$;

revoke execute on function public.update_appointment_status(uuid, public.appointment_status) from public, anon;
grant execute on function public.update_appointment_status(uuid, public.appointment_status) to authenticated;

-- Un RPC con token opaco permite que el backend obtenga solo el payload de un evento que acaba de crear.
create or replace function public.claim_appointment_notification(
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
           v_event.end_time, 'ALREADY_SENT'::text, v_event.attempts;
    return;
  end if;

  if v_event.status = 'SENDING' and v_event.updated_at > now() - interval '10 minutes' then
    return query
    select v_event.id, v_event.notification_type, v_event.recipient_email, v_event.client_name,
           v_event.barber_name, v_event.service_name, v_event.booking_date, v_event.start_time,
           'IN_PROGRESS'::text, v_event.attempts;
    return;
  end if;

  update public.appointment_notification_events as updated
  set status = 'SENDING', attempts = updated.attempts + 1, last_error = null, updated_at = now()
  where updated.id = v_event.id;

  return query
  select v_event.id, v_event.notification_type, v_event.recipient_email, v_event.client_name,
         v_event.barber_name, v_event.service_name, v_event.booking_date, v_event.start_time,
         v_event.end_time, 'READY'::text, v_event.attempts + 1;
end;
$$;

create or replace function public.complete_appointment_notification(
  p_notification_id uuid,
  p_claim_token text,
  p_provider_message_id text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, extensions
as $$
begin
  update public.appointment_notification_events
  set status = 'SENT', provider_message_id = nullif(trim(p_provider_message_id), ''),
      sent_at = now(), updated_at = now(), last_error = null
  where id = p_notification_id
    and claim_token_digest = encode(digest(p_claim_token, 'sha256'), 'hex')
    and status = 'SENDING';

  if not found then
    raise exception using errcode = '42501', message = 'NOTIFICATION_CLAIM_INVALID';
  end if;
  return true;
end;
$$;

create or replace function public.fail_appointment_notification(
  p_notification_id uuid,
  p_claim_token text,
  p_error text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, extensions
as $$
begin
  update public.appointment_notification_events
  set status = 'FAILED', last_error = left(coalesce(p_error, 'RESEND_SEND_FAILED'), 500), updated_at = now()
  where id = p_notification_id
    and claim_token_digest = encode(digest(p_claim_token, 'sha256'), 'hex')
    and status = 'SENDING';

  if not found then
    raise exception using errcode = '42501', message = 'NOTIFICATION_CLAIM_INVALID';
  end if;
  return true;
end;
$$;

revoke all on function public.claim_appointment_notification(uuid, text) from public;
revoke all on function public.complete_appointment_notification(uuid, text, text) from public;
revoke all on function public.fail_appointment_notification(uuid, text, text) from public;
grant execute on function public.claim_appointment_notification(uuid, text) to anon, authenticated;
grant execute on function public.complete_appointment_notification(uuid, text, text) to anon, authenticated;
grant execute on function public.fail_appointment_notification(uuid, text, text) to anon, authenticated;

comment on table public.appointment_notification_events is
  'Outbox privado e idempotente para emails de solicitudes, confirmaciones y cancelaciones. Las claves de Resend viven fuera de Supabase y nunca se almacenan aquí.';
comment on function public.claim_appointment_notification(uuid, text) is
  'Entrega al backend únicamente el payload asociado a un token de un solo uso y serializa los reintentos.';
