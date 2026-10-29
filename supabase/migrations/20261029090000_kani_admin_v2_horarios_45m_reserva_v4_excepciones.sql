-- Migration: 20261029090000_kani_admin_v2_horarios_45m_reserva_v4_excepciones.sql
-- Kani Barber Studio — Admin V2 & Reserva V4:
-- 1. Disponibilidad en intervalos de 45 minutos (10:00 -> 10:45 .. 19:00 -> 19:45)
-- 2. Disponibilidad extraordinaria fuera de horario habitual y en domingos (ADMIN y BARBER propio)
-- 3. Exposición pública en /reserva-v4 (read_valid_availability_starts y request_appointment)
-- 4. Turnos manuales directos sin abrir disponibilidad pública y con snapshot booking_client_name
-- 5. Deduplicación estricta de señas online por appointment_id en get_online_deposit_movements

-- ==============================================================================
-- 1. DURACIÓN OFICIAL DE SERVICIOS (Barba 30m, Corte 45m, Corte + barba 45m)
-- ==============================================================================

UPDATE public.services
SET duration_minutes = CASE name
  WHEN 'Corte' THEN 45
  WHEN 'Corte + barba' THEN 45
  WHEN 'Corte y barba' THEN 45
  WHEN 'Barba' THEN 30
  ELSE duration_minutes
END,
updated_at = now()
WHERE name IN ('Corte', 'Corte + barba', 'Corte y barba', 'Barba');

-- ==============================================================================
-- 2. SNAPSHOT INMUTABLE EN APPOINTMENTS Y BORRADO LÓGICO DE CLIENTES
-- ==============================================================================

ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS booking_client_name text DEFAULT NULL;

UPDATE public.appointments a
SET booking_client_name = c.name
FROM public.clients c
WHERE a.client_id = c.id
  AND a.booking_client_name IS NULL;

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_clients_deleted_at
  ON public.clients (deleted_at);

CREATE OR REPLACE FUNCTION public.save_client(
  p_id uuid DEFAULT NULL,
  p_name text DEFAULT NULL,
  p_phone text DEFAULT NULL,
  p_email text DEFAULT NULL
)
RETURNS public.clients
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_is_admin boolean := public.is_admin();
  v_staff_barber_id uuid := public.current_staff_barber_id();
  v_clean_name text := trim(coalesce(p_name, ''));
  v_clean_phone text := trim(coalesce(p_phone, ''));
  v_phone_digits text := regexp_replace(v_clean_phone, '[^0-9]', '', 'g');
  v_clean_email text := nullif(lower(trim(coalesce(p_email, ''))), '');
  v_client public.clients%ROWTYPE;
  v_existing_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION USING errcode = '42501', message = 'AUTH_REQUIRED';
  END IF;

  IF NOT v_is_admin AND v_staff_barber_id IS NULL THEN
    RAISE EXCEPTION USING errcode = '42501', message = 'FORBIDDEN_STAFF_REQUIRED';
  END IF;

  IF length(v_clean_name) < 2 THEN
    RAISE EXCEPTION USING errcode = '22023', message = 'CLIENT_NAME_INVALID';
  END IF;

  IF length(v_phone_digits) < 6 THEN
    RAISE EXCEPTION USING errcode = '22023', message = 'CLIENT_PHONE_INVALID';
  END IF;

  IF v_clean_email IS NOT NULL AND (position('@' in v_clean_email) <= 1 OR v_clean_email LIKE '%@kanibarber.internal') THEN
    v_clean_email := NULL;
  END IF;

  IF p_id IS NOT NULL THEN
    SELECT * INTO v_client FROM public.clients WHERE id = p_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION USING errcode = 'P0002', message = 'CLIENT_NOT_FOUND';
    END IF;

    UPDATE public.clients
    SET name = v_clean_name,
        phone = v_clean_phone,
        email = v_clean_email,
        deleted_at = NULL,
        updated_at = now()
    WHERE id = p_id
    RETURNING * INTO v_client;

    RETURN v_client;
  ELSE
    SELECT id INTO v_existing_id
    FROM public.clients c
    WHERE regexp_replace(c.phone, '[^0-9]', '', 'g') = v_phone_digits
       OR (v_clean_email IS NOT NULL AND lower(trim(coalesce(c.email, ''))) = v_clean_email)
    ORDER BY c.deleted_at NULLS FIRST, c.created_at ASC
    LIMIT 1;

    IF v_existing_id IS NOT NULL THEN
      UPDATE public.clients
      SET name = v_clean_name,
          phone = v_clean_phone,
          email = coalesce(v_clean_email, email),
          deleted_at = NULL,
          updated_at = now()
      WHERE id = v_existing_id
      RETURNING * INTO v_client;

      RETURN v_client;
    END IF;

    INSERT INTO public.clients (name, phone, email, created_at, updated_at)
    VALUES (v_clean_name, v_clean_phone, v_clean_email, now(), now())
    RETURNING * INTO v_client;

    RETURN v_client;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.save_client(uuid, text, text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.save_client(uuid, text, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.delete_client(
  p_client_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_is_admin boolean := public.is_admin();
  v_staff_barber_id uuid := public.current_staff_barber_id();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION USING errcode = '42501', message = 'AUTH_REQUIRED';
  END IF;

  IF NOT v_is_admin AND v_staff_barber_id IS NULL THEN
    RAISE EXCEPTION USING errcode = '42501', message = 'FORBIDDEN_STAFF_REQUIRED';
  END IF;

  IF p_client_id IS NULL THEN
    RAISE EXCEPTION USING errcode = '22023', message = 'CLIENT_ID_REQUIRED';
  END IF;

  UPDATE public.clients
  SET deleted_at = now(),
      updated_at = now()
  WHERE id = p_client_id
    AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING errcode = 'P0002', message = 'CLIENT_NOT_FOUND';
  END IF;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_client(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.delete_client(uuid) TO authenticated;

-- ==============================================================================
-- 3. CONSTRAINTS Y NORMALIZACIÓN A 45 MINUTOS EN BARBER_AVAILABILITY_SLOTS
-- ==============================================================================

ALTER TABLE public.barber_availability_slots
  DROP CONSTRAINT IF EXISTS availability_inside_business_hours,
  DROP CONSTRAINT IF EXISTS availability_inside_extended_hours,
  DROP CONSTRAINT IF EXISTS availability_hourly_slot,
  DROP CONSTRAINT IF EXISTS availability_interval_valid,
  DROP CONSTRAINT IF EXISTS availability_minimum_interval,
  DROP CONSTRAINT IF EXISTS availability_end_granularity;

ALTER TABLE public.barber_availability_slots
  ADD CONSTRAINT availability_interval_valid
    CHECK (end_time > start_time OR end_time = time '00:00:00'),
  ADD CONSTRAINT availability_minimum_interval
    CHECK (
      (end_time > start_time AND end_time - start_time >= interval '5 minutes')
      OR (end_time = time '00:00:00' AND start_time <= time '23:55:00')
    ),
  ADD CONSTRAINT availability_end_granularity
    CHECK (
      extract(second from end_time) = 0
      AND (extract(minute from end_time)::int % 5 = 0 OR end_time = time '00:00:00')
    );

-- Reemplazar los bloques antiguos de 60m (10:00->11:00 .. 19:00->20:00) o fusionados
-- desde el 2026-10-28 en adelante por la grilla oficial de 13 bloques de 45 minutos
DELETE FROM public.barber_availability_slots
WHERE slot_date >= date '2026-10-28'
  AND status = 'AVAILABLE'
  AND start_time >= time '10:00:00'
  AND end_time <= time '20:00:00'
  AND (end_time - start_time) <> interval '45 minutes';

INSERT INTO public.barber_availability_slots (barber_id, slot_date, start_time, end_time, status)
SELECT
  b.id,
  d::date,
  gs::time AS start_time,
  (gs + interval '45 minutes')::time AS end_time,
  'AVAILABLE'::public.availability_status
FROM public.barbers b
CROSS JOIN generate_series(
  date '2026-10-28',
  ((timezone('America/Argentina/Buenos_Aires', clock_timestamp()))::date + 60)::date,
  interval '1 day'
) AS d
CROSS JOIN generate_series(
  timestamp '2000-01-01 10:00:00',
  timestamp '2000-01-01 19:00:00',
  interval '45 minutes'
) AS gs
WHERE b.active = true
  AND extract(isodow from d) BETWEEN 1 AND 6
ON CONFLICT (barber_id, slot_date, start_time) DO NOTHING;

-- ==============================================================================
-- 4. CREATE_AVAILABILITY_SLOTS (45m por defecto, fuera de horario y domingos
--    habilitados para ADMIN y para BARBER sobre su propio barber_id)
-- ==============================================================================

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
  v_is_admin boolean := public.is_admin();
  v_staff_barber_id uuid := public.current_staff_barber_id();
  v_end_time time;
  v_existing public.barber_availability_slots%ROWTYPE;
  v_slot public.barber_availability_slots%ROWTYPE;
  v_conflict_apt record;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION USING errcode = '42501', message = 'AUTH_REQUIRED';
  END IF;

  IF NOT v_is_admin AND (v_staff_barber_id IS NULL OR v_staff_barber_id IS DISTINCT FROM p_barber_id) THEN
    RAISE EXCEPTION USING errcode = '42501', message = 'AVAILABILITY_NOT_ALLOWED';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.barbers b WHERE b.id = p_barber_id AND b.active = true) THEN
    RAISE EXCEPTION USING errcode = '22023', message = 'BARBER_NOT_FOUND';
  END IF;

  IF p_slot_dates IS NULL OR cardinality(p_slot_dates) = 0 THEN
    RAISE EXCEPTION USING errcode = '22023', message = 'DATE_REQUIRED';
  END IF;

  IF p_start_time IS NULL
     OR extract(second from p_start_time) <> 0
     OR p_start_time < time '00:00'
     OR p_start_time > time '23:55'
     OR (extract(minute from p_start_time)::int % 5 <> 0 AND p_start_time <> time '00:00') THEN
    RAISE EXCEPTION USING errcode = '22023', message = 'START_TIME_NOT_ALLOWED';
  END IF;

  IF p_end_time IS NOT NULL
     AND (extract(second from p_end_time) <> 0
       OR (extract(minute from p_end_time)::int % 5 <> 0)
       OR (p_end_time <= p_start_time AND p_end_time <> time '00:00:00')
       OR p_end_time > time '23:55') THEN
    RAISE EXCEPTION USING errcode = '22023', message = 'END_TIME_INVALID';
  END IF;

  v_end_time := coalesce(
    p_end_time,
    (p_start_time + interval '45 minutes')::time
  );

  FOREACH v_date IN ARRAY p_slot_dates LOOP
    -- Permitir cualquier fecha vigente o futura, incluyendo domingos (para ADMIN y BARBER propio)
    IF v_date IS NULL OR v_date < v_today THEN
      RAISE EXCEPTION USING errcode = '22023', message = 'AVAILABILITY_DATE_INVALID';
    END IF;

    PERFORM pg_advisory_xact_lock(hashtextextended(p_barber_id::text || '|' || v_date::text, 0));

    SELECT s.* INTO v_existing
    FROM public.barber_availability_slots s
    WHERE s.barber_id = p_barber_id
      AND s.slot_date = v_date
      AND s.start_time = p_start_time
    LIMIT 1;

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

    IF FOUND THEN
      RAISE EXCEPTION USING errcode = '23P01',
        message = 'AVAILABILITY_APPOINTMENT_CONFLICT:' || v_conflict_apt.name || ':' || to_char(v_conflict_apt.start_time, 'HH24:MI') || ':' || to_char(v_conflict_apt.end_time, 'HH24:MI');
    END IF;

    IF EXISTS (
      SELECT 1 FROM public.barber_availability_slots s
      WHERE s.barber_id = p_barber_id
        AND s.slot_date = v_date
        AND s.status = 'UNAVAILABLE'
        AND s.start_time <> p_start_time
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

-- ==============================================================================
-- 5. READ_VALID_AVAILABILITY_STARTS
--    Expone tanto la grilla habitual (10:00..19:00) como las excepciones explícitas
--    fuera de horario (ej. 08:15, 20:15) y en domingos en /reserva-v4.
-- ==============================================================================

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
BEGIN
  IF v_from > v_to THEN
    RAISE EXCEPTION USING errcode = '22023', message = 'DATE_RANGE_INVALID';
  END IF;

  RETURN QUERY
  WITH available_slots AS (
    SELECT
      s.barber_id,
      s.slot_date,
      s.start_time,
      s.end_time,
      (s.slot_date + s.start_time)::timestamp AS slot_start_ts,
      ((s.slot_date + CASE WHEN s.end_time <= s.start_time THEN 1 ELSE 0 END) + s.end_time)::timestamp AS slot_end_ts
    FROM public.barber_availability_slots s
    JOIN public.barbers b ON b.id = s.barber_id AND b.active = true
    WHERE s.status = 'AVAILABLE'
      AND s.slot_date BETWEEN v_from AND v_to
      AND (p_barber_id IS NULL OR s.barber_id = p_barber_id)
      AND (s.end_time > s.start_time OR s.end_time = time '00:00:00')
  ), standard_candidates AS (
    SELECT DISTINCT
      s.barber_id,
      s.slot_date,
      gs.candidate_start,
      (extract(isodow from s.slot_date) = 7) AS is_exception
    FROM available_slots s
    CROSS JOIN LATERAL generate_series(
      s.slot_date + time '10:00',
      s.slot_date + time '19:00',
      interval '45 minutes'
    ) AS gs(candidate_start)
    WHERE gs.candidate_start >= s.slot_start_ts
      AND gs.candidate_start < s.slot_end_ts
  ), extended_candidates AS (
    SELECT DISTINCT
      s.barber_id,
      s.slot_date,
      gs.candidate_start,
      true AS is_exception
    FROM available_slots s
    CROSS JOIN LATERAL generate_series(
      s.slot_start_ts,
      s.slot_end_ts - interval '5 minutes',
      interval '45 minutes'
    ) AS gs(candidate_start)
    WHERE gs.candidate_start::date = s.slot_date
  ), all_candidates AS (
    SELECT
      u.barber_id,
      u.slot_date,
      u.candidate_start,
      bool_and(u.is_exception) AS is_exception
    FROM (
      SELECT * FROM standard_candidates
      UNION ALL
      SELECT * FROM extended_candidates
    ) u
    GROUP BY u.barber_id, u.slot_date, u.candidate_start
  )
  SELECT
    c.barber_id,
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
      AND NOT EXISTS (
        SELECT 1
        FROM generate_series(
          0,
          ceil(svc.duration_minutes::numeric / 5)::integer - 1
        ) AS requested(segment_index)
        WHERE NOT EXISTS (
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
            AND NOT EXISTS (
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
            AND NOT EXISTS (
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

-- ==============================================================================
-- 6. REQUEST_APPOINTMENT
--    Valida que todos los segmentos de 5m del servicio estén cubiertos por
--    disponibilidad AVAILABLE (incluyendo horarios extraordinarios y domingos
--    explícitamente habilitados) y preserva booking_client_name.
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
  WHERE s.name = trim(p_service_name)
    AND s.active = true;

  v_duration := v_service.duration_minutes * interval '1 minute';
  v_start_at := (p_booking_date + p_start_time)::timestamp;
  v_end_at := v_start_at + v_duration;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_barber.id::text || '|' || p_booking_date::text, 0));

  v_last_segment := ceil(extract(epoch from v_duration) / 300)::integer - 1;

  IF EXISTS (
    SELECT 1
    FROM generate_series(0, v_last_segment) AS requested(segment_index)
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.barber_availability_slots slot
      WHERE slot.barber_id = v_barber.id
        AND slot.slot_date = p_booking_date
        AND slot.status = 'AVAILABLE'
        AND tsrange(
          v_start_at + requested.segment_index * interval '5 minutes',
          v_start_at + (requested.segment_index + 1) * interval '5 minutes',
          '[)'
        ) <@ tsrange(
          (slot.slot_date + slot.start_time)::timestamp,
          ((slot.slot_date + CASE WHEN slot.end_time <= slot.start_time THEN 1 ELSE 0 END) + slot.end_time)::timestamp,
          '[)'
        )
        AND NOT EXISTS (
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
    RAISE EXCEPTION USING errcode = '23P01', message = 'SLOT_ALREADY_BOOKED';
  END IF;

  SELECT c.id INTO v_client_id
  FROM public.clients c
  WHERE lower(trim(coalesce(c.email, ''))) = v_clean_email
    AND regexp_replace(c.phone, '[^0-9+]', '', 'g') = regexp_replace(v_clean_phone, '[^0-9+]', '', 'g')
  ORDER BY c.deleted_at NULLS FIRST, c.created_at ASC
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

  notification_claim_token := NULL;
  RETURN NEXT;
EXCEPTION
  WHEN no_data_found THEN
    RAISE EXCEPTION USING errcode = 'P0001', message = 'BARBER_OR_SERVICE_NOT_FOUND';
END;
$$;

REVOKE ALL ON FUNCTION public.request_appointment(text, text, date, time, text, text, text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.request_appointment(text, text, date, time, text, text, text, text) TO anon, authenticated;

-- ==============================================================================
-- 7. TURNOS MANUALES: Eliminar sobrecargas legacy que auto-creaban disponibilidad
--    pública y preservar snapshot booking_client_name
-- ==============================================================================

DROP FUNCTION IF EXISTS public.create_manual_appointment(uuid, uuid, date, time, text, text, text, text, boolean, integer, boolean);
DROP FUNCTION IF EXISTS public.update_manual_appointment(uuid, uuid, uuid, date, time, text, text, text, text);

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
  IF v_clean_email IS NOT NULL AND (position('@' in v_clean_email) <= 1 OR v_clean_email LIKE '%@kanibarber.internal') THEN
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

  IF p_client_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.clients WHERE id = p_client_id) THEN
    v_client_id := p_client_id;
    UPDATE public.clients
    SET name = v_clean_name,
        phone = v_clean_phone,
        email = coalesce(v_clean_email, email),
        deleted_at = NULL,
        updated_at = now()
    WHERE id = v_client_id;
  ELSE
    SELECT c.id INTO v_client_id
    FROM public.clients c
    WHERE (v_clean_email IS NOT NULL AND lower(trim(coalesce(c.email, ''))) = v_clean_email)
       OR regexp_replace(c.phone, '[^0-9]', '', 'g') = regexp_replace(v_clean_phone, '[^0-9]', '', 'g')
    ORDER BY c.deleted_at NULLS FIRST, c.created_at ASC
    LIMIT 1;

    IF v_client_id IS NULL THEN
      INSERT INTO public.clients (name, phone, email)
      VALUES (v_clean_name, v_clean_phone, v_clean_email)
      RETURNING id INTO v_client_id;
    ELSE
      UPDATE public.clients
      SET name = v_clean_name,
          phone = v_clean_phone,
          email = coalesce(v_clean_email, email),
          deleted_at = NULL,
          updated_at = now()
      WHERE id = v_client_id;
    END IF;
  END IF;

  -- Importante: el turno manual reserva directamente el intervalo para este cliente
  -- SIN crear ni abrir disponibilidad pública en barber_availability_slots.
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

REVOKE ALL ON FUNCTION public.create_manual_appointment(uuid, uuid, text, integer, date, time, time, text, text, text, text, boolean, integer, boolean, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.create_manual_appointment(uuid, uuid, text, integer, date, time, time, text, text, text, text, boolean, integer, boolean, uuid) TO authenticated;

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

  IF NOT v_is_admin AND (v_staff_barber_id IS NULL OR v_staff_barber_id IS DISTINCT FROM v_appt.barber_id OR v_staff_barber_id IS DISTINCT FROM p_barber_id) THEN
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
    v_final_service_name := nullif(trim(coalesce(p_custom_service_name, v_appt.custom_service_name, '')), '');
    IF v_final_service_name IS NULL THEN
      RAISE EXCEPTION USING errcode = '22023', message = 'CUSTOM_SERVICE_NAME_REQUIRED';
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
  v_clean_phone := trim(coalesce(p_client_phone, ''));
  v_clean_email := nullif(lower(trim(coalesce(p_client_email, ''))), '');
  IF v_clean_email IS NOT NULL AND (position('@' in v_clean_email) <= 1 OR v_clean_email LIKE '%@kanibarber.internal') THEN
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
    SET name = CASE WHEN length(v_clean_name) >= 2 THEN v_clean_name ELSE name END,
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

REVOKE ALL ON FUNCTION public.update_manual_appointment(uuid, uuid, uuid, text, integer, date, time, time, text, text, text, text, integer) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.update_manual_appointment(uuid, uuid, uuid, text, integer, date, time, time, text, text, text, text, integer) TO authenticated;

-- ==============================================================================
-- 8. RLS EN PAYMENT_ATTEMPTS Y DEDUPLICACIÓN ESTRICTA DE SEÑAS ONLINE
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
    ('deposit-' || a.id::text)::text AS movement_id,
    a.id AS appointment_id,
    coalesce(pa.provider, 'PAYWAY')::text AS provider,
    coalesce(pa.amount_ars, a.deposit_amount_ars::numeric, 5000::numeric) AS amount_ars,
    (timezone('America/Argentina/Buenos_Aires', coalesce(pa.created_at, a.created_at)))::date AS payment_date,
    to_char(timezone('America/Argentina/Buenos_Aires', coalesce(pa.created_at, a.created_at)), 'HH24:MI') AS payment_time,
    coalesce(pa.created_at, a.created_at) AS payment_timestamp,
    a.barber_id,
    coalesce(b.name, 'Barbero')::text AS barber_name,
    ('Seña - ' || CASE WHEN coalesce(a.custom_service_name, s.name, 'Corte') = 'Corte + barba' THEN 'Corte y barba' ELSE coalesce(a.custom_service_name, s.name, 'Corte') END)::text AS service_name,
    coalesce(a.booking_client_name, c.name, 'Cliente')::text AS client_name,
    coalesce(c.phone, '')::text AS client_contact,
    a.booking_date AS appointment_date,
    to_char(a.start_time, 'HH24:MI') AS appointment_time
  FROM public.appointments a
  JOIN LATERAL (
    SELECT p.id, p.provider, p.amount_ars, p.created_at
    FROM public.payment_attempts p
    WHERE p.appointment_id = a.id
      AND p.state = 'APPROVED'
    ORDER BY p.created_at DESC
    LIMIT 1
  ) pa ON true
  JOIN public.barbers b ON b.id = a.barber_id
  LEFT JOIN public.services s ON s.id = a.service_id
  LEFT JOIN public.clients c ON c.id = a.client_id
  WHERE a.status <> 'CANCELLED'
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

REVOKE ALL ON FUNCTION public.get_online_deposit_movements(uuid, date, date) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_online_deposit_movements(uuid, date, date) TO authenticated;

NOTIFY pgrst, 'reload schema';
