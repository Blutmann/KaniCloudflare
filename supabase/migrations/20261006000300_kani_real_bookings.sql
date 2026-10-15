-- KANI Barber Studio — Fase 3: reservas reales y control de conflictos
-- La creación pública y los cambios administrativos pasan por RPCs controladas.

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
  end_time time
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_barber public.barbers%rowtype;
  v_service public.services%rowtype;
  v_client_id uuid;
  v_end_time time;
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

  v_end_time := p_start_time + (v_service.duration_minutes * interval '1 minute');
  if v_end_time > time '20:00' then
    raise exception using errcode = '22023', message = 'SERVICE_OUTSIDE_BUSINESS_HOURS';
  end if;

  -- Serializa solicitudes del mismo barbero y fecha para que el primer insert gane.
  perform pg_advisory_xact_lock(hashtextextended(v_barber.id::text || '|' || p_booking_date::text, 0));

  if not exists (
    select 1
    from public.barber_availability_slots slot
    where slot.barber_id = v_barber.id
      and slot.slot_date = p_booking_date
      and slot.start_time <= p_start_time
      and slot.end_time >= v_end_time
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

  return query
  insert into public.appointments (client_id, barber_id, service_id, booking_date, start_time, end_time, status, notes)
  values (v_client_id, v_barber.id, v_service.id, p_booking_date, p_start_time, v_end_time, 'PENDING', nullif(trim(coalesce(p_notes, '')), ''))
  returning id, status, booking_date, start_time, end_time;
exception
  when no_data_found then
    raise exception using errcode = 'P0001', message = 'BARBER_OR_SERVICE_NOT_FOUND';
end;
$$;

create or replace function public.update_appointment_status(
  p_appointment_id uuid,
  p_status public.appointment_status
)
returns public.appointment_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status public.appointment_status;
  v_barber_id uuid;
  v_booking_date date;
begin
  if (select auth.uid()) is null then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;
  if p_status not in ('CONFIRMED', 'CANCELLED', 'COMPLETED') then
    raise exception using errcode = '22023', message = 'STATUS_NOT_ALLOWED';
  end if;

  select a.barber_id, a.booking_date into v_barber_id, v_booking_date
  from public.appointments a
  where a.id = p_appointment_id
    and (public.is_admin() or a.barber_id = public.current_staff_barber_id())
  for update;

  if v_barber_id is null then
    raise exception using errcode = '42501', message = 'APPOINTMENT_NOT_ALLOWED';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_barber_id::text || '|' || v_booking_date::text, 0));

  update public.appointments
  set status = p_status, updated_at = now()
  where id = p_appointment_id
  returning status into v_status;

  return v_status;
end;
$$;

-- No se permite insertar/modificar appointments directamente desde el cliente.
drop policy if exists admin_can_insert_appointments on public.appointments;
drop policy if exists barber_can_update_own_appointments on public.appointments;

revoke execute on function public.request_appointment(text, text, date, time, text, text, text, text) from public;
grant execute on function public.request_appointment(text, text, date, time, text, text, text, text) to anon, authenticated;
revoke execute on function public.update_appointment_status(uuid, public.appointment_status) from public;
grant execute on function public.update_appointment_status(uuid, public.appointment_status) to authenticated;

comment on function public.request_appointment(text, text, date, time, text, text, text, text) is
  'Crea una solicitud PENDING validando identidad de barbero/servicio, disponibilidad y solapamientos bajo bloqueo transaccional.';
comment on function public.update_appointment_status(uuid, public.appointment_status) is
  'Permite a BARBER actualizar sus propios estados y a ADMIN actualizar cualquier agenda, sin exponer mutaciones de campos sensibles.';
