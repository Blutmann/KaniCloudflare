-- Migration: 20261116000200_kani_barber_and_client_notification_dispatches.sql
-- Kani Barber Studio — Soporte multi-destinatario (CLIENT / BARBER) en appointment_notification_dispatches
-- Permite registrar despachos independientes por (notification_event_id, recipient_role, channel)
-- preservando todos los registros históricos existentes como recipient_role = 'CLIENT'
-- y conservando todas las políticas RLS, bloqueos y controles de autorización existentes.

-- 1. Agregar columna recipient_role con default 'CLIENT' para compatibilidad con filas existentes
ALTER TABLE public.appointment_notification_dispatches
  ADD COLUMN IF NOT EXISTS recipient_role text NOT NULL DEFAULT 'CLIENT';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'appointment_notification_dispatches_recipient_role_check'
      AND conrelid = 'public.appointment_notification_dispatches'::regclass
  ) THEN
    ALTER TABLE public.appointment_notification_dispatches
      ADD CONSTRAINT appointment_notification_dispatches_recipient_role_check
      CHECK (recipient_role IN ('CLIENT', 'BARBER'));
  END IF;
END $$;

-- 2. Reemplazar restricción única (notification_event_id, channel) por (notification_event_id, recipient_role, channel)
ALTER TABLE public.appointment_notification_dispatches
  DROP CONSTRAINT IF EXISTS appointment_notification_dispatches_event_channel_key;

DROP INDEX IF EXISTS public.appointment_notification_dispatches_event_channel_key;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'appointment_notification_dispatches_event_role_channel_key'
      AND conrelid = 'public.appointment_notification_dispatches'::regclass
  ) THEN
    ALTER TABLE public.appointment_notification_dispatches
      ADD CONSTRAINT appointment_notification_dispatches_event_role_channel_key
      UNIQUE (notification_event_id, recipient_role, channel);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_notif_dispatches_app_role_channel
  ON public.appointment_notification_dispatches (appointment_id, recipient_role, channel);

-- 3. Actualizar RPC record_channel_dispatch_status preservando p_meta_message_id y controles de seguridad
DROP FUNCTION IF EXISTS public.record_channel_dispatch_status(
  uuid, uuid, text, text, text, text, text, text, text, boolean
);

DROP FUNCTION IF EXISTS public.record_channel_dispatch_status(
  uuid, uuid, text, text, text, text, text, text, text, boolean, text
);

CREATE OR REPLACE FUNCTION public.record_channel_dispatch_status(
  p_appointment_id uuid,
  p_notification_event_id uuid,
  p_channel text,
  p_provider text,
  p_recipient text,
  p_provider_message_id text,
  p_status text,
  p_error_code text default null,
  p_error_description text default null,
  p_increment_attempt boolean default false,
  p_meta_message_id text default null,
  p_recipient_role text default 'CLIENT'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'pg_catalog', 'extensions', 'public'
AS $$
DECLARE
  v_dispatch_id uuid;
  v_current_status text;
  v_recipient_role text;
BEGIN
  -- Validación estricta de autorización en el servidor
  IF (SELECT auth.role()) <> 'service_role' THEN
    IF NOT (
      public.is_operator()
      OR EXISTS (
        SELECT 1 FROM public.appointments a
        WHERE a.id = p_appointment_id
          AND a.barber_id = public.current_staff_barber_id()
      )
    ) THEN
      RAISE EXCEPTION 'ACCESS_DENIED: No posee permisos para modificar el estado de despacho de este turno'
        USING errcode = '42501';
    END IF;
  END IF;

  IF p_notification_event_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.appointment_notification_events
    WHERE id = p_notification_event_id AND appointment_id = p_appointment_id
  ) THEN
    RAISE EXCEPTION USING errcode = '42501', message = 'NOTIFICATION_EVENT_NOT_ALLOWED';
  END IF;

  v_recipient_role := CASE
    WHEN upper(trim(coalesce(p_recipient_role, 'CLIENT'))) = 'BARBER' THEN 'BARBER'
    ELSE 'CLIENT'
  END;

  -- Bloqueo de fila para evitar condiciones de carrera concurrentes por (event/appointment, recipient_role, channel)
  SELECT id, status INTO v_dispatch_id, v_current_status
  FROM public.appointment_notification_dispatches
  WHERE appointment_id = p_appointment_id
    AND recipient_role = v_recipient_role
    AND channel = p_channel
    AND (p_notification_event_id IS NULL OR notification_event_id = p_notification_event_id)
  LIMIT 1
  FOR UPDATE;

  -- Jerarquía de estados: un mensaje entregado o leído no puede retroceder a estados inferiores ni a fallido tardío
  IF v_current_status IN ('DELIVERED', 'READ') AND p_status IN ('PROVIDER_ACCEPTED', 'SENT', 'PROCESSING', 'PENDING', 'FAILED') THEN
    RETURN v_dispatch_id;
  END IF;
  IF v_current_status = 'READ' AND p_status = 'DELIVERED' THEN
    RETURN v_dispatch_id;
  END IF;

  IF v_dispatch_id IS NULL THEN
    INSERT INTO public.appointment_notification_dispatches (
      appointment_id, notification_event_id, recipient_role, channel, provider,
      recipient, provider_message_id, meta_message_id, status, error_code, error_description,
      attempts, requested_at,
      delivered_at, read_at, updated_at
    ) VALUES (
      p_appointment_id, p_notification_event_id, v_recipient_role, p_channel, p_provider,
      p_recipient, p_provider_message_id, p_meta_message_id, p_status, p_error_code, p_error_description,
      CASE WHEN p_increment_attempt THEN 1 ELSE 0 END,
      now(),
      CASE WHEN p_status IN ('DELIVERED', 'READ') THEN now() ELSE NULL END,
      CASE WHEN p_status = 'READ' THEN now() ELSE NULL END,
      now()
    )
    RETURNING id INTO v_dispatch_id;
  ELSE
    UPDATE public.appointment_notification_dispatches
    SET provider_message_id = coalesce(p_provider_message_id, provider_message_id),
        meta_message_id = coalesce(p_meta_message_id, meta_message_id),
        recipient = coalesce(p_recipient, recipient),
        status = p_status,
        error_code = p_error_code,
        error_description = p_error_description,
        attempts = CASE WHEN p_increment_attempt THEN attempts + 1 ELSE attempts END,
        delivered_at = CASE
          WHEN p_status IN ('DELIVERED', 'READ') AND delivered_at IS NULL THEN now()
          ELSE delivered_at
        END,
        read_at = CASE
          WHEN p_status = 'READ' AND read_at IS NULL THEN now()
          ELSE read_at
        END,
        updated_at = now()
    WHERE id = v_dispatch_id;
  END IF;

  RETURN v_dispatch_id;
END;
$$;

REVOKE ALL ON FUNCTION public.record_channel_dispatch_status(
  uuid, uuid, text, text, text, text, text, text, text, boolean, text, text
) FROM public, anon;

GRANT EXECUTE ON FUNCTION public.record_channel_dispatch_status(
  uuid, uuid, text, text, text, text, text, text, text, boolean, text, text
) TO authenticated, service_role;

INSERT INTO supabase_migrations.schema_migrations (version)
VALUES ('20261116000200')
ON CONFLICT (version) DO NOTHING;

NOTIFY pgrst, 'reload schema';
