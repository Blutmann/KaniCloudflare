-- ==============================================================================
-- KANI BARBER STUDIO — Verificación Transaccional Segura con ROLLBACK
-- Archivo: supabase/scripts/validate_claim_calendar_sync_jobs_signature.sql
--
-- Propósito:
-- Validar que public.claim_pending_calendar_sync_jobs() se ejecute exitosamente
-- sin el error SQLSTATE 42804 ("structure of query does not match function result type").
--
-- Garantía de aislamiento:
-- Ejecutado dentro de una transacción que finaliza con ROLLBACK, lo que garantiza
-- que ninguna reserva, lease ni versión sea modificada o retenida en Supabase Test.
-- ==============================================================================

BEGIN;

-- 1. Inspeccionar la firma exacta y tipo de salida en el catálogo de PostgreSQL
SELECT 
  p.proname AS funcion,
  pg_get_function_result(p.oid) AS tipo_retorno
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' 
  AND p.proname = 'claim_pending_calendar_sync_jobs';

-- 2. Ejecutar la función con un worker de prueba en modo dry-run
-- Si existiera alguna discordancia entre las columnas devueltas por el SELECT
-- y los tipos declarados en RETURNS TABLE (ej: request_number bigint vs integer),
-- PostgreSQL fallaría inmediatamente con SQLSTATE 42804.
SELECT 
  sync_id,
  appointment_id,
  barber_id,
  barber_name,
  calendar_id,
  google_event_id,
  sync_action,
  attempts,
  booking_date,
  start_time,
  end_time,
  request_number,
  client_name,
  service_name,
  service_price_ars,
  deposit_paid,
  deposit_amount_ars,
  sync_version
FROM public.claim_pending_calendar_sync_jobs(
  p_worker_id := 'dry-run-validation-' || clock_timestamp()::text,
  p_limit := 1,
  p_lease_seconds := 30
);

-- 3. Revertir toda modificación efectuada durante la prueba
ROLLBACK;
