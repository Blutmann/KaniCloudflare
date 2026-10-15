-- Kani Barber Studio — disponibilidad intermedia y reservas por duración real.
-- Convierte los registros de disponibilidad en ventanas administrables, sin
-- eliminar datos existentes ni exponer información interna.

-- Las duraciones oficiales se mantienen centralizadas en services.
update public.services
set duration_minutes = case name
  when 'Corte' then 45
  when 'Barba' then 30
  when 'Corte + barba' then 60
  else duration_minutes
end,
updated_at = now()
where name in ('Corte', 'Barba', 'Corte + barba');

alter table public.barber_availability_slots
  drop constraint if exists availability_one_hour_interval,
  drop constraint if exists availability_hourly_slot,
  drop constraint if exists availability_interval_valid,
  drop constraint if exists availability_inside_business_hours;

alter table public.barber_availability_slots
  add constraint availability_interval_valid
    check (end_time > start_time),
  add constraint availability_inside_business_hours
    check (start_time >= time '10:00' and end_time <= time '20:00'),
  add constraint availability_start_granularity
    check (extract(second from start_time) = 0 and extract(minute from start_time)::int % 5 = 0),
  add constraint availability_end_granularity
    check (extract(second from end_time) = 0 and extract(minute from end_time)::int % 5 = 0),
  add constraint availability_minimum_interval
    check (end_time - start_time >= interval '5 minutes');

create index if not exists barber_availability_slots_public_lookup_idx
  on public.barber_availability_slots (barber_id, slot_date, status, start_time, end_time);

-- La vista pública devuelve únicamente segmentos libres de cinco minutos.
-- Los bloqueos administrativos tienen prioridad sobre ventanas disponibles y
-- las reservas PENDING/CONFIRMED/COMPLETED ocupan únicamente su intervalo real.
-- internal_note nunca forma parte de esta vista.
create or replace view public.available_barber_slots
with (security_invoker = false)
as
select distinct on (s.barber_id, s.slot_date, segment.segment_start)
  s.id,
  s.barber_id,
  s.slot_date,
  segment.segment_start::time as start_time,
  (segment.segment_start + interval '5 minutes')::time as end_time,
  'AVAILABLE'::public.availability_status as status
from public.barber_availability_slots s
join public.barbers b on b.id = s.barber_id
cross join lateral generate_series(
  (s.slot_date + s.start_time)::timestamp,
  (s.slot_date + s.end_time)::timestamp - interval '5 minutes',
  interval '5 minutes'
) as segment(segment_start)
where b.active = true
  and s.status = 'AVAILABLE'
  and s.start_time >= time '10:00'
  and s.end_time <= time '20:00'
  and s.end_time > s.start_time
  and not exists (
    select 1
    from public.barber_availability_slots blocked
    where blocked.barber_id = s.barber_id
      and blocked.slot_date = s.slot_date
      and blocked.status = 'UNAVAILABLE'
      and tsrange(
        segment.segment_start,
        segment.segment_start + interval '5 minutes',
        '[)'
      ) && tsrange(
        (blocked.slot_date + blocked.start_time)::timestamp,
        (blocked.slot_date + blocked.end_time)::timestamp,
        '[)'
      )
  )
  and not exists (
    select 1
    from public.appointments a
    where a.barber_id = s.barber_id
      and a.booking_date = s.slot_date
      and a.status <> 'CANCELLED'
      and tsrange(
        segment.segment_start,
        segment.segment_start + interval '5 minutes',
        '[)'
      ) && tsrange(
        (a.booking_date + a.start_time)::timestamp,
        (a.booking_date + a.end_time)::timestamp,
        '[)'
      )
  )
order by s.barber_id, s.slot_date, segment.segment_start, s.id;

grant select on public.available_barber_slots to anon, authenticated;

-- La mutación administrativa acepta una ventana completa. Las ventanas
-- AVAILABLE que tocan o se superponen se extienden sobre un registro existente
-- para evitar duplicados; una solicitud ya cubierta se vuelve idempotente.
drop function if exists public.create_availability_slots(uuid, date[], time);
drop function if exists public.create_availability_slots(uuid, date[], time, time);

create or replace function public.create_availability_slots(
  p_barber_id uuid,
  p_slot_dates date[],
  p_start_time time,
  p_end_time time
)
returns setof public.barber_availability_slots
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  v_date date;
  v_today date := (timezone('America/Argentina/Buenos_Aires', clock_timestamp()))::date;
  v_existing_start time;
  v_existing_end time;
  v_survivor_id uuid;
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
  if p_start_time is null
     or extract(second from p_start_time) <> 0
     or extract(minute from p_start_time)::int % 5 <> 0
     or p_start_time < time '10:00'
     or p_start_time >= time '20:00' then
    raise exception using errcode = '22023', message = 'START_TIME_INVALID';
  end if;
  if p_end_time is null
     or extract(second from p_end_time) <> 0
     or extract(minute from p_end_time)::int % 5 <> 0
     or p_end_time <= p_start_time
     or p_end_time > time '20:00' then
    raise exception using errcode = '22023', message = 'END_TIME_INVALID';
  end if;
  if p_end_time - p_start_time < interval '5 minutes' then
    raise exception using errcode = '22023', message = 'AVAILABILITY_INTERVAL_INVALID';
  end if;

  foreach v_date in array p_slot_dates loop
    if v_date is null or v_date < v_today or extract(isodow from v_date) = 7 then
      raise exception using errcode = '22023', message = 'AVAILABILITY_DATE_INVALID';
    end if;

    perform pg_advisory_xact_lock(hashtextextended(p_barber_id::text || '|' || v_date::text, 0));

    -- Una ventana disponible existente ya cubre la solicitud: no se duplica.
    if exists (
      select 1
      from public.barber_availability_slots s
      where s.barber_id = p_barber_id
        and s.slot_date = v_date
        and s.status = 'AVAILABLE'
        and s.start_time <= p_start_time
        and s.end_time >= p_end_time
    ) then
      continue;
    end if;

    -- Los bloqueos no se pisan ni se vuelven disponibles por accidente.
    if exists (
      select 1
      from public.barber_availability_slots s
      where s.barber_id = p_barber_id
        and s.slot_date = v_date
        and s.status = 'UNAVAILABLE'
        and s.start_time < p_end_time
        and s.end_time > p_start_time
    ) then
      raise exception using errcode = '23P01', message = 'AVAILABILITY_OVERLAP';
    end if;

    -- Nunca se permite crear disponibilidad sobre una reserva activa.
    if exists (
      select 1
      from public.appointments a
      where a.barber_id = p_barber_id
        and a.booking_date = v_date
        and a.status <> 'CANCELLED'
        and a.start_time < p_end_time
        and a.end_time > p_start_time
    ) then
      raise exception using errcode = '23P01', message = 'AVAILABILITY_APPOINTMENT_CONFLICT';
    end if;

    select min(s.start_time), max(s.end_time)
      into v_existing_start, v_existing_end
    from public.barber_availability_slots s
    where s.barber_id = p_barber_id
      and s.slot_date = v_date
      and s.status = 'AVAILABLE'
      and s.start_time <= p_end_time
      and s.end_time >= p_start_time;

    select s.id
      into v_survivor_id
    from public.barber_availability_slots s
    where s.barber_id = p_barber_id
      and s.slot_date = v_date
      and s.status = 'AVAILABLE'
      and s.start_time <= p_end_time
      and s.end_time >= p_start_time
    order by s.start_time, s.id
    limit 1;

    if v_survivor_id is not null then
      update public.barber_availability_slots
      set start_time = least(v_existing_start, p_start_time),
          end_time = greatest(v_existing_end, p_end_time),
          updated_by = auth.uid(),
          updated_at = now()
      where id = v_survivor_id
      returning * into v_slot;
      return next v_slot;
    else
      insert into public.barber_availability_slots (
        barber_id, slot_date, start_time, end_time, status, updated_by
      ) values (
        p_barber_id, v_date, p_start_time, p_end_time, 'AVAILABLE', auth.uid()
      ) returning * into v_slot;
      return next v_slot;
    end if;
  end loop;
end;
$$;

revoke all on function public.create_availability_slots(uuid, date[], time, time) from public, anon, authenticated;
grant execute on function public.create_availability_slots(uuid, date[], time, time) to authenticated;

-- El cambio de estado también queda protegido contra reservas activas.
create or replace function public.update_availability_slot(
  p_slot_id uuid,
  p_status public.availability_status,
  p_internal_note text
)
returns setof public.barber_availability_slots
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  v_barber_id uuid;
  v_slot_date date;
  v_slot public.barber_availability_slots%rowtype;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;
  if p_internal_note is not null and length(p_internal_note) > 500 then
    raise exception using errcode = '22023', message = 'INTERNAL_NOTE_TOO_LONG';
  end if;
  select s.barber_id, s.slot_date into v_barber_id, v_slot_date
  from public.barber_availability_slots s
  where s.id = p_slot_id
    and (public.is_admin() or s.barber_id = public.current_staff_barber_id());
  if not found then
    raise exception using errcode = '42501', message = 'AVAILABILITY_NOT_ALLOWED';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_barber_id::text || '|' || v_slot_date::text, 0));
  select s.* into v_slot
  from public.barber_availability_slots s
  where s.id = p_slot_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'AVAILABILITY_NOT_FOUND';
  end if;
  if exists (
    select 1
    from public.appointments a
    where a.barber_id = v_slot.barber_id
      and a.booking_date = v_slot.slot_date
      and a.status <> 'CANCELLED'
      and a.start_time < v_slot.end_time
      and a.end_time > v_slot.start_time
  ) then
    raise exception using errcode = '23P01', message = 'AVAILABILITY_APPOINTMENT_CONFLICT';
  end if;
  update public.barber_availability_slots
  set status = p_status,
      internal_note = nullif(trim(p_internal_note), ''),
      updated_by = auth.uid(),
      updated_at = now()
  where id = p_slot_id
  returning * into v_slot;
  return next v_slot;
end;
$$;

revoke all on function public.update_availability_slot(uuid, public.availability_status, text) from public, anon, authenticated;
grant execute on function public.update_availability_slot(uuid, public.availability_status, text) to authenticated;

-- Reserva pública: valida cada segmento de cinco minutos de forma atómica,
-- con advisory lock por barbero y fecha para evitar carreras.
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
  v_end_time time;
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
  if p_start_time < time '10:00'
     or p_start_time >= time '20:00'
     or extract(second from p_start_time) <> 0
     or extract(minute from p_start_time)::int % 5 <> 0 then
    raise exception using errcode = '22023', message = 'START_TIME_INVALID';
  end if;

  select b.* into strict v_barber
  from public.barbers b
  where b.name = trim(p_barber_name) and b.active = true;
  select s.* into strict v_service
  from public.services s
  where s.name = trim(p_service_name) and s.active = true;

  v_end_time := p_start_time + (v_service.duration_minutes * interval '1 minute');
  if v_end_time > time '20:00' then
    raise exception using errcode = '22023', message = 'SERVICE_OUTSIDE_BUSINESS_HOURS';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_barber.id::text || '|' || p_booking_date::text, 0));

  if exists (
    select 1
    from generate_series(
      (p_booking_date + p_start_time)::timestamp,
      (p_booking_date + v_end_time)::timestamp - interval '5 minutes',
      interval '5 minutes'
    ) as requested(segment_start)
    where not exists (
      select 1
      from public.barber_availability_slots slot
      where slot.barber_id = v_barber.id
        and slot.slot_date = p_booking_date
        and slot.status = 'AVAILABLE'
        and slot.start_time <= requested.segment_start::time
        and slot.end_time >= (requested.segment_start + interval '5 minutes')::time
        and not exists (
          select 1
          from public.barber_availability_slots blocked
          where blocked.barber_id = v_barber.id
            and blocked.slot_date = p_booking_date
            and blocked.status = 'UNAVAILABLE'
            and tsrange(
              requested.segment_start,
              requested.segment_start + interval '5 minutes',
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
      and a.start_time < v_end_time
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

  insert into public.appointments as inserted (
    client_id, barber_id, service_id, booking_date, start_time, end_time, status, notes
  ) values (
    v_client_id, v_barber.id, v_service.id, p_booking_date, p_start_time, v_end_time,
    'PENDING', nullif(trim(coalesce(p_notes, '')), '')
  )
  returning inserted.id, inserted.status, inserted.booking_date, inserted.start_time,
            inserted.end_time, inserted.request_number
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

comment on function public.create_availability_slots(uuid, date[], time, time) is
  'Crea o extiende ventanas de disponibilidad de cinco minutos, con autorización por agenda y protección contra reservas activas.';
comment on function public.request_appointment(text, text, date, time, text, text, text, text) is
  'Solicita una reserva usando la duración configurada y valida cada segmento de cinco minutos bajo lock por agenda y fecha.';
