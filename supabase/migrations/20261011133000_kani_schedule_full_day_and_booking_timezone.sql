-- Kani Barber Studio — granularidad manual de horarios y fecha de negocio en Preview.
-- No se aplica a Production. La configuración fuera de 10:00–20:00 permanece privada.

alter table public.barber_availability_slots
  drop constraint if exists availability_inside_business_hours,
  drop constraint if exists availability_interval_valid,
  drop constraint if exists availability_hourly_slot;

alter table public.barber_availability_slots
  add constraint availability_one_hour_interval check (
    (end_time > start_time and end_time - start_time = interval '1 hour')
    or (end_time < start_time and end_time - start_time + interval '24 hours' = interval '1 hour')
  );

create or replace view public.available_barber_slots
with (security_invoker = false)
as
select
  s.id,
  s.barber_id,
  s.slot_date,
  s.start_time,
  s.end_time,
  s.status
from public.barber_availability_slots s
join public.barbers b on b.id = s.barber_id
where b.active = true
  and s.start_time >= time '10:00'
  and s.end_time <= time '20:00'
  and s.end_time > s.start_time
  and not public.is_public_slot_booked(s.barber_id, s.slot_date, s.start_time, s.end_time);

grant select on public.available_barber_slots to anon, authenticated;

create or replace function public.create_availability_slots(
  p_barber_id uuid,
  p_slot_dates date[],
  p_start_time time
)
returns setof public.barber_availability_slots
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  v_date date;
  v_end_time time;
  v_today date := (timezone('America/Argentina/Buenos_Aires', clock_timestamp()))::date;
  v_slot public.barber_availability_slots%rowtype;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;

  if not public.is_admin() and public.current_staff_barber_id() is distinct from p_barber_id then
    raise exception using errcode = '42501', message = 'AVAILABILITY_NOT_ALLOWED';
  end if;

  if not exists (select 1 from public.barbers b where b.id = p_barber_id and b.active = true) then
    raise exception using errcode = '22023', message = 'BARBER_NOT_FOUND';
  end if;

  if p_slot_dates is null or cardinality(p_slot_dates) = 0 then
    raise exception using errcode = '22023', message = 'DATE_REQUIRED';
  end if;

  if p_start_time is null or extract(second from p_start_time) <> 0 then
    raise exception using errcode = '22023', message = 'START_TIME_INVALID';
  end if;

  v_end_time := (p_start_time + interval '1 hour')::time;

  foreach v_date in array p_slot_dates loop
    if v_date is null or v_date < v_today or v_date > v_today + 21 or extract(isodow from v_date) = 7 then
      raise exception using errcode = '22023', message = 'AVAILABILITY_DATE_INVALID';
    end if;

    perform pg_advisory_xact_lock(hashtextextended(p_barber_id::text || '|' || v_date::text, 0));

    if exists (
      select 1
      from public.barber_availability_slots s
      where s.barber_id = p_barber_id
        and s.slot_date = v_date
        and s.start_time = p_start_time
    ) then
      continue;
    end if;

    if exists (
      select 1
      from public.barber_availability_slots s
      where s.barber_id = p_barber_id
        and tsrange((v_date + p_start_time)::timestamp, (v_date + p_start_time + interval '1 hour')::timestamp, '[)')
          && tsrange((s.slot_date + s.start_time)::timestamp, (s.slot_date + s.start_time + interval '1 hour')::timestamp, '[)')
    ) then
      raise exception using errcode = '23P01', message = 'AVAILABILITY_OVERLAP';
    end if;

    if exists (
      select 1
      from public.appointments a
      where a.barber_id = p_barber_id
        and a.booking_date = v_date
        and a.status <> 'CANCELLED'
        and tsrange((v_date + p_start_time)::timestamp, (v_date + p_start_time + interval '1 hour')::timestamp, '[)')
          && tsrange((a.booking_date + a.start_time)::timestamp, (a.booking_date + a.end_time)::timestamp, '[)')
    ) then
      raise exception using errcode = '23P01', message = 'AVAILABILITY_APPOINTMENT_CONFLICT';
    end if;

    insert into public.barber_availability_slots (
      barber_id, slot_date, start_time, end_time, status, updated_by
    ) values (
      p_barber_id, v_date, p_start_time, v_end_time, 'AVAILABLE', auth.uid()
    ) returning * into v_slot;

    return next v_slot;
  end loop;
end;
$$;

revoke all on function public.create_availability_slots(uuid, date[], time) from public, anon, authenticated;
grant execute on function public.create_availability_slots(uuid, date[], time) to authenticated;

-- La creación pública continúa siendo únicamente la RPC request_appointment.
revoke all on table public.appointments from anon, authenticated;
grant select on table public.appointments to authenticated;

create or replace function public.request_appointment(
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
  request_number bigint,
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
  v_today date := (timezone('America/Argentina/Buenos_Aires', clock_timestamp()))::date;
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
  if p_booking_date < v_today or p_booking_date > v_today + 21 then
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
      and slot.start_time >= time '10:00'
      and slot.end_time <= time '20:00'
      and slot.end_time > slot.start_time
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
  returning inserted.id, inserted.status, inserted.booking_date, inserted.start_time, inserted.end_time, inserted.request_number
  into appointment_id, appointment_status, booking_date, start_time, end_time, request_number;

  notification_claim_token := public.create_appointment_notification_event(appointment_id, 'NEW_REQUEST');
  return next;
exception
  when no_data_found then
    raise exception using errcode = 'P0001', message = 'BARBER_OR_SERVICE_NOT_FOUND';
end;
$$;

revoke execute on function public.request_appointment(text, text, date, time, text, text, text, text) from public;
grant execute on function public.request_appointment(text, text, date, time, text, text, text, text) to anon, authenticated;
