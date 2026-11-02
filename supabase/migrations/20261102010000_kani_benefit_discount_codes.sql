-- Migration: 20261102010000_kani_benefit_discount_codes.sql
-- Kani Barber Studio — Benefit & Single-Use Discount Codes Engine
-- 1. Tabla benefit_codes para administración, trazabilidad y ciclo de vida de códigos
-- 2. Snapshot inmutable de beneficios en appointments
-- 3. Trigger de no reutilización ante cancelaciones
-- 4. RPCs de administración para Mantenimiento -> Descuentos
-- 5. RPCs de validación, bloqueo/liberación atómica y confirmación sin seña online (NO_DEPOSIT / FREE_SERVICE)

-- ==============================================================================
-- 1. TABLA BENEFIT_CODES
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.benefit_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9-]{4,32}$'),
  type text NOT NULL CHECK (type IN ('NO_DEPOSIT', 'FREE_SERVICE', 'PERCENT_10', 'PERCENT_50')),
  internal_note text,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'LOCKED', 'CONSUMED', 'DISABLED')),
  created_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_by_display_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  consumed_at timestamptz,
  consumed_appointment_id uuid REFERENCES public.appointments(id) ON DELETE SET NULL,
  consumed_client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  locked_at timestamptz,
  locked_expires_at timestamptz,
  locked_attempt_id text,
  original_price_ars integer,
  discount_amount_ars integer,
  final_price_ars integer,
  online_deposit_ars integer,
  in_person_balance_ars integer
);

CREATE INDEX IF NOT EXISTS idx_benefit_codes_code ON public.benefit_codes (code);
CREATE INDEX IF NOT EXISTS idx_benefit_codes_status ON public.benefit_codes (status);
CREATE INDEX IF NOT EXISTS idx_benefit_codes_consumed_client ON public.benefit_codes (consumed_client_id);
CREATE INDEX IF NOT EXISTS idx_benefit_codes_consumed_appt ON public.benefit_codes (consumed_appointment_id);

-- ==============================================================================
-- 2. SNAPSHOT INMUTABLE EN APPOINTMENTS
-- ==============================================================================

ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS benefit_code_id uuid REFERENCES public.benefit_codes(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS benefit_code text,
  ADD COLUMN IF NOT EXISTS benefit_type text CHECK (benefit_type IS NULL OR benefit_type IN ('NO_DEPOSIT', 'FREE_SERVICE', 'PERCENT_10', 'PERCENT_50')),
  ADD COLUMN IF NOT EXISTS benefit_original_price_ars integer,
  ADD COLUMN IF NOT EXISTS benefit_discount_amount_ars integer,
  ADD COLUMN IF NOT EXISTS benefit_final_price_ars integer,
  ADD COLUMN IF NOT EXISTS benefit_online_deposit_ars integer,
  ADD COLUMN IF NOT EXISTS benefit_in_person_balance_ars integer;

CREATE INDEX IF NOT EXISTS idx_appointments_benefit_code_id ON public.appointments (benefit_code_id);

-- ==============================================================================
-- 3. TRIGGER: PREVENCIÓN DE REACTIVACIÓN EN CANCELACIONES
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.guard_benefit_code_on_appointment_cancel()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
BEGIN
  -- Si el turno se cancela y tiene un código vinculado, asegurar que permanezca CONSUMED
  IF new.status = 'CANCELLED' AND (new.benefit_code_id IS NOT NULL OR old.benefit_code_id IS NOT NULL) THEN
    UPDATE public.benefit_codes
    SET status = 'CONSUMED',
        updated_at = clock_timestamp()
    WHERE id = COALESCE(new.benefit_code_id, old.benefit_code_id)
      AND status <> 'CONSUMED';
  END IF;
  RETURN new;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_benefit_code_on_appointment_cancel ON public.appointments;
CREATE TRIGGER trg_guard_benefit_code_on_appointment_cancel
  AFTER UPDATE OF status ON public.appointments
  FOR EACH ROW
  WHEN (new.status = 'CANCELLED')
  EXECUTE FUNCTION public.guard_benefit_code_on_appointment_cancel();

-- ==============================================================================
-- 4. RPCS ADMINISTRATIVAS (MANTENIMIENTO -> DESCUENTOS)
-- ==============================================================================

-- Validar rol ADMIN
CREATE OR REPLACE FUNCTION public.check_is_admin_user()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
DECLARE
  v_role text;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN false;
  END IF;
  SELECT role INTO v_role FROM public.staff_profiles WHERE user_id = auth.uid() AND active = true;
  RETURN v_role = 'ADMIN';
END;
$$;

-- Crear nuevo código de beneficio
CREATE OR REPLACE FUNCTION public.admin_create_benefit_code(
  p_type text,
  p_internal_note text DEFAULT NULL,
  p_code text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
DECLARE
  v_code text;
  v_creator_name text := 'Administrador';
  v_new_row public.benefit_codes%ROWTYPE;
BEGIN
  IF NOT public.check_is_admin_user() THEN
    RAISE EXCEPTION 'UNAUTHORIZED_ADMIN_ONLY';
  END IF;

  IF p_type NOT IN ('NO_DEPOSIT', 'FREE_SERVICE', 'PERCENT_10', 'PERCENT_50') THEN
    RAISE EXCEPTION 'INVALID_BENEFIT_TYPE';
  END IF;

  SELECT display_name INTO v_creator_name
  FROM public.staff_profiles
  WHERE user_id = auth.uid();

  IF p_code IS NOT NULL AND trim(p_code) <> '' THEN
    v_code := upper(trim(p_code));
  ELSE
    -- Generar código aleatorio difícil de adivinar
    v_code := 'KANI-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 4)) || '-' ||
              upper(substr(md5(random()::text || clock_timestamp()::text), 5, 4));
  END IF;

  INSERT INTO public.benefit_codes (
    code,
    type,
    internal_note,
    status,
    created_by_user_id,
    created_by_display_name
  )
  VALUES (
    v_code,
    p_type,
    nullif(trim(p_internal_note), ''),
    'ACTIVE',
    auth.uid(),
    coalesce(v_creator_name, 'Administrador')
  )
  RETURNING * INTO v_new_row;

  RETURN to_jsonb(v_new_row);
END;
$$;

-- Desactivar un código disponible
CREATE OR REPLACE FUNCTION public.admin_disable_benefit_code(p_code_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
DECLARE
  v_status text;
BEGIN
  IF NOT public.check_is_admin_user() THEN
    RAISE EXCEPTION 'UNAUTHORIZED_ADMIN_ONLY';
  END IF;

  SELECT status INTO v_status FROM public.benefit_codes WHERE id = p_code_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'BENEFIT_CODE_NOT_FOUND';
  END IF;

  IF v_status <> 'ACTIVE' THEN
    RAISE EXCEPTION 'CANNOT_DISABLE_NON_ACTIVE_CODE';
  END IF;

  UPDATE public.benefit_codes
  SET status = 'DISABLED',
      updated_at = clock_timestamp()
  WHERE id = p_code_id;

  RETURN true;
END;
$$;

-- Listar códigos para el panel con toda su trazabilidad e historial
CREATE OR REPLACE FUNCTION public.admin_list_benefit_codes()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
DECLARE
  v_result jsonb;
BEGIN
  IF NOT public.check_is_admin_user() THEN
    RAISE EXCEPTION 'UNAUTHORIZED_ADMIN_ONLY';
  END IF;

  SELECT coalesce(jsonb_agg(
    jsonb_build_object(
      'id', b.id,
      'code', b.code,
      'type', b.type,
      'internalNote', b.internal_note,
      'status', b.status,
      'createdByUserId', b.created_by_user_id,
      'createdByDisplayName', b.created_by_display_name,
      'createdAt', b.created_at,
      'updatedAt', b.updated_at,
      'consumedAt', b.consumed_at,
      'consumedAppointmentId', b.consumed_appointment_id,
      'consumedClientId', b.consumed_client_id,
      'clientName', c.name,
      'clientPhone', c.phone,
      'clientEmail', c.email,
      'appointmentRequestNumber', a.request_number,
      'appointmentDate', a.booking_date,
      'appointmentTime', to_char(a.start_time, 'HH24:MI'),
      'appointmentStatus', a.status,
      'appointmentService', s.name,
      'appointmentBarber', barb.name,
      'originalPriceArs', coalesce(a.benefit_original_price_ars, b.original_price_ars),
      'discountAmountArs', coalesce(a.benefit_discount_amount_ars, b.discount_amount_ars),
      'finalPriceArs', coalesce(a.benefit_final_price_ars, b.final_price_ars),
      'onlineDepositArs', coalesce(a.benefit_online_deposit_ars, b.online_deposit_ars),
      'inPersonBalanceArs', coalesce(a.benefit_in_person_balance_ars, b.in_person_balance_ars),
      'isAppointmentCancelled', (a.status = 'CANCELLED')
    ) ORDER BY b.created_at DESC
  ), '[]'::jsonb)
  INTO v_result
  FROM public.benefit_codes b
  LEFT JOIN public.appointments a ON a.id = b.consumed_appointment_id
  LEFT JOIN public.clients c ON c.id = COALESCE(b.consumed_client_id, a.client_id)
  LEFT JOIN public.services s ON s.id = a.service_id
  LEFT JOIN public.barbers barb ON barb.id = a.barber_id;

  RETURN v_result;
END;
$$;

-- ==============================================================================
-- 5. RPCS PÚBLICAS Y DE RESERVA
-- ==============================================================================

-- Cotización y validación pública en el resumen de reserva
CREATE OR REPLACE FUNCTION public.validate_and_quote_benefit_code(
  p_code text,
  p_service_name text,
  p_barber_name text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
DECLARE
  v_norm text;
  v_benefit public.benefit_codes%ROWTYPE;
  v_price integer;
  v_deposit numeric;
  v_discount integer := 0;
  v_final integer := 0;
  v_online_deposit integer := 0;
  v_balance integer := 0;
  v_skip boolean := false;
  v_label text := '';
BEGIN
  IF p_code IS NULL OR trim(p_code) = '' THEN
    RETURN jsonb_build_object('valid', false, 'error', 'Ingresá un código de beneficio.');
  END IF;

  v_norm := upper(regexp_replace(trim(p_code), '\s+', '-', 'g'));

  SELECT * INTO v_benefit
  FROM public.benefit_codes
  WHERE code = v_norm;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('valid', false, 'error', 'El código de beneficio no existe o es inválido.');
  END IF;

  IF v_benefit.status = 'DISABLED' THEN
    RETURN jsonb_build_object('valid', false, 'error', 'Este código ha sido desactivado.');
  END IF;

  IF v_benefit.status = 'CONSUMED' THEN
    RETURN jsonb_build_object('valid', false, 'error', 'Este código ya fue utilizado en otra reserva.');
  END IF;

  IF v_benefit.status = 'LOCKED' AND v_benefit.locked_expires_at > clock_timestamp() THEN
    RETURN jsonb_build_object('valid', false, 'error', 'El código se encuentra en uso en otro intento de reserva. Si no se completa, se liberará en unos minutos.');
  END IF;

  -- Resolver precio del servicio
  SELECT price_ars INTO v_price
  FROM public.services
  WHERE name = trim(p_service_name);

  IF v_price IS NULL THEN
    v_price := 25000; -- Fallback seguro
  END IF;

  v_deposit := public.read_public_deposit_amount(trim(p_barber_name));
  IF v_deposit IS NULL OR v_deposit <= 0 THEN
    v_deposit := 5000;
  END IF;

  -- Calcular según el tipo exacto
  IF v_benefit.type = 'NO_DEPOSIT' THEN
    v_discount := 0;
    v_final := v_price;
    v_online_deposit := 0;
    v_balance := v_final;
    v_skip := true;
    v_label := 'Reserva sin seña';
  ELSIF v_benefit.type = 'FREE_SERVICE' THEN
    v_discount := v_price;
    v_final := 0;
    v_online_deposit := 0;
    v_balance := 0;
    v_skip := true;
    v_label := 'Servicio gratuito (100% bonificado)';
  ELSIF v_benefit.type = 'PERCENT_10' THEN
    v_discount := round(v_price * 0.10);
    v_final := greatest(0, v_price - v_discount);
    v_online_deposit := least(v_deposit::integer, v_final);
    v_balance := greatest(0, v_final - v_online_deposit);
    v_skip := (v_online_deposit = 0);
    v_label := 'Descuento del 10 %';
  ELSIF v_benefit.type = 'PERCENT_50' THEN
    v_discount := round(v_price * 0.50);
    v_final := greatest(0, v_price - v_discount);
    v_online_deposit := least(v_deposit::integer, v_final);
    v_balance := greatest(0, v_final - v_online_deposit);
    v_skip := (v_online_deposit = 0);
    v_label := 'Descuento del 50 %';
  ELSE
    RETURN jsonb_build_object('valid', false, 'error', 'Tipo de beneficio no reconocido.');
  END IF;

  RETURN jsonb_build_object(
    'valid', true,
    'code', v_benefit.code,
    'benefitType', v_benefit.type,
    'benefitLabel', v_label,
    'originalPriceArs', v_price,
    'discountAmountArs', v_discount,
    'finalPriceArs', v_final,
    'onlineDepositArs', v_online_deposit,
    'inPersonBalanceArs', v_balance,
    'skipOnlinePayment', v_skip,
    'buttonLabel', case when v_skip then 'Reservar turno' else 'Pagar seña con tarjeta' end
  );
END;
$$;

-- Bloqueo temporal para checkout con Payway
CREATE OR REPLACE FUNCTION public.lock_benefit_code_attempt(
  p_code text,
  p_attempt_id text,
  p_ttl_seconds integer DEFAULT 600
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
DECLARE
  v_norm text;
  v_rows integer;
BEGIN
  v_norm := upper(regexp_replace(trim(p_code), '\s+', '-', 'g'));

  UPDATE public.benefit_codes
  SET status = 'LOCKED',
      locked_at = clock_timestamp(),
      locked_expires_at = clock_timestamp() + (p_ttl_seconds || ' seconds')::interval,
      locked_attempt_id = p_attempt_id,
      updated_at = clock_timestamp()
  WHERE code = v_norm
    AND (
      status = 'ACTIVE'
      OR (status = 'LOCKED' AND (locked_expires_at <= clock_timestamp() OR locked_attempt_id = p_attempt_id))
    );

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN (v_rows > 0);
END;
$$;

-- Liberación de código ante pago rechazado o abandonado
CREATE OR REPLACE FUNCTION public.release_benefit_code_attempt(
  p_code text,
  p_attempt_id text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
BEGIN
  UPDATE public.benefit_codes
  SET status = 'ACTIVE',
      locked_at = NULL,
      locked_expires_at = NULL,
      locked_attempt_id = NULL,
      updated_at = clock_timestamp()
  WHERE status = 'LOCKED'
    AND (
      (p_attempt_id IS NOT NULL AND trim(p_attempt_id) <> '' AND (locked_attempt_id = p_attempt_id OR replace(locked_attempt_id, '-', '') = replace(p_attempt_id, '-', '')))
      OR (p_code IS NOT NULL AND trim(p_code) <> '' AND code = upper(regexp_replace(trim(p_code), '\s+', '-', 'g')))
    );

  RETURN true;
END;
$$;

-- ==============================================================================
-- 6. CONFIRMACIÓN ATÓMICA SIN SEÑA (NO_DEPOSIT / FREE_SERVICE)
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.confirm_zero_deposit_appointment(
  p_barber_name text,
  p_service_name text,
  p_booking_date date,
  p_start_time time,
  p_client_name text,
  p_client_phone text,
  p_client_email text,
  p_benefit_code text,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
DECLARE
  v_norm text;
  v_benefit public.benefit_codes%ROWTYPE;
  v_appt_id uuid;
  v_req_num bigint;
  v_notif_token text;
  v_appt public.appointments%ROWTYPE;
  v_price integer;
  v_discount integer := 0;
  v_final integer := 0;
  v_balance integer := 0;
  v_client_id uuid;
BEGIN
  IF p_benefit_code IS NULL OR trim(p_benefit_code) = '' THEN
    RAISE EXCEPTION 'BENEFIT_CODE_REQUIRED';
  END IF;

  v_norm := upper(regexp_replace(trim(p_benefit_code), '\s+', '-', 'g'));

  -- Bloquear y validar código atómicamente
  SELECT * INTO v_benefit
  FROM public.benefit_codes
  WHERE code = v_norm
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'BENEFIT_CODE_NOT_FOUND';
  END IF;

  IF v_benefit.status = 'CONSUMED' THEN
    RAISE EXCEPTION 'BENEFIT_CODE_ALREADY_CONSUMED';
  END IF;

  IF v_benefit.status = 'DISABLED' THEN
    RAISE EXCEPTION 'BENEFIT_CODE_DISABLED';
  END IF;

  IF v_benefit.type NOT IN ('NO_DEPOSIT', 'FREE_SERVICE') THEN
    RAISE EXCEPTION 'BENEFIT_REQUIRES_ONLINE_PAYMENT';
  END IF;

  -- Crear turno mediante la RPC oficial de reservas
  SELECT appointment_id, request_number, notification_claim_token
  INTO v_appt_id, v_req_num, v_notif_token
  FROM public.request_appointment(
    p_barber_name,
    p_service_name,
    p_booking_date,
    p_start_time,
    p_client_name,
    p_client_phone,
    p_client_email,
    p_notes
  );

  SELECT * INTO strict v_appt FROM public.appointments WHERE id = v_appt_id FOR UPDATE;
  v_client_id := v_appt.client_id;

  SELECT price_ars INTO v_price FROM public.services WHERE id = v_appt.service_id;
  IF v_price IS NULL THEN v_price := 25000; END IF;

  IF v_benefit.type = 'NO_DEPOSIT' THEN
    v_discount := 0;
    v_final := v_price;
    v_balance := v_final;
  ELSIF v_benefit.type = 'FREE_SERVICE' THEN
    v_discount := v_price;
    v_final := 0;
    v_balance := 0;
  END IF;

  -- Confirmar turno y registrar snapshot inmutable
  UPDATE public.appointments
  SET status = 'CONFIRMED',
      deposit_paid = false,
      deposit_amount_ars = 0,
      balance_paid = (v_benefit.type = 'FREE_SERVICE'),
      benefit_code_id = v_benefit.id,
      benefit_code = v_benefit.code,
      benefit_type = v_benefit.type,
      benefit_original_price_ars = v_price,
      benefit_discount_amount_ars = v_discount,
      benefit_final_price_ars = v_final,
      benefit_online_deposit_ars = 0,
      benefit_in_person_balance_ars = v_balance,
      updated_at = clock_timestamp()
  WHERE id = v_appt_id;

  -- Consumir código definitivamente
  UPDATE public.benefit_codes
  SET status = 'CONSUMED',
      consumed_at = clock_timestamp(),
      consumed_appointment_id = v_appt_id,
      consumed_client_id = v_client_id,
      original_price_ars = v_price,
      discount_amount_ars = v_discount,
      final_price_ars = v_final,
      online_deposit_ars = 0,
      in_person_balance_ars = v_balance,
      locked_at = NULL,
      locked_expires_at = NULL,
      locked_attempt_id = NULL,
      updated_at = clock_timestamp()
  WHERE id = v_benefit.id;

  -- Crear evento de notificación de confirmación
  v_notif_token := public.create_appointment_notification_event(v_appt_id, 'CONFIRMED');

  RETURN jsonb_build_object(
    'confirmed', true,
    'appointmentId', v_appt_id,
    'requestNumber', v_req_num,
    'notificationClaimToken', v_notif_token,
    'benefitType', v_benefit.type,
    'originalPriceArs', v_price,
    'discountAmountArs', v_discount,
    'finalPriceArs', v_final,
    'onlineDepositArs', 0,
    'inPersonBalanceArs', v_balance
  );
END;
$$;

-- Consumir código bloqueado en Payway tras aprobación exitosa del pago
CREATE OR REPLACE FUNCTION public.admin_consume_benefit_code_for_attempt(
  p_appointment_id uuid,
  p_attempt_id text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
DECLARE
  v_code_row public.benefit_codes%ROWTYPE;
  v_appt_row public.appointments%ROWTYPE;
  v_service_price integer;
  v_discount integer := 0;
  v_final integer;
  v_deposit integer := 0;
  v_balance integer;
BEGIN
  -- Buscar si existe un código bloqueado para este attempt o appointment
  SELECT * INTO v_code_row
  FROM public.benefit_codes
  WHERE locked_attempt_id = p_attempt_id
     OR replace(locked_attempt_id, '-', '') = replace(p_attempt_id, '-', '')
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  SELECT * INTO v_appt_row
  FROM public.appointments
  WHERE id = p_appointment_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  v_service_price := COALESCE(v_appt_row.service_price_ars, 25000);

  IF v_code_row.type = 'NO_DEPOSIT' THEN
    v_discount := 0;
    v_final := v_service_price;
    v_deposit := 0;
    v_balance := v_service_price;
  ELSIF v_code_row.type = 'FREE_SERVICE' THEN
    v_discount := v_service_price;
    v_final := 0;
    v_deposit := 0;
    v_balance := 0;
  ELSIF v_code_row.type = 'PERCENT_10' THEN
    v_discount := round(v_service_price * 0.10)::integer;
    v_final := v_service_price - v_discount;
    v_deposit := LEAST(COALESCE(v_appt_row.deposit_amount_ars, 5000), v_final);
    v_balance := GREATEST(0, v_final - v_deposit);
  ELSIF v_code_row.type = 'PERCENT_50' THEN
    v_discount := round(v_service_price * 0.50)::integer;
    v_final := v_service_price - v_discount;
    v_deposit := LEAST(COALESCE(v_appt_row.deposit_amount_ars, 5000), v_final);
    v_balance := GREATEST(0, v_final - v_deposit);
  END IF;

  -- Actualizar appointment con snapshot inmutable
  UPDATE public.appointments
  SET benefit_code_id = v_code_row.id,
      benefit_code = v_code_row.code,
      benefit_type = v_code_row.type,
      benefit_original_price_ars = v_service_price,
      benefit_discount_amount_ars = v_discount,
      benefit_final_price_ars = v_final,
      benefit_online_deposit_ars = v_deposit,
      benefit_in_person_balance_ars = v_balance,
      updated_at = clock_timestamp()
  WHERE id = p_appointment_id;

  -- Consumir código definitivamente
  UPDATE public.benefit_codes
  SET status = 'CONSUMED',
      consumed_at = clock_timestamp(),
      consumed_by_appointment_id = p_appointment_id,
      locked_at = NULL,
      locked_expires_at = NULL,
      locked_attempt_id = NULL,
      updated_at = clock_timestamp()
  WHERE id = v_code_row.id;

  RETURN true;
END;
$$;

-- Permisos
REVOKE ALL ON TABLE public.benefit_codes FROM public, anon;
GRANT SELECT, INSERT, UPDATE ON TABLE public.benefit_codes TO authenticated;
GRANT ALL ON TABLE public.benefit_codes TO service_role;

GRANT EXECUTE ON FUNCTION public.admin_create_benefit_code(text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_disable_benefit_code(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_benefit_codes() TO authenticated;
GRANT EXECUTE ON FUNCTION public.validate_and_quote_benefit_code(text, text, text) TO public, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.confirm_zero_deposit_appointment(text, text, date, time, text, text, text, text, text) TO public, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.lock_benefit_code_attempt(text, text, integer) TO public, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.release_benefit_code_attempt(text, text) TO public, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_consume_benefit_code_for_attempt(uuid, text) TO public, anon, authenticated, service_role;
