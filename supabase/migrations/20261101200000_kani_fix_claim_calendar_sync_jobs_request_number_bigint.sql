-- ==============================================================================
-- KANI BARBER STUDIO — Migración: Corrección de tipo request_number en claim_pending_calendar_sync_jobs
-- Archivo: 20261101200000_kani_fix_claim_calendar_sync_jobs_request_number_bigint.sql
--
-- Causa raíz identificada (PostgreSQL SQLSTATE 42804):
-- En la tabla public.appointments, la columna request_number es de tipo BIGINT.
-- La función previa public.claim_pending_calendar_sync_jobs() declaraba en RETURNS TABLE
-- la columna como INTEGER ("request_number integer"), provocando:
-- "structure of query does not match function result type: Returned type bigint does not match expected type integer in column 15".
--
-- Corrección:
-- 1. DROP FUNCTION IF EXISTS public.claim_pending_calendar_sync_jobs(text, integer, integer);
--    (Obligatorio en PostgreSQL para modificar la estructura de tipos devuelta por RETURNS TABLE).
-- 2. Recreación de public.claim_pending_calendar_sync_jobs() declarando "request_number bigint".
-- 3. Verificación de coincidencia de todos los demás tipos con las columnas reales de la base de datos:
--    - sync_id: uuid
--    - appointment_id: uuid
--    - barber_id: uuid
--    - barber_name: text
--    - calendar_id: text
--    - google_event_id: text
--    - previous_calendar_id: text
--    - previous_google_event_id: text
--    - sync_action: text
--    - attempts: integer
--    - payload_checksum: text
--    - booking_date: date
--    - start_time: time
--    - end_time: time
--    - request_number: bigint
--    - client_name: text
--    - service_name: text
--    - custom_service_name: text
--    - service_price_ars: integer
--    - deposit_paid: boolean
--    - deposit_amount_ars: integer
--    - sync_version: integer
-- 4. Conservación íntegra de:
--    - FOR UPDATE SKIP LOCKED para exclusión mutua de jobs concurrentes.
--    - Leases transaccionales configurables con control de vencimiento y claim_expires_at.
--    - Incremento atómico de versión (version = s.version + 1) e identificación de worker (claimed_by).
--    - Permisos estrictos: REVOKE EXECUTE a PUBLIC, anon, authenticated; GRANT exclusivo a service_role.
-- ==============================================================================

-- 1. Eliminar la función existente con la firma de tipo anterior
DROP FUNCTION IF EXISTS public.claim_pending_calendar_sync_jobs(text, integer, integer);

-- 2. Recrear la función con la columna request_number BIGINT coincidente con public.appointments
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
  request_number bigint,
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

-- 3. Permisos estrictos: exclusivamente para service_role (denegado a anónimo y autenticado)
REVOKE EXECUTE ON FUNCTION public.claim_pending_calendar_sync_jobs(text, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_pending_calendar_sync_jobs(text, integer, integer) TO service_role;
