-- Corrección de ambigüedad en la fuente unificada de inicios.

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
  with available_rows as (
    select s.barber_id, s.slot_date, s.start_time, s.end_time,
           extract(minute from s.start_time)::int % 15 <> 0 as row_is_exception
    from public.barber_availability_slots s
    join public.barbers b on b.id = s.barber_id and b.active = true
    where s.status = 'AVAILABLE'
      and s.slot_date between v_from and v_to
      and (p_barber_id is null or s.barber_id = p_barber_id)
      and s.start_time >= time '10:00'
      and s.end_time <= time '20:00'
      and s.end_time > s.start_time
  ), candidates as (
    select ar.barber_id, ar.slot_date, gs.candidate_start,
           bool_or(ar.row_is_exception) as is_exception
    from available_rows ar
    cross join lateral generate_series(
      ar.slot_date + time '10:00',
      ar.slot_date + time '19:45',
      interval '15 minutes'
    ) as gs(candidate_start)
    where not ar.row_is_exception
      and gs.candidate_start >= ar.slot_date + ar.start_time
      and gs.candidate_start < ar.slot_date + ar.end_time
    group by ar.barber_id, ar.slot_date, gs.candidate_start
    union
    select ar.barber_id, ar.slot_date,
           (ar.slot_date + ar.start_time)::timestamp,
           true
    from available_rows ar
    where ar.row_is_exception
  ), deduped_candidates as (
    select c.barber_id, c.slot_date, c.candidate_start, bool_or(c.is_exception) as is_exception
    from candidates c
    group by c.barber_id, c.slot_date, c.candidate_start
  )
  select dc.barber_id,
         dc.slot_date,
         dc.candidate_start::time,
         dc.is_exception,
         compatibility.compatible_services
  from deduped_candidates dc
  cross join lateral (
    select coalesce(array_agg(svc.name order by svc.name), '{}'::text[]) as compatible_services
    from public.services svc
    where svc.active
      and not exists (
        select 1
        from generate_series(
          0,
          ceil(extract(epoch from (
            case svc.name
              when 'Corte' then interval '44 minutes 59 seconds'
              when 'Barba' then interval '29 minutes 59 seconds'
              when 'Corte + barba' then interval '59 minutes 59 seconds'
              else svc.duration_minutes * interval '1 minute'
            end
          )) / 300)::integer - 1
        ) as requested(segment_index)
        where not exists (
          select 1
          from public.barber_availability_slots available
          where available.barber_id = dc.barber_id
            and available.slot_date = dc.slot_date
            and available.status = 'AVAILABLE'
            and available.start_time <= (dc.candidate_start + requested.segment_index * interval '5 minutes')::time
            and available.end_time >= (dc.candidate_start + (requested.segment_index + 1) * interval '5 minutes')::time
            and not exists (
              select 1
              from public.barber_availability_slots blocked
              where blocked.barber_id = dc.barber_id
                and blocked.slot_date = dc.slot_date
                and blocked.status = 'UNAVAILABLE'
                and tsrange(
                  dc.candidate_start + requested.segment_index * interval '5 minutes',
                  dc.candidate_start + (requested.segment_index + 1) * interval '5 minutes', '[)'
                ) && tsrange(
                  blocked.slot_date + blocked.start_time,
                  blocked.slot_date + blocked.end_time, '[)'
                )
            )
            and not exists (
              select 1
              from public.appointments a
              where a.barber_id = dc.barber_id
                and a.booking_date = dc.slot_date
                and a.status <> 'CANCELLED'
                and tsrange(
                  dc.candidate_start + requested.segment_index * interval '5 minutes',
                  dc.candidate_start + (requested.segment_index + 1) * interval '5 minutes', '[)'
                ) && tsrange(
                  a.booking_date + a.start_time,
                  a.booking_date + a.end_time, '[)'
                )
            )
        )
      )
  ) compatibility
  where cardinality(compatibility.compatible_services) > 0
  order by dc.barber_id, dc.slot_date, dc.candidate_start;
end;
$$;

revoke all on function public.read_valid_availability_starts(uuid, date, date) from public;
grant execute on function public.read_valid_availability_starts(uuid, date, date) to anon, authenticated;

comment on function public.read_valid_availability_starts(uuid, date, date) is
  'Fuente única de inicios estándar de 15 minutos y excepciones manuales con compatibilidad por servicio, reservas y bloqueos.';
