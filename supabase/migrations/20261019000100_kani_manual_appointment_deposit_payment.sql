-- Migration: 20261019000100_kani_manual_appointment_deposit_payment.sql
-- KANI Barber Studio — Registro efectivo de seña de $5.000 (deposit_paid = true) cuando "Abona seña" es Sí en turnos manuales

create or replace function public.create_manual_appointment(
  p_barber_id uuid,
  p_service_id uuid,
  p_booking_date date,
  p_start_time time,
  p_client_name text,
  p_client_phone text,
  p_client_email text,
  p_notes text default null,
  p_is_recurring boolean default false,
  p_duration_minutes integer default null,
  p_deposit_required boolean default false
)
returns table (
  appointment_id uuid,
  appointment_status public.appointment_status,
  booking_date date,
  start_time time,
  end_time time,
  request_number bigint,
  is_manual boolean,
  origin text,
  created_by_display_name text,
  recurring_rule_id uuid,
  deposit_required boolean,
  deposit_paid boolean
)
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  v_staff_barber_id uuid;
  v_is_admin boolean;
  v_creator_user_id uuid := auth.uid();
  v_creator_name text;
  v_barber public.barbers%rowtype;
  v_service public.services%rowtype;
  v_duration_min integer;
  v_duration interval;
  v_end_time time;
  v_start_ts timestamp;
  v_end_ts timestamp;
  v_client_id uuid;
  v_apt_id uuid;
  v_rule_id uuid := null;
  v_req_num bigint;
  v_day_of_week integer;
  v_deposit_flag boolean := coalesce(p_deposit_required, false);
begin
  if v_creator_user_id is null then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;

  v_is_admin := public.is_admin();
  v_staff_barber_id := public.current_staff_barber_id();

  -- Validar permisos de barbero: si no es admin, solo puede agendar para su propio id
  if not v_is_admin and (v_staff_barber_id is null or v_staff_barber_id is distinct from p_barber_id) then
    raise exception using errcode = '42501', message = 'MANUAL_APPOINTMENT_NOT_ALLOWED';
  end if;

  -- Determinar nombre para auditoría "Turno generado por"
  if v_is_admin then
    v_creator_name := 'Admin';
  else
    select b.name into v_creator_name
    from public.barbers b
    where b.id = v_staff_barber_id;
    if v_creator_name is null then
      v_creator_name := 'Barbero';
    end if;
  end if;

  -- Validaciones de entrada
  if p_barber_id is null then
    raise exception using errcode = '22023', message = 'BARBER_REQUIRED';
  end if;
  if p_service_id is null then
    raise exception using errcode = '22023', message = 'SERVICE_REQUIRED';
  end if;
  if p_booking_date is null then
    raise exception using errcode = '22023', message = 'DATE_REQUIRED';
  end if;
  if p_start_time is null then
    raise exception using errcode = '22023', message = 'START_TIME_REQUIRED';
  end if;
  if p_client_name is null or length(trim(p_client_name)) < 3 then
    raise exception using errcode = '22023', message = 'CLIENT_NAME_INVALID';
  end if;
  if p_client_phone is null or length(trim(p_client_phone)) < 6 then
    raise exception using errcode = '22023', message = 'CLIENT_PHONE_INVALID';
  end if;
  if p_client_email is null or trim(p_client_email) = '' or position('@' in trim(p_client_email)) <= 1 then
    raise exception using errcode = '22023', message = 'CLIENT_EMAIL_REQUIRED';
  end if;

  -- Obtener barbero activo
  select * into v_barber
  from public.barbers b
  where b.id = p_barber_id and b.active = true;
  if not found then
    raise exception using errcode = '22023', message = 'BARBER_NOT_FOUND';
  end if;

  -- Obtener servicio activo y verificar precio oficial
  select * into v_service
  from public.services s
  where s.id = p_service_id and s.active = true;
  if not found then
    raise exception using errcode = '22023', message = 'SERVICE_NOT_FOUND';
  end if;

  -- Calcular duración y horario de fin
  v_duration_min := coalesce(p_duration_minutes, v_service.duration_minutes, 30);
  v_duration := (v_duration_min || ' minutes')::interval;
  v_end_time := (p_start_time + v_duration)::time;
  v_start_ts := (p_booking_date + p_start_time)::timestamp;
  v_end_ts := (p_booking_date + v_end_time)::timestamp;

  -- Bloqueo consultivo por barbero y fecha para evitar condiciones de carrera
  perform pg_advisory_xact_lock(hashtextextended(p_barber_id::text || '|' || p_booking_date::text, 0));

  -- Validar que no se superponga con otro turno activo del mismo barbero
  if exists (
    select 1
    from public.appointments a
    where a.barber_id = v_barber.id
      and a.booking_date = p_booking_date
      and a.status <> 'CANCELLED'
      and (a.booking_date + a.start_time)::timestamp < v_end_ts
      and (a.booking_date + a.end_time)::timestamp > v_start_ts
  ) then
    raise exception using errcode = '23P01', message = 'SLOT_ALREADY_BOOKED';
  end if;

  -- Resolver o consolidar cliente
  begin
    v_client_id := public.find_or_create_consolidated_client(
      p_client_name,
      p_client_phone,
      p_client_email
    );
  exception when undefined_function then
    select c.id into v_client_id
    from public.clients c
    where lower(trim(c.email)) = lower(trim(coalesce(p_client_email, '')))
       or regexp_replace(c.phone, '[^0-9+]', '', 'g') = regexp_replace(trim(p_client_phone), '[^0-9+]', '', 'g')
    order by c.created_at asc
    limit 1;

    if v_client_id is null then
      insert into public.clients (name, phone, email)
      values (
        trim(p_client_name),
        trim(p_client_phone),
        lower(trim(coalesce(p_client_email, 'sin-email@kanibarber.internal')))
      )
      returning id into v_client_id;
    else
      update public.clients
      set name = trim(p_client_name),
          phone = trim(p_client_phone),
          email = coalesce(nullif(lower(trim(p_client_email)), ''), email),
          updated_at = now()
      where id = v_client_id;
    end if;
  end;

  -- Asegurar disponibilidad en barber_availability_slots para cubrir el intervalo
  if not exists (
    select 1
    from public.barber_availability_slots s
    where s.barber_id = v_barber.id
      and s.slot_date = p_booking_date
      and s.status = 'AVAILABLE'
      and s.start_time <= p_start_time
      and s.end_time >= v_end_time
  ) then
    insert into public.barber_availability_slots (
      barber_id, slot_date, start_time, end_time, status, internal_note
    ) values (
      v_barber.id,
      p_booking_date,
      p_start_time,
      v_end_time,
      'AVAILABLE',
      'Habilitado automáticamente por turno manual'
    )
    on conflict (barber_id, slot_date, start_time)
    do update set status = 'AVAILABLE', end_time = greatest(barber_availability_slots.end_time, v_end_time);
  end if;

  -- Si es recurrente, crear regla de recurrencia
  if p_is_recurring then
    v_day_of_week := extract(isodow from p_booking_date)::integer;
    insert into public.recurring_appointment_rules (
      client_id,
      barber_id,
      service_id,
      day_of_week,
      start_time,
      duration_minutes,
      start_date,
      active,
      created_by_user_id,
      created_by_display_name,
      notes
    ) values (
      v_client_id,
      v_barber.id,
      v_service.id,
      v_day_of_week,
      p_start_time,
      v_duration_min,
      p_booking_date,
      true,
      v_creator_user_id,
      v_creator_name,
      nullif(trim(coalesce(p_notes, '')), '')
    )
    returning id into v_rule_id;
  end if;

  -- Insertar el turno manual (confirmado).
  -- Cuando p_deposit_required = true: deposit_required = true y deposit_paid = true (seña recibida).
  -- Cuando p_deposit_required = false: deposit_required = false y deposit_paid = false.
  insert into public.appointments (
    client_id,
    barber_id,
    service_id,
    booking_date,
    start_time,
    end_time,
    status,
    notes,
    is_manual,
    origin,
    created_by_user_id,
    created_by_display_name,
    recurring_rule_id,
    deposit_required,
    deposit_paid
  ) values (
    v_client_id,
    v_barber.id,
    v_service.id,
    p_booking_date,
    p_start_time,
    v_end_time,
    'CONFIRMED',
    nullif(trim(coalesce(p_notes, '')), ''),
    true,
    'MANUAL',
    v_creator_user_id,
    v_creator_name,
    v_rule_id,
    v_deposit_flag,
    v_deposit_flag
  )
  returning id, status, booking_date, start_time, end_time, request_number
  into v_apt_id, appointment_status, booking_date, start_time, end_time, v_req_num;

  -- Si es recurrente, sincronizar las siguientes 4 semanas
  if p_is_recurring then
    perform public.sync_recurring_appointment_rules(28);
  end if;

  return query select
    v_apt_id,
    appointment_status,
    booking_date,
    start_time,
    end_time,
    v_req_num,
    true,
    'MANUAL'::text,
    v_creator_name,
    v_rule_id,
    v_deposit_flag,
    v_deposit_flag;
end;
$$;

revoke all on function public.create_manual_appointment(uuid, uuid, date, time, text, text, text, text, boolean, integer, boolean) from public;
grant execute on function public.create_manual_appointment(uuid, uuid, date, time, text, text, text, text, boolean, integer, boolean) to authenticated;
