-- Migration: 20261031200000_kani_fix_sql_42702_request_appointment_ambiguity.sql
-- KANI BARBER STUDIO — Reparación de ambigüedad SQL 42702 y Horario definitivo de Franco
--
-- 1. Reparación de SQLSTATE 42702 en request_appointment:
--    La función declara 'RETURNS TABLE (..., start_time time, end_time time, ...)', lo que
--    introduce la variable PL/pgSQL 'start_time' en el ámbito de la función. Al evaluar la cláusula
--    'ON CONFLICT (barber_id, slot_date, start_time) DO NOTHING', el compilador PL/pgSQL detecta
--    ambigüedad entre la columna de public.barber_availability_slots y la variable de retorno.
--    Solución: Se declara '#variable_conflict use_column' al inicio del cuerpo de la función y se
--    califican explícitamente los campos del RETURNING (inserted.id, inserted.start_time, etc.).
--
-- 2. Horario definitivo de Franco:
--    Franco trabaja de Lunes a Sábados de 16:00 a 20:00 (extract(isodow from d) BETWEEN 1 AND 6).
--    Se actualizan atómicamente:
--      a) public.read_valid_availability_starts (horizonte dinámico y candidatos de lunes a sábados 16:00 a 20:00).
--      b) public.request_appointment (generación de slots recurrentes de lunes a sábados 16:00 a 20:00).
--      c) Generación idempotente para los próximos 180 días con ON CONFLICT DO NOTHING.
--      d) Depuración segura y no destructiva de slots no reservados anteriores a las 16:00 para Franco.
--    Se preservan intactos todos los bloqueos administrativos (UNAVAILABLE), disponibilidades
--    extraordinarias, turnos existentes y la seña unificada de $5.000.

-- ==============================================================================
-- 1. POBLADO IDEMPOTENTE DE DISPONIBILIDAD PARA FRANCO (LUNES A SÁBADOS 16:00 A 20:00)
-- ==============================================================================

INSERT INTO public.barber_availability_slots (barber_id, slot_date, start_time, end_time, status)
SELECT
  b.id,
  d::date,
  slot_def.start_time,
  slot_def.end_time,
  'AVAILABLE'::public.availability_status
FROM public.barbers b
CROSS JOIN generate_series(
  (timezone('America/Argentina/Buenos_Aires', clock_timestamp()))::date,
  ((timezone('America/Argentina/Buenos_Aires', clock_timestamp()))::date + 180)::date,
  interval '1 day'
) AS d
CROSS JOIN (
  VALUES
    (time '16:00:00', time '16:45:00'),
    (time '16:45:00', time '17:30:00'),
    (time '17:30:00', time '18:15:00'),
    (time '18:15:00', time '19:00:00'),
    (time '19:00:00', time '19:45:00'),
    (time '19:30:00', time '20:00:00')
) AS slot_def(start_time, end_time)
WHERE b.name = 'Franco'
  AND extract(isodow from d) BETWEEN 1 AND 6
ON CONFLICT (barber_id, slot_date, start_time) DO NOTHING;

-- Depuración segura: retirar slots disponibles no reservados previos a las 16:00 para Franco,
-- preservando turnos existentes, cancelados o bloqueos administrativos (UNAVAILABLE).
DELETE FROM public.barber_availability_slots s
WHERE s.barber_id IN (SELECT id FROM public.barbers WHERE name = 'Franco')
  AND s.start_time < time '16:00:00'
  AND s.status = 'AVAILABLE'
  AND NOT EXISTS (
    SELECT 1 FROM public.appointments a
    WHERE a.barber_id = s.barber_id
      AND a.booking_date = s.slot_date
      AND a.status <> 'CANCELLED'
      AND tsrange(
        (a.booking_date + a.start_time)::timestamp,
        ((a.booking_date + CASE WHEN a.end_time <= a.start_time THEN 1 ELSE 0 END) + a.end_time)::timestamp,
        '[)'
      ) && tsrange(
        (s.slot_date + s.start_time)::timestamp,
        ((s.slot_date + CASE WHEN s.end_time <= s.start_time THEN 1 ELSE 0 END) + s.end_time)::timestamp,
        '[)'
      )
  );

-- ==============================================================================
-- 2. READ_VALID_AVAILABILITY_STARTS CON HORIZONTE DINÁMICO (LUNES A SÁBADOS 16:00 A 20:00)
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
  WITH recurring_base_slots AS (
    -- Horizonte dinámico continuo para Franco (Lunes a Sábados 16:00 a 20:00)
    SELECT
      b.id AS barber_id,
      d::date AS slot_date,
      slot_def.start_time,
      slot_def.end_time,
      (d::date + slot_def.start_time)::timestamp AS slot_start_ts,
      ((d::date + CASE WHEN slot_def.end_time <= slot_def.start_time THEN 1 ELSE 0 END) + slot_def.end_time)::timestamp AS slot_end_ts
    FROM public.barbers b
    CROSS JOIN generate_series(v_from, v_to, interval '1 day') AS d
    CROSS JOIN (
      VALUES
        (time '16:00:00', time '16:45:00'),
        (time '16:45:00', time '17:30:00'),
        (time '17:30:00', time '18:15:00'),
        (time '18:15:00', time '19:00:00'),
        (time '19:00:00', time '19:45:00'),
        (time '19:30:00', time '20:00:00')
    ) AS slot_def(start_time, end_time)
    WHERE b.name = 'Franco'
      AND b.active = true
      AND extract(isodow from d) BETWEEN 1 AND 6
      AND (p_barber_id IS NULL OR b.id = p_barber_id)
      AND NOT EXISTS (
        SELECT 1
        FROM public.barber_availability_slots blk
        WHERE blk.barber_id = b.id
          AND blk.slot_date = d::date
          AND blk.status = 'UNAVAILABLE'
          AND tsrange(
            d::date + slot_def.start_time,
            (d::date + CASE WHEN slot_def.end_time <= slot_def.start_time THEN 1 ELSE 0 END) + slot_def.end_time,
            '[)'
          ) && tsrange(
            blk.slot_date + blk.start_time,
            (blk.slot_date + CASE WHEN blk.end_time <= blk.start_time THEN 1 ELSE 0 END) + blk.end_time,
            '[)'
          )
      )
  ), stored_available_slots AS (
    -- Slots explícitos almacenados en BD (incluye disponibilidades extraordinarias y manuales de barberos)
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
  ), available_slots AS (
    SELECT
      s.barber_id,
      s.slot_date,
      s.start_time,
      s.end_time,
      s.slot_start_ts,
      s.slot_end_ts
    FROM stored_available_slots s
    UNION
    SELECT
      r.barber_id,
      r.slot_date,
      r.start_time,
      r.end_time,
      r.slot_start_ts,
      r.slot_end_ts
    FROM recurring_base_slots r
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
  ), franco_candidates AS (
    SELECT DISTINCT
      s.barber_id,
      s.slot_date,
      (s.slot_date + franco_time.t)::timestamp AS candidate_start,
      false AS is_exception
    FROM available_slots s
    JOIN public.barbers b ON b.id = s.barber_id AND b.name = 'Franco'
    CROSS JOIN (
      VALUES
        (time '16:00:00'),
        (time '16:45:00'),
        (time '17:30:00'),
        (time '18:15:00'),
        (time '19:00:00'),
        (time '19:15:00'),
        (time '19:30:00')
    ) AS franco_time(t)
    WHERE extract(isodow from s.slot_date) BETWEEN 1 AND 6
      AND (s.slot_date + franco_time.t)::timestamp >= s.slot_start_ts
      AND (s.slot_date + franco_time.t)::timestamp < s.slot_end_ts
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
  ), closing_candidates AS (
    SELECT DISTINCT
      s.barber_id,
      s.slot_date,
      (s.slot_date + offset_time.t)::timestamp AS candidate_start,
      false AS is_exception
    FROM available_slots s
    CROSS JOIN (
      VALUES (time '19:00:00'), (time '19:15:00'), (time '19:30:00')
    ) AS offset_time(t)
    WHERE (s.slot_date + offset_time.t)::timestamp >= s.slot_start_ts
      AND (s.slot_date + offset_time.t)::timestamp < s.slot_end_ts
  ), all_candidates AS (
    SELECT
      u.barber_id,
      u.slot_date,
      u.candidate_start,
      bool_and(u.is_exception) AS is_exception
    FROM (
      SELECT sc.barber_id, sc.slot_date, sc.candidate_start, sc.is_exception FROM standard_candidates sc
      UNION ALL
      SELECT fc.barber_id, fc.slot_date, fc.candidate_start, fc.is_exception FROM franco_candidates fc
      UNION ALL
      SELECT ec.barber_id, ec.slot_date, ec.candidate_start, ec.is_exception FROM extended_candidates ec
      UNION ALL
      SELECT cc.barber_id, cc.slot_date, cc.candidate_start, cc.is_exception FROM closing_candidates cc
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
              c.candidate_start + (requested.segment_index + 1) * interval '5 minutes',
              '[)'
            ) <@ tsrange(
              available.slot_start_ts,
              available.slot_end_ts,
              '[)'
            )
            AND NOT EXISTS (
              SELECT 1
              FROM public.barber_availability_slots blocked
              WHERE blocked.barber_id = c.barber_id
                AND blocked.slot_date = c.slot_date
                AND blocked.status = 'UNAVAILABLE'
                AND tsrange(
                  c.candidate_start + requested.segment_index * interval '5 minutes',
                  c.candidate_start + (requested.segment_index + 1) * interval '5 minutes',
                  '[)'
                ) && tsrange(
                  (blocked.slot_date + blocked.start_time)::timestamp,
                  ((blocked.slot_date + CASE WHEN blocked.end_time <= blocked.start_time THEN 1 ELSE 0 END) + blocked.end_time)::timestamp,
                  '[)'
                )
            )
        )
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.appointments appt
        WHERE appt.barber_id = c.barber_id
          AND appt.booking_date = c.slot_date
          AND appt.status <> 'CANCELLED'
          AND tsrange(
            (appt.booking_date + appt.start_time)::timestamp,
            ((appt.booking_date + CASE WHEN appt.end_time <= appt.start_time THEN 1 ELSE 0 END) + appt.end_time)::timestamp,
            '[)'
          ) && tsrange(
            c.candidate_start,
            c.candidate_start + svc.duration_minutes * interval '1 minute',
            '[)'
          )
      )
  ) compatibility
  WHERE cardinality(compatibility.compatible_services) > 0
  ORDER BY c.slot_date ASC, c.candidate_start ASC, c.barber_id ASC;
END;
$$;

REVOKE ALL ON FUNCTION public.read_valid_availability_starts(uuid, date, date) FROM public;
GRANT EXECUTE ON FUNCTION public.read_valid_availability_starts(uuid, date, date) TO anon, authenticated;

-- ==============================================================================
-- 3. REQUEST_APPOINTMENT CON SOLUCIÓN A SQLSTATE 42702 Y REGLA DE FRANCO
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
  WHERE s.name = trim(p_service_name)
    AND s.active = true;

  v_duration := v_service.duration_minutes * interval '1 minute';
  v_start_at := (p_booking_date + p_start_time)::timestamp;
  v_end_at := v_start_at + v_duration;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_barber.id::text || '|' || p_booking_date::text, 0));

  -- Garantizar atómicamente el slot base recurrente en public.barber_availability_slots si no existiera
  IF v_barber.name = 'Franco' AND extract(isodow from p_booking_date) BETWEEN 1 AND 6 THEN
    INSERT INTO public.barber_availability_slots (barber_id, slot_date, start_time, end_time, status)
    VALUES
      (v_barber.id, p_booking_date, time '16:00:00', time '16:45:00', 'AVAILABLE'),
      (v_barber.id, p_booking_date, time '16:45:00', time '17:30:00', 'AVAILABLE'),
      (v_barber.id, p_booking_date, time '17:30:00', time '18:15:00', 'AVAILABLE'),
      (v_barber.id, p_booking_date, time '18:15:00', time '19:00:00', 'AVAILABLE'),
      (v_barber.id, p_booking_date, time '19:00:00', time '19:45:00', 'AVAILABLE'),
      (v_barber.id, p_booking_date, time '19:30:00', time '20:00:00', 'AVAILABLE')
    ON CONFLICT (barber_id, slot_date, start_time) DO NOTHING;
  ELSIF v_barber.name <> 'Franco' AND extract(isodow from p_booking_date) BETWEEN 1 AND 6 THEN
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

  -- Calcular precio efectivo (promocional si existe en barber_service_prices o estándar de services)
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
$$;

REVOKE ALL ON FUNCTION public.request_appointment(text, text, date, time, text, text, text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.request_appointment(text, text, date, time, text, text, text, text) TO anon, authenticated;
