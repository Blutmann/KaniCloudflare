-- Kani Barber Studio — conservar las duraciones oficiales exactas.
-- La disponibilidad se calcula por segmentos de cinco minutos; los intervalos
-- de reserva siguen siendo 30, 45 y 60 minutos completos.

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
set search_path = pg_catalog, public, extensions
as $$
declare
  v_barber public.barbers%rowtype;
  v_service public.services%rowtype;
  v_client_id uuid;
  v_duration interval;
  v_start_at timestamp;
  v_end_at timestamp;
  v_last_segment integer;
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
  if p_booking_date < (timezone('America/Argentina/Buenos_Aires', clock_timestamp()))::date
     or p_booking_date > (timezone('America/Argentina/Buenos_Aires', clock_timestamp()))::date + 21 then
    raise exception using errcode = '22023', message = 'BOOKING_DATE_OUT_OF_RANGE';
  end if;
  if extract(isodow from p_booking_date) = 7 then
    raise exception using errcode = '22023', message = 'SUNDAY_CLOSED';
  end if;
  if p_start_time < time '10:00'
     or p_start_time >= time '20:00'
     or extract(second from p_start_time) <> 0
     or extract(minute from p_start_time)::int % 5 <> 0 then
    raise exception using errcode = '22023', message = 'START_TIME_INVALID';
  end if;

  select b.* into strict v_barber
  from public.barbers b
  where b.name = trim(p_barber_name)
    and b.active = true;

  select s.* into strict v_service
  from public.services s
  where s.name = trim(p_service_name)
    and s.active = true;

  v_duration := case v_service.name
    when 'Corte' then interval '45 minutes'
    when 'Barba' then interval '30 minutes'
    when 'Corte + barba' then interval '60 minutes'
    else v_service.duration_minutes * interval '1 minute'
  end;
  v_start_at := (p_booking_date + p_start_time)::timestamp;
  v_end_at := v_start_at + v_duration;

  if v_end_at > (p_booking_date + time '20:00')::timestamp then
    raise exception using errcode = '22023', message = 'SERVICE_OUTSIDE_BUSINESS_HOURS';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_barber.id::text || '|' || p_booking_date::text, 0));

  v_last_segment := ceil(extract(epoch from v_duration) / 300)::integer - 1;

  if exists (
    select 1
    from generate_series(0, v_last_segment) as requested(segment_index)
    where not exists (
      select 1
      from public.barber_availability_slots slot
      where slot.barber_id = v_barber.id
        and slot.slot_date = p_booking_date
        and slot.status = 'AVAILABLE'
        and slot.start_time <= (v_start_at + requested.segment_index * interval '5 minutes')::time
        and slot.end_time >= (v_start_at + (requested.segment_index + 1) * interval '5 minutes')::time
        and not exists (
          select 1
          from public.barber_availability_slots blocked
          where blocked.barber_id = v_barber.id
            and blocked.slot_date = p_booking_date
            and blocked.status = 'UNAVAILABLE'
            and tsrange(
              v_start_at + requested.segment_index * interval '5 minutes',
              v_start_at + (requested.segment_index + 1) * interval '5 minutes',
              '[)'
            ) && tsrange(
              (blocked.slot_date + blocked.start_time)::timestamp,
              (blocked.slot_date + blocked.end_time)::timestamp,
              '[)'
            )
        )
    )
  ) then
    raise exception using errcode = 'P0001', message = 'SLOT_UNAVAILABLE';
  end if;

  if exists (
    select 1
    from public.appointments a
    where a.barber_id = v_barber.id
      and a.booking_date = p_booking_date
      and a.status <> 'CANCELLED'
      and (a.booking_date + a.start_time)::timestamp < v_end_at
      and (a.booking_date + a.end_time)::timestamp > v_start_at
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
    set name = trim(p_client_name),
        phone = trim(p_client_phone),
        email = lower(trim(p_client_email)),
        updated_at = now()
    where id = v_client_id;
  end if;

  insert into public.appointments as inserted (
    client_id,
    barber_id,
    service_id,
    booking_date,
    start_time,
    end_time,
    status,
    notes
  ) values (
    v_client_id,
    v_barber.id,
    v_service.id,
    p_booking_date,
    p_start_time,
    v_end_at::time,
    'PENDING',
    nullif(trim(coalesce(p_notes, '')), '')
  )
  returning inserted.id,
            inserted.status,
            inserted.booking_date,
            inserted.start_time,
            inserted.end_time,
            inserted.request_number
  into appointment_id,
       appointment_status,
       booking_date,
       start_time,
       end_time,
       request_number;

  notification_claim_token := public.create_appointment_notification_event(appointment_id, 'NEW_REQUEST');
  return next;
exception
  when no_data_found then
    raise exception using errcode = 'P0001', message = 'BARBER_OR_SERVICE_NOT_FOUND';
end;
$$;

revoke execute on function public.request_appointment(text, text, date, time, text, text, text, text) from public;
grant execute on function public.request_appointment(text, text, date, time, text, text, text, text) to anon, authenticated;

comment on function public.request_appointment(text, text, date, time, text, text, text, text) is
  'Solicita una reserva con duración oficial exacta y validación atómica de disponibilidad, bloqueos y turnos activos.';
