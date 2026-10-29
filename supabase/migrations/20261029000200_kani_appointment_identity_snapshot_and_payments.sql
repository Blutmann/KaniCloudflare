-- Migration: 20261029000200_kani_appointment_identity_snapshot_and_payments.sql
-- Kani Barber Studio — Admin V2: Integración definitiva de Payway con Pagos, Turnos e Identidad Histórica
-- 1. Snapshot inmutable del nombre de reserva en appointments (booking_client_name)
-- 2. Retrocompatibilidad y backfill de appointments existentes
-- 3. Actualización de request_appointment, create_manual_appointment y update_manual_appointment con snapshot
-- 4. RLS y lectura autorizada de payment_attempts para staff
-- 5. RPC get_online_deposit_movements para alimentar La cobranza con fecha efectiva de cobro

-- ==============================================================================
-- 1. SNAPSHOT INMUTABLE EN APPOINTMENTS
-- ==============================================================================

ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS booking_client_name text DEFAULT NULL;

-- Backfill seguro de registros históricos existentes desde clients si no tienen snapshot
UPDATE public.appointments a
SET booking_client_name = c.name
FROM public.clients c
WHERE a.client_id = c.id
  AND a.booking_client_name IS NULL;

-- ==============================================================================
-- 2. REQUEST_APPOINTMENT CON PRESERVACIÓN DE SNAPSHOT
-- ==============================================================================

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
  IF v_clean_email IS NOT NULL AND position('@' in v_clean_email) <= 1 THEN
    RAISE EXCEPTION USING errcode = '22023', message = 'CLIENT_EMAIL_INVALID';
  END IF;
  IF p_booking_date < (timezone('America/Argentina/Buenos_Aires', clock_timestamp()))::date
     OR p_booking_date > (timezone('America/Argentina/Buenos_Aires', clock_timestamp()))::date + 21 THEN
    RAISE EXCEPTION USING errcode = '22023', message = 'BOOKING_DATE_OUT_OF_RANGE';
  END IF;
  IF extract(isodow FROM p_booking_date) = 7 THEN
    RAISE EXCEPTION USING errcode = '22023', message = 'SUNDAY_CLOSED';
  END IF;
  IF p_start_time < time '10:00'
     OR p_start_time > time '19:00'
     OR extract(second FROM p_start_time) <> 0
     OR mod(extract(epoch FROM (p_start_time - time '10:00'))::integer, 2700) <> 0 THEN
    RAISE EXCEPTION USING errcode = '22023', message = 'START_TIME_NOT_ALLOWED';
  END IF;

  SELECT b.* INTO STRICT v_barber
  FROM public.barbers b
  WHERE b.name = trim(p_barber_name)
    AND b.active = true;

  SELECT s.* INTO STRICT v_service
  FROM public.services s
  WHERE s.name = trim(p_service_name)
    AND s.active = true;

  v_duration := v_service.duration_minutes * interval '1 minute';
  v_start_at := p_booking_date + p_start_time;
  v_end_at := v_start_at + v_duration;

  IF v_end_at::date <> p_booking_date OR v_end_at::time > time '20:00' THEN
    RAISE EXCEPTION USING errcode = '22023', message = 'SERVICE_EXCEEDS_CLOSING_TIME';
  END IF;

  v_last_segment := ceil(v_service.duration_minutes / 45.0)::integer - 1;
  IF NOT EXISTS (
    SELECT 1
    FROM public.availability_starts
    WHERE barber_id = v_barber.id
      AND slot_date = p_booking_date
      AND start_time = p_start_time
      AND segment_index = 0
  ) OR (
    v_last_segment > 0 AND NOT EXISTS (
      SELECT 1
      FROM public.availability_starts
      WHERE barber_id = v_barber.id
        AND slot_date = p_booking_date
        AND start_time = (p_start_time + v_last_segment * interval '45 minutes')::time
        AND segment_index = v_last_segment
    )
  ) THEN
    RAISE EXCEPTION USING errcode = '22023', message = 'START_TIME_UNAVAILABLE';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_barber.id::text || '|' || p_booking_date::text, 0));

  IF EXISTS (
    SELECT 1
    FROM public.appointments existing
    WHERE existing.barber_id = v_barber.id
      AND existing.booking_date = p_booking_date
      AND existing.status IN ('PENDING', 'CONFIRMED', 'COMPLETED')
      AND (
        existing.status <> 'PENDING'
        OR existing.created_at + interval '10 minutes' > clock_timestamp()
      )
      AND existing.start_time < v_end_at::time
      AND existing.end_time > p_start_time
  ) THEN
    RAISE EXCEPTION USING errcode = '23505', message = 'APPOINTMENT_COLLISION';
  END IF;

  -- Resolver o consolidar contacto
  v_client_id := public.find_or_create_consolidated_client(
    v_clean_name,
    v_clean_phone,
    v_clean_email
  );

  INSERT INTO public.appointments AS inserted (
    client_id,
    barber_id,
    service_id,
    booking_date,
    start_time,
    end_time,
    status,
    notes,
    booking_client_name
  ) VALUES (
    v_client_id,
    v_barber.id,
    v_service.id,
    p_booking_date,
    p_start_time,
    v_end_at::time,
    'PENDING',
    nullif(trim(coalesce(p_notes, '')), ''),
    v_clean_name
  )
  RETURNING inserted.id,
            inserted.status,
            inserted.booking_date,
            inserted.start_time,
            inserted.end_time,
            inserted.request_number
  INTO appointment_id,
       appointment_status,
       booking_date,
       start_time,
       end_time,
       request_number;

  RETURN NEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION public.request_appointment TO anon, authenticated;

-- ==============================================================================
-- 3. CREATE_MANUAL_APPOINTMENT CON PRESERVACIÓN DE SNAPSHOT
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.create_manual_appointment(
  p_barber_id uuid,
  p_service_id uuid DEFAULT NULL,
  p_custom_service_name text DEFAULT NULL,
  p_service_price_ars integer DEFAULT NULL,
  p_booking_date date DEFAULT NULL,
  p_start_time time DEFAULT NULL,
  p_end_time time DEFAULT NULL,
  p_client_name text DEFAULT NULL,
  p_client_phone text DEFAULT NULL,
  p_client_email text DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_is_recurring boolean DEFAULT false,
  p_duration_minutes integer DEFAULT NULL,
  p_deposit_required boolean DEFAULT false,
  p_client_id uuid DEFAULT NULL
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
DECLARE
  v_staff_barber_id uuid;
  v_is_admin boolean;
  v_creator_user_id uuid := auth.uid();
  v_creator_name text;
  v_barber public.barbers%ROWTYPE;
  v_service public.services%ROWTYPE;
  v_duration_min integer;
  v_duration interval;
  v_end_time time;
  v_start_ts timestamp;
  v_end_ts timestamp;
  v_client_id uuid;
  v_apt_id uuid;
  v_req_num bigint;
  v_clean_name text;
  v_clean_email text;
  v_clean_phone text;
  v_final_service_name text;
  v_final_price integer;
  v_conflict_start time;
  v_conflict_end time;
BEGIN
  IF v_creator_user_id IS NULL THEN
    RAISE EXCEPTION USING errcode = '42501', message = 'AUTH_REQUIRED';
  END IF;

  v_is_admin := public.is_admin();
  v_staff_barber_id := public.current_staff_barber_id();

  IF NOT v_is_admin AND (v_staff_barber_id IS NULL OR v_staff_barber_id IS DISTINCT FROM p_barber_id) THEN
    RAISE EXCEPTION USING errcode = '42501', message = 'MANUAL_APPOINTMENT_NOT_ALLOWED';
  END IF;

  IF v_is_admin THEN
    v_creator_name := 'Admin';
  ELSE
    SELECT b.name INTO v_creator_name FROM public.barbers b WHERE b.id = v_staff_barber_id;
    v_creator_name := coalesce(v_creator_name, 'Barbero');
  END IF;

  IF p_barber_id IS NULL THEN RAISE EXCEPTION USING errcode = '22023', message = 'BARBER_REQUIRED'; END IF;
  IF p_booking_date IS NULL THEN RAISE EXCEPTION USING errcode = '22023', message = 'DATE_REQUIRED'; END IF;
  IF p_start_time IS NULL THEN RAISE EXCEPTION USING errcode = '22023', message = 'START_TIME_REQUIRED'; END IF;

  SELECT b.* INTO STRICT v_barber
  FROM public.barbers b
  WHERE b.id = p_barber_id AND b.active = true;

  IF p_service_id IS NOT NULL THEN
    SELECT s.* INTO STRICT v_service
    FROM public.services s
    WHERE s.id = p_service_id AND s.active = true;
    v_final_service_name := v_service.name;
    v_final_price := coalesce(p_service_price_ars, v_service.price_ars);
    v_duration_min := coalesce(p_duration_minutes, v_service.duration_minutes, 45);
  ELSE
    v_final_service_name := nullif(trim(coalesce(p_custom_service_name, '')), '');
    IF v_final_service_name IS NULL THEN
      RAISE EXCEPTION USING errcode = '22023', message = 'CUSTOM_SERVICE_NAME_REQUIRED';
    END IF;
    v_final_price := coalesce(p_service_price_ars, 0);
    v_duration_min := coalesce(p_duration_minutes, 45);
  END IF;

  IF v_duration_min <= 0 THEN
    v_duration_min := 45;
  END IF;

  IF p_end_time IS NOT NULL THEN
    v_end_time := p_end_time;
  ELSE
    v_start_ts := p_booking_date + p_start_time;
    v_end_ts := v_start_ts + (v_duration_min * interval '1 minute');
    v_end_time := v_end_ts::time;
  END IF;

  v_clean_name := trim(coalesce(p_client_name, ''));
  IF length(v_clean_name) < 2 THEN
    RAISE EXCEPTION USING errcode = '22023', message = 'CLIENT_NAME_INVALID';
  END IF;

  v_clean_phone := trim(coalesce(p_client_phone, ''));
  IF length(regexp_replace(v_clean_phone, '[^0-9]', '', 'g')) < 6 THEN
    RAISE EXCEPTION USING errcode = '22023', message = 'CLIENT_PHONE_INVALID';
  END IF;

  v_clean_email := nullif(lower(trim(coalesce(p_client_email, ''))), '');
  IF v_clean_email IS NOT NULL AND position('@' in v_clean_email) <= 1 THEN
    v_clean_email := NULL;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_barber.id::text || '|' || p_booking_date::text, 0));

  SELECT existing.start_time, existing.end_time
  INTO v_conflict_start, v_conflict_end
  FROM public.appointments existing
  WHERE existing.barber_id = v_barber.id
    AND existing.booking_date = p_booking_date
    AND existing.status IN ('CONFIRMED', 'COMPLETED', 'PENDING')
    AND (
      existing.status <> 'PENDING'
      OR existing.created_at + interval '10 minutes' > clock_timestamp()
    )
    AND (
      (v_end_time > p_start_time AND existing.start_time < v_end_time AND existing.end_time > p_start_time)
      OR (v_end_time <= p_start_time AND (existing.start_time >= p_start_time OR existing.end_time <= v_end_time))
    )
  ORDER BY existing.start_time ASC
  LIMIT 1;

  IF v_conflict_start IS NOT NULL THEN
    RAISE EXCEPTION USING errcode = '23505',
      message = 'APPOINTMENT_COLLISION_DETAILS|' || v_conflict_start::text || '|' || v_conflict_end::text;
  END IF;

  IF p_client_id IS NOT NULL THEN
    v_client_id := p_client_id;
  ELSE
    v_client_id := public.find_or_create_consolidated_client(
      v_clean_name,
      v_clean_phone,
      v_clean_email
    );
  END IF;

  INSERT INTO public.appointments (
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
    deposit_paid,
    booking_client_name
  ) VALUES (
    v_client_id,
    v_barber.id,
    p_service_id,
    CASE WHEN p_service_id IS NULL THEN v_final_service_name ELSE NULL END,
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
    false,
    v_clean_name
  )
  RETURNING id, status, booking_date, start_time, end_time, request_number
  INTO v_apt_id, appointment_status, booking_date, start_time, end_time, v_req_num;

  RETURN QUERY SELECT
    v_apt_id,
    appointment_status,
    booking_date,
    start_time,
    end_time,
    v_req_num,
    true,
    'MANUAL'::text,
    v_creator_name,
    v_final_service_name,
    v_final_price;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_manual_appointment TO authenticated;

-- ==============================================================================
-- 4. UPDATE_MANUAL_APPOINTMENT CON ACTUALIZACIÓN DE SNAPSHOT
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.update_manual_appointment(
  p_appointment_id uuid,
  p_barber_id uuid,
  p_service_id uuid DEFAULT NULL,
  p_custom_service_name text DEFAULT NULL,
  p_service_price_ars integer DEFAULT NULL,
  p_booking_date date DEFAULT NULL,
  p_start_time time DEFAULT NULL,
  p_end_time time DEFAULT NULL,
  p_client_name text DEFAULT NULL,
  p_client_phone text DEFAULT NULL,
  p_client_email text DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_duration_minutes integer DEFAULT NULL
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
DECLARE
  v_appt public.appointments%ROWTYPE;
  v_service public.services%ROWTYPE;
  v_is_admin boolean;
  v_staff_barber_id uuid;
  v_duration_min integer;
  v_duration interval;
  v_end_time time;
  v_start_ts timestamp;
  v_end_ts timestamp;
  v_clean_name text;
  v_clean_email text;
  v_clean_phone text;
  v_final_service_name text;
  v_final_price integer;
  v_conflict_start time;
  v_conflict_end time;
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN
    RAISE EXCEPTION USING errcode = '42501', message = 'AUTH_REQUIRED';
  END IF;

  v_is_admin := public.is_admin();
  v_staff_barber_id := public.current_staff_barber_id();

  SELECT * INTO v_appt
  FROM public.appointments
  WHERE id = p_appointment_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING errcode = '22023', message = 'APPOINTMENT_NOT_FOUND';
  END IF;

  IF NOT v_is_admin THEN
    IF v_staff_barber_id IS NULL OR v_appt.barber_id IS DISTINCT FROM v_staff_barber_id THEN
      RAISE EXCEPTION USING errcode = '42501', message = 'MANUAL_APPOINTMENT_NOT_ALLOWED';
    END IF;
    IF p_barber_id IS DISTINCT FROM v_staff_barber_id THEN
      RAISE EXCEPTION USING errcode = '42501', message = 'CANNOT_ASSIGN_OTHER_BARBER';
    END IF;
  END IF;

  IF p_service_id IS NOT NULL THEN
    SELECT s.* INTO STRICT v_service
    FROM public.services s
    WHERE s.id = p_service_id AND s.active = true;
    v_final_service_name := v_service.name;
    v_final_price := coalesce(p_service_price_ars, v_service.price_ars);
    v_duration_min := coalesce(p_duration_minutes, v_service.duration_minutes, 45);
  ELSE
    v_final_service_name := nullif(trim(coalesce(p_custom_service_name, '')), '');
    IF v_final_service_name IS NULL THEN
      v_final_service_name := coalesce(v_appt.custom_service_name, 'Otro');
    END IF;
    v_final_price := coalesce(p_service_price_ars, v_appt.service_price_ars, 0);
    v_duration_min := coalesce(p_duration_minutes, 45);
  END IF;

  IF v_duration_min <= 0 THEN
    v_duration_min := 45;
  END IF;

  IF p_end_time IS NOT NULL THEN
    v_end_time := p_end_time;
  ELSE
    v_start_ts := p_booking_date + p_start_time;
    v_end_ts := v_start_ts + (v_duration_min * interval '1 minute');
    v_end_time := v_end_ts::time;
  END IF;

  v_clean_name := trim(coalesce(p_client_name, ''));

  PERFORM pg_advisory_xact_lock(hashtextextended(p_barber_id::text || '|' || p_booking_date::text, 0));

  SELECT existing.start_time, existing.end_time
  INTO v_conflict_start, v_conflict_end
  FROM public.appointments existing
  WHERE existing.barber_id = p_barber_id
    AND existing.booking_date = p_booking_date
    AND existing.id <> p_appointment_id
    AND existing.status IN ('CONFIRMED', 'COMPLETED', 'PENDING')
    AND (
      existing.status <> 'PENDING'
      OR existing.created_at + interval '10 minutes' > clock_timestamp()
    )
    AND (
      (v_end_time > p_start_time AND existing.start_time < v_end_time AND existing.end_time > p_start_time)
      OR (v_end_time <= p_start_time AND (existing.start_time >= p_start_time OR existing.end_time <= v_end_time))
    )
  ORDER BY existing.start_time ASC
  LIMIT 1;

  IF v_conflict_start IS NOT NULL THEN
    RAISE EXCEPTION USING errcode = '23505',
      message = 'APPOINTMENT_COLLISION_DETAILS|' || v_conflict_start::text || '|' || v_conflict_end::text;
  END IF;

  v_clean_phone := trim(coalesce(p_client_phone, ''));
  v_clean_email := nullif(lower(trim(coalesce(p_client_email, ''))), '');

  IF length(v_clean_name) >= 2 AND length(regexp_replace(v_clean_phone, '[^0-9]', '', 'g')) >= 6 THEN
    UPDATE public.clients
    SET name = v_clean_name,
        phone = v_clean_phone,
        email = coalesce(v_clean_email, email),
        updated_at = now()
    WHERE id = v_appt.client_id;
  END IF;

  UPDATE public.appointments
  SET barber_id = p_barber_id,
      service_id = p_service_id,
      custom_service_name = CASE WHEN p_service_id IS NULL THEN v_final_service_name ELSE NULL END,
      service_price_ars = v_final_price,
      booking_date = p_booking_date,
      start_time = p_start_time,
      end_time = v_end_time,
      notes = nullif(trim(coalesce(p_notes, '')), ''),
      booking_client_name = CASE WHEN length(v_clean_name) >= 2 THEN v_clean_name ELSE booking_client_name END,
      updated_at = now()
  WHERE id = p_appointment_id
  RETURNING id, status, booking_date, start_time, end_time, request_number
  INTO appointment_id, appointment_status, booking_date, start_time, end_time, request_number;

  RETURN QUERY SELECT
    appointment_id,
    appointment_status,
    booking_date,
    start_time,
    end_time,
    request_number,
    v_appt.is_manual,
    v_appt.origin,
    v_appt.created_by_display_name,
    v_final_service_name,
    v_final_price;
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_manual_appointment TO authenticated;

-- ==============================================================================
-- 5. RLS EN PAYMENT_ATTEMPTS PARA STAFF
-- ==============================================================================

DROP POLICY IF EXISTS payment_attempts_admin_read ON public.payment_attempts;
DROP POLICY IF EXISTS payment_attempts_staff_read ON public.payment_attempts;

CREATE POLICY payment_attempts_staff_read
  ON public.payment_attempts
  FOR SELECT
  TO authenticated
  USING (
    public.is_admin()
    OR EXISTS (
      SELECT 1 FROM public.appointments a
      WHERE a.id = payment_attempts.appointment_id
        AND a.barber_id = public.current_staff_barber_id()
    )
  );

-- ==============================================================================
-- 6. RPC GET_ONLINE_DEPOSIT_MOVEMENTS
-- Permite consultar señas online efectivamente cobradas según su FECHA REAL DE PAGO
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.get_online_deposit_movements(
  p_barber_id uuid DEFAULT NULL,
  p_start_date date DEFAULT NULL,
  p_end_date date DEFAULT NULL
)
RETURNS TABLE (
  movement_id text,
  appointment_id uuid,
  provider text,
  amount_ars numeric,
  payment_date date,
  payment_time text,
  payment_timestamp timestamptz,
  barber_id uuid,
  barber_name text,
  service_name text,
  client_name text,
  client_contact text,
  appointment_date date,
  appointment_time text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
DECLARE
  v_is_admin boolean := public.is_admin();
  v_staff_barber_id uuid := public.current_staff_barber_id();
  v_filter_barber uuid;
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN
    RAISE EXCEPTION USING errcode = '42501', message = 'AUTH_REQUIRED';
  END IF;

  IF NOT v_is_admin THEN
    IF v_staff_barber_id IS NULL THEN
      RAISE EXCEPTION USING errcode = '42501', message = 'FORBIDDEN_STAFF_REQUIRED';
    END IF;
    v_filter_barber := v_staff_barber_id;
  ELSE
    v_filter_barber := p_barber_id;
  END IF;

  RETURN QUERY
  SELECT
    ('deposit-' || coalesce(pa.id::text, a.id::text))::text AS movement_id,
    a.id AS appointment_id,
    coalesce(pa.provider, 'PAYWAY')::text AS provider,
    coalesce(pa.amount_ars, a.deposit_amount_ars::numeric, 5000::numeric) AS amount_ars,
    (timezone('America/Argentina/Buenos_Aires', coalesce(pa.created_at, a.created_at)))::date AS payment_date,
    to_char(timezone('America/Argentina/Buenos_Aires', coalesce(pa.created_at, a.created_at)), 'HH24:MI') AS payment_time,
    coalesce(pa.created_at, a.created_at) AS payment_timestamp,
    a.barber_id,
    coalesce(b.name, 'Barbero')::text AS barber_name,
    ('Seña — ' || coalesce(a.custom_service_name, s.name, 'Servicio'))::text AS service_name,
    coalesce(a.booking_client_name, c.name, 'Cliente')::text AS client_name,
    coalesce(c.phone, '')::text AS client_contact,
    a.booking_date AS appointment_date,
    to_char(a.start_time, 'HH24:MI') AS appointment_time
  FROM public.appointments a
  LEFT JOIN public.payment_attempts pa
    ON pa.appointment_id = a.id
   AND pa.state = 'APPROVED'
  JOIN public.barbers b ON b.id = a.barber_id
  LEFT JOIN public.services s ON s.id = a.service_id
  LEFT JOIN public.clients c ON c.id = a.client_id
  WHERE (a.deposit_paid = true OR pa.state = 'APPROVED')
    AND (v_filter_barber IS NULL OR a.barber_id = v_filter_barber)
    AND (
      p_start_date IS NULL
      OR (timezone('America/Argentina/Buenos_Aires', coalesce(pa.created_at, a.created_at)))::date >= p_start_date
    )
    AND (
      p_end_date IS NULL
      OR (timezone('America/Argentina/Buenos_Aires', coalesce(pa.created_at, a.created_at)))::date <= p_end_date
    )
  ORDER BY coalesce(pa.created_at, a.created_at) DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_online_deposit_movements TO authenticated;
