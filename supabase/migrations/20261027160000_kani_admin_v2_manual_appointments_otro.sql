-- Migration: 20261027160000_kani_admin_v2_manual_appointments_otro.sql
-- Kani Barber Studio — Admin V2: Turnos manuales definitivos, servicio "Otro", email NULL real y eliminación de disponibilidad pública artificial

-- 1. Permitir email NULL en clients y actualizar constraint
ALTER TABLE public.clients ALTER COLUMN email DROP NOT NULL;
ALTER TABLE public.clients DROP CONSTRAINT IF EXISTS clients_email_check;
ALTER TABLE public.clients ADD CONSTRAINT clients_email_check CHECK (email IS NULL OR POSITION('@' IN email) > 1);

-- 2. Asegurar columnas en appointments para turnos manuales, precios históricos y servicio Otro
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS is_manual boolean NOT NULL DEFAULT false;
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS origin text NOT NULL DEFAULT 'PUBLIC_WEB';
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS custom_service_name text;
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS service_price_ars integer;
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS created_by_user_id uuid;
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS created_by_display_name text;
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS recurring_rule_id uuid;
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS deposit_required boolean NOT NULL DEFAULT true;
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS balance_paid boolean NOT NULL DEFAULT false;

-- Permitir service_id NULL en appointments para servicio "Otro"
ALTER TABLE public.appointments ALTER COLUMN service_id DROP NOT NULL;

-- Actualizar constraints de appointments
ALTER TABLE public.appointments DROP CONSTRAINT IF EXISTS appointment_inside_business_hours;
ALTER TABLE public.appointments ADD CONSTRAINT appointment_inside_business_hours CHECK (
  coalesce(is_manual, false) = true OR (
    start_time >= '10:00:00'::time without time zone AND 
    end_time <= '20:00:00'::time without time zone
  )
);

ALTER TABLE public.appointments DROP CONSTRAINT IF EXISTS appointments_service_check;
ALTER TABLE public.appointments ADD CONSTRAINT appointments_service_check CHECK (
  service_id IS NOT NULL OR custom_service_name IS NOT NULL
);

-- 3. Actualizar create_appointment_notification_event con LEFT JOIN para tolerar service_id NULL
CREATE OR REPLACE FUNCTION public.create_appointment_notification_event(p_appointment_id uuid, p_notification_type notification_type)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'extensions', 'public'
AS $function$
declare
  v_token text := gen_random_uuid()::text;
  v_recipient_email text;
  v_recipient_phone text;
  v_client_name text;
  v_barber_name text;
  v_service_name text;
  v_booking_date date;
  v_start_time time;
  v_end_time time;
  v_client_notes text;
  v_service_price_ars integer;
  v_service_duration_minutes integer;
  v_down_payment_ars integer;
  v_transfer_alias text;
  v_transfer_cuit text;
  v_transfer_holder_name text;
begin
  select c.email, c.phone, c.name, b.name, 
         coalesce(nullif(trim(a.custom_service_name), ''), s.name, 'Servicio especial'), 
         a.booking_date, a.start_time, a.end_time,
         a.notes, 
         coalesce(a.service_price_ars, s.price_ars, 0), 
         coalesce(round(extract(epoch from (a.end_time - a.start_time)) / 60)::integer, s.duration_minutes, 30),
         coalesce(nullif(td.down_payment_ars, 10000), 5000),
         td.alias, td.cuit, td.holder_name
    into v_recipient_email, v_recipient_phone, v_client_name, v_barber_name, v_service_name,
         v_booking_date, v_start_time, v_end_time, v_client_notes,
         v_service_price_ars, v_service_duration_minutes, v_down_payment_ars,
         v_transfer_alias, v_transfer_cuit, v_transfer_holder_name
  from public.appointments a
  join public.clients c on c.id = a.client_id
  join public.barbers b on b.id = a.barber_id
  left join public.services s on s.id = a.service_id
  left join public.barber_transfer_details td on td.barber_id = a.barber_id
    and td.active = true
  where a.id = p_appointment_id;

  if not found then
    raise exception using errcode = 'P0001', message = 'APPOINTMENT_NOT_FOUND';
  end if;

  insert into public.appointment_notification_events (
    appointment_id, notification_type, recipient_email, recipient_phone, client_name, barber_name,
    service_name, booking_date, start_time, end_time, client_notes,
    service_price_ars, service_duration_minutes, down_payment_ars,
    transfer_alias, transfer_cuit, transfer_holder_name, claim_token_digest
  ) values (
    p_appointment_id, p_notification_type, v_recipient_email, v_recipient_phone, v_client_name,
    v_barber_name, v_service_name, v_booking_date, v_start_time, v_end_time,
    v_client_notes, v_service_price_ars, v_service_duration_minutes,
    coalesce(v_down_payment_ars, 5000), v_transfer_alias, v_transfer_cuit, v_transfer_holder_name,
    encode(digest(v_token, 'sha256'), 'hex')
  ) on conflict (appointment_id, notification_type) do nothing;

  if found then
    return v_token;
  end if;
  return null;
end;
$function$;

-- 4. Actualizar create_manual_appointment
-- NO genera disponibilidad pública en barber_availability_slots.
-- Soporta servicios normales y servicio "Otro".
-- Email es NULL si no se ingresa (sin correos sintéticos).
CREATE OR REPLACE FUNCTION public.create_manual_appointment(
  p_barber_id uuid,
  p_service_id uuid default null,
  p_custom_service_name text default null,
  p_service_price_ars integer default null,
  p_booking_date date default null,
  p_start_time time default null,
  p_end_time time default null,
  p_client_name text default null,
  p_client_phone text default null,
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
  custom_service_name text,
  service_price_ars integer
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
  v_req_num bigint;
  v_clean_email text;
  v_clean_phone text;
  v_final_service_name text;
  v_final_price integer;
begin
  if v_creator_user_id is null then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;

  v_is_admin := public.is_admin();
  v_staff_barber_id := public.current_staff_barber_id();

  -- Permisos de barbero: BARBER solo para sí mismo
  if not v_is_admin and (v_staff_barber_id is null or v_staff_barber_id is distinct from p_barber_id) then
    raise exception using errcode = '42501', message = 'MANUAL_APPOINTMENT_NOT_ALLOWED';
  end if;

  if v_is_admin then
    v_creator_name := 'Admin';
  else
    select b.name into v_creator_name from public.barbers b where b.id = v_staff_barber_id;
    v_creator_name := coalesce(v_creator_name, 'Barbero');
  end if;

  -- Validaciones básicas
  if p_barber_id is null then raise exception using errcode = '22023', message = 'BARBER_REQUIRED'; end if;
  if p_booking_date is null then raise exception using errcode = '22023', message = 'DATE_REQUIRED'; end if;
  if p_start_time is null then raise exception using errcode = '22023', message = 'START_TIME_REQUIRED'; end if;
  if p_client_name is null or length(trim(p_client_name)) < 3 then raise exception using errcode = '22023', message = 'CLIENT_NAME_INVALID'; end if;

  v_clean_phone := trim(coalesce(p_client_phone, ''));
  if length(v_clean_phone) < 6 then raise exception using errcode = '22023', message = 'CLIENT_PHONE_INVALID'; end if;

  v_clean_email := nullif(lower(trim(coalesce(p_client_email, ''))), '');
  if v_clean_email is not null and position('@' in v_clean_email) <= 1 then
    raise exception using errcode = '22023', message = 'CLIENT_EMAIL_INVALID';
  end if;

  -- Validar barbero activo
  select * into v_barber from public.barbers b where b.id = p_barber_id and b.active = true;
  if not found then raise exception using errcode = '22023', message = 'BARBER_NOT_FOUND'; end if;

  -- Resolver Servicio: Normal vs Otro
  if p_service_id is not null then
    select * into v_service from public.services s where s.id = p_service_id and s.active = true;
    if not found then raise exception using errcode = '22023', message = 'SERVICE_NOT_FOUND'; end if;
    v_duration_min := coalesce(p_duration_minutes, v_service.duration_minutes, 45);
    v_duration := (v_duration_min || ' minutes')::interval;
    v_end_time := coalesce(p_end_time, (p_start_time + v_duration)::time);
    v_final_service_name := v_service.name;
    v_final_price := coalesce(p_service_price_ars, v_service.price_ars, 0);
  else
    -- Servicio Otro
    v_final_service_name := trim(coalesce(p_custom_service_name, ''));
    if length(v_final_service_name) < 2 then
      raise exception using errcode = '22023', message = 'CUSTOM_SERVICE_NAME_REQUIRED';
    end if;

    if p_service_price_ars is null or p_service_price_ars < 0 then
      raise exception using errcode = '22023', message = 'SERVICE_PRICE_REQUIRED';
    end if;
    v_final_price := p_service_price_ars;

    if p_end_time is not null then
      v_end_time := p_end_time;
      if v_end_time <= p_start_time then
        raise exception using errcode = '22023', message = 'END_TIME_MUST_BE_AFTER_START_TIME';
      end if;
      v_duration_min := round(extract(epoch from (v_end_time - p_start_time)) / 60)::integer;
    elsif p_duration_minutes is not null and p_duration_minutes > 0 then
      v_duration_min := p_duration_minutes;
      v_duration := (v_duration_min || ' minutes')::interval;
      v_end_time := (p_start_time + v_duration)::time;
    else
      raise exception using errcode = '22023', message = 'END_TIME_REQUIRED';
    end if;
  end if;

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

  -- Resolver o consolidar cliente (EMAIL NULL REAL, sin fallbacks sintéticos)
  select c.id into v_client_id
  from public.clients c
  where (v_clean_email is not null and lower(trim(coalesce(c.email, ''))) = v_clean_email)
     or regexp_replace(c.phone, '[^0-9+]', '', 'g') = regexp_replace(v_clean_phone, '[^0-9+]', '', 'g')
  order by c.created_at asc
  limit 1;

  if v_client_id is null then
    insert into public.clients (name, phone, email)
    values (trim(p_client_name), v_clean_phone, v_clean_email)
    returning id into v_client_id;
  else
    update public.clients
    set name = trim(p_client_name),
        phone = v_clean_phone,
        email = coalesce(v_clean_email, email),
        updated_at = now()
    where id = v_client_id;
  end if;

  -- NOTA FUNDAMENTAL: NO SE MODIFICA barber_availability_slots.
  -- El turno manual NO crea disponibilidad pública.

  -- Insertar turno manual directamente confirmado
  insert into public.appointments (
    client_id,
    barber_id,
    service_id,
    custom_service_name,
    service_price_ars,
    booking_date,
    start_time,
    end_time,
    status,
    notes,
    is_manual,
    origin,
    created_by_user_id,
    created_by_display_name,
    deposit_required,
    deposit_paid
  ) values (
    v_client_id,
    v_barber.id,
    p_service_id,
    case when p_service_id is null then v_final_service_name else null end,
    v_final_price,
    p_booking_date,
    p_start_time,
    v_end_time,
    'CONFIRMED',
    nullif(trim(coalesce(p_notes, '')), ''),
    true,
    'MANUAL',
    v_creator_user_id,
    v_creator_name,
    false,
    false
  )
  returning id, status, booking_date, start_time, end_time, request_number
  into v_apt_id, appointment_status, booking_date, start_time, end_time, v_req_num;

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
    case when p_service_id is null then v_final_service_name else null end,
    v_final_price;
end;
$$;

-- 5. Actualizar update_manual_appointment
CREATE OR REPLACE FUNCTION public.update_manual_appointment(
  p_appointment_id uuid,
  p_barber_id uuid,
  p_service_id uuid default null,
  p_custom_service_name text default null,
  p_service_price_ars integer default null,
  p_booking_date date default null,
  p_start_time time default null,
  p_end_time time default null,
  p_client_name text default null,
  p_client_phone text default null,
  p_client_email text default null,
  p_notes text default null,
  p_duration_minutes integer default null
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
  custom_service_name text,
  service_price_ars integer
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
  v_clean_phone text;
  v_final_service_name text;
  v_final_price integer;
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
    if v_staff_barber_id is null or v_appt.barber_id is distinct from v_staff_barber_id then
      raise exception using errcode = '42501', message = 'MANUAL_APPOINTMENT_NOT_ALLOWED';
    end if;
    if p_barber_id is distinct from v_staff_barber_id then
      raise exception using errcode = '42501', message = 'BARBER_CANNOT_REASSIGN_APPOINTMENT';
    end if;
  end if;

  if p_barber_id is null then raise exception using errcode = '22023', message = 'BARBER_REQUIRED'; end if;
  if p_booking_date is null then raise exception using errcode = '22023', message = 'DATE_REQUIRED'; end if;
  if p_start_time is null then raise exception using errcode = '22023', message = 'START_TIME_REQUIRED'; end if;
  if p_client_name is null or length(trim(p_client_name)) < 3 then raise exception using errcode = '22023', message = 'CLIENT_NAME_INVALID'; end if;

  v_clean_phone := trim(coalesce(p_client_phone, ''));
  if length(v_clean_phone) < 6 then raise exception using errcode = '22023', message = 'CLIENT_PHONE_INVALID'; end if;

  v_clean_email := nullif(lower(trim(coalesce(p_client_email, ''))), '');
  if v_clean_email is not null and position('@' in v_clean_email) <= 1 then
    raise exception using errcode = '22023', message = 'CLIENT_EMAIL_INVALID';
  end if;

  -- Resolver Servicio
  if p_service_id is not null then
    select * into v_service from public.services s where s.id = p_service_id and s.active = true;
    if not found then raise exception using errcode = '22023', message = 'SERVICE_NOT_FOUND'; end if;
    v_duration_min := coalesce(p_duration_minutes, v_service.duration_minutes, 45);
    v_duration := (v_duration_min || ' minutes')::interval;
    v_end_time := coalesce(p_end_time, (p_start_time + v_duration)::time);
    v_final_service_name := v_service.name;
    v_final_price := coalesce(p_service_price_ars, v_appt.service_price_ars, v_service.price_ars, 0);
  else
    v_final_service_name := trim(coalesce(p_custom_service_name, v_appt.custom_service_name, ''));
    if length(v_final_service_name) < 2 then
      raise exception using errcode = '22023', message = 'CUSTOM_SERVICE_NAME_REQUIRED';
    end if;
    v_final_price := coalesce(p_service_price_ars, v_appt.service_price_ars, 0);

    if p_end_time is not null then
      v_end_time := p_end_time;
      if v_end_time <= p_start_time then
        raise exception using errcode = '22023', message = 'END_TIME_MUST_BE_AFTER_START_TIME';
      end if;
    elsif p_duration_minutes is not null and p_duration_minutes > 0 then
      v_duration_min := p_duration_minutes;
      v_duration := (v_duration_min || ' minutes')::interval;
      v_end_time := (p_start_time + v_duration)::time;
    else
      v_end_time := v_appt.end_time;
    end if;
  end if;

  v_start_ts := (p_booking_date + p_start_time)::timestamp;
  v_end_ts := (p_booking_date + v_end_time)::timestamp;

  -- Bloqueo consultivo
  perform pg_advisory_xact_lock(hashtextextended(p_barber_id::text || '|' || p_booking_date::text, 0));

  -- Validar anti-solapamiento excluyendo el propio appointment
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

  -- Actualizar cliente asociado
  if v_appt.client_id is not null then
    update public.clients
    set name = trim(p_client_name),
        phone = v_clean_phone,
        email = v_clean_email,
        updated_at = now()
    where id = v_appt.client_id;
  end if;

  -- Actualizar el turno (sin tocar barber_availability_slots)
  update public.appointments
  set barber_id = p_barber_id,
      service_id = p_service_id,
      custom_service_name = case when p_service_id is null then v_final_service_name else null end,
      service_price_ars = v_final_price,
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
    v_appt.created_by_display_name,
    case when p_service_id is null then v_final_service_name else null end,
    v_final_price;
end;
$$;

-- 6. Actualizar record_service_payment para aceptar nombres libres de servicio ("Otro" o personalizados)
CREATE OR REPLACE FUNCTION public.record_service_payment(
  p_barber_id uuid,
  p_service_name text,
  p_service_other_detail text DEFAULT NULL::text,
  p_service_price_ars integer DEFAULT NULL::integer,
  p_discount_ars integer DEFAULT 0,
  p_payment_date date DEFAULT NULL::date,
  p_payment_time time without time zone DEFAULT NULL::time without time zone,
  p_payment_method text DEFAULT 'Efectivo'::text,
  p_online_deposit_paid boolean DEFAULT false,
  p_client_name text DEFAULT NULL::text,
  p_client_contact text DEFAULT NULL::text,
  p_appointment_id uuid DEFAULT NULL::uuid,
  p_service_origin text DEFAULT NULL::text
)
RETURNS TABLE (
  payment_id uuid,
  barber_id uuid,
  service_name text,
  final_amount_ars integer,
  collected_amount_ars integer,
  payment_date date,
  payment_time time without time zone,
  appointment_id uuid,
  service_origin text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_is_admin boolean := public.is_admin();
  v_staff_barber_id uuid := public.current_staff_barber_id();
  v_creator_name text;
  v_service_id uuid := null;
  v_service_price integer;
  v_discount integer := coalesce(p_discount_ars, 0);
  v_final_amount integer;
  v_date date;
  v_time time;
  v_online_deposit_paid boolean := false;
  v_online_deposit_amount integer := 0;
  v_collected_amount integer;
  v_apt record;
  v_new_id uuid;
  v_origin text;
  v_final_service_name text;
  v_other_detail text;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if not v_is_admin and (v_staff_barber_id is null or v_staff_barber_id is distinct from p_barber_id) then
    raise exception 'FORBIDDEN_BARBER_SCOPE';
  end if;

  if v_is_admin then
    v_creator_name := 'Admin';
  else
    select name into v_creator_name from public.barbers where id = v_staff_barber_id;
    v_creator_name := coalesce(v_creator_name, 'Barbero');
  end if;

  v_origin := coalesce(p_service_origin, case when p_appointment_id is not null then 'appointment' else 'walk_in' end);
  if v_origin not in ('appointment', 'walk_in', 'legacy') then
    raise exception 'INVALID_SERVICE_ORIGIN';
  end if;

  if v_origin = 'appointment' and p_appointment_id is null then
    raise exception 'APPOINTMENT_ID_REQUIRED_FOR_ORIGIN';
  end if;

  if v_origin = 'walk_in' and p_appointment_id is not null then
    raise exception 'APPOINTMENT_ID_NOT_ALLOWED_FOR_WALK_IN';
  end if;

  -- Resolver nombre y precio del servicio
  v_other_detail := nullif(trim(coalesce(p_service_other_detail, '')), '');
  
  if p_service_name in ('Corte', 'Corte y barba', 'Corte + barba', 'Barba') then
    select id, price_ars into v_service_id, v_service_price
    from public.services
    where name = p_service_name or (p_service_name = 'Corte y barba' and name = 'Corte + barba')
    limit 1;

    v_service_price := coalesce(p_service_price_ars, v_service_price, 25000);
    v_final_service_name := p_service_name;
  elsif p_service_name in ('Otro', 'Otros') then
    if v_other_detail is null then
      raise exception 'OTHER_SERVICE_DETAIL_REQUIRED';
    end if;
    if p_service_price_ars is null or p_service_price_ars <= 0 then
      raise exception 'OTHER_SERVICE_PRICE_REQUIRED';
    end if;
    v_service_price := p_service_price_ars;
    v_final_service_name := v_other_detail;
  else
    -- Nombre libre (ej. 'Tintura de color' proveniente de un appointment o manual)
    if length(trim(coalesce(p_service_name, ''))) < 2 then
      raise exception 'INVALID_SERVICE_NAME';
    end if;
    if p_service_price_ars is null or p_service_price_ars <= 0 then
      raise exception 'OTHER_SERVICE_PRICE_REQUIRED';
    end if;
    v_service_price := p_service_price_ars;
    v_final_service_name := trim(p_service_name);
  end if;

  -- Validar descuento
  if v_discount < 0 or v_discount > v_service_price then
    raise exception 'INVALID_DISCOUNT_AMOUNT';
  end if;
  v_final_amount := v_service_price - v_discount;

  -- Validar método de pago
  if p_payment_method not in ('Efectivo', 'Transferencia') then
    raise exception 'INVALID_PAYMENT_METHOD';
  end if;

  v_date := coalesce(p_payment_date, (timezone('America/Argentina/Buenos_Aires', clock_timestamp()))::date);
  v_time := coalesce(p_payment_time, (timezone('America/Argentina/Buenos_Aires', clock_timestamp()))::time);

  -- Validar vinculación a turno
  if p_appointment_id is not null then
    select * into v_apt from public.appointments where id = p_appointment_id for update;
    if not found then raise exception 'APPOINTMENT_NOT_FOUND'; end if;
    if not v_is_admin and v_apt.barber_id <> v_staff_barber_id then raise exception 'FORBIDDEN_APPOINTMENT_SCOPE'; end if;
    if exists (select 1 from public.service_payments sp where sp.appointment_id = p_appointment_id) then
      raise exception 'APPOINTMENT_ALREADY_LINKED';
    end if;

    if coalesce(v_apt.deposit_paid, false) = true then
      v_online_deposit_paid := true;
      v_online_deposit_amount := coalesce(v_apt.deposit_amount_ars, 5000);
    else
      if p_online_deposit_paid = true then raise exception 'INVALID_ONLINE_DEPOSIT_CLAIM'; end if;
      v_online_deposit_paid := false;
      v_online_deposit_amount := 0;
    end if;

    v_collected_amount := greatest(0, v_final_amount - (case when v_online_deposit_paid then v_online_deposit_amount else 0 end));

    update public.appointments
    set balance_paid = true,
        status = case when status in ('PENDING', 'CONFIRMED') then 'COMPLETED'::public.appointment_status else status end,
        updated_at = now()
    where id = p_appointment_id;
  else
    if p_online_deposit_paid = true then raise exception 'INVALID_ONLINE_DEPOSIT_WITHOUT_APPOINTMENT'; end if;
    v_online_deposit_paid := false;
    v_online_deposit_amount := 0;
    v_collected_amount := v_final_amount;
  end if;

  insert into public.service_payments (
    barber_id,
    service_id,
    service_name,
    service_other_detail,
    service_price_ars,
    discount_ars,
    final_amount_ars,
    payment_date,
    payment_time,
    payment_method,
    online_deposit_paid,
    online_deposit_amount_ars,
    collected_amount_ars,
    client_name,
    client_contact,
    appointment_id,
    service_origin,
    created_by_user_id,
    created_by_display_name
  ) values (
    p_barber_id,
    v_service_id,
    v_final_service_name,
    v_other_detail,
    v_service_price,
    v_discount,
    v_final_amount,
    v_date,
    v_time,
    p_payment_method,
    v_online_deposit_paid,
    v_online_deposit_amount,
    v_collected_amount,
    nullif(trim(p_client_name), ''),
    nullif(trim(p_client_contact), ''),
    p_appointment_id,
    v_origin,
    v_uid,
    v_creator_name
  )
  returning id into v_new_id;

  return query select
    v_new_id,
    p_barber_id,
    v_final_service_name,
    v_final_amount,
    v_collected_amount,
    v_date,
    v_time,
    p_appointment_id,
    v_origin;
end;
$function$;

-- 7. Limpiar cualquier slot introducido con internal_note de turno manual en barber_availability_slots
DELETE FROM public.barber_availability_slots
WHERE internal_note ILIKE '%turno manual%';
