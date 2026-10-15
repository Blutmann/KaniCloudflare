-- Kani Barber Studio — reparación de creación y persistencia de horarios.
-- Sincroniza Production con el flujo administrativo actual.
-- No modifica reservas, clientes, servicios ni políticas RLS.

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

  if p_start_time is null
     or extract(second from p_start_time) <> 0
     or p_start_time < time '00:00'
     or p_start_time > time '23:55'
     or extract(minute from p_start_time)::int % 5 <> 0 then
    raise exception using errcode = '22023', message = 'START_TIME_INVALID';
  end if;

  v_end_time := (p_start_time + interval '1 hour')::time;

  foreach v_date in array p_slot_dates loop
    if v_date is null or v_date < v_today or extract(isodow from v_date) = 7 then
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
