-- Migration: Corrección inequívoca de ambigüedad en turnos manuales y modelo de horarios de 45 minutos con soporte de medianoche
-- Target: iockpxtkflyjfagkvgnr (Supabase Test)

-- ==============================================================================
-- 1. TURNOS MANUALES: Corrección de ambigüedad "booking_date is ambiguous"
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
  v_end_time time;
  v_start_ts timestamp;
  v_end_ts timestamp;
  v_client_id uuid;
  v_clean_name text;
  v_clean_email text;
  v_clean_phone text;
  v_final_service_name text;
  v_final_price integer;
  v_conflict_start time;
  v_conflict_end time;

  -- Variables locales dedicadas para recibir RETURNING y evitar colisión con OUT params
  v_res_apt_id uuid;
  v_res_status public.appointment_status;
  v_res_booking_date date;
  v_res_start_time time;
  v_res_end_time time;
  v_res_req_num bigint;
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

  -- Inserción calificada inequívocamente sin colisión con OUT parameters
  INSERT INTO public.appointments AS a (
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
  RETURNING a.id, a.status, a.booking_date, a.start_time, a.end_time, a.request_number
  INTO v_res_apt_id, v_res_status, v_res_booking_date, v_res_start_time, v_res_end_time, v_res_req_num;

  RETURN QUERY SELECT
    v_res_apt_id,
    v_res_status,
    v_res_booking_date,
    v_res_start_time,
    v_res_end_time,
    v_res_req_num,
    true,
    'MANUAL'::text,
    v_creator_name,
    v_final_service_name,
    v_final_price;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_manual_appointment TO authenticated;

-- Corrección para update_manual_appointment
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
  v_staff_barber_id uuid;
  v_is_admin boolean;
  v_appt public.appointments%ROWTYPE;
  v_barber public.barbers%ROWTYPE;
  v_service public.services%ROWTYPE;
  v_duration_min integer;
  v_end_time time;
  v_start_ts timestamp;
  v_end_ts timestamp;
  v_clean_name text;
  v_clean_phone text;
  v_clean_email text;
  v_final_service_name text;
  v_final_price integer;
  v_conflict_start time;
  v_conflict_end time;

  v_res_apt_id uuid;
  v_res_status public.appointment_status;
  v_res_booking_date date;
  v_res_start_time time;
  v_res_end_time time;
  v_res_req_num bigint;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION USING errcode = '42501', message = 'AUTH_REQUIRED';
  END IF;

  v_is_admin := public.is_admin();
  v_staff_barber_id := public.current_staff_barber_id();

  SELECT a.* INTO STRICT v_appt
  FROM public.appointments a
  WHERE a.id = p_appointment_id;

  IF NOT v_is_admin AND (v_staff_barber_id IS NULL OR (v_staff_barber_id IS DISTINCT FROM v_appt.barber_id AND v_staff_barber_id IS DISTINCT FROM p_barber_id)) THEN
    RAISE EXCEPTION USING errcode = '42501', message = 'MANUAL_APPOINTMENT_NOT_ALLOWED';
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
  v_clean_phone := trim(coalesce(p_client_phone, ''));
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

  IF v_appt.client_id IS NOT NULL AND (length(v_clean_name) >= 2 OR length(regexp_replace(v_clean_phone, '[^0-9]', '', 'g')) >= 6) THEN
    UPDATE public.clients
    SET full_name = CASE WHEN length(v_clean_name) >= 2 THEN v_clean_name ELSE full_name END,
        phone = CASE WHEN length(regexp_replace(v_clean_phone, '[^0-9]', '', 'g')) >= 6 THEN v_clean_phone ELSE phone END,
        email = coalesce(v_clean_email, email),
        updated_at = now()
    WHERE id = v_appt.client_id;
  END IF;

  UPDATE public.appointments AS a
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
  WHERE a.id = p_appointment_id
  RETURNING a.id, a.status, a.booking_date, a.start_time, a.end_time, a.request_number
  INTO v_res_apt_id, v_res_status, v_res_booking_date, v_res_start_time, v_res_end_time, v_res_req_num;

  RETURN QUERY SELECT
    v_res_apt_id,
    v_res_status,
    v_res_booking_date,
    v_res_start_time,
    v_res_end_time,
    v_res_req_num,
    v_appt.is_manual,
    v_appt.origin,
    v_appt.created_by_display_name,
    v_final_service_name,
    v_final_price;
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_manual_appointment TO authenticated;

-- ==============================================================================
-- 2. HORARIOS: Modelo exacto de 45 min, persistencia sin fusión no deseada y medianoche
-- ==============================================================================

-- Ajuste de constraints para permitir medianoche (end_time = '00:00:00') de forma válida
ALTER TABLE public.barber_availability_slots
  DROP CONSTRAINT IF EXISTS availability_interval_valid,
  DROP CONSTRAINT IF EXISTS availability_minimum_interval,
  DROP CONSTRAINT IF EXISTS availability_end_granularity;

ALTER TABLE public.barber_availability_slots
  ADD CONSTRAINT availability_interval_valid
    CHECK (end_time > start_time OR end_time = time '00:00:00'),
  ADD CONSTRAINT availability_minimum_interval
    CHECK ((end_time > start_time AND end_time - start_time >= interval '5 minutes') OR (end_time = time '00:00:00' AND start_time <= time '23:55:00')),
  ADD CONSTRAINT availability_end_granularity
    CHECK (extract(second from end_time) = 0 AND (extract(minute from end_time)::int % 5 = 0 OR end_time = time '00:00:00'));

-- Actualización de create_availability_slots
CREATE OR REPLACE FUNCTION public.create_availability_slots(
  p_barber_id uuid,
  p_slot_dates date[],
  p_start_time time,
  p_end_time time DEFAULT NULL
)
RETURNS SETOF public.barber_availability_slots
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
DECLARE
  v_date date;
  v_today date := (timezone('America/Argentina/Buenos_Aires', clock_timestamp()))::date;
  v_end_time time;
  v_existing public.barber_availability_slots%ROWTYPE;
  v_slot public.barber_availability_slots%ROWTYPE;
  v_conflict_apt record;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION USING errcode = '42501', message = 'AUTH_REQUIRED';
  END IF;

  IF NOT public.is_admin() AND public.current_staff_barber_id() IS DISTINCT FROM p_barber_id THEN
    RAISE EXCEPTION USING errcode = '42501', message = 'AVAILABILITY_NOT_ALLOWED';
  END IF;

  IF NOT exists (SELECT 1 FROM public.barbers b WHERE b.id = p_barber_id AND b.active = true) THEN
    RAISE EXCEPTION USING errcode = '22023', message = 'BARBER_NOT_FOUND';
  END IF;

  IF p_slot_dates IS NULL OR cardinality(p_slot_dates) = 0 THEN
    RAISE EXCEPTION USING errcode = '22023', message = 'DATE_REQUIRED';
  END IF;

  IF p_start_time IS NULL
     OR extract(second from p_start_time) <> 0
     OR p_start_time < time '00:00'
     OR p_start_time > time '23:59'
     OR (extract(minute from p_start_time)::int % 5 <> 0 AND p_start_time <> time '00:00') THEN
    RAISE EXCEPTION USING errcode = '22023', message = 'START_TIME_NOT_ALLOWED';
  END IF;

  -- Valida fin: permite '00:00:00' si start_time > '00:00:00' (cruce de medianoche a las 45m de 23:15)
  IF p_end_time IS NOT NULL
     AND (extract(second from p_end_time) <> 0
       OR (extract(minute from p_end_time)::int % 5 <> 0)
       OR (p_end_time <= p_start_time AND p_end_time <> time '00:00:00')
       OR p_end_time > time '23:59') THEN
    RAISE EXCEPTION USING errcode = '22023', message = 'END_TIME_INVALID';
  END IF;

  -- Si no se suministra end_time, se calcula la duración operativa exacta de 45 minutos
  v_end_time := coalesce(
    p_end_time,
    (p_start_time + interval '45 minutes')::time
  );

  FOREACH v_date IN ARRAY p_slot_dates LOOP
    IF v_date IS NULL OR v_date < v_today OR extract(isodow from v_date) = 7 THEN
      RAISE EXCEPTION USING errcode = '22023', message = 'AVAILABILITY_DATE_INVALID';
    END IF;

    PERFORM pg_advisory_xact_lock(hashtextextended(p_barber_id::text || '|' || v_date::text, 0));

    -- Verificar slot existente para este barbero, fecha e inicio exacto
    SELECT s.* INTO v_existing
    FROM public.barber_availability_slots s
    WHERE s.barber_id = p_barber_id
      AND s.slot_date = v_date
      AND s.start_time = p_start_time
    LIMIT 1;

    -- Validar colisión con turnos existentes reportando detalles exactos
    SELECT a.start_time, a.end_time, b.name INTO v_conflict_apt
    FROM public.appointments a
    JOIN public.barbers b ON b.id = a.barber_id
    WHERE a.barber_id = p_barber_id
      AND a.booking_date = v_date
      AND a.status <> 'CANCELLED'
      AND tsrange(
        v_date + p_start_time,
        (v_date + CASE WHEN v_end_time <= p_start_time THEN 1 ELSE 0 END) + v_end_time,
        '[)'
      ) && tsrange(
        a.booking_date + a.start_time,
        (a.booking_date + CASE WHEN a.end_time <= a.start_time THEN 1 ELSE 0 END) + a.end_time,
        '[)'
      )
    ORDER BY a.start_time
    LIMIT 1;

    IF found THEN
      RAISE EXCEPTION USING errcode = '23P01', message = 'AVAILABILITY_APPOINTMENT_CONFLICT:' || v_conflict_apt.name || ':' || to_char(v_conflict_apt.start_time, 'HH24:MI') || ':' || to_char(v_conflict_apt.end_time, 'HH24:MI');
    END IF;

    -- Validar colisión con franjas expresamente bloqueadas (UNAVAILABLE)
    IF exists (
      SELECT 1 FROM public.barber_availability_slots s
      WHERE s.barber_id = p_barber_id
        AND s.slot_date = v_date
        AND s.status = 'UNAVAILABLE'
        AND tsrange(
          v_date + p_start_time,
          (v_date + CASE WHEN v_end_time <= p_start_time THEN 1 ELSE 0 END) + v_end_time,
          '[)'
        ) && tsrange(
          s.slot_date + s.start_time,
          (s.slot_date + CASE WHEN s.end_time <= s.start_time THEN 1 ELSE 0 END) + s.end_time,
          '[)'
        )
    ) THEN
      RAISE EXCEPTION USING errcode = '23P01', message = 'AVAILABILITY_BLOCKED_START';
    END IF;

    -- Si ya existe este inicio exacto, actualizar a disponible con el fin correspondiente
    IF v_existing.id IS NOT NULL THEN
      UPDATE public.barber_availability_slots
      SET end_time = v_end_time,
          status = 'AVAILABLE',
          updated_by = auth.uid(),
          updated_at = now()
      WHERE id = v_existing.id
      RETURNING * INTO v_slot;

      RETURN NEXT v_slot;
      CONTINUE;
    END IF;

    -- Inserción independiente sin fusionar con slots adyacentes
    INSERT INTO public.barber_availability_slots (
      barber_id, slot_date, start_time, end_time, status, updated_by
    ) VALUES (
      p_barber_id, v_date, p_start_time, v_end_time, 'AVAILABLE', auth.uid()
    ) RETURNING * INTO v_slot;

    RETURN NEXT v_slot;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.create_availability_slots(uuid, date[], time, time) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_availability_slots(uuid, date[], time, time) TO authenticated;

-- Actualización de update_availability_slot con soporte de tsrange para medianoche
CREATE OR REPLACE FUNCTION public.update_availability_slot(
  p_slot_id uuid,
  p_status public.availability_status,
  p_internal_note text DEFAULT NULL
)
RETURNS SETOF public.barber_availability_slots
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
DECLARE
  v_barber_id uuid;
  v_slot_date date;
  v_slot public.barber_availability_slots%ROWTYPE;
  v_conflict_apt record;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION USING errcode = '42501', message = 'AUTH_REQUIRED';
  END IF;

  IF p_internal_note IS NOT NULL AND length(p_internal_note) > 500 THEN
    RAISE EXCEPTION USING errcode = '22023', message = 'INTERNAL_NOTE_TOO_LONG';
  END IF;

  SELECT s.barber_id, s.slot_date INTO v_barber_id, v_slot_date
  FROM public.barber_availability_slots s
  WHERE s.id = p_slot_id
    AND (public.is_admin() OR s.barber_id = public.current_staff_barber_id());

  IF NOT found THEN
    RAISE EXCEPTION USING errcode = '42501', message = 'AVAILABILITY_NOT_ALLOWED';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_barber_id::text || '|' || v_slot_date::text, 0));

  SELECT s.* INTO v_slot
  FROM public.barber_availability_slots s
  WHERE s.id = p_slot_id
  FOR UPDATE;

  IF NOT found THEN
    RAISE EXCEPTION USING errcode = 'P0002', message = 'AVAILABILITY_NOT_FOUND';
  END IF;

  -- Comprobar conflicto con turno existente usando tsrange para soportar cruce de medianoche
  SELECT a.start_time, a.end_time, b.name INTO v_conflict_apt
  FROM public.appointments a
  JOIN public.barbers b ON b.id = a.barber_id
  WHERE a.barber_id = v_slot.barber_id
    AND a.booking_date = v_slot.slot_date
    AND a.status <> 'CANCELLED'
    AND tsrange(
      a.booking_date + a.start_time,
      (a.booking_date + CASE WHEN a.end_time <= a.start_time THEN 1 ELSE 0 END) + a.end_time,
      '[)'
    ) && tsrange(
      v_slot.slot_date + v_slot.start_time,
      (v_slot.slot_date + CASE WHEN v_slot.end_time <= v_slot.start_time THEN 1 ELSE 0 END) + v_slot.end_time,
      '[)'
    )
  ORDER BY a.start_time ASC
  LIMIT 1;

  IF found AND p_status = 'UNAVAILABLE' THEN
    RAISE EXCEPTION USING errcode = '23P01', message = 'AVAILABILITY_APPOINTMENT_CONFLICT:' || v_conflict_apt.name || ':' || to_char(v_conflict_apt.start_time, 'HH24:MI') || ':' || to_char(v_conflict_apt.end_time, 'HH24:MI');
  END IF;

  UPDATE public.barber_availability_slots
  SET status = p_status,
      internal_note = nullif(trim(p_internal_note), ''),
      updated_by = auth.uid(),
      updated_at = now()
  WHERE id = p_slot_id
  RETURNING * INTO v_slot;

  RETURN NEXT v_slot;
END;
$$;

REVOKE ALL ON FUNCTION public.update_availability_slot(uuid, public.availability_status, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_availability_slot(uuid, public.availability_status, text) TO authenticated;

-- Actualización de read_valid_availability_starts con soporte de tsrange para medianoche
CREATE OR REPLACE FUNCTION public.read_valid_availability_starts(
  p_barber_id uuid DEFAULT NULL,
  p_from_date date DEFAULT NULL,
  p_to_date date DEFAULT NULL
)
RETURNS TABLE (
  barber_id uuid,
  slot_date date,
  start_time time,
  is_exception boolean,
  compatible_services text[]
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
DECLARE
  v_from date := coalesce(p_from_date, (timezone('America/Argentina/Buenos_Aires', clock_timestamp()))::date);
  v_to date := coalesce(p_to_date, v_from + 21);
  v_staff_barber_id uuid := public.current_staff_barber_id();
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_admin() AND v_staff_barber_id IS NULL THEN
    RAISE EXCEPTION USING errcode = '42501', message = 'AVAILABILITY_NOT_ALLOWED';
  END IF;
  IF auth.uid() IS NOT NULL AND NOT public.is_admin() AND (p_barber_id IS NULL OR p_barber_id IS DISTINCT FROM v_staff_barber_id) THEN
    RAISE EXCEPTION USING errcode = '42501', message = 'AVAILABILITY_NOT_ALLOWED';
  END IF;
  IF v_from > v_to THEN
    RAISE EXCEPTION USING errcode = '22023', message = 'DATE_RANGE_INVALID';
  END IF;

  RETURN QUERY
  WITH available_slots AS (
    SELECT s.barber_id, s.slot_date, s.start_time, s.end_time
    FROM public.barber_availability_slots s
    JOIN public.barbers b ON b.id = s.barber_id AND b.active = true
    WHERE s.status = 'AVAILABLE'
      AND s.slot_date BETWEEN v_from AND v_to
      AND (p_barber_id IS NULL OR s.barber_id = p_barber_id)
      AND (s.end_time > s.start_time OR s.end_time = time '00:00:00')
  ), standard_candidates AS (
    SELECT DISTINCT s.barber_id, s.slot_date, gs.candidate_start, false AS is_exception
    FROM available_slots s
    CROSS JOIN LATERAL generate_series(
      s.slot_date + time '10:00',
      s.slot_date + time '19:00',
      interval '45 minutes'
    ) AS gs(candidate_start)
    WHERE gs.candidate_start >= s.slot_date + s.start_time
      AND gs.candidate_start < (s.slot_date + CASE WHEN s.end_time <= s.start_time THEN interval '1 day' ELSE interval '0 day' END) + s.end_time
  ), extended_candidates AS (
    SELECT DISTINCT s.barber_id, s.slot_date, (s.slot_date + s.start_time)::timestamp AS candidate_start, true AS is_exception
    FROM available_slots s
  ), all_candidates AS (
    SELECT * FROM standard_candidates
    UNION
    SELECT * FROM extended_candidates
  )
  SELECT c.barber_id,
         c.slot_date,
         c.candidate_start::time,
         c.is_exception,
         compatibility.compatible_services
  FROM all_candidates c
  CROSS JOIN LATERAL (
    SELECT coalesce(array_agg(svc.name ORDER BY svc.name), '{}'::text[]) AS compatible_services
    FROM public.services svc
    WHERE svc.active
      AND svc.duration_minutes > 0
      AND NOT exists (
        SELECT 1
        FROM generate_series(
          0,
          ceil(svc.duration_minutes::numeric / 5)::integer - 1
        ) AS requested(segment_index)
        WHERE NOT exists (
          SELECT 1
          FROM public.barber_availability_slots available
          WHERE available.barber_id = c.barber_id
            AND available.slot_date = c.slot_date
            AND available.status = 'AVAILABLE'
            AND tsrange(
              c.candidate_start + requested.segment_index * interval '5 minutes',
              c.candidate_start + (requested.segment_index + 1) * interval '5 minutes', '[)'
            ) <@ tsrange(
              available.slot_date + available.start_time,
              (available.slot_date + CASE WHEN available.end_time <= available.start_time THEN 1 ELSE 0 END) + available.end_time, '[)'
            )
            AND NOT exists (
              SELECT 1
              FROM public.barber_availability_slots blocked
              WHERE blocked.barber_id = c.barber_id
                AND blocked.slot_date = c.slot_date
                AND blocked.status = 'UNAVAILABLE'
                AND tsrange(
                  c.candidate_start + requested.segment_index * interval '5 minutes',
                  c.candidate_start + (requested.segment_index + 1) * interval '5 minutes', '[)'
                ) && tsrange(
                  blocked.slot_date + blocked.start_time,
                  (blocked.slot_date + CASE WHEN blocked.end_time <= blocked.start_time THEN 1 ELSE 0 END) + blocked.end_time, '[)'
                )
            )
            AND NOT exists (
              SELECT 1
              FROM public.appointments a
              WHERE a.barber_id = c.barber_id
                AND a.booking_date = c.slot_date
                AND a.status <> 'CANCELLED'
                AND tsrange(
                  c.candidate_start + requested.segment_index * interval '5 minutes',
                  c.candidate_start + (requested.segment_index + 1) * interval '5 minutes', '[)'
                ) && tsrange(
                  a.booking_date + a.start_time,
                  (a.booking_date + CASE WHEN a.end_time <= a.start_time THEN 1 ELSE 0 END) + a.end_time, '[)'
                )
            )
        )
      )
  ) compatibility
  WHERE cardinality(compatibility.compatible_services) > 0
  ORDER BY c.barber_id, c.slot_date, c.candidate_start;
END;
$$;

REVOKE ALL ON FUNCTION public.read_valid_availability_starts(uuid, date, date) FROM public;
GRANT EXECUTE ON FUNCTION public.read_valid_availability_starts(uuid, date, date) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
