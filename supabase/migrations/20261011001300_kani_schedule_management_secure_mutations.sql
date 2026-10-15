-- Kani Barber Studio — gestión segura de horarios en Preview
-- Las mutaciones de disponibilidad se concentran en RPCs validadas.

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

  v_end_time := p_start_time + interval '1 hour';
  if p_start_time < time '10:00' or p_start_time >= time '20:00' or v_end_time > time '20:00' then
    raise exception using errcode = '22023', message = 'AVAILABILITY_OUTSIDE_BUSINESS_HOURS';
  end if;

  foreach v_date in array p_slot_dates loop
    if v_date is null or v_date < v_today or v_date > v_today + 21 or extract(isodow from v_date) = 7 then
      raise exception using errcode = '22023', message = 'AVAILABILITY_DATE_INVALID';
    end if;

    perform pg_advisory_xact_lock(hashtextextended(p_barber_id::text || '|' || v_date::text, 0));

    -- Repetir la misma solicitud es idempotente; no crea un duplicado.
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
        and s.slot_date = v_date
        and s.start_time < v_end_time
        and s.end_time > p_start_time
    ) then
      raise exception using errcode = '23P01', message = 'AVAILABILITY_OVERLAP';
    end if;

    if exists (
      select 1
      from public.appointments a
      where a.barber_id = p_barber_id
        and a.booking_date = v_date
        and a.status <> 'CANCELLED'
        and a.start_time < v_end_time
        and a.end_time > p_start_time
    ) then
      raise exception using errcode = '23P01', message = 'AVAILABILITY_APPOINTMENT_CONFLICT';
    end if;

    insert into public.barber_availability_slots (
      barber_id,
      slot_date,
      start_time,
      end_time,
      status,
      updated_by
    )
    values (
      p_barber_id,
      v_date,
      p_start_time,
      v_end_time,
      'AVAILABLE',
      auth.uid()
    )
    returning * into v_slot;

    return next v_slot;
  end loop;
end;
$$;

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
  v_slot public.barber_availability_slots%rowtype;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;

  if p_internal_note is not null and length(p_internal_note) > 500 then
    raise exception using errcode = '22023', message = 'INTERNAL_NOTE_TOO_LONG';
  end if;

  select s.* into v_slot
  from public.barber_availability_slots s
  where s.id = p_slot_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'AVAILABILITY_NOT_FOUND';
  end if;

  if not public.is_admin() and public.current_staff_barber_id() is distinct from v_slot.barber_id then
    raise exception using errcode = '42501', message = 'AVAILABILITY_NOT_ALLOWED';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_slot.barber_id::text || '|' || v_slot.slot_date::text, 0));

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

revoke all on function public.create_availability_slots(uuid, date[], time) from public, anon, authenticated;
revoke all on function public.update_availability_slot(uuid, public.availability_status, text) from public, anon, authenticated;
grant execute on function public.create_availability_slots(uuid, date[], time) to authenticated;
grant execute on function public.update_availability_slot(uuid, public.availability_status, text) to authenticated;

-- El cliente conserva SELECT, pero no puede mutar columnas arbitrarias ni borrar slots.
revoke insert, update, delete on table public.barber_availability_slots from anon, authenticated;
drop policy if exists staff_can_manage_own_availability on public.barber_availability_slots;
drop policy if exists staff_can_update_own_availability on public.barber_availability_slots;
drop policy if exists staff_can_delete_own_availability on public.barber_availability_slots;

comment on function public.create_availability_slots(uuid, date[], time) is
  'Crea slots de una hora para una agenda autorizada, con minutos arbitrarios, sin duplicados ni solapamientos.';
comment on function public.update_availability_slot(uuid, public.availability_status, text) is
  'Actualiza únicamente estado y nota interna de un slot perteneciente a la agenda autorizada.';
