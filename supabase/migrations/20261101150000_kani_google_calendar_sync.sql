-- Migration: 20261101150000_kani_google_calendar_sync.sql
-- KANI BARBER STUDIO — Integración con Google Calendar (Etapa 1: Modelo, Cola Transaccional y Disparadores)
--
-- 1. barber_google_calendars:
--    Asocia cada barbero (Lautaro, Gonzalo, Valentín, Franco) con el ID de su calendario secundario
--    de Google Calendar y el estado de sincronización.
--
-- 2. appointment_calendar_sync:
--    Cola transaccional y estado de sincronización Kani -> Google Calendar por reserva.
--    Permite registrar:
--      - appointment_id, barber_id, calendar_id, google_event_id.
--      - previous_calendar_id, previous_google_event_id (para cambios de barbero).
--      - sync_action ('UPSERT' | 'DELETE').
--      - sync_status ('PENDING' | 'SYNCED' | 'FAILED' | 'SKIPPED').
--      - payload_checksum para evitar actualizaciones innecesarias.
--      - attempts, max_attempts, last_attempt_at, last_error.
--
-- 3. Disparador trg_appointment_calendar_sync en public.appointments:
--    Garantiza atómicamente que:
--      - Reservas públicas pendientes NO generan eventos en Google Calendar.
--      - Al confirmarse el pago (PENDING -> CONFIRMED), se encola 'UPSERT'.
--      - Turnos manuales de ADMIN/BARBER (INSERT con 'CONFIRMED'), se encola 'UPSERT'.
--      - Cancelaciones (CONFIRMED -> CANCELLED), se encola 'DELETE' si ya existía evento,
--        o 'SKIPPED' si nunca se había sincronizado (prevención de eventos fantasma).
--      - Modificaciones (fecha, hora, servicio, barbero): se encola 'UPSERT'; si cambió el barbero,
--        se guarda previous_calendar_id y previous_google_event_id para migrar entre calendarios.
--
-- 4. Funciones RPC:
--    - get_pending_calendar_sync_items(p_limit int)
--    - record_calendar_sync_success(p_sync_id uuid, p_google_event_id text, p_calendar_id text, p_checksum text)
--    - record_calendar_sync_failure(p_sync_id uuid, p_error text)
--    - set_barber_google_calendar(p_barber_name text, p_calendar_id text)

-- ==============================================================================
-- 1. TABLA: barber_google_calendars
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.barber_google_calendars (
  barber_id uuid PRIMARY KEY REFERENCES public.barbers(id) ON DELETE CASCADE,
  calendar_id text,
  calendar_name text,
  sync_enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

-- Pre-poblado idempotente para los 4 barberos oficiales
INSERT INTO public.barber_google_calendars (barber_id, calendar_name, sync_enabled)
SELECT b.id, b.name || ' — Kani Barber Studio', true
FROM public.barbers b
WHERE b.name IN ('Lautaro', 'Gonzalo', 'Valentín', 'Franco')
ON CONFLICT (barber_id) DO NOTHING;

-- ==============================================================================
-- 2. TABLA: appointment_calendar_sync (Cola y Estado de Sincronización)
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.appointment_calendar_sync (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id uuid NOT NULL REFERENCES public.appointments(id) ON DELETE CASCADE,
  barber_id uuid NOT NULL REFERENCES public.barbers(id),
  calendar_id text,
  google_event_id text,
  previous_calendar_id text,
  previous_google_event_id text,
  sync_action text NOT NULL DEFAULT 'UPSERT' CHECK (sync_action IN ('UPSERT', 'DELETE')),
  sync_status text NOT NULL DEFAULT 'PENDING' CHECK (sync_status IN ('PENDING', 'SYNCED', 'FAILED', 'SKIPPED')),
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 5,
  last_attempt_at timestamptz,
  last_error text,
  payload_checksum text,
  synced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT uq_appointment_calendar_sync_appointment UNIQUE (appointment_id)
);

CREATE INDEX IF NOT EXISTS idx_appointment_calendar_sync_pending
  ON public.appointment_calendar_sync(sync_status, sync_action)
  WHERE sync_status = 'PENDING';

CREATE INDEX IF NOT EXISTS idx_appointment_calendar_sync_barber
  ON public.appointment_calendar_sync(barber_id);

-- ==============================================================================
-- 3. TRIGGER FUNCTION: handle_appointment_calendar_sync
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.handle_appointment_calendar_sync()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
DECLARE
  v_sync public.appointment_calendar_sync%ROWTYPE;
  v_old_calendar_id text;
  v_new_calendar_id text;
BEGIN
  -- --------------------------------------------------------------------------
  -- CASO 1: INSERT
  -- --------------------------------------------------------------------------
  IF TG_OP = 'INSERT' THEN
    -- Sólo encolar si el turno nace confirmado (ej. turnos manuales creados por staff)
    IF NEW.status = 'CONFIRMED' THEN
      SELECT calendar_id INTO v_new_calendar_id
      FROM public.barber_google_calendars
      WHERE barber_id = NEW.barber_id;

      INSERT INTO public.appointment_calendar_sync (
        appointment_id,
        barber_id,
        calendar_id,
        sync_action,
        sync_status
      ) VALUES (
        NEW.id,
        NEW.barber_id,
        v_new_calendar_id,
        'UPSERT',
        'PENDING'
      )
      ON CONFLICT (appointment_id) DO UPDATE
      SET barber_id = EXCLUDED.barber_id,
          calendar_id = EXCLUDED.calendar_id,
          sync_action = 'UPSERT',
          sync_status = 'PENDING',
          updated_at = clock_timestamp();
    END IF;
    RETURN NEW;
  END IF;

  -- --------------------------------------------------------------------------
  -- CASO 2: UPDATE
  -- --------------------------------------------------------------------------
  IF TG_OP = 'UPDATE' THEN
    SELECT * INTO v_sync
    FROM public.appointment_calendar_sync
    WHERE appointment_id = NEW.id;

    -- Subcaso 2.1: El turno pasa a CANCELLED
    IF NEW.status = 'CANCELLED' THEN
      IF FOUND THEN
        IF v_sync.google_event_id IS NOT NULL THEN
          -- Ya existía un evento en Google Calendar: solicitar borrado
          UPDATE public.appointment_calendar_sync
          SET sync_action = 'DELETE',
              sync_status = 'PENDING',
              updated_at = clock_timestamp()
          WHERE id = v_sync.id;
        ELSE
          -- Si estaba encolado y nunca se llegó a sincronizar en Google, omitir para evitar creación fantasma
          UPDATE public.appointment_calendar_sync
          SET sync_status = 'SKIPPED',
              last_error = 'CANCELLED_BEFORE_INITIAL_SYNC',
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
        sync_status
      ) VALUES (
        NEW.id,
        NEW.barber_id,
        v_new_calendar_id,
        'UPSERT',
        'PENDING'
      )
      ON CONFLICT (appointment_id) DO UPDATE
      SET barber_id = EXCLUDED.barber_id,
          calendar_id = EXCLUDED.calendar_id,
          sync_action = 'UPSERT',
          sync_status = 'PENDING',
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

      IF FOUND THEN
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
              payload_checksum = NULL,
              updated_at = clock_timestamp()
          WHERE id = v_sync.id;
        ELSE
          -- Mismo barbero o no tenía evento previo: actualización normal
          UPDATE public.appointment_calendar_sync
          SET barber_id = NEW.barber_id,
              calendar_id = v_new_calendar_id,
              sync_action = 'UPSERT',
              sync_status = 'PENDING',
              payload_checksum = NULL,
              updated_at = clock_timestamp()
          WHERE id = v_sync.id;
        END IF;
      ELSE
        -- No existía fila previa de sincronización (ej. turno previo a la migración)
        INSERT INTO public.appointment_calendar_sync (
          appointment_id,
          barber_id,
          calendar_id,
          sync_action,
          sync_status
        ) VALUES (
          NEW.id,
          NEW.barber_id,
          v_new_calendar_id,
          'UPSERT',
          'PENDING'
        );
      END IF;
    END IF;

    RETURN NEW;
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_appointment_calendar_sync ON public.appointments;
CREATE TRIGGER trg_appointment_calendar_sync
AFTER INSERT OR UPDATE ON public.appointments
FOR EACH ROW
EXECUTE FUNCTION public.handle_appointment_calendar_sync();

-- ==============================================================================
-- 4. RPCs DE CONSULTA Y PROCESAMIENTO
-- ==============================================================================

-- Lectura de elementos pendientes en la cola con detalles del turno y cliente
CREATE OR REPLACE FUNCTION public.get_pending_calendar_sync_items(p_limit integer DEFAULT 10)
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
  deposit_amount_ars integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
BEGIN
  RETURN QUERY
  SELECT
    s.id AS sync_id,
    a.id AS appointment_id,
    a.barber_id,
    b.name AS barber_name,
    coalesce(s.calendar_id, bgc.calendar_id) AS calendar_id,
    s.google_event_id,
    s.previous_calendar_id,
    s.previous_google_event_id,
    s.sync_action,
    s.attempts,
    s.payload_checksum,
    a.booking_date,
    a.start_time,
    a.end_time,
    a.request_number,
    coalesce(a.booking_client_name, c.name, 'Cliente Kani') AS client_name,
    coalesce(svc.name, 'Corte') AS service_name,
    a.custom_service_name,
    a.service_price_ars,
    coalesce(a.deposit_paid, false) AS deposit_paid,
    coalesce(a.deposit_amount_ars, 5000) AS deposit_amount_ars
  FROM public.appointment_calendar_sync s
  JOIN public.appointments a ON a.id = s.appointment_id
  JOIN public.barbers b ON b.id = a.barber_id
  LEFT JOIN public.barber_google_calendars bgc ON bgc.barber_id = a.barber_id
  LEFT JOIN public.clients c ON c.id = a.client_id
  LEFT JOIN public.services svc ON svc.id = a.service_id
  WHERE s.sync_status = 'PENDING'
    AND s.attempts < s.max_attempts
    AND (
      s.last_attempt_at IS NULL
      OR s.last_attempt_at + (power(2, least(s.attempts, 6)) * interval '10 seconds') <= clock_timestamp()
    )
  ORDER BY s.created_at ASC
  LIMIT least(coalesce(p_limit, 10), 50);
END;
$$;

-- Registro de éxito en la sincronización
CREATE OR REPLACE FUNCTION public.record_calendar_sync_success(
  p_sync_id uuid,
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
      synced_at = clock_timestamp(),
      updated_at = clock_timestamp()
  WHERE id = p_sync_id;

  RETURN FOUND;
END;
$$;

-- Registro de fallo en la sincronización
CREATE OR REPLACE FUNCTION public.record_calendar_sync_failure(
  p_sync_id uuid,
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
      updated_at = clock_timestamp()
  WHERE id = p_sync_id;

  RETURN FOUND;
END;
$$;

-- Asignación de calendar_id para un barbero por su nombre
CREATE OR REPLACE FUNCTION public.set_barber_google_calendar(
  p_barber_name text,
  p_calendar_id text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
DECLARE
  v_barber_id uuid;
BEGIN
  SELECT id INTO v_barber_id
  FROM public.barbers
  WHERE name = trim(p_barber_name);

  IF v_barber_id IS NULL THEN
    RAISE EXCEPTION 'BARBER_NOT_FOUND: %', p_barber_name;
  END IF;

  INSERT INTO public.barber_google_calendars (barber_id, calendar_id, updated_at)
  VALUES (v_barber_id, trim(p_calendar_id), clock_timestamp())
  ON CONFLICT (barber_id) DO UPDATE
  SET calendar_id = EXCLUDED.calendar_id,
      updated_at = clock_timestamp();

  RETURN true;
END;
$$;

-- Permisos
REVOKE ALL ON TABLE public.barber_google_calendars FROM public, anon;
GRANT SELECT ON TABLE public.barber_google_calendars TO authenticated;
GRANT ALL ON TABLE public.barber_google_calendars TO service_role;

REVOKE ALL ON TABLE public.appointment_calendar_sync FROM public, anon;
GRANT SELECT ON TABLE public.appointment_calendar_sync TO authenticated;
GRANT ALL ON TABLE public.appointment_calendar_sync TO service_role;

REVOKE ALL ON FUNCTION public.get_pending_calendar_sync_items(integer) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_pending_calendar_sync_items(integer) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.record_calendar_sync_success(uuid, text, text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.record_calendar_sync_success(uuid, text, text, text) TO service_role;

REVOKE ALL ON FUNCTION public.record_calendar_sync_failure(uuid, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.record_calendar_sync_failure(uuid, text) TO service_role;

REVOKE ALL ON FUNCTION public.set_barber_google_calendar(text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.set_barber_google_calendar(text, text) TO service_role;
