-- ==============================================================================
-- KANI BARBER STUDIO — Migración: Concurrencia Transaccional e Idempotencia
-- Tabla: appointment_calendar_sync
-- Sistema de leases recuperables con SKIP LOCKED, versión optimista y prevención de duplicados
-- ==============================================================================

-- 1. Ampliar columnas para lease y versión
ALTER TABLE public.appointment_calendar_sync
  ADD COLUMN IF NOT EXISTS claimed_by text,
  ADD COLUMN IF NOT EXISTS claimed_at timestamptz,
  ADD COLUMN IF NOT EXISTS claim_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;

-- 2. Actualizar constraint de estado para admitir PROCESSING
ALTER TABLE public.appointment_calendar_sync
  DROP CONSTRAINT IF EXISTS appointment_calendar_sync_sync_status_check;

ALTER TABLE public.appointment_calendar_sync
  ADD CONSTRAINT appointment_calendar_sync_sync_status_check
  CHECK (sync_status IN ('PENDING', 'PROCESSING', 'SYNCED', 'FAILED', 'SKIPPED'));

-- 3. Índice para búsqueda de reclamo concurrente eficiente
CREATE INDEX IF NOT EXISTS idx_appointment_calendar_sync_claim
  ON public.appointment_calendar_sync (sync_status, claim_expires_at, last_attempt_at)
  WHERE sync_status IN ('PENDING', 'PROCESSING');

-- 4. RPC atómica de reclamo con SKIP LOCKED
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

-- 5. RPC segura de registro de éxito con control de versión
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
    AND (version = p_version OR p_version IS NULL);

  RETURN FOUND;
END;
$$;

-- 6. RPC segura de registro de fallo con control de versión
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
    AND (version = p_version OR p_version IS NULL);

  RETURN FOUND;
END;
$$;

-- 7. RPC de conciliación inteligente de trabajos históricos (sin descarte ciego)
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
  -- 1. Descartar reservas de prueba ficticias identificadas
  WITH test_rows AS (
    SELECT s.id
    FROM public.appointment_calendar_sync s
    JOIN public.appointments a ON a.id = s.appointment_id
    WHERE s.sync_status IN ('PENDING', 'PROCESSING')
      AND (
        coalesce(a.booking_client_name, '') ILIKE '%prueba%'
        OR coalesce(a.booking_client_name, '') ILIKE '%test%'
        OR coalesce(a.booking_client_name, '') ILIKE '%audit%'
        OR coalesce(a.notes, '') ILIKE '%ficticio%'
      )
  )
  UPDATE public.appointment_calendar_sync s
  SET sync_status = 'SKIPPED',
      last_error = 'TEST_FICTITIOUS_APPOINTMENT: Reserva de prueba descartada de sincronización.',
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

  -- 3. Descartar turnos obsoletos del pasado que nunca se sincronizaron
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

  -- 4. Contar turnos confirmados legítimos que se PRESERVAN en PENDING
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

-- Permisos
REVOKE ALL ON FUNCTION public.claim_pending_calendar_sync_jobs(text, integer, integer) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.claim_pending_calendar_sync_jobs(text, integer, integer) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.record_calendar_sync_success_v2(uuid, text, integer, text, text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.record_calendar_sync_success_v2(uuid, text, integer, text, text, text) TO service_role;

REVOKE ALL ON FUNCTION public.record_calendar_sync_failure_v2(uuid, text, integer, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.record_calendar_sync_failure_v2(uuid, text, integer, text) TO service_role;

REVOKE ALL ON FUNCTION public.reconcile_stale_calendar_sync_items() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.reconcile_stale_calendar_sync_items() TO authenticated, service_role;
