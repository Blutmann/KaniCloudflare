-- Migration: 20261027151000_kani_admin_v2_manual_appointments.sql
-- Kani Barber Studio — Admin V2: Turnos manuales, edición y reglas de cancelación

-- 1. Actualizar update_appointment_status para impedir que un BARBER cancele turnos manuales
CREATE OR REPLACE FUNCTION public.update_appointment_status(p_appointment_id uuid, p_status appointment_status)
 RETURNS TABLE(appointment_status appointment_status, notification_claim_token text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'extensions'
AS $function$
declare
  v_current_status public.appointment_status;
  v_barber_id uuid;
  v_booking_date date;
  v_is_manual boolean;
begin
  if (select auth.uid()) is null then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;
  if p_status not in ('CANCELLED', 'COMPLETED') then
    raise exception using errcode = '22023', message = 'STATUS_NOT_ALLOWED';
  end if;

  select a.status, a.barber_id, a.booking_date, a.is_manual
    into v_current_status, v_barber_id, v_booking_date, v_is_manual
  from public.appointments a
  where a.id = p_appointment_id
    and (public.is_admin() or a.barber_id = public.current_staff_barber_id());

  if v_barber_id is null then
    raise exception using errcode = '42501', message = 'APPOINTMENT_NOT_ALLOWED';
  end if;

  -- Regla estricta: BARBER no puede cancelar un turno manual
  if p_status = 'CANCELLED' and coalesce(v_is_manual, false) = true and not public.is_admin() then
    raise exception using errcode = '42501', message = 'BARBER_CANNOT_CANCEL_MANUAL_APPOINTMENT';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_barber_id::text || '|' || v_booking_date::text, 0));
  select a.status into v_current_status from public.appointments a where a.id=p_appointment_id for update;

  if v_current_status = p_status then
    appointment_status := v_current_status;
    notification_claim_token := null;
    return next;
    return;
  end if;

  if p_status = 'CONFIRMED' and v_current_status <> 'PENDING' then
    raise exception using errcode = '22023', message = 'STATUS_TRANSITION_NOT_ALLOWED';
  end if;
  if p_status = 'CANCELLED' and v_current_status not in ('PENDING', 'CONFIRMED') then
    raise exception using errcode = '22023', message = 'STATUS_TRANSITION_NOT_ALLOWED';
  end if;
  if p_status = 'COMPLETED' and v_current_status <> 'CONFIRMED' then
    raise exception using errcode = '22023', message = 'STATUS_TRANSITION_NOT_ALLOWED';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_barber_id::text || '|' || v_booking_date::text, 0));

  update public.appointments as updated
  set status = p_status, updated_at = now(),
      cancellation_reason = case when p_status='CANCELLED' then 'STAFF_CANCELLED' else updated.cancellation_reason end,
      cancelled_at = case when p_status='CANCELLED' then now() else updated.cancelled_at end,
      cancelled_by = case when p_status='CANCELLED' then auth.uid() else updated.cancelled_by end
  where updated.id = p_appointment_id
  returning updated.status into appointment_status;

  if appointment_status = 'CONFIRMED' then
    notification_claim_token := public.create_appointment_notification_event(p_appointment_id, 'CONFIRMED');
  elsif appointment_status = 'CANCELLED' then
    notification_claim_token := public.create_appointment_notification_event(p_appointment_id, 'CANCELLED');
  else
    notification_claim_token := null;
  end if;

  return next;
end;
$function$;

-- 2. Asegurar create_manual_appointment con soporte para email opcional y reglas anti-solapamiento
CREATE OR REPLACE FUNCTION public.create_manual_appointment(
  p_barber_id uuid,
  p_service_id uuid,
  p_booking_date date,
  p_start_time time,
  p_client_name text,
  p_client_phone text,
  p_client_email text default null,
  p_notes text default null,
  p_is_recurring boolean default false,
  p_duration_minutes integer default null,
  p_deposit_required boolean default false
)
RETURNS TABLE (
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
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
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
  v_clean_email text;
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

  v_clean_email := nullif(lower(trim(coalesce(p_client_email, ''))), '');
  if v_clean_email is not null and position('@' in v_clean_email) <= 1 then
    raise exception using errcode = '22023', message = 'CLIENT_EMAIL_INVALID';
  end if;

  -- Obtener barbero activo
  select * into v_barber
  from public.barbers b
  where b.id = p_barber_id and b.active = true;
  if not found then
    raise exception using errcode = '22023', message = 'BARBER_NOT_FOUND';
  end if;

  -- Obtener servicio activo
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

  -- Validar anti-solapamiento estricto por intervalo
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
      coalesce(v_clean_email, regexp_replace(p_client_phone, '[^0-9]', '', 'g') || '@cliente.kanibarber.internal')
    );
  exception when undefined_function then
    select c.id into v_client_id
    from public.clients c
    where (v_clean_email is not null and lower(trim(c.email)) = v_clean_email)
       or regexp_replace(c.phone, '[^0-9+]', '', 'g') = regexp_replace(trim(p_client_phone), '[^0-9+]', '', 'g')
    order by c.created_at asc
    limit 1;

    if v_client_id is null then
      insert into public.clients (name, phone, email)
      values (
        trim(p_client_name),
        trim(p_client_phone),
        coalesce(v_clean_email, regexp_replace(p_client_phone, '[^0-9]', '', 'g') || '@cliente.kanibarber.internal')
      )
      returning id into v_client_id;
    else
      update public.clients
      set name = trim(p_client_name),
          phone = trim(p_client_phone),
          email = coalesce(v_clean_email, email),
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

  -- Insertar el turno manual (CONFIRMED directamente, sin seña)
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

-- 3. Crear función RPC update_manual_appointment para edición de turnos manuales con anti-solapamiento
CREATE OR REPLACE FUNCTION public.update_manual_appointment(
  p_appointment_id uuid,
  p_barber_id uuid,
  p_service_id uuid,
  p_booking_date date,
  p_start_time time,
  p_client_name text,
  p_client_phone text,
  p_client_email text default null,
  p_notes text default null
)
RETURNS TABLE (
  appointment_id uuid,
  appointment_status public.appointment_status,
  booking_date date,
  start_time time,
  end_time time,
  request_number bigint,
  is_manual boolean,
  origin text,
  created_by_display_name text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
declare
  v_appt public.appointments%rowtype;
  v_service public.services%rowtype;
  v_is_admin boolean;
  v_staff_barber_id uuid;
  v_duration_min integer;
  v_duration interval;
  v_end_time time;
  v_start_ts timestamp;
  v_end_ts timestamp;
  v_clean_email text;
begin
  if (select auth.uid()) is null then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;

  v_is_admin := public.is_admin();
  v_staff_barber_id := public.current_staff_barber_id();

  select * into v_appt
  from public.appointments
  where id = p_appointment_id;

  if not found then
    raise exception using errcode = '22023', message = 'APPOINTMENT_NOT_FOUND';
  end if;

  if not v_is_admin then
    -- Barber solo puede editar sus propios turnos
    if v_staff_barber_id is null or v_appt.barber_id is distinct from v_staff_barber_id then
      raise exception using errcode = '42501', message = 'MANUAL_APPOINTMENT_NOT_ALLOWED';
    end if;
    -- Barber NO puede reasignar el turno a otro barbero
    if p_barber_id is distinct from v_staff_barber_id then
      raise exception using errcode = '42501', message = 'BARBER_CANNOT_REASSIGN_APPOINTMENT';
    end if;
  end if;

  -- Validaciones de entrada
  if p_barber_id is null then raise exception using errcode = '22023', message = 'BARBER_REQUIRED'; end if;
  if p_service_id is null then raise exception using errcode = '22023', message = 'SERVICE_REQUIRED'; end if;
  if p_booking_date is null then raise exception using errcode = '22023', message = 'DATE_REQUIRED'; end if;
  if p_start_time is null then raise exception using errcode = '22023', message = 'START_TIME_REQUIRED'; end if;
  if p_client_name is null or length(trim(p_client_name)) < 3 then raise exception using errcode = '22023', message = 'CLIENT_NAME_INVALID'; end if;
  if p_client_phone is null or length(trim(p_client_phone)) < 6 then raise exception using errcode = '22023', message = 'CLIENT_PHONE_INVALID'; end if;

  v_clean_email := nullif(lower(trim(coalesce(p_client_email, ''))), '');
  if v_clean_email is not null and position('@' in v_clean_email) <= 1 then
    raise exception using errcode = '22023', message = 'CLIENT_EMAIL_INVALID';
  end if;

  select * into v_service from public.services s where s.id = p_service_id and s.active = true;
  if not found then raise exception using errcode = '22023', message = 'SERVICE_NOT_FOUND'; end if;

  v_duration_min := coalesce(v_service.duration_minutes, 30);
  v_duration := (v_duration_min || ' minutes')::interval;
  v_end_time := (p_start_time + v_duration)::time;
  v_start_ts := (p_booking_date + p_start_time)::timestamp;
  v_end_ts := (p_booking_date + v_end_time)::timestamp;

  -- Bloqueo consultivo en barbero de destino y fecha
  perform pg_advisory_xact_lock(hashtextextended(p_barber_id::text || '|' || p_booking_date::text, 0));

  -- Validar anti-solapamiento excluyendo el propio appointment que se está editando
  if exists (
    select 1
    from public.appointments a
    where a.barber_id = p_barber_id
      and a.booking_date = p_booking_date
      and a.id <> p_appointment_id
      and a.status <> 'CANCELLED'
      and (a.booking_date + a.start_time)::timestamp < v_end_ts
      and (a.booking_date + a.end_time)::timestamp > v_start_ts
  ) then
    raise exception using errcode = '23P01', message = 'SLOT_ALREADY_BOOKED';
  end if;

  -- Actualizar datos del cliente asociado
  if v_appt.client_id is not null then
    update public.clients
    set name = trim(p_client_name),
        phone = trim(p_client_phone),
        email = coalesce(v_clean_email, email),
        updated_at = now()
    where id = v_appt.client_id;
  end if;

  -- Asegurar disponibilidad en barber_availability_slots
  if not exists (
    select 1
    from public.barber_availability_slots s
    where s.barber_id = p_barber_id
      and s.slot_date = p_booking_date
      and s.status = 'AVAILABLE'
      and s.start_time <= p_start_time
      and s.end_time >= v_end_time
  ) then
    insert into public.barber_availability_slots (
      barber_id, slot_date, start_time, end_time, status, internal_note
    ) values (
      p_barber_id,
      p_booking_date,
      p_start_time,
      v_end_time,
      'AVAILABLE',
      'Habilitado automáticamente por edición de turno manual'
    )
    on conflict (barber_id, slot_date, start_time)
    do update set status = 'AVAILABLE', end_time = greatest(barber_availability_slots.end_time, v_end_time);
  end if;

  -- Actualizar el turno
  update public.appointments
  set barber_id = p_barber_id,
      service_id = p_service_id,
      booking_date = p_booking_date,
      start_time = p_start_time,
      end_time = v_end_time,
      notes = nullif(trim(coalesce(p_notes, '')), ''),
      updated_at = now()
  where id = p_appointment_id;

  return query select
    p_appointment_id,
    v_appt.status,
    p_booking_date,
    p_start_time,
    v_end_time,
    v_appt.request_number,
    v_appt.is_manual,
    v_appt.origin,
    v_appt.created_by_display_name;
end;
$$;

revoke all on function public.update_manual_appointment(uuid, uuid, uuid, date, time, text, text, text, text) from public, anon;
grant execute on function public.update_manual_appointment(uuid, uuid, uuid, date, time, text, text, text, text) to authenticated;
