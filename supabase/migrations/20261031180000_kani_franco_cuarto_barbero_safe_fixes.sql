-- Migration: 20261031180000_kani_franco_cuarto_barbero_safe_fixes.sql
-- KANI BARBER STUDIO — Validación final y aplicación segura de la incorporación de Franco:
-- 1. Centralizar definitivamente la seña ($5.000 unificada): read_public_deposit_amount desacoplada de barber_transfer_details.
-- 2. Preservar datos bancarios históricos: limpieza acotada de registros ficticios generados en pruebas previas.
-- 3. Preservar disponibilidades extraordinarias y horizonte dinámico continuo para Franco y barberos en read_valid_availability_starts.
-- 4. Auditar autorización y proteger datos personales (PII) en get_appointment_payment_details frente a consultas anónimas arbitrarias.
-- 5. Preservar integridad de funciones críticas (request_appointment, confirm_verified_appointment_payment).

-- ==============================================================================
-- 1. SEÑA CENTRALIZADA Y DESACOPLADA ($5.000)
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.read_public_deposit_amount(p_barber_name text DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
BEGIN
  -- Seña pública unificada y centralizada de Kani Barber Studio: $5.000 para todos los barberos y servicios
  RETURN 5000;
END;
$$;

REVOKE ALL ON FUNCTION public.read_public_deposit_amount(text) FROM public;
GRANT EXECUTE ON FUNCTION public.read_public_deposit_amount(text) TO anon, authenticated;

-- ==============================================================================
-- 2. LIMPIEZA ACOTADA EXCLUSIVAMENTE DE DATOS BANCARIOS FICTICIOS
-- ==============================================================================

DELETE FROM public.barber_transfer_details
WHERE barber_id IN (SELECT id FROM public.barbers WHERE name = 'Franco')
  AND (
    alias IN ('kanibarber.mp', 'franco.kani', 'kani.barber')
    OR cuit IN ('20-12345678-9', '20123456789', '00-00000000-0')
    OR holder_name ILIKE '%ficticio%'
    OR holder_name ILIKE '%test%'
  );

-- ==============================================================================
-- 3. DISPONIBILIDAD: HORIZONTE DINÁMICO Y PRESERVACIÓN DE SLOTS EXTRAORDINARIOS
-- ==============================================================================

-- Inicialización idempotente para los próximos 180 días con ON CONFLICT DO NOTHING
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
    (time '15:00:00', time '15:45:00'),
    (time '15:45:00', time '16:30:00'),
    (time '16:30:00', time '17:15:00'),
    (time '17:15:00', time '18:00:00'),
    (time '18:00:00', time '18:45:00'),
    (time '18:45:00', time '19:30:00'),
    (time '19:30:00', time '20:00:00')
) AS slot_def(start_time, end_time)
WHERE b.name = 'Franco'
  AND extract(isodow from d) = 6
ON CONFLICT (barber_id, slot_date, start_time) DO NOTHING;

-- read_valid_availability_starts con horizonte dinámico continuo
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
    -- Horizonte dinámico continuo para Franco (Sábados 15:00 a 20:00)
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
      AND extract(isodow from d) = 6
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
    SELECT DISTINCT barber_id, slot_date, start_time, end_time, slot_start_ts, slot_end_ts
    FROM (
      SELECT * FROM stored_available_slots
      UNION ALL
      SELECT * FROM recurring_base_slots
    ) combined
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
      SELECT * FROM standard_candidates
      UNION ALL
      SELECT * FROM franco_saturday_candidates
      UNION ALL
      SELECT * FROM extended_candidates
      UNION ALL
      SELECT * FROM closing_candidates
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
$$;

REVOKE ALL ON FUNCTION public.read_valid_availability_starts(uuid, date, date) FROM public;
GRANT EXECUTE ON FUNCTION public.read_valid_availability_starts(uuid, date, date) TO anon, authenticated;

-- ==============================================================================
-- 4. REQUEST_APPOINTMENT CON ATOMICIDAD DE SLOTS Y PRECIO EFECTIVO
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
  IF v_barber.name = 'Franco' AND extract(isodow from p_booking_date) = 6 THEN
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
  ELSIF v_barber.name <> 'Franco' AND extract(isodow from p_booking_date) BETWEEN 1 AND 6 THEN
    INSERT INTO public.barber_availability_slots (barber_id, slot_date, start_time, end_time, status)
    SELECT
      v_barber.id,
      p_booking_date,
      gs::time AS start_time,
      (gs + interval '45 minutes')::time AS end_time,
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

-- ==============================================================================
-- 5. GET_APPOINTMENT_PAYMENT_DETAILS CON AUTORIZACIÓN Y PROTECCIÓN DE DATOS
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.get_appointment_payment_details(p_appointment_id uuid)
RETURNS TABLE (
  appointment_id uuid,
  appointment_status public.appointment_status,
  booking_date date,
  start_time time,
  end_time time,
  barber_id uuid,
  barber_name text,
  service_id uuid,
  service_name text,
  service_price_ars integer,
  down_payment_ars integer,
  client_name text,
  client_email text,
  client_phone text,
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
DECLARE
  v_is_privileged boolean;
BEGIN
  -- Autorización estricta:
  -- Privilegiado si es service_role (backend de Mercado Pago / Payway), administrador o staff autorizado
  v_is_privileged := (
    coalesce((SELECT auth.role()), '') = 'service_role'
    OR current_user = 'service_role'
    OR public.is_admin()
    OR public.current_staff_barber_id() IS NOT NULL
  );

  RETURN QUERY
  SELECT
    a.id AS appointment_id,
    a.status AS appointment_status,
    a.booking_date,
    a.start_time,
    a.end_time,
    b.id AS barber_id,
    b.name AS barber_name,
    s.id AS service_id,
    s.name AS service_name,
    coalesce(a.service_price_ars, bsp.price_ars, s.price_ars) AS service_price_ars,
    coalesce(a.deposit_amount_ars, 5000) AS down_payment_ars,
    coalesce(a.booking_client_name, c.name) AS client_name,
    -- Protección de datos personales (PII): anon no recibe email ni teléfono sin enmascarar
    CASE
      WHEN v_is_privileged THEN coalesce(c.email, '')
      ELSE regexp_replace(coalesce(c.email, ''), '^(.)(.*)(@.*)$', '\1***\3')
    END AS client_email,
    CASE
      WHEN v_is_privileged THEN coalesce(c.phone, '')
      ELSE regexp_replace(coalesce(c.phone, ''), '(\d{2})\d+(\d{2})$', '\1****\2')
    END AS client_phone,
    a.created_at
  FROM public.appointments a
  JOIN public.barbers b ON b.id = a.barber_id
  JOIN public.services s ON s.id = a.service_id
  LEFT JOIN public.clients c ON c.id = a.client_id
  LEFT JOIN public.barber_service_prices bsp ON bsp.barber_id = a.barber_id AND bsp.service_id = a.service_id AND bsp.active = true
  WHERE a.id = p_appointment_id
    -- Si el visitante es anónimo (no privilegiado), solo puede consultar reservas recientes (ventana de pago / confirmación de 48 hs)
    -- en estado PENDING o CONFIRMED, impidiendo el scraping de turnos históricos
    AND (
      v_is_privileged
      OR (a.created_at >= (now() - interval '48 hours') AND a.status IN ('PENDING', 'CONFIRMED'))
    );
END;
$$;

REVOKE ALL ON FUNCTION public.get_appointment_payment_details(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.get_appointment_payment_details(uuid) TO anon, authenticated, service_role;

-- ==============================================================================
-- 6. CONFIRM_VERIFIED_APPOINTMENT_PAYMENT CON SALDO RESTANTE $0 (BALANCE_PAID = TRUE)
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.confirm_verified_appointment_payment(
  p_appointment_id uuid,
  p_provider text,
  p_reference text,
  p_paid_amount numeric
)
RETURNS TABLE (
  appointment_status public.appointment_status,
  result_code text,
  notification_claim_token text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_appt public.appointments%ROWTYPE;
  v_order public.appointment_payment_orders%ROWTYPE;
  v_attempt public.payment_attempts%ROWTYPE;
  v_token text;
  v_resolution text;
  v_collision boolean;
  v_past boolean;
BEGIN
  SELECT * INTO v_appt FROM public.appointments WHERE id = p_appointment_id;
  IF NOT FOUND THEN
    RETURN QUERY SELECT null::public.appointment_status, 'APPOINTMENT_NOT_FOUND'::text, null::text;
    RETURN;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_appt.barber_id::text || '|' || v_appt.booking_date::text, 0));
  SELECT * INTO v_appt FROM public.appointments WHERE id = p_appointment_id FOR UPDATE;

  IF p_provider = 'MERCADO_PAGO' THEN
    SELECT * INTO v_order FROM public.appointment_payment_orders WHERE appointment_id = p_appointment_id FOR UPDATE;
    IF NOT FOUND OR p_reference IS NULL OR v_order.order_id IS DISTINCT FROM p_reference OR p_paid_amount IS DISTINCT FROM v_order.expected_amount_ars::numeric THEN
      RETURN QUERY SELECT v_appt.status, 'PAYMENT_MISMATCH'::text, null::text;
      RETURN;
    END IF;
    UPDATE public.appointment_payment_orders
    SET paid_amount_ars = p_paid_amount::integer, updated_at = now()
    WHERE appointment_id = p_appointment_id;
  ELSIF p_provider = 'PAYWAY' THEN
    SELECT * INTO v_attempt FROM public.payment_attempts WHERE id = p_reference::uuid AND appointment_id = p_appointment_id AND provider = 'PAYWAY' FOR UPDATE;
    IF NOT FOUND OR v_attempt.state <> 'APPROVED' OR v_attempt.provider_transaction_id IS NULL OR p_paid_amount IS DISTINCT FROM v_attempt.amount_ars THEN
      RETURN QUERY SELECT v_appt.status, 'PAYMENT_MISMATCH'::text, null::text;
      RETURN;
    END IF;
  ELSE
    RETURN QUERY SELECT v_appt.status, 'PAYMENT_MISMATCH'::text, null::text;
    RETURN;
  END IF;

  IF v_appt.status IN ('CONFIRMED', 'COMPLETED') THEN
    IF NOT v_appt.deposit_paid THEN
      UPDATE public.appointments
      SET deposit_paid = true,
          deposit_amount_ars = p_paid_amount::integer,
          balance_paid = CASE WHEN coalesce(service_price_ars, 0) <= p_paid_amount::integer THEN true ELSE balance_paid END,
          updated_at = now()
      WHERE id = p_appointment_id;
    END IF;
    IF p_provider = 'PAYWAY' THEN
      UPDATE public.payment_attempts SET confirmation_status = 'ALREADY_CONFIRMED' WHERE id = v_attempt.id;
    END IF;
    RETURN QUERY SELECT v_appt.status, 'ALREADY_CONFIRMED'::text, null::text;
    RETURN;
  END IF;

  v_collision := EXISTS (
    SELECT 1 FROM public.appointments other
    WHERE other.barber_id = v_appt.barber_id
      AND other.booking_date = v_appt.booking_date
      AND other.id <> v_appt.id
      AND other.status IN ('PENDING', 'CONFIRMED', 'COMPLETED')
      AND other.start_time < v_appt.end_time
      AND other.end_time > v_appt.start_time
  );
  v_past := (v_appt.booking_date + v_appt.start_time <= timezone('America/Argentina/Buenos_Aires', now()));

  IF v_appt.status = 'CANCELLED' AND coalesce(v_appt.cancellation_reason, '') <> 'PAYMENT_EXPIRED' THEN
    v_resolution := 'PAID_CANCELLED_REVIEW';
  ELSIF v_collision OR v_past THEN
    v_resolution := 'PAID_LATE_REVIEW';
  END IF;

  IF v_resolution IS NOT NULL THEN
    IF p_provider = 'MERCADO_PAGO' THEN
      UPDATE public.appointment_payment_orders SET reconciliation_status = v_resolution, updated_at = now() WHERE appointment_id = p_appointment_id;
    ELSE
      UPDATE public.payment_attempts SET confirmation_status = v_resolution WHERE id = v_attempt.id;
    END IF;
    RETURN QUERY SELECT v_appt.status, CASE WHEN v_resolution = 'PAID_CANCELLED_REVIEW' THEN 'APPOINTMENT_CANCELLED' ELSE 'SLOT_COLLISION_LATE_PAYMENT' end, null::text;
    RETURN;
  END IF;

  PERFORM set_config('kani.verified_payment_appointment', p_appointment_id::text, true);
  UPDATE public.appointments
  SET status = 'CONFIRMED',
      deposit_paid = true,
      deposit_amount_ars = p_paid_amount::integer,
      balance_paid = CASE WHEN coalesce(service_price_ars, 0) <= p_paid_amount::integer THEN true ELSE balance_paid END,
      cancellation_reason = null,
      cancelled_at = null,
      cancelled_by = null,
      updated_at = now()
  WHERE id = p_appointment_id;
  PERFORM set_config('kani.verified_payment_appointment', '', true);

  IF p_provider = 'MERCADO_PAGO' THEN
    UPDATE public.appointment_payment_orders SET reconciliation_status = 'CONFIRMED', updated_at = now() WHERE appointment_id = p_appointment_id;
  ELSE
    UPDATE public.payment_attempts SET confirmation_status = 'CONFIRMED' WHERE id = v_attempt.id;
  END IF;

  v_token := public.create_appointment_notification_event(p_appointment_id, 'CONFIRMED');
  RETURN QUERY SELECT 'CONFIRMED'::public.appointment_status, 'CONFIRMED'::text, v_token;
END;
$$;

REVOKE ALL ON FUNCTION public.confirm_verified_appointment_payment(uuid, text, text, numeric) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_verified_appointment_payment(uuid, text, text, numeric) TO service_role;
