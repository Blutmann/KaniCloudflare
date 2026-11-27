-- ==============================================================================
-- KANI BARBER STUDIO — ACTUALIZACIÓN DE HORARIOS BASE POR BARBERO (45 MIN)
-- ==============================================================================
-- Migración local (NO ejecutar remotamente sin autorización explícita).
--
-- Nueva agenda base por defecto:
--   1. Lautaro:
--      - Lunes a Sábado (isodow 1..6): 10:00 a 20:00 -> inicios 10:00..19:00 (45m)
--      - Domingo: cerrado
--   2. Gonzalo:
--      - Lunes, Miércoles, Viernes, Sábado (isodow 1, 3, 5, 6): 10:00..19:00 (45m)
--      - Martes y Jueves (isodow 2, 4): 11:00 a 20:00 -> inicios 11:00..19:15 (45m)
--      - Domingo: cerrado
--   3. Valentín (barbers.name IN ('Valentín', 'Valentin')):
--      - Lunes (isodow 1): Franco (sin slots base por defecto)
--      - Martes a Viernes (isodow 2..5): 12:00 a 20:00 -> inicios 12:00..19:30 (45m)
--      - Sábado (isodow 6): 10:00..19:00 (45m)
--      - Domingo: cerrado
--   4. Franco:
--      - Sábados (isodow 6): 15:00 a 20:00 (preservado sin cambios)
--
-- Preserva 100 % la gestión administrativa de bloqueos (UNAVAILABLE),
-- habilitaciones, horarios extraordinarios y reglas recurrentes.
-- ==============================================================================

BEGIN;

-- ==============================================================================
-- 1. ACTUALIZAR public.read_valid_availability_starts
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.read_valid_availability_starts(
  p_barber_id uuid DEFAULT NULL::uuid,
  p_from_date date DEFAULT NULL::date,
  p_to_date date DEFAULT NULL::date
)
RETURNS TABLE(
  barber_id uuid,
  slot_date date,
  start_time time without time zone,
  is_exception boolean,
  compatible_services text[]
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
#variable_conflict use_column
DECLARE
  v_from date := coalesce(p_from_date, (timezone('America/Argentina/Buenos_Aires', clock_timestamp()))::date);
  v_to date := coalesce(p_to_date, v_from + 21);
BEGIN
  IF v_from > v_to THEN
    RAISE EXCEPTION USING errcode = '22023', message = 'DATE_RANGE_INVALID';
  END IF;

  RETURN QUERY
  WITH barber_base_schedule_defs AS (
    -- Lautaro: Lunes a Sábado (1..6), 10:00..19:00 cada 45m
    SELECT
      b.id AS barber_id,
      b.name AS barber_name,
      d::date AS slot_date,
      gs::time AS start_time,
      (gs + interval '45 minutes')::time AS end_time
    FROM public.barbers b
    CROSS JOIN generate_series(v_from, v_to, interval '1 day') AS d
    CROSS JOIN generate_series(
      timestamp '2000-01-01 10:00:00',
      timestamp '2000-01-01 19:00:00',
      interval '45 minutes'
    ) AS gs
    WHERE b.name = 'Lautaro'
      AND b.active = true
      AND (b.public_booking_enabled OR coalesce((SELECT public.is_operator()), false) OR b.id = (SELECT public.current_staff_barber_id()))
      AND extract(isodow from d) BETWEEN 1 AND 6
      AND (p_barber_id IS NULL OR b.id = p_barber_id)

    UNION ALL

    -- Gonzalo: Lunes, Miércoles, Viernes y Sábado (1, 3, 5, 6), 10:00..19:00 cada 45m
    SELECT
      b.id AS barber_id,
      b.name AS barber_name,
      d::date AS slot_date,
      gs::time AS start_time,
      (gs + interval '45 minutes')::time AS end_time
    FROM public.barbers b
    CROSS JOIN generate_series(v_from, v_to, interval '1 day') AS d
    CROSS JOIN generate_series(
      timestamp '2000-01-01 10:00:00',
      timestamp '2000-01-01 19:00:00',
      interval '45 minutes'
    ) AS gs
    WHERE b.name = 'Gonzalo'
      AND b.active = true
      AND (b.public_booking_enabled OR coalesce((SELECT public.is_operator()), false) OR b.id = (SELECT public.current_staff_barber_id()))
      AND extract(isodow from d) IN (1, 3, 5, 6)
      AND (p_barber_id IS NULL OR b.id = p_barber_id)

    UNION ALL

    -- Gonzalo: Martes y Jueves (2, 4), 11:00..19:15 cada 45m (termina 20:00)
    SELECT
      b.id AS barber_id,
      b.name AS barber_name,
      d::date AS slot_date,
      gs::time AS start_time,
      (gs + interval '45 minutes')::time AS end_time
    FROM public.barbers b
    CROSS JOIN generate_series(v_from, v_to, interval '1 day') AS d
    CROSS JOIN generate_series(
      timestamp '2000-01-01 11:00:00',
      timestamp '2000-01-01 19:15:00',
      interval '45 minutes'
    ) AS gs
    WHERE b.name = 'Gonzalo'
      AND b.active = true
      AND (b.public_booking_enabled OR coalesce((SELECT public.is_operator()), false) OR b.id = (SELECT public.current_staff_barber_id()))
      AND extract(isodow from d) IN (2, 4)
      AND (p_barber_id IS NULL OR b.id = p_barber_id)

    UNION ALL

    -- Valentín: Martes a Viernes (2..5), 12:00..19:30 cada 45m (Lunes = Franco sin slots base)
    SELECT
      b.id AS barber_id,
      b.name AS barber_name,
      d::date AS slot_date,
      gs::time AS start_time,
      (gs + interval '45 minutes')::time AS end_time
    FROM public.barbers b
    CROSS JOIN generate_series(v_from, v_to, interval '1 day') AS d
    CROSS JOIN generate_series(
      timestamp '2000-01-01 12:00:00',
      timestamp '2000-01-01 19:30:00',
      interval '45 minutes'
    ) AS gs
    WHERE b.name IN ('Valentín', 'Valentin')
      AND b.active = true
      AND (b.public_booking_enabled OR coalesce((SELECT public.is_operator()), false) OR b.id = (SELECT public.current_staff_barber_id()))
      AND extract(isodow from d) BETWEEN 2 AND 5
      AND (p_barber_id IS NULL OR b.id = p_barber_id)

    UNION ALL

    -- Valentín: Sábado (6), 10:00..19:00 cada 45m
    SELECT
      b.id AS barber_id,
      b.name AS barber_name,
      d::date AS slot_date,
      gs::time AS start_time,
      (gs + interval '45 minutes')::time AS end_time
    FROM public.barbers b
    CROSS JOIN generate_series(v_from, v_to, interval '1 day') AS d
    CROSS JOIN generate_series(
      timestamp '2000-01-01 10:00:00',
      timestamp '2000-01-01 19:00:00',
      interval '45 minutes'
    ) AS gs
    WHERE b.name IN ('Valentín', 'Valentin')
      AND b.active = true
      AND (b.public_booking_enabled OR coalesce((SELECT public.is_operator()), false) OR b.id = (SELECT public.current_staff_barber_id()))
      AND extract(isodow from d) = 6
      AND (p_barber_id IS NULL OR b.id = p_barber_id)

    UNION ALL

    -- Franco: Sábados (6), 15:00 a 20:00 (preservado)
    SELECT
      b.id AS barber_id,
      b.name AS barber_name,
      d::date AS slot_date,
      slot_def.start_time,
      slot_def.end_time
    FROM public.barbers b
    CROSS JOIN generate_series(v_from, v_to, interval '1 day') AS d
    CROSS JOIN (
      VALUES
        (time '15:00:00', time '15:45:00'),
        (time '15:45:00', time '16:30:00'),
        (time '16:30:00', time '17:15:00'),
        (time '17:15:00', time '18:00:00'),
        (time '18:00:00', time '18:45:00'),
        (time '18:45:00', time '19:30:00'),
        (time '19:30:00', time '20:00:00')
    ) AS slot_def(start_time, end_time)
    WHERE b.name = 'Franco'
      AND b.active = true
      AND (b.public_booking_enabled OR coalesce((SELECT public.is_operator()), false) OR b.id = (SELECT public.current_staff_barber_id()))
      AND extract(isodow from d) = 6
      AND (p_barber_id IS NULL OR b.id = p_barber_id)
  ), recurring_base_slots AS (
    SELECT
      def.barber_id,
      def.barber_name,
      def.slot_date,
      def.start_time,
      def.end_time,
      (def.slot_date + def.start_time)::timestamp AS slot_start_ts,
      ((def.slot_date + CASE WHEN def.end_time <= def.start_time THEN 1 ELSE 0 END) + def.end_time)::timestamp AS slot_end_ts
    FROM barber_base_schedule_defs def
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.barber_availability_slots blk
      WHERE blk.barber_id = def.barber_id
        AND blk.slot_date = def.slot_date
        AND blk.status = 'UNAVAILABLE'
        AND tsrange(
          def.slot_date + def.start_time,
          (def.slot_date + CASE WHEN def.end_time <= def.start_time THEN 1 ELSE 0 END) + def.end_time,
          '[)'
        ) && tsrange(
          blk.slot_date + blk.start_time,
          (blk.slot_date + CASE WHEN blk.end_time <= blk.start_time THEN 1 ELSE 0 END) + blk.end_time,
          '[)'
        )
    )
  ), dynamic_recurring_rule_slots AS (
    -- Reglas de disponibilidad recurrente configuradas por staff
    SELECT
      r.barber_id,
      occ_date AS slot_date,
      coalesce(exc.override_start_time, r.start_time) AS start_time,
      coalesce(exc.override_end_time, r.end_time) AS end_time,
      (occ_date + coalesce(exc.override_start_time, r.start_time))::timestamp AS slot_start_ts,
      ((occ_date + CASE WHEN coalesce(exc.override_end_time, r.end_time) <= coalesce(exc.override_start_time, r.start_time) THEN 1 ELSE 0 END) + coalesce(exc.override_end_time, r.end_time))::timestamp AS slot_end_ts
    FROM public.recurring_availability_rules r
    JOIN public.barbers b ON b.id = r.barber_id AND b.active = true
      AND (b.public_booking_enabled OR coalesce((SELECT public.is_operator()), false) OR b.id = (SELECT public.current_staff_barber_id()))
    CROSS JOIN LATERAL public.generate_recurrence_dates(
      r.start_date,
      r.frequency_type,
      r.end_type,
      r.end_date,
      r.max_occurrences,
      v_from,
      v_to,
      r.excluded_dates
    ) AS occ_date
    LEFT JOIN public.recurring_availability_exceptions exc
      ON exc.rule_id = r.id AND exc.exception_date = occ_date
    WHERE r.active = true
      AND (p_barber_id IS NULL OR r.barber_id = p_barber_id)
      AND (exc.id IS NULL OR exc.exception_type = 'MODIFIED')
      AND NOT EXISTS (
        SELECT 1
        FROM public.barber_availability_slots blk
        WHERE blk.barber_id = r.barber_id
          AND blk.slot_date = occ_date
          AND blk.status = 'UNAVAILABLE'
          AND tsrange(
            occ_date + coalesce(exc.override_start_time, r.start_time),
            (occ_date + CASE WHEN coalesce(exc.override_end_time, r.end_time) <= coalesce(exc.override_start_time, r.start_time) THEN 1 ELSE 0 END) + coalesce(exc.override_end_time, r.end_time),
            '[)'
          ) && tsrange(
            blk.slot_date + blk.start_time,
            (blk.slot_date + CASE WHEN blk.end_time <= blk.start_time THEN 1 ELSE 0 END) + blk.end_time,
            '[)'
          )
      )
  ), stored_available_slots AS (
    -- Slots explícitos almacenados en BD (incluye manuales y extraordinarios)
    SELECT
      s.barber_id,
      s.slot_date,
      s.start_time,
      s.end_time,
      (s.slot_date + s.start_time)::timestamp AS slot_start_ts,
      ((s.slot_date + CASE WHEN s.end_time <= s.start_time THEN 1 ELSE 0 END) + s.end_time)::timestamp AS slot_end_ts
    FROM public.barber_availability_slots s
    JOIN public.barbers b ON b.id = s.barber_id AND b.active = true
      AND (b.public_booking_enabled OR coalesce((SELECT public.is_operator()), false) OR b.id = (SELECT public.current_staff_barber_id()))
    WHERE s.status = 'AVAILABLE'
      AND s.slot_date BETWEEN v_from AND v_to
      AND (p_barber_id IS NULL OR s.barber_id = p_barber_id)
      AND (s.end_time > s.start_time OR s.end_time = time '00:00:00')
  ), available_slots AS (
    SELECT s.barber_id, s.slot_date, s.start_time, s.end_time, s.slot_start_ts, s.slot_end_ts FROM stored_available_slots s
    UNION
    SELECT r.barber_id, r.slot_date, r.start_time, r.end_time, r.slot_start_ts, r.slot_end_ts FROM recurring_base_slots r
    UNION
    SELECT dr.barber_id, dr.slot_date, dr.start_time, dr.end_time, dr.slot_start_ts, dr.slot_end_ts FROM dynamic_recurring_rule_slots dr
  ), standard_candidates AS (
    -- Candidatos de la grilla oficial por barbero + día (sin desfasajes entre grillas :00, :15 y :30)
    SELECT DISTINCT
      r.barber_id,
      r.slot_date,
      r.slot_start_ts AS candidate_start,
      false AS is_exception
    FROM recurring_base_slots r
    WHERE r.barber_name <> 'Franco'
  ), franco_saturday_candidates AS (
    SELECT DISTINCT
      s.barber_id,
      s.slot_date,
      (s.slot_date + franco_time.t)::timestamp AS candidate_start,
      false AS is_exception
    FROM available_slots s
    JOIN public.barbers b ON b.id = s.barber_id AND b.name = 'Franco'
    CROSS JOIN (
      VALUES
        (time '15:00:00'),
        (time '15:45:00'),
        (time '16:30:00'),
        (time '17:15:00'),
        (time '18:00:00'),
        (time '18:45:00'),
        (time '19:00:00'),
        (time '19:15:00'),
        (time '19:30:00')
    ) AS franco_time(t)
    WHERE extract(isodow from s.slot_date) = 6
      AND (s.slot_date + franco_time.t)::timestamp >= s.slot_start_ts
      AND (s.slot_date + franco_time.t)::timestamp < s.slot_end_ts
  ), extended_candidates AS (
    -- Candidatos provenientes de horarios extraordinarios o reglas recurrentes cargadas por staff
    SELECT DISTINCT
      ext.barber_id,
      ext.slot_date,
      gs.candidate_start,
      true AS is_exception
    FROM (
      SELECT s.barber_id, s.slot_date, s.slot_start_ts, s.slot_end_ts FROM stored_available_slots s
      UNION
      SELECT dr.barber_id, dr.slot_date, dr.slot_start_ts, dr.slot_end_ts FROM dynamic_recurring_rule_slots dr
    ) ext
    CROSS JOIN LATERAL generate_series(
      ext.slot_start_ts,
      ext.slot_end_ts - interval '5 minutes',
      interval '45 minutes'
    ) AS gs(candidate_start)
    WHERE gs.candidate_start::date = ext.slot_date
  ), all_candidates AS (
    SELECT
      u.barber_id,
      u.slot_date,
      u.candidate_start,
      bool_and(u.is_exception) AS is_exception
    FROM (
      SELECT sc.barber_id, sc.slot_date, sc.candidate_start, sc.is_exception FROM standard_candidates sc
      UNION ALL
      SELECT fc.barber_id, fc.slot_date, fc.candidate_start, fc.is_exception FROM franco_saturday_candidates fc
      UNION ALL
      SELECT ec.barber_id, ec.slot_date, ec.candidate_start, ec.is_exception FROM extended_candidates ec
    ) u
    GROUP BY u.barber_id, u.slot_date, u.candidate_start
  )
  SELECT
    c.barber_id,
    c.slot_date,
    c.candidate_start::time AS start_time,
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
          FROM available_slots available
          WHERE available.barber_id = c.barber_id
            AND available.slot_date = c.slot_date
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
$function$;

REVOKE ALL ON FUNCTION public.read_valid_availability_starts(uuid, date, date) FROM public;
GRANT EXECUTE ON FUNCTION public.read_valid_availability_starts(uuid, date, date) TO anon, authenticated, service_role;

-- ==============================================================================
-- 2. ACTUALIZAR public.request_appointment
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.request_appointment(
  p_barber_name text,
  p_service_name text,
  p_booking_date date,
  p_start_time time without time zone,
  p_client_name text,
  p_client_phone text,
  p_client_email text,
  p_notes text DEFAULT NULL::text
)
RETURNS TABLE(
  appointment_id uuid,
  appointment_status appointment_status,
  booking_date date,
  start_time time without time zone,
  end_time time without time zone,
  request_number bigint,
  notification_claim_token text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
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
  v_isodow integer;
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

  IF auth.uid() IS NOT NULL AND EXISTS(SELECT 1 FROM public.staff_profiles WHERE user_id=auth.uid() AND role='BARBER')
   AND v_barber.id IS DISTINCT FROM public.current_staff_barber_id() THEN
   RAISE EXCEPTION USING errcode='42501',message='APPOINTMENT_NOT_ALLOWED';
  END IF;

  SELECT s.* INTO STRICT v_service
  FROM public.services s
  WHERE s.active = true
    AND (
      s.name = trim(p_service_name)
      OR (trim(p_service_name) IN ('Corte', 'Corte de cabello') AND s.name IN ('Corte', 'Corte de cabello'))
      OR (trim(p_service_name) IN ('Corte y barba', 'Corte + barba') AND s.name IN ('Corte y barba', 'Corte + barba'))
    )
  LIMIT 1;

  v_duration := v_service.duration_minutes * interval '1 minute';
  v_start_at := (p_booking_date + p_start_time)::timestamp;
  v_end_at := v_start_at + v_duration;
  v_isodow := extract(isodow from p_booking_date)::int;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_barber.id::text || '|' || p_booking_date::text, 0));

  -- Garantizar atómicamente los slots base por barbero + día en public.barber_availability_slots
  IF v_barber.name = 'Franco' AND v_isodow = 6 THEN
    INSERT INTO public.barber_availability_slots (barber_id, slot_date, start_time, end_time, status)
    VALUES
      (v_barber.id, p_booking_date, time '15:00:00', time '15:45:00', 'AVAILABLE'),
      (v_barber.id, p_booking_date, time '15:45:00', time '16:30:00', 'AVAILABLE'),
      (v_barber.id, p_booking_date, time '16:30:00', time '17:15:00', 'AVAILABLE'),
      (v_barber.id, p_booking_date, time '17:15:00', time '18:00:00', 'AVAILABLE'),
      (v_barber.id, p_booking_date, time '18:00:00', time '18:45:00', 'AVAILABLE'),
      (v_barber.id, p_booking_date, time '18:45:00', time '19:30:00', 'AVAILABLE'),
      (v_barber.id, p_booking_date, time '19:30:00', time '20:00:00', 'AVAILABLE')
    ON CONFLICT (barber_id, slot_date, start_time) DO NOTHING;

  ELSIF v_barber.name = 'Lautaro' AND v_isodow BETWEEN 1 AND 6 THEN
    INSERT INTO public.barber_availability_slots (barber_id, slot_date, start_time, end_time, status)
    SELECT
      v_barber.id,
      p_booking_date,
      gs::time AS slot_start,
      (gs + interval '45 minutes')::time AS slot_end,
      'AVAILABLE'::public.availability_status
    FROM generate_series(
      timestamp '2000-01-01 10:00:00',
      timestamp '2000-01-01 19:00:00',
      interval '45 minutes'
    ) AS gs
    ON CONFLICT (barber_id, slot_date, start_time) DO NOTHING;

  ELSIF v_barber.name = 'Gonzalo' AND v_isodow IN (1, 3, 5, 6) THEN
    INSERT INTO public.barber_availability_slots (barber_id, slot_date, start_time, end_time, status)
    SELECT
      v_barber.id,
      p_booking_date,
      gs::time AS slot_start,
      (gs + interval '45 minutes')::time AS slot_end,
      'AVAILABLE'::public.availability_status
    FROM generate_series(
      timestamp '2000-01-01 10:00:00',
      timestamp '2000-01-01 19:00:00',
      interval '45 minutes'
    ) AS gs
    ON CONFLICT (barber_id, slot_date, start_time) DO NOTHING;

  ELSIF v_barber.name = 'Gonzalo' AND v_isodow IN (2, 4) THEN
    INSERT INTO public.barber_availability_slots (barber_id, slot_date, start_time, end_time, status)
    SELECT
      v_barber.id,
      p_booking_date,
      gs::time AS slot_start,
      (gs + interval '45 minutes')::time AS slot_end,
      'AVAILABLE'::public.availability_status
    FROM generate_series(
      timestamp '2000-01-01 11:00:00',
      timestamp '2000-01-01 19:15:00',
      interval '45 minutes'
    ) AS gs
    ON CONFLICT (barber_id, slot_date, start_time) DO NOTHING;

  ELSIF v_barber.name IN ('Valentín', 'Valentin') AND v_isodow BETWEEN 2 AND 5 THEN
    INSERT INTO public.barber_availability_slots (barber_id, slot_date, start_time, end_time, status)
    SELECT
      v_barber.id,
      p_booking_date,
      gs::time AS slot_start,
      (gs + interval '45 minutes')::time AS slot_end,
      'AVAILABLE'::public.availability_status
    FROM generate_series(
      timestamp '2000-01-01 12:00:00',
      timestamp '2000-01-01 19:30:00',
      interval '45 minutes'
    ) AS gs
    ON CONFLICT (barber_id, slot_date, start_time) DO NOTHING;

  ELSIF v_barber.name IN ('Valentín', 'Valentin') AND v_isodow = 6 THEN
    INSERT INTO public.barber_availability_slots (barber_id, slot_date, start_time, end_time, status)
    SELECT
      v_barber.id,
      p_booking_date,
      gs::time AS slot_start,
      (gs + interval '45 minutes')::time AS slot_end,
      'AVAILABLE'::public.availability_status
    FROM generate_series(
      timestamp '2000-01-01 10:00:00',
      timestamp '2000-01-01 19:00:00',
      interval '45 minutes'
    ) AS gs
    ON CONFLICT (barber_id, slot_date, start_time) DO NOTHING;
  END IF;
  -- Nota: Valentín los lunes (isodow = 1) no auto-materializa slots base (Franco).
  -- Si el staff agrega un horario extraordinario o regla recurrente el lunes, existirá
  -- en barber_availability_slots y será validado normalmente abajo.

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

  -- Serialize contact reuse across public and staff flows after taking the agenda lock.
  PERFORM pg_advisory_xact_lock(hashtextextended('client-phone:'||regexp_replace(v_clean_phone,'[^0-9]','','g'),0));
  SELECT c.id INTO v_client_id
  FROM public.clients c
  WHERE (c.email is null or lower(trim(coalesce(c.email,'')))=v_clean_email)
    AND regexp_replace(c.phone,'[^0-9]','','g')=regexp_replace(v_clean_phone,'[^0-9]','','g')
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
$function$;

REVOKE ALL ON FUNCTION public.request_appointment(text, text, date, time, text, text, text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.request_appointment(text, text, date, time, text, text, text, text) TO anon, authenticated, service_role;

-- ==============================================================================
-- 3. LIMPIEZA QUIRÚRGICA DE SLOTS FUTUROS PRE-MATERIALIZADOS CON GRILLA ANTERIOR
--    Y MATERIALIZACIÓN DE LA NUEVA GRILLA BASE (60 DÍAS)
-- ==============================================================================
-- Solo elimina filas futuras (slot_date >= hoy AR), status = 'AVAILABLE',
-- pre-materializadas automáticamente (updated_by IS NULL AND internal_note IS NULL),
-- pertenecientes a la grilla vieja 10:00..19:00 (45m), sin turnos activos
-- (PENDING/CONFIRMED/COMPLETED) y sin regla recurrente manual activa.
-- Jamás borra bloqueos UNAVAILABLE ni horarios manuales/extraordinarios.

DELETE FROM public.barber_availability_slots s
USING public.barbers b
WHERE b.id = s.barber_id
  AND s.slot_date >= (timezone('America/Argentina/Buenos_Aires', clock_timestamp()))::date
  AND s.status = 'AVAILABLE'
  AND s.updated_by IS NULL
  AND s.internal_note IS NULL
  AND s.end_time = (s.start_time + interval '45 minutes')::time
  AND s.start_time IN (
    SELECT gs::time
    FROM generate_series(
      timestamp '2000-01-01 10:00:00',
      timestamp '2000-01-01 19:00:00',
      interval '45 minutes'
    ) AS gs
  )
  AND (
    (b.name = 'Gonzalo' AND extract(isodow from s.slot_date) IN (2, 4))
    OR (b.name IN ('Valentín', 'Valentin') AND extract(isodow from s.slot_date) BETWEEN 1 AND 5)
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.appointments a
    WHERE a.barber_id = s.barber_id
      AND a.booking_date = s.slot_date
      AND a.status IN ('PENDING', 'CONFIRMED', 'COMPLETED')
      AND tsrange(
        (a.booking_date + a.start_time)::timestamp,
        ((a.booking_date + CASE WHEN a.end_time <= a.start_time THEN 1 ELSE 0 END) + a.end_time)::timestamp,
        '[)'
      ) && tsrange(
        (s.slot_date + s.start_time)::timestamp,
        ((s.slot_date + CASE WHEN s.end_time <= s.start_time THEN 1 ELSE 0 END) + s.end_time)::timestamp,
        '[)'
      )
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.recurring_availability_rules r
    WHERE r.barber_id = s.barber_id
      AND r.active = true
      AND r.start_time = s.start_time
      AND s.slot_date >= r.start_date
      AND (r.end_date IS NULL OR s.slot_date <= r.end_date)
  );

-- Materializar la nueva grilla base para los próximos 60 días (para edición inmediata en Admin Horarios)
-- sin sobrescribir bloqueos UNAVAILABLE ni slots existentes.
WITH new_base_slots AS (
  -- Gonzalo Martes y Jueves: 11:00..19:15 (45m)
  SELECT
    b.id AS barber_id,
    d::date AS slot_date,
    gs::time AS start_time,
    (gs + interval '45 minutes')::time AS end_time
  FROM public.barbers b
  CROSS JOIN generate_series(
    (timezone('America/Argentina/Buenos_Aires', clock_timestamp()))::date,
    ((timezone('America/Argentina/Buenos_Aires', clock_timestamp()))::date + 60)::date,
    interval '1 day'
  ) AS d
  CROSS JOIN generate_series(
    timestamp '2000-01-01 11:00:00',
    timestamp '2000-01-01 19:15:00',
    interval '45 minutes'
  ) AS gs
  WHERE b.name = 'Gonzalo'
    AND b.active = true
    AND extract(isodow from d) IN (2, 4)

  UNION ALL

  -- Valentín Martes a Viernes: 12:00..19:30 (45m)
  SELECT
    b.id AS barber_id,
    d::date AS slot_date,
    gs::time AS start_time,
    (gs + interval '45 minutes')::time AS end_time
  FROM public.barbers b
  CROSS JOIN generate_series(
    (timezone('America/Argentina/Buenos_Aires', clock_timestamp()))::date,
    ((timezone('America/Argentina/Buenos_Aires', clock_timestamp()))::date + 60)::date,
    interval '1 day'
  ) AS d
  CROSS JOIN generate_series(
    timestamp '2000-01-01 12:00:00',
    timestamp '2000-01-01 19:30:00',
    interval '45 minutes'
  ) AS gs
  WHERE b.name IN ('Valentín', 'Valentin')
    AND b.active = true
    AND extract(isodow from d) BETWEEN 2 AND 5
)
INSERT INTO public.barber_availability_slots (barber_id, slot_date, start_time, end_time, status)
SELECT
  ns.barber_id,
  ns.slot_date,
  ns.start_time,
  ns.end_time,
  'AVAILABLE'::public.availability_status
FROM new_base_slots ns
WHERE NOT EXISTS (
  SELECT 1
  FROM public.barber_availability_slots blk
  WHERE blk.barber_id = ns.barber_id
    AND blk.slot_date = ns.slot_date
    AND blk.status = 'UNAVAILABLE'
    AND tsrange(
      (ns.slot_date + ns.start_time)::timestamp,
      (ns.slot_date + ns.end_time)::timestamp,
      '[)'
    ) && tsrange(
      (blk.slot_date + blk.start_time)::timestamp,
      ((blk.slot_date + CASE WHEN blk.end_time <= blk.start_time THEN 1 ELSE 0 END) + blk.end_time)::timestamp,
      '[)'
    )
)
ON CONFLICT (barber_id, slot_date, start_time) DO NOTHING;

COMMIT;
