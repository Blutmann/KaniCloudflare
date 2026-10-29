-- ==============================================================================
-- KANI Barber Studio — Admin V2: Horarios fuera de horario comercial + Eliminación segura de clientes
-- Fecha: 2026-10-29
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. HORARIOS: Eliminar la constraint que confunde business hours con disponibilidad administrativa
-- ------------------------------------------------------------------------------

ALTER TABLE public.barber_availability_slots
  DROP CONSTRAINT IF EXISTS availability_inside_business_hours,
  DROP CONSTRAINT IF EXISTS availability_inside_extended_hours;

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

-- Actualizar create_availability_slots para permitir horarios extraordinarios y excepciones de domingo por ADMIN
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
  v_is_admin boolean := public.is_admin();
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION USING errcode = '42501', message = 'AUTH_REQUIRED';
  END IF;

  IF NOT v_is_admin AND public.current_staff_barber_id() IS DISTINCT FROM p_barber_id THEN
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

  -- Duración operativa exacta de 45 minutos si no se provee fin
  v_end_time := coalesce(
    p_end_time,
    (p_start_time + interval '45 minutes')::time
  );

  FOREACH v_date IN ARRAY p_slot_dates LOOP
    -- Admite excepciones en domingos exclusivamente a administradores
    IF v_date IS NULL OR v_date < v_today OR (extract(isodow from v_date) = 7 AND NOT v_is_admin) THEN
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

REVOKE ALL ON FUNCTION public.create_availability_slots(uuid, date[], time, time) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.create_availability_slots(uuid, date[], time, time) TO authenticated;

-- Asegurar que read_valid_availability_starts mantenga horarios públicos 10:00-19:00 de lunes a sábado
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
  v_is_public boolean := (auth.uid() IS NULL);
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
      -- En reservas públicas, domingos permanecen cerrados
      AND (NOT v_is_public OR extract(isodow from s.slot_date) <> 7)
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
    -- Disponibilidad pública sólo expone inicios dentro de la ventana comercial 10:00 a 19:00
    WHERE (NOT v_is_public)
       OR (s.start_time >= time '10:00' AND s.start_time <= time '19:00')
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

-- ------------------------------------------------------------------------------
-- 2. CLIENTES: Soft delete, seguridad de eliminación exclusiva por ADMIN y preservación de historial
-- ------------------------------------------------------------------------------

-- Agregar columna deleted_at si no existe
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz DEFAULT NULL;

-- Actualizar políticas RLS en public.clients:
-- SELECT: staff autenticado puede leer clientes
-- INSERT: staff autenticado puede crear clientes
-- UPDATE: staff autenticado puede editar clientes
-- DELETE: EXCLUSIVAMENTE ADMIN puede eliminar clientes

DROP POLICY IF EXISTS staff_can_manage_clients ON public.clients;
DROP POLICY IF EXISTS admin_can_manage_clients ON public.clients;
DROP POLICY IF EXISTS admin_can_delete_clients ON public.clients;
DROP POLICY IF EXISTS staff_can_insert_clients ON public.clients;
DROP POLICY IF EXISTS staff_can_update_clients ON public.clients;
DROP POLICY IF EXISTS staff_can_read_clients ON public.clients;

CREATE POLICY staff_can_read_clients
  ON public.clients
  FOR SELECT
  TO authenticated
  USING (
    public.is_admin()
    OR public.current_staff_barber_id() IS NOT NULL
  );

CREATE POLICY staff_can_insert_clients
  ON public.clients
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_admin()
    OR public.current_staff_barber_id() IS NOT NULL
  );

CREATE POLICY staff_can_update_clients
  ON public.clients
  FOR UPDATE
  TO authenticated
  USING (
    public.is_admin()
    OR public.current_staff_barber_id() IS NOT NULL
  )
  WITH CHECK (
    public.is_admin()
    OR public.current_staff_barber_id() IS NOT NULL
  );

CREATE POLICY admin_can_delete_clients
  ON public.clients
  FOR DELETE
  TO authenticated
  USING (
    public.is_admin()
  );

-- RPC para eliminación segura de clientes: soft-delete protegiendo historial
CREATE OR REPLACE FUNCTION public.delete_client(p_client_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
DECLARE
  v_is_admin boolean := public.is_admin();
  v_has_relations boolean;
BEGIN
  IF (SELECT auth.uid()) IS NULL OR NOT v_is_admin THEN
    RAISE EXCEPTION USING errcode = '42501', message = 'ADMIN_ROLE_REQUIRED';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.clients WHERE id = p_client_id) THEN
    RAISE EXCEPTION USING errcode = 'P0002', message = 'CLIENT_NOT_FOUND';
  END IF;

  -- Comprobar si existen citas asociadas
  SELECT EXISTS (
    SELECT 1 FROM public.appointments WHERE client_id = p_client_id
  ) INTO v_has_relations;

  IF NOT v_has_relations THEN
    -- Si no tiene relaciones, intentar borrado físico; si otra tabla lo restringe, hacer soft-delete
    BEGIN
      DELETE FROM public.clients WHERE id = p_client_id;
      RETURN true;
    EXCEPTION WHEN foreign_key_violation THEN
      UPDATE public.clients
      SET deleted_at = now(), updated_at = now()
      WHERE id = p_client_id;
      RETURN true;
    END;
  ELSE
    -- Con historial previo: soft-delete obligatorio para preservar trazabilidad
    UPDATE public.clients
    SET deleted_at = now(), updated_at = now()
    WHERE id = p_client_id;
    RETURN true;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_client(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.delete_client(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
