-- Migration: Allow extended availability slots from 00:00 to 23:59
-- Updates barber_availability_slots constraints and functions create_availability_slots and read_valid_availability_starts

-- 1. Table constraints on barber_availability_slots
alter table public.barber_availability_slots
  drop constraint if exists availability_inside_business_hours,
  drop constraint if exists availability_inside_extended_hours,
  drop constraint if exists availability_end_granularity;

alter table public.barber_availability_slots
  add constraint availability_inside_extended_hours
    check (start_time >= time '00:00:00' and end_time <= time '23:59:59'),
  add constraint availability_end_granularity
    check (extract(second from end_time) = 0 and (extract(minute from end_time)::int % 5 = 0 or end_time = time '23:59:00'));

-- 2. create_availability_slots function with full 00:00 - 23:59 range support
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
     or p_start_time < time '00:00'
     or p_start_time > time '23:59'
     or (extract(minute from p_start_time)::int % 5 <> 0 and p_start_time <> time '00:00') then
    raise exception using errcode = '22023', message = 'START_TIME_NOT_ALLOWED';
  end if;

  if p_end_time is not null
     and (extract(second from p_end_time) <> 0
       or (extract(minute from p_end_time)::int % 5 <> 0 and p_end_time <> time '23:59')
       or p_end_time <= p_start_time
       or p_end_time > time '23:59') then
    raise exception using errcode = '22023', message = 'END_TIME_INVALID';
  end if;

  foreach v_date in array p_slot_dates loop
    if v_date is null or v_date < v_today or extract(isodow from v_date) = 7 then
      raise exception using errcode = '22023', message = 'AVAILABILITY_DATE_INVALID';
    end if;

    perform pg_advisory_xact_lock(hashtextextended(p_barber_id::text || '|' || v_date::text, 0));

    -- Check if an existing available slot already covers the interval
    select s.* into v_existing
    from public.barber_availability_slots s
    where s.barber_id = p_barber_id
      and s.slot_date = v_date
      and s.status = 'AVAILABLE'
      and s.start_time <= p_start_time
      and (p_end_time is null and s.end_time > p_start_time or p_end_time is not null and s.end_time >= p_end_time)
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
      coalesce(
        p_end_time,
        case
          when p_start_time >= time '23:00' then time '23:59'
          else (p_start_time + interval '1 hour')::time
        end
      ),
      coalesce(v_next_block_start, coalesce(p_end_time, time '23:59'))
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

comment on function public.create_availability_slots(uuid, date[], time, time) is
  'Guarda disponibilidad horaria para un barbero y fechas seleccionadas con soporte extendido de 00:00 a 23:59.';

-- 3. read_valid_availability_starts with extended hours support
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
  with available_slots as (
    select s.barber_id, s.slot_date, s.start_time, s.end_time
    from public.barber_availability_slots s
    join public.barbers b on b.id = s.barber_id and b.active = true
    where s.status = 'AVAILABLE'
      and s.slot_date between v_from and v_to
      and (p_barber_id is null or s.barber_id = p_barber_id)
      and s.end_time > s.start_time
  ), standard_candidates as (
    select distinct s.barber_id, s.slot_date, gs.candidate_start, false as is_exception
    from available_slots s
    cross join lateral generate_series(
      s.slot_date + time '10:00',
      s.slot_date + time '19:00',
      interval '45 minutes'
    ) as gs(candidate_start)
    where gs.candidate_start >= s.slot_date + s.start_time
      and gs.candidate_start < s.slot_date + s.end_time
  ), extended_candidates as (
    select distinct s.barber_id, s.slot_date, (s.slot_date + s.start_time)::timestamp as candidate_start, true as is_exception
    from available_slots s
  ), all_candidates as (
    select * from standard_candidates
    union
    select * from extended_candidates
  )
  select c.barber_id,
         c.slot_date,
         c.candidate_start::time,
         c.is_exception,
         compatibility.compatible_services
  from all_candidates c
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
