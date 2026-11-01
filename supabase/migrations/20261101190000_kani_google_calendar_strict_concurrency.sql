-- ==============================================================================
-- KANI BARBER STUDIO — Migración: Concurrencia Estricta, Versiones y Permisos
-- Archivo: 20261101190000_kani_google_calendar_strict_concurrency.sql
-- 
-- 1. Exige coincidencia estricta de (id, version, claimed_by, sync_status = 'PROCESSING')
--    en record_calendar_sync_success_v2 y record_calendar_sync_failure_v2.
--    No permite p_version IS NULL ni p_worker_id IS NULL.
-- 2. El trigger de citas (handle_appointment_calendar_sync) incrementa versión y
--    libera leases ante modificaciones o cancelaciones para invalidar workers obsoletos.
-- 3. Permisos estrictos: Revoca EXECUTE en todas las RPCs de sincronización a PUBLIC,
--    anon y authenticated; otorga permisos exclusivamente a service_role.
-- 4. Conciliación estricta (reconcile_stale_calendar_sync_items): descarta turnos
--    cancelados y pasados sin sincronizar, y solo reservas con marcador técnico explícito
--    ([AUDIT-TEST]), preservando todas las reservas legítimas futuras.
-- ==============================================================================

-- 1. RPC de éxito con control estricto de versión, worker_id y estado PROCESSING
CREATE OR REPLACE FUNCTION public.record_calendar_sync_success_v2(
  p_sync_id uuid,
  p_worker_id text,
  p_version integer,
  p_google_event_id text,
  p_calendar_id text,
  p_checksum text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
BEGIN
  IF p_worker_id IS NULL OR length(trim(p_worker_id)) = 0 OR p_version IS NULL THEN
    RAISE EXCEPTION 'INVALID_CONCURRENCY_PARAMS: Se requiere p_worker_id y p_version obligatorios.';
  END IF;

  UPDATE public.appointment_calendar_sync
  SET sync_status = 'SYNCED',
      google_event_id = p_google_event_id,
      calendar_id = p_calendar_id,
      previous_calendar_id = NULL,
      previous_google_event_id = NULL,
      payload_checksum = p_checksum,
      last_error = NULL,
      claimed_by = NULL,
      claimed_at = NULL,
      claim_expires_at = NULL,
      synced_at = clock_timestamp(),
      updated_at = clock_timestamp()
  WHERE id = p_sync_id
    AND version = p_version
    AND claimed_by = p_worker_id
    AND sync_status = 'PROCESSING';

  RETURN FOUND;
END;
$$;

-- 2. RPC de fallo con control estricto de versión, worker_id y estado PROCESSING
CREATE OR REPLACE FUNCTION public.record_calendar_sync_failure_v2(
  p_sync_id uuid,
  p_worker_id text,
  p_version integer,
  p_error text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
BEGIN
  IF p_worker_id IS NULL OR length(trim(p_worker_id)) = 0 OR p_version IS NULL THEN
    RAISE EXCEPTION 'INVALID_CONCURRENCY_PARAMS: Se requiere p_worker_id y p_version obligatorios.';
  END IF;

  UPDATE public.appointment_calendar_sync
  SET attempts = attempts + 1,
      last_attempt_at = clock_timestamp(),
      last_error = p_error,
      sync_status = CASE WHEN attempts + 1 >= max_attempts THEN 'FAILED' ELSE 'PENDING' END,
      claimed_by = NULL,
      claimed_at = NULL,
      claim_expires_at = NULL,
      updated_at = clock_timestamp()
  WHERE id = p_sync_id
    AND version = p_version
    AND claimed_by = p_worker_id
    AND sync_status = 'PROCESSING';

  RETURN FOUND;
END;
$$;

-- 3. RPC de reclamo atómico obligatorio
CREATE OR REPLACE FUNCTION public.claim_pending_calendar_sync_jobs(
  p_worker_id text,
  p_limit integer DEFAULT 10,
  p_lease_seconds integer DEFAULT 120
)
RETURNS TABLE (
  sync_id uuid,
  appointment_id uuid,
  barber_id uuid,
  barber_name text,
  calendar_id text,
  google_event_id text,
  previous_calendar_id text,
  previous_google_event_id text,
  sync_action text,
  attempts integer,
  payload_checksum text,
  booking_date date,
  start_time time,
  end_time time,
  request_number integer,
  client_name text,
  service_name text,
  custom_service_name text,
  service_price_ars integer,
  deposit_paid boolean,
  deposit_amount_ars integer,
  sync_version integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
DECLARE
  v_lease_interval interval := (least(greatest(p_lease_seconds, 30), 600) || ' seconds')::interval;
BEGIN
  IF p_worker_id IS NULL OR length(trim(p_worker_id)) = 0 THEN
    RAISE EXCEPTION 'WORKER_ID_REQUIRED: Se requiere un identificador de worker para reclamar trabajos.';
  END IF;

  RETURN QUERY
  WITH candidate_jobs AS (
    SELECT s.id
    FROM public.appointment_calendar_sync s
    WHERE (
      -- Estado PENDING listo para ejecución según backoff exponencial
      (s.sync_status = 'PENDING' AND (
        s.last_attempt_at IS NULL
        OR s.last_attempt_at + (power(2, least(s.attempts, 6)) * interval '10 seconds') <= clock_timestamp()
      ))
      OR
      -- O estado PROCESSING cuyo lease venció (recuperación de workers caídos)
      (s.sync_status = 'PROCESSING' AND s.claim_expires_at < clock_timestamp())
    )
    AND s.attempts < s.max_attempts
    ORDER BY s.created_at ASC
    LIMIT least(coalesce(p_limit, 10), 50)
    FOR UPDATE SKIP LOCKED
  ),
  claimed_jobs AS (
    UPDATE public.appointment_calendar_sync s
    SET sync_status = 'PROCESSING',
        claimed_by = p_worker_id,
        claimed_at = clock_timestamp(),
        claim_expires_at = clock_timestamp() + v_lease_interval,
        version = s.version + 1,
        updated_at = clock_timestamp()
    FROM candidate_jobs c
    WHERE s.id = c.id
    RETURNING s.*
  )
  SELECT
    cj.id AS sync_id,
    a.id AS appointment_id,
    a.barber_id,
    b.name AS barber_name,
    coalesce(cj.calendar_id, bgc.calendar_id) AS calendar_id,
    cj.google_event_id,
    cj.previous_calendar_id,
    cj.previous_google_event_id,
    cj.sync_action,
    cj.attempts,
    cj.payload_checksum,
    a.booking_date,
    a.start_time,
    a.end_time,
    a.request_number,
    coalesce(a.booking_client_name, cl.name, 'Cliente Kani') AS client_name,
    coalesce(svc.name, 'Corte') AS service_name,
    a.custom_service_name,
    a.service_price_ars,
    coalesce(a.deposit_paid, false) AS deposit_paid,
    coalesce(a.deposit_amount_ars, 5000) AS deposit_amount_ars,
    cj.version AS sync_version
  FROM claimed_jobs cj
  JOIN public.appointments a ON a.id = cj.appointment_id
  JOIN public.barbers b ON b.id = a.barber_id
  LEFT JOIN public.barber_google_calendars bgc ON bgc.barber_id = a.barber_id
  LEFT JOIN public.clients cl ON cl.id = a.client_id
  LEFT JOIN public.services svc ON svc.id = a.service_id;
END;
$$;

-- 4. Actualización del trigger en appointments: invalida leases ante cancelaciones o modificaciones
CREATE OR REPLACE FUNCTION public.handle_appointment_calendar_sync()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
DECLARE
  v_new_calendar_id text;
  v_old_calendar_id text;
  v_sync public.appointment_calendar_sync%ROWTYPE;
BEGIN
  -- Operaciones sobre appointments
  IF TG_OP = 'INSERT' THEN
    -- Si se inserta directamente en CONFIRMED (ej: turno manual por staff)
    IF NEW.status = 'CONFIRMED' THEN
      SELECT calendar_id INTO v_new_calendar_id
      FROM public.barber_google_calendars
      WHERE barber_id = NEW.barber_id;

      INSERT INTO public.appointment_calendar_sync (
        appointment_id,
        barber_id,
        calendar_id,
        sync_action,
        sync_status,
        version
      ) VALUES (
        NEW.id,
        NEW.barber_id,
        v_new_calendar_id,
        'UPSERT',
        'PENDING',
        1
      )
      ON CONFLICT (appointment_id) DO UPDATE
      SET barber_id = EXCLUDED.barber_id,
          calendar_id = EXCLUDED.calendar_id,
          sync_action = 'UPSERT',
          sync_status = 'PENDING',
          version = appointment_calendar_sync.version + 1,
          claimed_by = NULL,
          claimed_at = NULL,
          claim_expires_at = NULL,
          payload_checksum = NULL,
          updated_at = clock_timestamp();
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    SELECT * INTO v_sync
    FROM public.appointment_calendar_sync
    WHERE appointment_id = NEW.id;

    -- Subcaso 2.1: El turno fue CANCELLED
    IF NEW.status = 'CANCELLED' AND OLD.status <> 'CANCELLED' THEN
      IF v_sync.id IS NOT NULL THEN
        IF v_sync.google_event_id IS NOT NULL THEN
          -- Si ya existe evento en Google Calendar, encolar eliminación y revocar lease activo
          UPDATE public.appointment_calendar_sync
          SET sync_action = 'DELETE',
              sync_status = 'PENDING',
              version = version + 1,
              claimed_by = NULL,
              claimed_at = NULL,
              claim_expires_at = NULL,
              updated_at = clock_timestamp()
          WHERE id = v_sync.id;
        ELSE
          -- Si estaba encolado y nunca se sincronizó en Google, marcar SKIPPED y revocar lease activo
          UPDATE public.appointment_calendar_sync
          SET sync_status = 'SKIPPED',
              last_error = 'CANCELLED_BEFORE_INITIAL_SYNC',
              version = version + 1,
              claimed_by = NULL,
              claimed_at = NULL,
              claim_expires_at = NULL,
              updated_at = clock_timestamp()
          WHERE id = v_sync.id;
        END IF;
      END IF;
      RETURN NEW;
    END IF;

    -- Subcaso 2.2: Transición de PENDING a CONFIRMED (Confirmación de pago)
    IF OLD.status = 'PENDING' AND NEW.status = 'CONFIRMED' THEN
      SELECT calendar_id INTO v_new_calendar_id
      FROM public.barber_google_calendars
      WHERE barber_id = NEW.barber_id;

      INSERT INTO public.appointment_calendar_sync (
        appointment_id,
        barber_id,
        calendar_id,
        sync_action,
        sync_status,
        version
      ) VALUES (
        NEW.id,
        NEW.barber_id,
        v_new_calendar_id,
        'UPSERT',
        'PENDING',
        1
      )
      ON CONFLICT (appointment_id) DO UPDATE
      SET barber_id = EXCLUDED.barber_id,
          calendar_id = EXCLUDED.calendar_id,
          sync_action = 'UPSERT',
          sync_status = 'PENDING',
          version = appointment_calendar_sync.version + 1,
          claimed_by = NULL,
          claimed_at = NULL,
          claim_expires_at = NULL,
          payload_checksum = NULL,
          updated_at = clock_timestamp();

      RETURN NEW;
    END IF;

    -- Subcaso 2.3: El turno está CONFIRMED y cambian datos de la cita (fecha, hora, servicio, barbero)
    IF NEW.status = 'CONFIRMED' AND (
      NEW.booking_date IS DISTINCT FROM OLD.booking_date OR
      NEW.start_time IS DISTINCT FROM OLD.start_time OR
      NEW.end_time IS DISTINCT FROM OLD.end_time OR
      NEW.service_id IS DISTINCT FROM OLD.service_id OR
      NEW.barber_id IS DISTINCT FROM OLD.barber_id OR
      coalesce(NEW.custom_service_name, '') IS DISTINCT FROM coalesce(OLD.custom_service_name, '')
    ) THEN
      SELECT calendar_id INTO v_new_calendar_id
      FROM public.barber_google_calendars
      WHERE barber_id = NEW.barber_id;

      IF v_sync.id IS NOT NULL THEN
        -- Si cambió el barbero y ya había un evento creado en Google Calendar:
        IF NEW.barber_id IS DISTINCT FROM OLD.barber_id AND v_sync.google_event_id IS NOT NULL THEN
          SELECT calendar_id INTO v_old_calendar_id
          FROM public.barber_google_calendars
          WHERE barber_id = OLD.barber_id;

          UPDATE public.appointment_calendar_sync
          SET barber_id = NEW.barber_id,
              calendar_id = v_new_calendar_id,
              previous_calendar_id = coalesce(v_sync.calendar_id, v_old_calendar_id),
              previous_google_event_id = v_sync.google_event_id,
              google_event_id = NULL,
              sync_action = 'UPSERT',
              sync_status = 'PENDING',
              version = version + 1,
              claimed_by = NULL,
              claimed_at = NULL,
              claim_expires_at = NULL,
              payload_checksum = NULL,
              updated_at = clock_timestamp()
          WHERE id = v_sync.id;
        ELSE
          -- Mismo barbero o no tenía evento previo: actualización normal con invalidación de lease
          UPDATE public.appointment_calendar_sync
          SET barber_id = NEW.barber_id,
              calendar_id = v_new_calendar_id,
              sync_action = 'UPSERT',
              sync_status = 'PENDING',
              version = version + 1,
              claimed_by = NULL,
              claimed_at = NULL,
              claim_expires_at = NULL,
              payload_checksum = NULL,
              updated_at = clock_timestamp()
          WHERE id = v_sync.id;
        END IF;
      ELSE
        -- No existía fila previa de sincronización
        INSERT INTO public.appointment_calendar_sync (
          appointment_id,
          barber_id,
          calendar_id,
          sync_action,
          sync_status,
          version
        ) VALUES (
          NEW.id,
          NEW.barber_id,
          v_new_calendar_id,
          'UPSERT',
          'PENDING',
          1
        );
      END IF;
    END IF;

    RETURN NEW;
  END IF;

  RETURN NULL;
END;
$$;

-- 5. Conciliación con criterios explícitos y verificables (sin búsqueda indiscriminada de texto)
CREATE OR REPLACE FUNCTION public.reconcile_stale_calendar_sync_items()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
DECLARE
  v_test_count integer := 0;
  v_cancelled_count integer := 0;
  v_past_count integer := 0;
  v_preserved_count integer := 0;
BEGIN
  -- 1. Descartar únicamente reservas con marcador técnico explícito de prueba/auditoría
  WITH test_rows AS (
    SELECT s.id
    FROM public.appointment_calendar_sync s
    JOIN public.appointments a ON a.id = s.appointment_id
    WHERE s.sync_status IN ('PENDING', 'PROCESSING')
      AND (
        coalesce(a.notes, '') LIKE '%[AUDIT-TEST]%'
        OR coalesce(a.notes, '') LIKE '%[TEST-FIXTURE]%'
        OR a.booking_client_name IN ('TEST_FIXTURE', 'AUDIT_TEST')
      )
  )
  UPDATE public.appointment_calendar_sync s
  SET sync_status = 'SKIPPED',
      last_error = 'TEST_FICTITIOUS_APPOINTMENT: Marcador explícito de prueba técnica.',
      claimed_by = NULL,
      claim_expires_at = NULL,
      updated_at = clock_timestamp()
  FROM test_rows t
  WHERE s.id = t.id;
  GET DIAGNOSTICS v_test_count = ROW_COUNT;

  -- 2. Descartar reservas canceladas que nunca se sincronizaron en Google
  WITH cancelled_rows AS (
    SELECT s.id
    FROM public.appointment_calendar_sync s
    JOIN public.appointments a ON a.id = s.appointment_id
    WHERE s.sync_status IN ('PENDING', 'PROCESSING')
      AND a.status = 'CANCELLED'
      AND s.google_event_id IS NULL
  )
  UPDATE public.appointment_calendar_sync s
  SET sync_status = 'SKIPPED',
      last_error = 'CANCELLED_BEFORE_INITIAL_SYNC: Turno cancelado sin evento previo en Google.',
      claimed_by = NULL,
      claim_expires_at = NULL,
      updated_at = clock_timestamp()
  FROM cancelled_rows c
  WHERE s.id = c.id;
  GET DIAGNOSTICS v_cancelled_count = ROW_COUNT;

  -- 3. Descartar turnos del pasado sin sincronizar para no generar eventos retroactivos
  WITH past_rows AS (
    SELECT s.id
    FROM public.appointment_calendar_sync s
    JOIN public.appointments a ON a.id = s.appointment_id
    WHERE s.sync_status IN ('PENDING', 'PROCESSING')
      AND a.booking_date < CURRENT_DATE
      AND s.google_event_id IS NULL
  )
  UPDATE public.appointment_calendar_sync s
  SET sync_status = 'SKIPPED',
      last_error = 'EXPIRED_PAST_APPOINTMENT: Turno con fecha pasada sin sincronización previa.',
      claimed_by = NULL,
      claim_expires_at = NULL,
      updated_at = clock_timestamp()
  FROM past_rows p
  WHERE s.id = p.id;
  GET DIAGNOSTICS v_past_count = ROW_COUNT;

  -- 4. Contar turnos confirmados legítimos futuros que se PRESERVAN estrictamente en PENDING
  SELECT count(*) INTO v_preserved_count
  FROM public.appointment_calendar_sync s
  JOIN public.appointments a ON a.id = s.appointment_id
  WHERE s.sync_status = 'PENDING'
    AND a.status = 'CONFIRMED'
    AND a.booking_date >= CURRENT_DATE;

  RETURN jsonb_build_object(
    'testAppointmentsSkipped', v_test_count,
    'cancelledSkipped', v_cancelled_count,
    'pastAppointmentsSkipped', v_past_count,
    'legitimateFuturePreserved', v_preserved_count
  );
END;
$$;

-- 6. PERMISOS ESTRICTOS: Exclusivo service_role
-- Revocación de permisos predeterminados de PUBLIC, anon y authenticated
REVOKE ALL ON FUNCTION public.claim_pending_calendar_sync_jobs(text, integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_calendar_sync_success_v2(uuid, text, integer, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_calendar_sync_failure_v2(uuid, text, integer, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reconcile_stale_calendar_sync_items() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.handle_appointment_calendar_sync() FROM PUBLIC, anon, authenticated;

-- Otorgamiento exclusivo a service_role
GRANT EXECUTE ON FUNCTION public.claim_pending_calendar_sync_jobs(text, integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_calendar_sync_success_v2(uuid, text, integer, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_calendar_sync_failure_v2(uuid, text, integer, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.reconcile_stale_calendar_sync_items() TO service_role;
GRANT EXECUTE ON FUNCTION public.handle_appointment_calendar_sync() TO service_role;
