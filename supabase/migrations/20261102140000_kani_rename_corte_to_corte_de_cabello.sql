-- Migration: 20261102140000_kani_rename_corte_to_corte_de_cabello.sql
-- Kani Barber Studio — Renombrar servicio oficial "Corte" a "Corte de cabello"
-- Conservando id, precio ($25.000 / $15.000 Franco), duración (45 min) y asociaciones

-- 1. Actualizar catálogo público en la tabla services
UPDATE public.services
SET name = 'Corte de cabello'
WHERE name = 'Corte';

-- 2. Actualizar slots de disponibilidad que contengan 'Corte' en compatible_services
UPDATE public.barber_availability_slots
SET compatible_services = array_replace(compatible_services, 'Corte', 'Corte de cabello')
WHERE 'Corte' = ANY(compatible_services);

-- 3. Actualizar constraint en service_payments para aceptar 'Corte de cabello'
ALTER TABLE public.service_payments DROP CONSTRAINT IF EXISTS service_payments_service_name_check;
ALTER TABLE public.service_payments ADD CONSTRAINT service_payments_service_name_check
  CHECK (service_name IN ('Corte', 'Corte de cabello', 'Corte y barba', 'Corte + barba', 'Barba', 'Otros'));

-- 4. Actualizar record_service_payment para tolerar 'Corte de cabello' y 'Corte'
CREATE OR REPLACE FUNCTION public.record_service_payment(
  p_barber_id uuid,
  p_service_name text,
  p_service_other_detail text,
  p_service_price_ars integer,
  p_discount_ars integer,
  p_payment_date date,
  p_payment_time time without time zone,
  p_payment_method text,
  p_online_deposit_paid boolean,
  p_client_name text DEFAULT NULL::text,
  p_client_contact text DEFAULT NULL::text,
  p_appointment_id uuid DEFAULT NULL::uuid,
  p_service_origin text DEFAULT 'walk_in'::text
)
RETURNS TABLE(
  payment_id uuid,
  barber_id uuid,
  service_id uuid,
  service_name text,
  service_other_detail text,
  service_price_ars integer,
  discount_ars integer,
  final_amount_ars integer,
  payment_date date,
  payment_time time without time zone,
  payment_method text,
  online_deposit_paid boolean,
  online_deposit_amount_ars integer,
  collected_amount_ars integer,
  client_name text,
  client_contact text,
  appointment_id uuid,
  service_origin text,
  created_by_user_id uuid,
  created_by_display_name text,
  created_at timestamp with time zone,
  updated_at timestamp with time zone
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'pg_catalog', 'public', 'extensions'
AS $$
declare
  v_user_id uuid := auth.uid();
  v_display_name text;
  v_role text;
  v_user_barber_id uuid;
  v_service_id uuid := null;
  v_service_price integer := 0;
  v_final_service_name text;
  v_other_detail text := null;
  v_discount integer := coalesce(p_discount_ars, 0);
  v_final_amount integer;
  v_deposit_amount integer := 0;
  v_collected_amount integer;
  v_payment_id uuid;
  v_origin text := lower(trim(coalesce(p_service_origin, 'walk_in')));
  v_new_payment public.service_payments%ROWTYPE;
begin
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  select p.role, p.display_name, p.barber_id
  into v_role, v_display_name, v_user_barber_id
  from public.profiles p
  where p.id = v_user_id;

  if v_role is null then
    raise exception 'FORBIDDEN_PROFILE_NOT_FOUND';
  end if;

  if v_role <> 'ADMIN' and p_barber_id <> v_user_barber_id then
    raise exception 'FORBIDDEN_BARBER_MISMATCH';
  end if;

  if v_origin not in ('appointment', 'walk_in', 'legacy', 'online_deposit') then
    raise exception 'INVALID_SERVICE_ORIGIN';
  end if;

  if v_origin = 'walk_in' and p_appointment_id is not null then
    raise exception 'APPOINTMENT_ID_NOT_ALLOWED_FOR_WALK_IN';
  end if;

  v_other_detail := nullif(trim(coalesce(p_service_other_detail, '')), '');
  
  if p_service_name in ('Corte', 'Corte de cabello', 'Corte y barba', 'Corte + barba', 'Barba') then
    select id, price_ars into v_service_id, v_service_price
    from public.services
    where name = p_service_name 
       or (p_service_name = 'Corte y barba' and name = 'Corte + barba')
       or (p_service_name = 'Corte de cabello' and name = 'Corte')
       or (p_service_name = 'Corte' and name = 'Corte de cabello')
    limit 1;

    v_service_price := coalesce(p_service_price_ars, v_service_price, 25000);
    v_final_service_name := case when p_service_name = 'Corte' then 'Corte de cabello' else p_service_name end;
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
    if length(trim(coalesce(p_service_name, ''))) < 2 then
      raise exception 'INVALID_SERVICE_NAME';
    end if;
    if p_service_price_ars is null or p_service_price_ars <= 0 then
      raise exception 'OTHER_SERVICE_PRICE_REQUIRED';
    end if;
    v_service_price := p_service_price_ars;
    v_final_service_name := trim(p_service_name);
  end if;

  if v_discount < 0 or v_discount > v_service_price then
    raise exception 'INVALID_DISCOUNT_AMOUNT';
  end if;
  v_final_amount := v_service_price - v_discount;

  if p_online_deposit_paid then
    if p_appointment_id is not null then
      select coalesce(a.deposit_amount_ars, 5000)
      into v_deposit_amount
      from public.appointments a
      where a.id = p_appointment_id;
      if v_deposit_amount is null or v_deposit_amount = 0 then
        v_deposit_amount := 5000;
      end if;
    else
      v_deposit_amount := 5000;
    end if;
  else
    v_deposit_amount := 0;
  end if;

  v_collected_amount := greatest(0, v_final_amount - v_deposit_amount);

  if p_appointment_id is not null then
    if exists (select 1 from public.service_payments sp where sp.appointment_id = p_appointment_id) then
      raise exception 'APPOINTMENT_ALREADY_PAID';
    end if;
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
    p_payment_date,
    p_payment_time,
    p_payment_method,
    p_online_deposit_paid,
    v_deposit_amount,
    v_collected_amount,
    nullif(trim(coalesce(p_client_name, '')), ''),
    nullif(trim(coalesce(p_client_contact, '')), ''),
    p_appointment_id,
    v_origin,
    v_user_id,
    coalesce(v_display_name, 'Staff Kani')
  )
  returning * into v_new_payment;

  if p_appointment_id is not null then
    update public.appointments
    set balance_paid = true,
        updated_at = now()
    where id = p_appointment_id;
  end if;

  return query select
    v_new_payment.id,
    v_new_payment.barber_id,
    v_new_payment.service_id,
    v_new_payment.service_name,
    v_new_payment.service_other_detail,
    v_new_payment.service_price_ars,
    v_new_payment.discount_ars,
    v_new_payment.final_amount_ars,
    v_new_payment.payment_date,
    v_new_payment.payment_time,
    v_new_payment.payment_method,
    v_new_payment.online_deposit_paid,
    v_new_payment.online_deposit_amount_ars,
    v_new_payment.collected_amount_ars,
    v_new_payment.client_name,
    v_new_payment.client_contact,
    v_new_payment.appointment_id,
    v_new_payment.service_origin,
    v_new_payment.created_by_user_id,
    v_new_payment.created_by_display_name,
    v_new_payment.created_at,
    v_new_payment.updated_at;
end;
$$;

-- 5. Actualizar request_appointment para buscar servicio como 'Corte de cabello' o 'Corte'
CREATE OR REPLACE FUNCTION public.request_appointment(
  p_barber_name text,
  p_service_name text,
  p_booking_date date,
  p_start_time time,
  p_client_name text,
  p_client_phone text,
  p_client_email text,
  p_notes text DEFAULT NULL
)
RETURNS TABLE (
  appointment_id uuid,
  appointment_status public.appointment_status,
  booking_date date,
  start_time time,
  end_time time,
  request_number bigint,
  notification_claim_token text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
#variable_conflict use_column
DECLARE
  v_barber public.barbers%ROWTYPE;
  v_service public.services%ROWTYPE;
  v_client_id uuid;
  v_clean_name text := trim(coalesce(p_client_name, ''));
  v_clean_phone text := trim(coalesce(p_client_phone, ''));
  v_clean_email text := lower(trim(coalesce(p_client_email, '')));
  v_duration interval;
  v_start_at timestamp;
  v_end_at timestamp;
  v_last_segment integer;
  v_effective_price integer;
BEGIN
  IF p_barber_name IS NULL OR length(trim(p_barber_name)) = 0 THEN
    RAISE EXCEPTION USING errcode = '22023', message = 'BARBER_REQUIRED';
  END IF;
  IF p_service_name IS NULL OR length(trim(p_service_name)) = 0 THEN
    RAISE EXCEPTION USING errcode = '22023', message = 'SERVICE_REQUIRED';
  END IF;
  IF length(v_clean_name) < 2 THEN
    RAISE EXCEPTION USING errcode = '22023', message = 'CLIENT_NAME_INVALID';
  END IF;
  IF length(regexp_replace(v_clean_phone, '[^0-9]', '', 'g')) < 6 THEN
    RAISE EXCEPTION USING errcode = '22023', message = 'CLIENT_PHONE_INVALID';
  END IF;
  IF v_clean_email IS NULL OR position('@' in v_clean_email) <= 1 THEN
    RAISE EXCEPTION USING errcode = '22023', message = 'CLIENT_EMAIL_INVALID';
  END IF;
  IF p_booking_date < (timezone('America/Argentina/Buenos_Aires', clock_timestamp()))::date
     OR p_booking_date > (timezone('America/Argentina/Buenos_Aires', clock_timestamp()))::date + 21 THEN
    RAISE EXCEPTION USING errcode = '22023', message = 'BOOKING_DATE_OUT_OF_RANGE';
  END IF;
  IF p_start_time IS NULL
     OR extract(second from p_start_time) <> 0
     OR extract(minute from p_start_time)::int % 5 <> 0 THEN
    RAISE EXCEPTION USING errcode = '22023', message = 'START_TIME_NOT_ALLOWED';
  END IF;

  SELECT b.* INTO STRICT v_barber
  FROM public.barbers b
  WHERE b.name = trim(p_barber_name)
    AND b.active = true;

  SELECT s.* INTO STRICT v_service
  FROM public.services s
  WHERE (s.name = trim(p_service_name) OR (trim(p_service_name) in ('Corte', 'Corte de cabello') AND s.name in ('Corte', 'Corte de cabello')))
    AND s.active = true;

  v_duration := v_service.duration_minutes * interval '1 minute';
  v_start_at := (p_booking_date + p_start_time)::timestamp;
  v_end_at := v_start_at + v_duration;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_barber.id::text || '|' || p_booking_date::text, 0));

  IF NOT EXISTS (
    SELECT 1
    FROM public.barber_availability_slots bas
    WHERE bas.barber_id = v_barber.id
      AND bas.slot_date = p_booking_date
      AND bas.start_time = p_start_time
      AND bas.status = 'AVAILABLE'
      AND (
        v_service.name = ANY(bas.compatible_services)
        OR (v_service.name = 'Corte de cabello' AND 'Corte' = ANY(bas.compatible_services))
        OR (v_service.name = 'Corte' AND 'Corte de cabello' = ANY(bas.compatible_services))
      )
  ) THEN
    RAISE EXCEPTION USING errcode = 'P0001', message = 'SLOT_UNAVAILABLE';
  END IF;

  v_last_segment := (v_service.duration_minutes / 5) - 1;

  IF NOT (
    SELECT bool_and(covers.covered)
    FROM (
      SELECT requested.segment_index,
             EXISTS (
               SELECT 1
               FROM public.barber_availability_slots bas
               WHERE bas.barber_id = v_barber.id
                 AND bas.slot_date = p_booking_date
                 AND bas.status = 'AVAILABLE'
                 AND tsrange(
                   v_start_at + requested.segment_index * interval '5 minutes',
                   v_start_at + (requested.segment_index + 1) * interval '5 minutes',
                   '[)'
                 ) && tsrange(
                   (bas.slot_date + bas.start_time)::timestamp,
                   ((bas.slot_date + CASE WHEN bas.end_time <= bas.start_time THEN 1 ELSE 0 END) + bas.end_time)::timestamp,
                   '[)'
                 )
             ) AS covered
      FROM generate_series(0, v_last_segment) AS requested(segment_index)
    ) covers
  ) OR EXISTS (
    SELECT 1
    FROM generate_series(0, v_last_segment) AS requested(segment_index)
    WHERE EXISTS (
      SELECT 1
      FROM public.barber_availability_slots blocked
      WHERE blocked.barber_id = v_barber.id
        AND blocked.slot_date = p_booking_date
        AND blocked.status = 'UNAVAILABLE'
        AND tsrange(
          v_start_at + requested.segment_index * interval '5 minutes',
          v_start_at + (requested.segment_index + 1) * interval '5 minutes',
          '[)'
        ) && tsrange(
          (blocked.slot_date + blocked.start_time)::timestamp,
          ((blocked.slot_date + CASE WHEN blocked.end_time <= blocked.start_time THEN 1 ELSE 0 END) + blocked.end_time)::timestamp,
          '[)'
        )
    )
  ) THEN
    RAISE EXCEPTION USING errcode = 'P0001', message = 'SLOT_UNAVAILABLE';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.appointments a
    WHERE a.barber_id = v_barber.id
      AND a.booking_date = p_booking_date
      AND a.status <> 'CANCELLED'
      AND tsrange(
        (a.booking_date + a.start_time)::timestamp,
        ((a.booking_date + CASE WHEN a.end_time <= a.start_time THEN 1 ELSE 0 END) + a.end_time)::timestamp,
        '[)'
      ) && tsrange(v_start_at, v_end_at, '[)')
  ) THEN
    RAISE EXCEPTION USING errcode = 'P0001', message = 'SLOT_UNAVAILABLE';
  END IF;

  SELECT c.id INTO v_client_id
  FROM public.clients c
  WHERE c.email = v_clean_email
  LIMIT 1;

  IF v_client_id IS NULL THEN
    INSERT INTO public.clients (name, phone, email)
    VALUES (v_clean_name, v_clean_phone, v_clean_email)
    RETURNING id INTO v_client_id;
  ELSE
    UPDATE public.clients
    SET name = v_clean_name,
        phone = v_clean_phone,
        email = v_clean_email,
        deleted_at = NULL,
        updated_at = now()
    WHERE id = v_client_id;
  END IF;

  SELECT coalesce(
    (SELECT bsp.price_ars FROM public.barber_service_prices bsp WHERE bsp.barber_id = v_barber.id AND bsp.service_id = v_service.id AND bsp.active = true LIMIT 1),
    v_service.price_ars
  ) INTO v_effective_price;

  INSERT INTO public.appointments AS inserted (
    client_id,
    barber_id,
    service_id,
    booking_date,
    start_time,
    end_time,
    status,
    notes,
    booking_client_name,
    service_price_ars,
    deposit_amount_ars
  ) VALUES (
    v_client_id,
    v_barber.id,
    v_service.id,
    p_booking_date,
    p_start_time,
    v_end_at::time,
    'PENDING',
    nullif(trim(coalesce(p_notes, '')), ''),
    v_clean_name,
    v_effective_price,
    5000
  )
  RETURNING
    inserted.id,
    inserted.status,
    inserted.booking_date,
    inserted.start_time,
    inserted.end_time,
    inserted.request_number,
    public.create_appointment_notification_event(inserted.id, 'NEW_REQUEST'::notification_type)
  INTO
    appointment_id,
    appointment_status,
    booking_date,
    start_time,
    end_time,
    request_number,
    notification_claim_token;

  RETURN NEXT;
END;
$$;
