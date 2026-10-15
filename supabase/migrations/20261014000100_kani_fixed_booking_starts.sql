-- Kani Barber Studio — duración comercial y secuencia fija de inicios.
-- Las ventanas administrativas continúan representando cobertura laboral; la
-- disponibilidad pública solo ofrece los inicios comerciales de 45 minutos.

update public.services
set duration_minutes = 45,
    updated_at = now()
where name in ('Corte', 'Corte + barba')
  and active = true;

create or replace function public.create_availability_slots(
  p_barber_id uuid,
  p_slot_dates date[],
  p_start_time time,
  p_end_time time default null
)
returns setof public.barber_availability_slots
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  v_date date;
  v_today date := (timezone('America/Argentina/Buenos_Aires', clock_timestamp()))::date;
  v_next_block_start time;
  v_end_time time;
  v_existing public.barber_availability_slots%rowtype;
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
     or p_start_time < time '10:00'
     or p_start_time > time '19:00'
     or mod(extract(epoch from (p_start_time - time '10:00'))::integer, 2700) <> 0 then
    raise exception using errcode = '22023', message = 'START_TIME_NOT_ALLOWED';
  end if;

  if p_end_time is not null
     and (extract(second from p_end_time) <> 0
       or extract(minute from p_end_time)::int % 5 <> 0
       or p_end_time <= p_start_time
       or p_end_time > time '20:00') then
    raise exception using errcode = '22023', message = 'END_TIME_INVALID';
  end if;

  foreach v_date in array p_slot_dates loop
    if v_date is null or v_date < v_today or extract(isodow from v_date) = 7 then
      raise exception using errcode = '22023', message = 'AVAILABILITY_DATE_INVALID';
    end if;

    perform pg_advisory_xact_lock(hashtextextended(p_barber_id::text || '|' || v_date::text, 0));

    -- Una ventana disponible existente que cubre el inicio hace la operación idempotente.
    select s.* into v_existing
    from public.barber_availability_slots s
    where s.barber_id = p_barber_id
      and s.slot_date = v_date
      and s.status = 'AVAILABLE'
      and s.start_time <= p_start_time
      and s.end_time > p_start_time
    order by s.start_time, s.id
    limit 1;

    if found then
      return next v_existing;
      continue;
    end if;

    if exists (
      select 1 from public.appointments a
      where a.barber_id = p_barber_id
        and a.booking_date = v_date
        and a.status <> 'CANCELLED'
        and a.start_time <= p_start_time
        and a.end_time > p_start_time
    ) then
      raise exception using errcode = '23P01', message = 'AVAILABILITY_APPOINTMENT_CONFLICT';
    end if;

    if exists (
      select 1 from public.barber_availability_slots s
      where s.barber_id = p_barber_id
        and s.slot_date = v_date
        and s.status = 'UNAVAILABLE'
        and s.start_time <= p_start_time
        and s.end_time > p_start_time
    ) then
      raise exception using errcode = '23P01', message = 'AVAILABILITY_BLOCKED_START';
    end if;

    select min(candidate_start) into v_next_block_start
    from (
      select min(a.start_time) as candidate_start
      from public.appointments a
      where a.barber_id = p_barber_id
        and a.booking_date = v_date
        and a.status <> 'CANCELLED'
        and a.start_time > p_start_time
      union all
      select min(s.start_time) as candidate_start
      from public.barber_availability_slots s
      where s.barber_id = p_barber_id
        and s.slot_date = v_date
        and s.status = 'UNAVAILABLE'
        and s.start_time > p_start_time
    ) candidates;

    v_end_time := least(
      coalesce(p_end_time, (p_start_time + interval '1 hour')::time),
      coalesce(v_next_block_start, time '20:00')
    );

    if v_end_time <= p_start_time then
      raise exception using errcode = '22023', message = 'AVAILABILITY_INTERVAL_INVALID';
    end if;

    select s.* into v_existing
    from public.barber_availability_slots s
    where s.barber_id = p_barber_id
      and s.slot_date = v_date
      and s.status = 'AVAILABLE'
      and s.start_time < v_end_time
      and s.end_time > p_start_time
    order by s.start_time, s.id
    limit 1;

    if found then
      update public.barber_availability_slots
      set start_time = least(v_existing.start_time, p_start_time),
          end_time = greatest(v_existing.end_time, v_end_time),
          updated_by = auth.uid(),
          updated_at = now()
      where id = v_existing.id
      returning * into v_slot;
      return next v_slot;
      continue;
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

revoke all on function public.create_availability_slots(uuid, date[], time, time) from public, anon, authenticated;
grant execute on function public.create_availability_slots(uuid, date[], time, time) to authenticated;

create or replace function public.read_valid_availability_starts(
  p_barber_id uuid default null,
  p_from_date date default null,
  p_to_date date default null
)
returns table (
  barber_id uuid,
  slot_date date,
  start_time time,
  is_exception boolean,
  compatible_services text[]
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  v_from date := coalesce(p_from_date, (timezone('America/Argentina/Buenos_Aires', clock_timestamp()))::date);
  v_to date := coalesce(p_to_date, v_from + 21);
  v_staff_barber_id uuid := public.current_staff_barber_id();
begin
  if auth.uid() is not null and not public.is_admin() and v_staff_barber_id is null then
    raise exception using errcode = '42501', message = 'AVAILABILITY_NOT_ALLOWED';
  end if;
  if auth.uid() is not null and not public.is_admin() and (p_barber_id is null or p_barber_id is distinct from v_staff_barber_id) then
    raise exception using errcode = '42501', message = 'AVAILABILITY_NOT_ALLOWED';
  end if;
  if v_from > v_to then
    raise exception using errcode = '22023', message = 'DATE_RANGE_INVALID';
  end if;

  return query
  with active_days as (
    select distinct s.barber_id, s.slot_date
    from public.barber_availability_slots s
    join public.barbers b on b.id = s.barber_id and b.active = true
    where s.status = 'AVAILABLE'
      and s.slot_date between v_from and v_to
      and (p_barber_id is null or s.barber_id = p_barber_id)
      and s.start_time >= time '10:00'
      and s.end_time <= time '20:00'
      and s.end_time > s.start_time
  ), candidates as (
    select ad.barber_id,
           ad.slot_date,
           gs.candidate_start
    from active_days ad
    cross join lateral generate_series(
      ad.slot_date + time '10:00',
      ad.slot_date + time '19:00',
      interval '45 minutes'
    ) as gs(candidate_start)
  )
  select c.barber_id,
         c.slot_date,
         c.candidate_start::time,
         false,
         compatibility.compatible_services
  from candidates c
  cross join lateral (
    select coalesce(array_agg(svc.name order by svc.name), '{}'::text[]) as compatible_services
    from public.services svc
    where svc.active
      and svc.duration_minutes > 0
      and not exists (
        select 1
        from generate_series(
          0,
          ceil(svc.duration_minutes::numeric / 5)::integer - 1
        ) as requested(segment_index)
        where not exists (
          select 1
          from public.barber_availability_slots available
          where available.barber_id = c.barber_id
            and available.slot_date = c.slot_date
            and available.status = 'AVAILABLE'
            and available.start_time <= (c.candidate_start + requested.segment_index * interval '5 minutes')::time
            and available.end_time >= (c.candidate_start + (requested.segment_index + 1) * interval '5 minutes')::time
            and not exists (
              select 1
              from public.barber_availability_slots blocked
              where blocked.barber_id = c.barber_id
                and blocked.slot_date = c.slot_date
                and blocked.status = 'UNAVAILABLE'
                and tsrange(
                  c.candidate_start + requested.segment_index * interval '5 minutes',
                  c.candidate_start + (requested.segment_index + 1) * interval '5 minutes', '[)'
                ) && tsrange(
                  blocked.slot_date + blocked.start_time,
                  blocked.slot_date + blocked.end_time, '[)'
                )
            )
            and not exists (
              select 1
              from public.appointments a
              where a.barber_id = c.barber_id
                and a.booking_date = c.slot_date
                and a.status <> 'CANCELLED'
                and tsrange(
                  c.candidate_start + requested.segment_index * interval '5 minutes',
                  c.candidate_start + (requested.segment_index + 1) * interval '5 minutes', '[)'
                ) && tsrange(
                  a.booking_date + a.start_time,
                  a.booking_date + a.end_time, '[)'
                )
            )
        )
      )
  ) compatibility
  where cardinality(compatibility.compatible_services) > 0
  order by c.barber_id, c.slot_date, c.candidate_start;
end;
$$;

revoke all on function public.read_valid_availability_starts(uuid, date, date) from public;
grant execute on function public.read_valid_availability_starts(uuid, date, date) to anon, authenticated;

comment on function public.read_valid_availability_starts(uuid, date, date) is
  'Fuente única de inicios comerciales fijos cada 45 minutos, con compatibilidad por duración exacta, reservas y bloqueos.';

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
     or p_start_time > time '19:00'
     or extract(second from p_start_time) <> 0
     or mod(extract(epoch from (p_start_time - time '10:00'))::integer, 2700) <> 0 then
    raise exception using errcode = '22023', message = 'START_TIME_NOT_ALLOWED';
  end if;

  select b.* into strict v_barber
  from public.barbers b
  where b.name = trim(p_barber_name)
    and b.active = true;

  select s.* into strict v_service
  from public.services s
  where s.name = trim(p_service_name)
    and s.active = true;

  v_duration := v_service.duration_minutes * interval '1 minute';
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
  'Solicita una reserva con duración exacta desde services y solo en inicios comerciales fijos de 45 minutos.';
