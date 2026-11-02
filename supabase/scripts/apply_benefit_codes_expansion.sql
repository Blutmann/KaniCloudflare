-- Migration: 20261102150000_kani_benefit_codes_usage_and_validity_expansion.sql
-- Kani Barber Studio — Ampliación de Códigos de Descuento: Usos (Single Use / Reusable) y Vigencia
-- 1. Ampliación de columnas en benefit_codes: usage_mode, validity_type, valid_from, valid_until, times_used, soft-delete y auditoría.
-- 2. Tabla benefit_code_usages para historial completo 1:N de reservas vinculadas a códigos reutilizables y de un solo uso.
-- 3. Tabla benefit_code_attempt_locks para admitir concurrencia sin bloqueo global en checkouts de códigos reutilizables.
-- 4. Extensión de snapshot inmutable en appointments (benefit_usage_mode).
-- 5. Trigger actualizado: cancelaciones conservan uso registrado pero no marcan CONSUMED códigos reutilizables.
-- 6. RPCs administrativas con auditoría y verificación ADMIN estricta:
--    - admin_create_benefit_code (ampliada)
--    - admin_update_benefit_code_validity
--    - admin_toggle_benefit_code_status (bloquea activación si venció)
--    - admin_delete_benefit_code (soft-delete sin reutilización de texto)
--    - admin_list_benefit_codes (estados calculados, trazabilidad y desglose 1:N)
-- 7. RPCs de reserva y pasarela:
--    - validate_and_quote_benefit_code (validación de vigencia en Buenos Aires y concurrencia)
--    - lock_benefit_code_attempt (concurrencia reutilizables)
--    - release_benefit_code_attempt
--    - confirm_zero_deposit_appointment (reserva sin seña / servicio gratuito con soporte reutilizable)
--    - admin_consume_benefit_code_for_attempt (respeto de TTL en checkouts ya iniciados)

-- ==============================================================================
-- 1. AMPLIACIÓN DE TABLA BENEFIT_CODES
-- ==============================================================================

BEGIN;

ALTER TABLE public.benefit_codes
  ADD COLUMN IF NOT EXISTS usage_mode text NOT NULL DEFAULT 'SINGLE_USE'
    CHECK (usage_mode IN ('SINGLE_USE', 'REUSABLE')),
  ADD COLUMN IF NOT EXISTS validity_type text NOT NULL DEFAULT 'NO_EXPIRATION'
    CHECK (validity_type IN ('NO_EXPIRATION', 'ONE_WEEK', 'ONE_MONTH', 'CUSTOM_DURATION', 'DATE_RANGE')),
  ADD COLUMN IF NOT EXISTS valid_from timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS valid_until timestamptz DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS validity_duration_value integer DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS validity_duration_unit text DEFAULT NULL
    CHECK (validity_duration_unit IS NULL OR validity_duration_unit IN ('DAYS', 'WEEKS', 'MONTHS')),
  ADD COLUMN IF NOT EXISTS times_used integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS max_uses integer DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS deleted_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS deleted_by_display_name text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS last_edited_at timestamptz DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS last_edited_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS last_edited_by_display_name text DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_benefit_codes_usage_mode ON public.benefit_codes (usage_mode);
CREATE INDEX IF NOT EXISTS idx_benefit_codes_validity ON public.benefit_codes (valid_from, valid_until);
CREATE INDEX IF NOT EXISTS idx_benefit_codes_deleted_at ON public.benefit_codes (deleted_at);

-- Extensión en appointments para trazabilidad inmutable del modo de uso
ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS benefit_usage_mode text DEFAULT 'SINGLE_USE'
    CHECK (benefit_usage_mode IS NULL OR benefit_usage_mode IN ('SINGLE_USE', 'REUSABLE'));

-- ==============================================================================
-- 2. TABLA BENEFIT_CODE_USAGES (HISTORIAL 1:N)
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.benefit_code_usages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  benefit_code_id uuid NOT NULL REFERENCES public.benefit_codes(id) ON DELETE CASCADE,
  appointment_id uuid NOT NULL REFERENCES public.appointments(id) ON DELETE CASCADE,
  client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  used_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  original_price_ars integer,
  discount_amount_ars integer,
  final_price_ars integer,
  online_deposit_ars integer,
  in_person_balance_ars integer,
  UNIQUE (benefit_code_id, appointment_id)
);

CREATE INDEX IF NOT EXISTS idx_benefit_code_usages_code_id ON public.benefit_code_usages (benefit_code_id);
CREATE INDEX IF NOT EXISTS idx_benefit_code_usages_appt_id ON public.benefit_code_usages (appointment_id);
CREATE INDEX IF NOT EXISTS idx_benefit_code_usages_client_id ON public.benefit_code_usages (client_id);

-- Migrar consumos previos existentes a la nueva tabla de historial
INSERT INTO public.benefit_code_usages (
  benefit_code_id,
  appointment_id,
  client_id,
  used_at,
  original_price_ars,
  discount_amount_ars,
  final_price_ars,
  online_deposit_ars,
  in_person_balance_ars
)
SELECT
  b.id,
  b.consumed_appointment_id,
  b.consumed_client_id,
  COALESCE(b.consumed_at, b.updated_at, now()),
  b.original_price_ars,
  b.discount_amount_ars,
  b.final_price_ars,
  b.online_deposit_ars,
  b.in_person_balance_ars
FROM public.benefit_codes b
WHERE b.consumed_appointment_id IS NOT NULL
ON CONFLICT (benefit_code_id, appointment_id) DO NOTHING;

-- Sincronizar contador times_used
UPDATE public.benefit_codes b
SET times_used = (
  SELECT count(*) FROM public.benefit_code_usages u WHERE u.benefit_code_id = b.id
)
WHERE b.times_used = 0;

-- ==============================================================================
-- 3. TABLA BENEFIT_CODE_ATTEMPT_LOCKS (CONCURRENCIA PAYWAY)
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.benefit_code_attempt_locks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  benefit_code_id uuid NOT NULL REFERENCES public.benefit_codes(id) ON DELETE CASCADE,
  attempt_id text NOT NULL UNIQUE,
  locked_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL,
  consumed_appointment_id uuid REFERENCES public.appointments(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_benefit_code_attempt_locks_lookup ON public.benefit_code_attempt_locks (attempt_id, expires_at);

-- ==============================================================================
-- 4. TRIGGER: PREVENCIÓN DE REACTIVACIÓN EN CANCELACIONES
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.guard_benefit_code_on_appointment_cancel()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
BEGIN
  -- Si el turno cancelado utilizó un código de un solo uso, debe permanecer CONSUMED.
  -- Los códigos reutilizables conservan el uso registrado en benefit_code_usages
  -- pero NO se marcan CONSUMED en su estado principal.
  IF new.status = 'CANCELLED' AND (new.benefit_code_id IS NOT NULL OR old.benefit_code_id IS NOT NULL) THEN
    UPDATE public.benefit_codes
    SET status = 'CONSUMED',
        updated_at = clock_timestamp()
    WHERE id = COALESCE(new.benefit_code_id, old.benefit_code_id)
      AND usage_mode = 'SINGLE_USE'
      AND status <> 'CONSUMED';
  END IF;
  RETURN new;
END;
$$;

-- ==============================================================================
-- 5. RPCS ADMINISTRATIVAS (MANTENIMIENTO -> DESCUENTOS)
-- ==============================================================================

-- 5.1. Crear código (ampliada para usos y vigencia)
DROP FUNCTION IF EXISTS public.admin_create_benefit_code(text, text, text);
CREATE OR REPLACE FUNCTION public.admin_create_benefit_code(
  p_type text,
  p_internal_note text DEFAULT NULL,
  p_code text DEFAULT NULL,
  p_usage_mode text DEFAULT 'SINGLE_USE',
  p_validity_type text DEFAULT 'NO_EXPIRATION',
  p_valid_from timestamptz DEFAULT clock_timestamp(),
  p_valid_until timestamptz DEFAULT NULL,
  p_duration_value integer DEFAULT NULL,
  p_duration_unit text DEFAULT NULL
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

  IF p_usage_mode NOT IN ('SINGLE_USE', 'REUSABLE') THEN
    RAISE EXCEPTION 'INVALID_USAGE_MODE';
  END IF;

  IF p_validity_type NOT IN ('NO_EXPIRATION', 'ONE_WEEK', 'ONE_MONTH', 'CUSTOM_DURATION', 'DATE_RANGE') THEN
    RAISE EXCEPTION 'INVALID_VALIDITY_TYPE';
  END IF;

  SELECT display_name INTO v_creator_name
  FROM public.staff_profiles
  WHERE user_id = auth.uid();

  IF p_code IS NOT NULL AND trim(p_code) <> '' THEN
    v_code := upper(regexp_replace(trim(p_code), '\s+', '-', 'g'));
  ELSE
    -- Generar código aleatorio difícil de adivinar
    v_code := 'KANI-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 4)) || '-' ||
              upper(substr(md5(random()::text || clock_timestamp()::text), 5, 4));
  END IF;

  -- Regla: No permitir reutilizar el mismo texto de un código existente (incluso eliminado)
  IF EXISTS (SELECT 1 FROM public.benefit_codes WHERE code = v_code) THEN
    RAISE EXCEPTION 'BENEFIT_CODE_ALREADY_EXISTS: El código ya existe o fue utilizado previamente. Los códigos eliminados no pueden reutilizarse.';
  END IF;

  INSERT INTO public.benefit_codes (
    code,
    type,
    internal_note,
    status,
    usage_mode,
    validity_type,
    valid_from,
    valid_until,
    validity_duration_value,
    validity_duration_unit,
    created_by_user_id,
    created_by_display_name
  )
  VALUES (
    v_code,
    p_type,
    nullif(trim(p_internal_note), ''),
    'ACTIVE',
    p_usage_mode,
    p_validity_type,
    COALESCE(p_valid_from, clock_timestamp()),
    p_valid_until,
    p_duration_value,
    p_duration_unit,
    auth.uid(),
    coalesce(v_creator_name, 'Administrador')
  )
  RETURNING * INTO v_new_row;

  RETURN to_jsonb(v_new_row);
END;
$$;

-- 5.2. Editar vigencia de códigos reutilizables
CREATE OR REPLACE FUNCTION public.admin_update_benefit_code_validity(
  p_code_id uuid,
  p_validity_type text,
  p_valid_from timestamptz,
  p_valid_until timestamptz DEFAULT NULL,
  p_duration_value integer DEFAULT NULL,
  p_duration_unit text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
DECLARE
  v_editor_name text := 'Administrador';
  v_updated_row public.benefit_codes%ROWTYPE;
BEGIN
  IF NOT public.check_is_admin_user() THEN
    RAISE EXCEPTION 'UNAUTHORIZED_ADMIN_ONLY';
  END IF;

  IF p_validity_type NOT IN ('NO_EXPIRATION', 'ONE_WEEK', 'ONE_MONTH', 'CUSTOM_DURATION', 'DATE_RANGE') THEN
    RAISE EXCEPTION 'INVALID_VALIDITY_TYPE';
  END IF;

  SELECT display_name INTO v_editor_name
  FROM public.staff_profiles
  WHERE user_id = auth.uid();

  UPDATE public.benefit_codes
  SET validity_type = p_validity_type,
      valid_from = COALESCE(p_valid_from, valid_from),
      valid_until = p_valid_until,
      validity_duration_value = p_duration_value,
      validity_duration_unit = p_duration_unit,
      last_edited_at = clock_timestamp(),
      last_edited_by_user_id = auth.uid(),
      last_edited_by_display_name = coalesce(v_editor_name, 'Administrador'),
      updated_at = clock_timestamp()
  WHERE id = p_code_id
    AND deleted_at IS NULL
  RETURNING * INTO v_updated_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'BENEFIT_CODE_NOT_FOUND_OR_DELETED';
  END IF;

  RETURN to_jsonb(v_updated_row);
END;
$$;

-- 5.3. Activar o Desactivar código
CREATE OR REPLACE FUNCTION public.admin_toggle_benefit_code_status(
  p_code_id uuid,
  p_active boolean
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
DECLARE
  v_row public.benefit_codes%ROWTYPE;
  v_editor_name text := 'Administrador';
BEGIN
  IF NOT public.check_is_admin_user() THEN
    RAISE EXCEPTION 'UNAUTHORIZED_ADMIN_ONLY';
  END IF;

  SELECT * INTO v_row
  FROM public.benefit_codes
  WHERE id = p_code_id
  FOR UPDATE;

  IF NOT FOUND OR v_row.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'BENEFIT_CODE_NOT_FOUND_OR_DELETED';
  END IF;

  SELECT display_name INTO v_editor_name
  FROM public.staff_profiles
  WHERE user_id = auth.uid();

  IF p_active THEN
    -- Regla de reactivación:
    -- 1. Códigos de un solo uso consumidos no se reactivan
    IF v_row.usage_mode = 'SINGLE_USE' AND (v_row.status = 'CONSUMED' OR v_row.times_used > 0) THEN
      RAISE EXCEPTION 'CANNOT_REACTIVATE_CONSUMED_CODE: Un código de un solo uso ya consumido no puede reactivarse.';
    END IF;

    -- 2. No borrar su vencimiento al activar: si venció, explicar que primero debe actualizarse la vigencia
    IF v_row.valid_until IS NOT NULL AND v_row.valid_until < clock_timestamp() THEN
      RAISE EXCEPTION 'CANNOT_ACTIVATE_EXPIRED_CODE: No se puede activar un código vencido. Primero debe actualizar su vigencia.';
    END IF;

    UPDATE public.benefit_codes
    SET status = 'ACTIVE',
        last_edited_at = clock_timestamp(),
        last_edited_by_user_id = auth.uid(),
        last_edited_by_display_name = coalesce(v_editor_name, 'Administrador'),
        updated_at = clock_timestamp()
    WHERE id = p_code_id;
  ELSE
    -- Desactivar
    UPDATE public.benefit_codes
    SET status = 'DISABLED',
        last_edited_at = clock_timestamp(),
        last_edited_by_user_id = auth.uid(),
        last_edited_by_display_name = coalesce(v_editor_name, 'Administrador'),
        updated_at = clock_timestamp()
    WHERE id = p_code_id;
  END IF;

  RETURN true;
END;
$$;

-- Compatibilidad hacia atrás con admin_disable_benefit_code
CREATE OR REPLACE FUNCTION public.admin_disable_benefit_code(p_code_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
BEGIN
  RETURN public.admin_toggle_benefit_code_status(p_code_id, false);
END;
$$;

-- 5.4. Eliminar código (Soft-delete con confirmación e historial preservado)
CREATE OR REPLACE FUNCTION public.admin_delete_benefit_code(p_code_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
DECLARE
  v_admin_name text := 'Administrador';
BEGIN
  IF NOT public.check_is_admin_user() THEN
    RAISE EXCEPTION 'UNAUTHORIZED_ADMIN_ONLY';
  END IF;

  SELECT display_name INTO v_admin_name
  FROM public.staff_profiles
  WHERE user_id = auth.uid();

  UPDATE public.benefit_codes
  SET deleted_at = clock_timestamp(),
      deleted_by_user_id = auth.uid(),
      deleted_by_display_name = coalesce(v_admin_name, 'Administrador'),
      status = 'DISABLED',
      updated_at = clock_timestamp()
  WHERE id = p_code_id
    AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'BENEFIT_CODE_NOT_FOUND_OR_ALREADY_DELETED';
  END IF;

  RETURN true;
END;
$$;

-- 5.5. Listar códigos con trazabilidad 1:N y estados calculados
DROP FUNCTION IF EXISTS public.admin_list_benefit_codes();
DROP FUNCTION IF EXISTS public.admin_list_benefit_codes(boolean);
CREATE OR REPLACE FUNCTION public.admin_list_benefit_codes(
  p_include_deleted boolean DEFAULT true
)
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
      'usageMode', b.usage_mode,
      'validityType', b.validity_type,
      'validFrom', b.valid_from,
      'validUntil', b.valid_until,
      'validityDurationValue', b.validity_duration_value,
      'validityDurationUnit', b.validity_duration_unit,
      'timesUsed', b.times_used,
      'internalNote', b.internal_note,
      'rawStatus', b.status,
      'status', CASE
        WHEN b.deleted_at IS NOT NULL THEN 'DELETED'
        WHEN b.status = 'DISABLED' THEN 'DISABLED'
        WHEN b.usage_mode = 'SINGLE_USE' AND (b.status = 'CONSUMED' OR b.times_used > 0) THEN 'CONSUMED'
        WHEN b.valid_until IS NOT NULL AND b.valid_until < clock_timestamp() THEN 'EXPIRED'
        WHEN b.valid_from IS NOT NULL AND b.valid_from > clock_timestamp() THEN 'SCHEDULED'
        ELSE 'ACTIVE'
      END,
      'isLockedInCheckout', (b.status = 'LOCKED' AND b.locked_expires_at > clock_timestamp()),
      'createdByUserId', b.created_by_user_id,
      'createdByDisplayName', b.created_by_display_name,
      'createdAt', b.created_at,
      'updatedAt', b.updated_at,
      'lastEditedAt', b.last_edited_at,
      'lastEditedByUserId', b.last_edited_by_user_id,
      'lastEditedByDisplayName', b.last_edited_by_display_name,
      'deletedAt', b.deleted_at,
      'deletedByUserId', b.deleted_by_user_id,
      'deletedByDisplayName', b.deleted_by_display_name,
      -- Último consumo para compatibilidad directa con tarjetas
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
      'isAppointmentCancelled', (a.status = 'CANCELLED'),
      -- Desglose completo de reservas vinculadas (1:N)
      'usages', coalesce((
        SELECT jsonb_agg(
          jsonb_build_object(
            'id', u.id,
            'appointmentId', u.appointment_id,
            'requestNumber', ua.request_number,
            'bookingDate', ua.booking_date,
            'bookingTime', to_char(ua.start_time, 'HH24:MI'),
            'appointmentStatus', ua.status,
            'serviceName', us.name,
            'barberName', ubarb.name,
            'clientId', u.client_id,
            'clientName', uc.name,
            'clientPhone', uc.phone,
            'clientEmail', uc.email,
            'usedAt', u.used_at,
            'originalPriceArs', coalesce(u.original_price_ars, ua.benefit_original_price_ars),
            'discountAmountArs', coalesce(u.discount_amount_ars, ua.benefit_discount_amount_ars),
            'finalPriceArs', coalesce(u.final_price_ars, ua.benefit_final_price_ars),
            'onlineDepositArs', coalesce(u.online_deposit_ars, ua.benefit_online_deposit_ars),
            'inPersonBalanceArs', coalesce(u.in_person_balance_ars, ua.benefit_in_person_balance_ars),
            'isAppointmentCancelled', (ua.status = 'CANCELLED')
          ) ORDER BY u.used_at DESC
        )
        FROM public.benefit_code_usages u
        LEFT JOIN public.appointments ua ON ua.id = u.appointment_id
        LEFT JOIN public.clients uc ON uc.id = coalesce(u.client_id, ua.client_id)
        LEFT JOIN public.services us ON us.id = ua.service_id
        LEFT JOIN public.barbers ubarb ON ubarb.id = ua.barber_id
        WHERE u.benefit_code_id = b.id
      ), '[]'::jsonb)
    ) ORDER BY b.created_at DESC
  ), '[]'::jsonb)
  INTO v_result
  FROM public.benefit_codes b
  LEFT JOIN public.appointments a ON a.id = b.consumed_appointment_id
  LEFT JOIN public.clients c ON c.id = COALESCE(b.consumed_client_id, a.client_id)
  LEFT JOIN public.services s ON s.id = a.service_id
  LEFT JOIN public.barbers barb ON barb.id = a.barber_id
  WHERE (p_include_deleted OR b.deleted_at IS NULL);

  RETURN v_result;
END;
$$;

-- ==============================================================================
-- 6. RPCS PÚBLICAS Y DE RESERVA (COTIZACIÓN Y CONCURRENCIA)
-- ==============================================================================

-- 6.1. Cotización pública con validación de vigencia en Buenos Aires
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
  v_start_fmt text;
  v_end_fmt text;
BEGIN
  IF p_code IS NULL OR trim(p_code) = '' THEN
    RETURN jsonb_build_object('valid', false, 'error', 'Ingresá un código de beneficio.');
  END IF;

  v_norm := upper(regexp_replace(trim(p_code), '\s+', '-', 'g'));

  SELECT * INTO v_benefit
  FROM public.benefit_codes
  WHERE code = v_norm;

  IF NOT FOUND OR v_benefit.deleted_at IS NOT NULL THEN
    RETURN jsonb_build_object('valid', false, 'error', 'El código de beneficio no existe o es inválido.');
  END IF;

  IF v_benefit.status = 'DISABLED' THEN
    RETURN jsonb_build_object('valid', false, 'error', 'Este código ha sido desactivado.');
  END IF;

  -- Validación de un solo uso consumido
  IF v_benefit.usage_mode = 'SINGLE_USE' AND (v_benefit.status = 'CONSUMED' OR v_benefit.times_used > 0) THEN
    RETURN jsonb_build_object('valid', false, 'error', 'Este código ya fue utilizado en otra reserva.');
  END IF;

  -- Validación de vigencia (inicio)
  IF v_benefit.valid_from IS NOT NULL AND v_benefit.valid_from > clock_timestamp() THEN
    v_start_fmt := to_char(timezone('America/Argentina/Buenos_Aires', v_benefit.valid_from), 'DD/MM/YYYY');
    RETURN jsonb_build_object('valid', false, 'error', 'Este código de beneficio aún no está vigente (inicia el ' || v_start_fmt || ').');
  END IF;

  -- Validación de vigencia (fin / vencimiento)
  IF v_benefit.valid_until IS NOT NULL AND v_benefit.valid_until < clock_timestamp() THEN
    v_end_fmt := to_char(timezone('America/Argentina/Buenos_Aires', v_benefit.valid_until), 'DD/MM/YYYY');
    RETURN jsonb_build_object('valid', false, 'error', 'Este código de beneficio ha vencido (venció el ' || v_end_fmt || ').');
  END IF;

  -- Bloqueo temporal exclusivo SOLO para códigos de un solo uso
  IF v_benefit.usage_mode = 'SINGLE_USE' AND v_benefit.status = 'LOCKED' AND v_benefit.locked_expires_at > clock_timestamp() THEN
    RETURN jsonb_build_object('valid', false, 'error', 'El código se encuentra en uso en otro intento de reserva. Si no se completa, se liberará en unos minutos.');
  END IF;

  -- Resolver precio del servicio
  SELECT price_ars INTO v_price
  FROM public.services
  WHERE name = trim(p_service_name);

  IF v_price IS NULL THEN
    v_price := 25000;
  END IF;

  v_deposit := public.read_public_deposit_amount(trim(p_barber_name));
  IF v_deposit IS NULL OR v_deposit <= 0 THEN
    v_deposit := 5000;
  END IF;

  -- Cálculos económicos
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
    'usageMode', v_benefit.usage_mode,
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

-- 6.2. Bloqueo temporal para checkout de Payway (soporte de concurrencia para reutilizables)
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
  v_benefit public.benefit_codes%ROWTYPE;
  v_expires timestamptz;
BEGIN
  IF p_code IS NULL OR trim(p_code) = '' OR p_attempt_id IS NULL OR trim(p_attempt_id) = '' THEN
    RETURN false;
  END IF;

  v_norm := upper(regexp_replace(trim(p_code), '\s+', '-', 'g'));
  v_expires := clock_timestamp() + (p_ttl_seconds || ' seconds')::interval;

  SELECT * INTO v_benefit
  FROM public.benefit_codes
  WHERE code = v_norm
  FOR UPDATE;

  IF NOT FOUND OR v_benefit.deleted_at IS NOT NULL OR v_benefit.status = 'DISABLED' THEN
    RETURN false;
  END IF;

  -- Verificar vigencia
  IF (v_benefit.valid_from IS NOT NULL AND v_benefit.valid_from > clock_timestamp()) OR
     (v_benefit.valid_until IS NOT NULL AND v_benefit.valid_until < clock_timestamp()) THEN
    RETURN false;
  END IF;

  IF v_benefit.usage_mode = 'REUSABLE' THEN
    -- Código reutilizable: NO bloquea globalmente. Registra el lock por intento.
    INSERT INTO public.benefit_code_attempt_locks (benefit_code_id, attempt_id, locked_at, expires_at)
    VALUES (v_benefit.id, p_attempt_id, clock_timestamp(), v_expires)
    ON CONFLICT (attempt_id) DO UPDATE
    SET expires_at = EXCLUDED.expires_at;

    RETURN true;
  ELSE
    -- Código de un solo uso: bloqueo exclusivo
    IF v_benefit.status = 'CONSUMED' OR v_benefit.times_used > 0 THEN
      RETURN false;
    END IF;

    IF v_benefit.status = 'LOCKED' AND v_benefit.locked_expires_at > clock_timestamp() AND v_benefit.locked_attempt_id <> p_attempt_id THEN
      RETURN false;
    END IF;

    UPDATE public.benefit_codes
    SET status = 'LOCKED',
        locked_at = clock_timestamp(),
        locked_expires_at = v_expires,
        locked_attempt_id = p_attempt_id,
        updated_at = clock_timestamp()
    WHERE id = v_benefit.id;

    INSERT INTO public.benefit_code_attempt_locks (benefit_code_id, attempt_id, locked_at, expires_at)
    VALUES (v_benefit.id, p_attempt_id, clock_timestamp(), v_expires)
    ON CONFLICT (attempt_id) DO UPDATE
    SET expires_at = EXCLUDED.expires_at;

    RETURN true;
  END IF;
END;
$$;

-- 6.3. Liberar intento de pago abandonado o cancelado
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
  -- Eliminar lock de la tabla de intentos
  IF p_attempt_id IS NOT NULL AND trim(p_attempt_id) <> '' THEN
    DELETE FROM public.benefit_code_attempt_locks
    WHERE attempt_id = p_attempt_id
       OR replace(attempt_id, '-', '') = replace(p_attempt_id, '-', '');
  END IF;

  -- Para códigos de un solo uso que estuvieran bloqueados por este intento
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

-- 6.4. Confirmación atómica sin seña (NO_DEPOSIT o FREE_SERVICE)
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

  -- Bloquear y validar código atómicamente en la base
  SELECT * INTO v_benefit
  FROM public.benefit_codes
  WHERE code = v_norm
  FOR UPDATE;

  IF NOT FOUND OR v_benefit.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'BENEFIT_CODE_NOT_FOUND';
  END IF;

  IF v_benefit.status = 'DISABLED' THEN
    RAISE EXCEPTION 'BENEFIT_CODE_DISABLED';
  END IF;

  -- Validación de un solo uso
  IF v_benefit.usage_mode = 'SINGLE_USE' AND (v_benefit.status = 'CONSUMED' OR v_benefit.times_used > 0) THEN
    RAISE EXCEPTION 'BENEFIT_CODE_ALREADY_CONSUMED';
  END IF;

  -- Validación de vigencia (inicio)
  IF v_benefit.valid_from IS NOT NULL AND v_benefit.valid_from > clock_timestamp() THEN
    RAISE EXCEPTION 'BENEFIT_CODE_NOT_YET_VALID';
  END IF;

  -- Validación de vigencia (fin)
  IF v_benefit.valid_until IS NOT NULL AND v_benefit.valid_until < clock_timestamp() THEN
    RAISE EXCEPTION 'BENEFIT_CODE_EXPIRED';
  END IF;

  -- Si el código estaba bloqueado por un checkout previo pero el lock expiró, liberarlo
  IF v_benefit.usage_mode = 'SINGLE_USE' AND v_benefit.status = 'LOCKED' THEN
    IF v_benefit.locked_expires_at IS NOT NULL AND v_benefit.locked_expires_at <= clock_timestamp() THEN
      UPDATE public.benefit_codes
      SET status = 'ACTIVE',
          locked_at = NULL,
          locked_expires_at = NULL,
          locked_attempt_id = NULL,
          updated_at = clock_timestamp()
      WHERE id = v_benefit.id;
    ELSE
      RAISE EXCEPTION 'BENEFIT_CODE_LOCKED';
    END IF;
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

  -- Autorizar transición en trigger
  PERFORM set_config('kani.verified_payment_appointment', v_appt_id::text, true);

  -- Confirmar turno y registrar snapshot inmutable
  UPDATE public.appointments
  SET status = 'CONFIRMED',
      deposit_paid = false,
      deposit_amount_ars = 0,
      balance_paid = (v_benefit.type = 'FREE_SERVICE'),
      benefit_code_id = v_benefit.id,
      benefit_code = v_benefit.code,
      benefit_type = v_benefit.type,
      benefit_usage_mode = v_benefit.usage_mode,
      benefit_original_price_ars = v_price,
      benefit_discount_amount_ars = v_discount,
      benefit_final_price_ars = v_final,
      benefit_online_deposit_ars = 0,
      benefit_in_person_balance_ars = v_balance,
      updated_at = clock_timestamp()
  WHERE id = v_appt_id;

  PERFORM set_config('kani.verified_payment_appointment', '', true);

  -- Registrar uso en benefit_code_usages
  INSERT INTO public.benefit_code_usages (
    benefit_code_id,
    appointment_id,
    client_id,
    used_at,
    original_price_ars,
    discount_amount_ars,
    final_price_ars,
    online_deposit_ars,
    in_person_balance_ars
  ) VALUES (
    v_benefit.id,
    v_appt_id,
    v_client_id,
    clock_timestamp(),
    v_price,
    v_discount,
    v_final,
    0,
    v_balance
  );

  -- Actualizar benefit_codes
  IF v_benefit.usage_mode = 'SINGLE_USE' THEN
    UPDATE public.benefit_codes
    SET status = 'CONSUMED',
        times_used = times_used + 1,
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
  ELSE
    -- Reutilizable: incrementa usos y permanece ACTIVE
    UPDATE public.benefit_codes
    SET times_used = times_used + 1,
        consumed_at = clock_timestamp(),
        consumed_appointment_id = v_appt_id,
        consumed_client_id = v_client_id,
        original_price_ars = v_price,
        discount_amount_ars = v_discount,
        final_price_ars = v_final,
        online_deposit_ars = 0,
        in_person_balance_ars = v_balance,
        updated_at = clock_timestamp()
    WHERE id = v_benefit.id;
  END IF;

  -- Crear evento de notificación de confirmación
  v_notif_token := public.create_appointment_notification_event(v_appt_id, 'CONFIRMED');

  RETURN jsonb_build_object(
    'confirmed', true,
    'appointmentId', v_appt_id,
    'requestNumber', v_req_num,
    'notificationClaimToken', v_notif_token,
    'benefitType', v_benefit.type,
    'usageMode', v_benefit.usage_mode,
    'originalPriceArs', v_price,
    'discountAmountArs', v_discount,
    'finalPriceArs', v_final,
    'onlineDepositArs', 0,
    'inPersonBalanceArs', v_balance
  );
END;
$$;

-- 6.5. Consumir código bloqueado en Payway tras aprobación exitosa del pago
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
  v_code_id uuid;
  v_code_row public.benefit_codes%ROWTYPE;
  v_appt_row public.appointments%ROWTYPE;
  v_service_price integer;
  v_discount integer := 0;
  v_final integer;
  v_deposit integer := 0;
  v_balance integer;
BEGIN
  -- 1. Buscar en benefit_code_attempt_locks
  SELECT benefit_code_id INTO v_code_id
  FROM public.benefit_code_attempt_locks
  WHERE attempt_id = p_attempt_id
     OR replace(attempt_id, '-', '') = replace(p_attempt_id, '-', '')
  ORDER BY locked_at DESC
  LIMIT 1;

  -- Fallback a benefit_codes.locked_attempt_id
  IF v_code_id IS NULL THEN
    SELECT id INTO v_code_id
    FROM public.benefit_codes
    WHERE locked_attempt_id = p_attempt_id
       OR replace(locked_attempt_id, '-', '') = replace(p_attempt_id, '-', '')
    LIMIT 1;
  END IF;

  IF v_code_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT * INTO v_code_row
  FROM public.benefit_codes
  WHERE id = v_code_id
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
      benefit_usage_mode = v_code_row.usage_mode,
      benefit_original_price_ars = v_service_price,
      benefit_discount_amount_ars = v_discount,
      benefit_final_price_ars = v_final,
      benefit_online_deposit_ars = v_deposit,
      benefit_in_person_balance_ars = v_balance,
      updated_at = clock_timestamp()
  WHERE id = p_appointment_id;

  -- Registrar uso en benefit_code_usages
  INSERT INTO public.benefit_code_usages (
    benefit_code_id,
    appointment_id,
    client_id,
    used_at,
    original_price_ars,
    discount_amount_ars,
    final_price_ars,
    online_deposit_ars,
    in_person_balance_ars
  ) VALUES (
    v_code_row.id,
    p_appointment_id,
    v_appt_row.client_id,
    clock_timestamp(),
    v_service_price,
    v_discount,
    v_final,
    v_deposit,
    v_balance
  )
  ON CONFLICT (benefit_code_id, appointment_id) DO NOTHING;

  -- Actualizar código
  IF v_code_row.usage_mode = 'SINGLE_USE' THEN
    UPDATE public.benefit_codes
    SET status = 'CONSUMED',
        times_used = times_used + 1,
        consumed_at = clock_timestamp(),
        consumed_appointment_id = p_appointment_id,
        consumed_client_id = v_appt_row.client_id,
        original_price_ars = v_service_price,
        discount_amount_ars = v_discount,
        final_price_ars = v_final,
        online_deposit_ars = v_deposit,
        in_person_balance_ars = v_balance,
        locked_at = NULL,
        locked_expires_at = NULL,
        locked_attempt_id = NULL,
        updated_at = clock_timestamp()
    WHERE id = v_code_row.id;
  ELSE
    UPDATE public.benefit_codes
    SET times_used = times_used + 1,
        consumed_at = clock_timestamp(),
        consumed_appointment_id = p_appointment_id,
        consumed_client_id = v_appt_row.client_id,
        original_price_ars = v_service_price,
        discount_amount_ars = v_discount,
        final_price_ars = v_final,
        online_deposit_ars = v_deposit,
        in_person_balance_ars = v_balance,
        updated_at = clock_timestamp()
    WHERE id = v_code_row.id;
  END IF;

  -- Limpiar intento
  DELETE FROM public.benefit_code_attempt_locks
  WHERE attempt_id = p_attempt_id
     OR replace(attempt_id, '-', '') = replace(p_attempt_id, '-', '');

  RETURN true;
END;
$$;

-- Permisos
REVOKE ALL ON TABLE public.benefit_code_usages FROM public, anon;
GRANT SELECT ON TABLE public.benefit_code_usages TO authenticated;
GRANT ALL ON TABLE public.benefit_code_usages TO service_role;

REVOKE ALL ON TABLE public.benefit_code_attempt_locks FROM public, anon;
GRANT ALL ON TABLE public.benefit_code_attempt_locks TO service_role, authenticated;

GRANT EXECUTE ON FUNCTION public.admin_create_benefit_code(text, text, text, text, text, timestamptz, timestamptz, integer, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_update_benefit_code_validity(uuid, text, timestamptz, timestamptz, integer, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_toggle_benefit_code_status(uuid, boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_delete_benefit_code(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_list_benefit_codes(boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.validate_and_quote_benefit_code(text, text, text) TO public, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.lock_benefit_code_attempt(text, text, integer) TO public, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.release_benefit_code_attempt(text, text) TO public, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.confirm_zero_deposit_appointment(text, text, date, time, text, text, text, text, text) TO public, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_consume_benefit_code_for_attempt(uuid, text) TO public, anon, authenticated, service_role;

-- Recargar caché de esquema de PostgREST
NOTIFY pgrst, 'reload schema';

COMMIT;


