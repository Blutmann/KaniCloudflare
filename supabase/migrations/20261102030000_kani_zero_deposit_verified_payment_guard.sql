-- Migration: 20261102030000_kani_zero_deposit_verified_payment_guard.sql
-- Kani Barber Studio — Zero-Deposit Transition Guard & Atomic Confirmation Fix
-- 
-- Permite la transición de PENDING a CONFIRMED exclusivamente cuando:
-- 1. Existe cobro verificado online por pasarela (Payway / Mercado Pago) con deposit_paid = true.
-- 2. O BIEN el servidor validó un beneficio de seña $0 (NO_DEPOSIT o FREE_SERVICE)
--    estableciendo kani.verified_payment_appointment = appointment_id,
--    con benefit_code_id NOT NULL y benefit_online_deposit_ars = 0.
-- 
-- Mantiene intacta la seguridad: llamadas directas o no autorizadas siguen arrojando VERIFIED_PAYMENT_REQUIRED.

-- 1. Actualizar el trigger guard_pending_payment_transition
CREATE OR REPLACE FUNCTION public.guard_pending_payment_transition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
declare
  v_verified_appt text;
  v_is_verified_payment boolean;
  v_is_verified_zero_deposit boolean;
begin
  if old.status = 'PENDING' and new.status in ('CONFIRMED', 'COMPLETED') then
    v_verified_appt := current_setting('kani.verified_payment_appointment', true);
    
    -- Caso 1: Pasarela de cobro verificado (Payway o Mercado Pago) con seña efectivamente pagada
    v_is_verified_payment := (
      v_verified_appt is not distinct from new.id::text
      and new.deposit_paid = true
    );

    -- Caso 2: Beneficio verificado en el servidor con seña online $0 (NO_DEPOSIT o FREE_SERVICE)
    -- Exclusivamente cuando la función del servidor validó el beneficio,
    -- el contexto transaccional kani.verified_payment_appointment coincide con el turno,
    -- está vinculado a un código de beneficio real y el importe online es estrictamente $0.
    v_is_verified_zero_deposit := (
      v_verified_appt is not distinct from new.id::text
      and new.benefit_code_id is not null
      and new.benefit_type in ('NO_DEPOSIT', 'FREE_SERVICE')
      and coalesce(new.benefit_online_deposit_ars, 0) = 0
      and new.deposit_paid = false
    );

    if not (v_is_verified_payment or v_is_verified_zero_deposit) then
      raise exception using errcode = '42501', message = 'VERIFIED_PAYMENT_REQUIRED';
    end if;
  end if;

  return new;
end; $$;

REVOKE ALL ON FUNCTION public.guard_pending_payment_transition() FROM public, anon, authenticated;

-- 2. Actualizar confirm_zero_deposit_appointment con contexto seguro y liberación de locks expirados
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

  IF NOT FOUND THEN
    RAISE EXCEPTION 'BENEFIT_CODE_NOT_FOUND';
  END IF;

  IF v_benefit.status = 'CONSUMED' THEN
    RAISE EXCEPTION 'BENEFIT_CODE_ALREADY_CONSUMED';
  END IF;

  IF v_benefit.status = 'DISABLED' THEN
    RAISE EXCEPTION 'BENEFIT_CODE_DISABLED';
  END IF;

  -- Si el código estaba bloqueado por un checkout previo pero el lock expiró, liberarlo
  IF v_benefit.status = 'LOCKED' THEN
    IF v_benefit.locked_expires_at IS NOT NULL AND v_benefit.locked_expires_at <= clock_timestamp() THEN
      -- Lock expirado: permitir su uso limpiando el bloqueo
      UPDATE public.benefit_codes
      SET status = 'ACTIVE',
          locked_at = NULL,
          locked_expires_at = NULL,
          locked_attempt_id = NULL,
          updated_at = clock_timestamp()
      WHERE id = v_benefit.id;
    ELSE
      -- Lock aún vigente en otro intento de pago
      RAISE EXCEPTION 'BENEFIT_CODE_LOCKED';
    END IF;
  END IF;

  IF v_benefit.type NOT IN ('NO_DEPOSIT', 'FREE_SERVICE') THEN
    RAISE EXCEPTION 'BENEFIT_REQUIRES_ONLINE_PAYMENT';
  END IF;

  -- Crear turno mediante la RPC oficial de reservas (valida disponibilidad, solapamientos y cliente)
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

  -- Configurar el contexto de sesión verificado para autorizar la transición en el trigger
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
      benefit_original_price_ars = v_price,
      benefit_discount_amount_ars = v_discount,
      benefit_final_price_ars = v_final,
      benefit_online_deposit_ars = 0,
      benefit_in_person_balance_ars = v_balance,
      updated_at = clock_timestamp()
  WHERE id = v_appt_id;

  -- Limpiar contexto de autorización
  PERFORM set_config('kani.verified_payment_appointment', '', true);

  -- Consumir código definitivamente (atómicamente vinculado a la reserva)
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

GRANT EXECUTE ON FUNCTION public.confirm_zero_deposit_appointment(text, text, date, time, text, text, text, text, text) TO public, anon, authenticated, service_role;
