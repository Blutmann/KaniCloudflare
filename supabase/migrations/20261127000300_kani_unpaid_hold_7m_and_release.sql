-- ==============================================================================
-- KANI BARBER STUDIO — VENTANA DE HOLD IMPAGO DE 7 MINUTOS, FIX MP Y LIBERACIÓN INMEDIATA
-- ==============================================================================
-- Migración local (NO ejecutar remotamente sin autorización explícita).
--
-- Cambios:
--   1. Alinea la ventana de reserva temporal impaga (PENDING) de 10m a 7m en:
--      - public.payment_attempts.expires_at (default)
--      - public.expire_unpaid_appointments()
--      - public.prepare_payway_attempt()
--      - public.create_manual_appointment()
--      - public.update_manual_appointment()
--   2. Corrige el bug de Mercado Pago en public.expire_unpaid_appointments():
--      ahora libera turnos PENDING pasados los 7 minutos aunque
--      appointment_payment_orders.reconciliation_status siga en 'PENDING'
--      (siempre que paid_amount_ars IS NULL, not deposit_paid y sin payment_attempts APPROVED),
--      sin borrar appointment_payment_orders ni tocar intentos PROCESSING/UNKNOWN.
--   3. Agrega public.release_abandoned_unpaid_hold(uuid) (service_role only) para
--      liberación atómica inmediata (cancellation_reason = 'HOLD_ABANDONED') cuando el
--      cliente abandona explícitamente Payway o vuelve por /pago/error sin pago en curso.
--   4. Mantiene y refuerza la red de seguridad de pagos tardíos en
--      public.confirm_verified_appointment_payment(...) para recuperar pagos tardíos
--      tras PAYMENT_EXPIRED o HOLD_ABANDONED si el horario sigue libre, o marcar
--      PAID_LATE_REVIEW si otro cliente ya tomó ese horario.
-- ==============================================================================

BEGIN;

-- 1. Default de expires_at en payment_attempts: 7 minutos
ALTER TABLE public.payment_attempts
  ALTER COLUMN expires_at SET DEFAULT (now() + interval '7 minutes');

-- 2. expire_unpaid_appointments(): ventana 7m + fix de órdenes MP en PENDING sin pago
CREATE OR REPLACE FUNCTION public.expire_unpaid_appointments() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  a record;
  n integer := 0;
BEGIN
  FOR a IN
    SELECT id, barber_id, booking_date
    FROM public.appointments
    WHERE status = 'PENDING'
      AND NOT deposit_paid
      AND created_at <= now() - interval '7 minutes'
    ORDER BY barber_id, booking_date, id
    LIMIT 500
  LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended(a.barber_id::text || '|' || a.booking_date::text, 0));
    PERFORM 1 FROM public.appointments WHERE id = a.id FOR UPDATE;

    IF EXISTS (
      SELECT 1
      FROM public.appointments
      WHERE id = a.id
        AND status = 'PENDING'
        AND NOT deposit_paid
        AND created_at <= now() - interval '7 minutes'
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.payment_attempts
      WHERE appointment_id = a.id
        AND state = 'APPROVED'
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.appointment_payment_orders
      WHERE appointment_id = a.id
        AND (
          paid_amount_ars IS NOT NULL
          OR reconciliation_status IN ('CONFIRMED', 'PAID_LATE_REVIEW', 'PAID_CANCELLED_REVIEW')
        )
    ) THEN
      -- Solo cancela intentos CREATED; preserva PROCESSING/UNKNOWN y appointment_payment_orders intactos
      UPDATE public.payment_attempts
      SET state = 'CANCELLED'
      WHERE appointment_id = a.id
        AND state = 'CREATED';

      UPDATE public.appointments
      SET status = 'CANCELLED',
          cancellation_reason = 'PAYMENT_EXPIRED',
          cancelled_at = now(),
          updated_at = now()
      WHERE id = a.id;

      n := n + 1;
    END IF;
  END LOOP;
  RETURN n;
END;
$$;

REVOKE ALL ON FUNCTION public.expire_unpaid_appointments() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expire_unpaid_appointments() TO service_role;

-- 3. release_abandoned_unpaid_hold(uuid): liberación atómica inmediata cuando el cliente abandona
CREATE OR REPLACE FUNCTION public.release_abandoned_unpaid_hold(p_appointment_id uuid)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_appt public.appointments%ROWTYPE;
BEGIN
  IF p_appointment_id IS NULL THEN
    RETURN 'NOT_FOUND';
  END IF;

  SELECT * INTO v_appt FROM public.appointments WHERE id = p_appointment_id;
  IF NOT FOUND THEN
    RETURN 'NOT_FOUND';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_appt.barber_id::text || '|' || v_appt.booking_date::text, 0));
  SELECT * INTO v_appt FROM public.appointments WHERE id = p_appointment_id FOR UPDATE;

  IF v_appt.status <> 'PENDING' OR v_appt.deposit_paid THEN
    RETURN 'NOT_PENDING';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.payment_attempts
    WHERE appointment_id = p_appointment_id
      AND state IN ('APPROVED', 'PROCESSING', 'UNKNOWN')
  ) THEN
    RETURN 'PAYMENT_IN_PROGRESS_OR_PAID';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.appointment_payment_orders
    WHERE appointment_id = p_appointment_id
      AND (
        paid_amount_ars IS NOT NULL
        OR reconciliation_status IN ('CONFIRMED', 'PAID_LATE_REVIEW', 'PAID_CANCELLED_REVIEW')
      )
  ) THEN
    RETURN 'PAYMENT_IN_PROGRESS_OR_PAID';
  END IF;

  UPDATE public.payment_attempts
  SET state = 'CANCELLED'
  WHERE appointment_id = p_appointment_id
    AND state = 'CREATED';

  UPDATE public.appointments
  SET status = 'CANCELLED',
      cancellation_reason = 'HOLD_ABANDONED',
      cancelled_at = now(),
      updated_at = now()
  WHERE id = p_appointment_id;

  RETURN 'RELEASED';
END;
$$;

REVOKE ALL ON FUNCTION public.release_abandoned_unpaid_hold(uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_abandoned_unpaid_hold(uuid) TO service_role;

-- 4. prepare_payway_attempt(): ventana unificada de 7 minutos
CREATE OR REPLACE FUNCTION public.prepare_payway_attempt(
  p_attempt_id uuid, p_site_id text, p_barber_name text, p_service_name text,
  p_booking_date date, p_start_time time, p_client_name text, p_client_phone text,
  p_client_email text, p_notes text DEFAULT NULL, p_existing_appointment_id uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_id uuid; v_appt public.appointments%ROWTYPE; v_attempt public.payment_attempts%ROWTYPE;
  v_barber text; v_price integer; v_deposit numeric;
BEGIN
  IF p_site_id IS NULL OR p_site_id !~ '^[0-9]{1,20}$' OR p_attempt_id IS NULL THEN
    RAISE EXCEPTION 'PAYMENT_CONFIGURATION_INVALID';
  END IF;
  IF p_existing_appointment_id IS NULL THEN
    SELECT r.appointment_id INTO v_id FROM public.request_appointment(
      p_barber_name, p_service_name, p_booking_date, p_start_time, p_client_name, p_client_phone, p_client_email, p_notes
    ) r;
  ELSE
    v_id := p_existing_appointment_id;
  END IF;

  SELECT * INTO STRICT v_appt FROM public.appointments WHERE id = v_id;
  PERFORM pg_advisory_xact_lock(hashtextextended(v_appt.barber_id::text || '|' || v_appt.booking_date::text, 0));
  SELECT * INTO STRICT v_appt FROM public.appointments WHERE id = v_id FOR UPDATE;

  IF NOT EXISTS (
    SELECT 1 FROM public.appointments a
    JOIN public.barbers b ON b.id = a.barber_id
    JOIN public.services s ON s.id = a.service_id
    JOIN public.clients c ON c.id = a.client_id
    WHERE a.id = v_id AND b.name = trim(p_barber_name) AND s.name = trim(p_service_name)
      AND a.booking_date = p_booking_date AND a.start_time = p_start_time
      AND c.name = trim(p_client_name) AND lower(c.email) = lower(trim(p_client_email)) AND c.phone = trim(p_client_phone)
      AND coalesce(a.notes, '') = trim(coalesce(p_notes, ''))
  ) THEN
    RAISE EXCEPTION 'CHECKOUT_RESERVATION_CHANGED';
  END IF;

  IF v_appt.status <> 'PENDING' OR v_appt.deposit_paid OR v_appt.created_at + interval '7 minutes' <= clock_timestamp() THEN
    RAISE EXCEPTION 'APPOINTMENT_NOT_PAYABLE';
  END IF;
  IF EXISTS (SELECT 1 FROM public.appointment_payment_orders WHERE appointment_id = v_id) THEN
    RAISE EXCEPTION 'PAYMENT_PROVIDER_CONFLICT';
  END IF;

  SELECT * INTO v_attempt FROM public.payment_attempts
  WHERE appointment_id = v_id
    AND state IN ('CREATED', 'PROCESSING', 'APPROVED', 'UNKNOWN')
  FOR UPDATE;
  IF FOUND THEN
    IF v_attempt.state <> 'CREATED' OR v_attempt.expires_at <= clock_timestamp() THEN
      RAISE EXCEPTION 'PAYMENT_REVIEW_REQUIRED';
    END IF;
    RETURN to_jsonb(v_attempt);
  END IF;

  SELECT b.name, s.price_ars INTO v_barber, v_price
  FROM public.barbers b JOIN public.services s ON s.id = v_appt.service_id
  WHERE b.id = v_appt.barber_id;
  v_deposit := public.read_public_deposit_amount(v_barber);
  IF v_deposit IS NULL OR v_deposit <= 0 OR v_deposit > v_price THEN
    RAISE EXCEPTION 'DEPOSIT_CONFIGURATION_INVALID';
  END IF;

  INSERT INTO public.payment_attempts(id, appointment_id, provider, site_transaction_id, provider_site_id, amount_ars, amount_minor_units, expires_at)
  VALUES (p_attempt_id, v_id, 'PAYWAY', 'KANI' || replace(p_attempt_id::text, '-', ''), p_site_id, v_deposit, (v_deposit * 100)::bigint, v_appt.created_at + interval '7 minutes')
  RETURNING * INTO v_attempt;

  RETURN to_jsonb(v_attempt);
END;
$$;

REVOKE ALL ON FUNCTION public.prepare_payway_attempt(uuid, text, text, text, date, time, text, text, text, text, uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_payway_attempt(uuid, text, text, text, date, time, text, text, text, text, uuid) TO service_role;

-- 5. confirm_verified_appointment_payment(): red de seguridad para pagos tardíos
--    Recupera atómicamente tras PAYMENT_EXPIRED o HOLD_ABANDONED si el slot sigue libre;
--    si otro cliente ya lo tomó o la hora pasó, marca PAID_LATE_REVIEW.
CREATE OR REPLACE FUNCTION public.confirm_verified_appointment_payment(
  p_appointment_id uuid,
  p_provider text,
  p_reference text,
  p_paid_amount numeric
)
RETURNS TABLE(appointment_status public.appointment_status, result_code text, notification_claim_token text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_appt public.appointments%ROWTYPE;
  v_order public.appointment_payment_orders%ROWTYPE;
  v_attempt public.payment_attempts%ROWTYPE;
  v_token text;
  v_resolution text;
  v_collision boolean;
  v_past boolean;
BEGIN
  SELECT * INTO v_appt FROM public.appointments WHERE id = p_appointment_id;
  IF NOT FOUND THEN
    RETURN QUERY SELECT null::public.appointment_status, 'APPOINTMENT_NOT_FOUND'::text, null::text;
    RETURN;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_appt.barber_id::text || '|' || v_appt.booking_date::text, 0));
  SELECT * INTO v_appt FROM public.appointments WHERE id = p_appointment_id FOR UPDATE;

  IF p_provider = 'MERCADO_PAGO' THEN
    SELECT * INTO v_order FROM public.appointment_payment_orders WHERE appointment_id = p_appointment_id FOR UPDATE;
    IF NOT FOUND OR p_reference IS NULL OR v_order.order_id IS DISTINCT FROM p_reference OR p_paid_amount IS DISTINCT FROM v_order.expected_amount_ars::numeric THEN
      RETURN QUERY SELECT v_appt.status, 'PAYMENT_MISMATCH'::text, null::text;
      RETURN;
    END IF;
    UPDATE public.appointment_payment_orders
    SET paid_amount_ars = p_paid_amount::integer, updated_at = now()
    WHERE appointment_id = p_appointment_id;
  ELSIF p_provider = 'PAYWAY' THEN
    SELECT * INTO v_attempt FROM public.payment_attempts WHERE id = p_reference::uuid AND appointment_id = p_appointment_id AND provider = 'PAYWAY' FOR UPDATE;
    IF NOT FOUND OR v_attempt.state <> 'APPROVED' OR v_attempt.provider_transaction_id IS NULL OR p_paid_amount IS DISTINCT FROM v_attempt.amount_ars THEN
      RETURN QUERY SELECT v_appt.status, 'PAYMENT_MISMATCH'::text, null::text;
      RETURN;
    END IF;
  ELSE
    RETURN QUERY SELECT v_appt.status, 'PAYMENT_MISMATCH'::text, null::text;
    RETURN;
  END IF;

  IF v_appt.status IN ('CONFIRMED', 'COMPLETED') THEN
    IF NOT v_appt.deposit_paid THEN
      UPDATE public.appointments
      SET deposit_paid = true,
          deposit_amount_ars = p_paid_amount::integer,
          balance_paid = CASE WHEN coalesce(service_price_ars, 0) <= p_paid_amount::integer THEN true ELSE balance_paid END,
          updated_at = now()
      WHERE id = p_appointment_id;
    END IF;
    IF p_provider = 'PAYWAY' THEN
      UPDATE public.payment_attempts SET confirmation_status = 'ALREADY_CONFIRMED' WHERE id = v_attempt.id;
    END IF;
    RETURN QUERY SELECT v_appt.status, 'ALREADY_CONFIRMED'::text, null::text;
    RETURN;
  END IF;

  v_collision := EXISTS (
    SELECT 1 FROM public.appointments other
    WHERE other.barber_id = v_appt.barber_id
      AND other.booking_date = v_appt.booking_date
      AND other.id <> v_appt.id
      AND other.status IN ('PENDING', 'CONFIRMED', 'COMPLETED')
      AND other.start_time < v_appt.end_time
      AND other.end_time > v_appt.start_time
  );
  v_past := (v_appt.booking_date + v_appt.start_time <= timezone('America/Argentina/Buenos_Aires', now()));

  IF v_appt.status = 'CANCELLED' AND coalesce(v_appt.cancellation_reason, '') NOT IN ('PAYMENT_EXPIRED', 'HOLD_ABANDONED') THEN
    v_resolution := 'PAID_CANCELLED_REVIEW';
  ELSIF v_collision OR v_past THEN
    v_resolution := 'PAID_LATE_REVIEW';
  END IF;

  IF v_resolution IS NOT NULL THEN
    IF p_provider = 'MERCADO_PAGO' THEN
      UPDATE public.appointment_payment_orders SET reconciliation_status = v_resolution, updated_at = now() WHERE appointment_id = p_appointment_id;
    ELSE
      UPDATE public.payment_attempts SET confirmation_status = v_resolution WHERE id = v_attempt.id;
    END IF;
    RETURN QUERY SELECT v_appt.status, CASE WHEN v_resolution = 'PAID_CANCELLED_REVIEW' THEN 'APPOINTMENT_CANCELLED' ELSE 'SLOT_COLLISION_LATE_PAYMENT' END, null::text;
    RETURN;
  END IF;

  PERFORM set_config('kani.verified_payment_appointment', p_appointment_id::text, true);
  UPDATE public.appointments
  SET status = 'CONFIRMED',
      deposit_paid = true,
      deposit_amount_ars = p_paid_amount::integer,
      balance_paid = CASE WHEN coalesce(service_price_ars, 0) <= p_paid_amount::integer THEN true ELSE balance_paid END,
      cancellation_reason = null,
      cancelled_at = null,
      cancelled_by = null,
      updated_at = now()
  WHERE id = p_appointment_id;
  PERFORM set_config('kani.verified_payment_appointment', '', true);

  IF p_provider = 'MERCADO_PAGO' THEN
    UPDATE public.appointment_payment_orders SET reconciliation_status = 'CONFIRMED', updated_at = now() WHERE appointment_id = p_appointment_id;
  ELSE
    UPDATE public.payment_attempts SET confirmation_status = 'CONFIRMED' WHERE id = v_attempt.id;
  END IF;

  v_token := public.create_appointment_notification_event(p_appointment_id, 'CONFIRMED');
  RETURN QUERY SELECT 'CONFIRMED'::public.appointment_status, 'CONFIRMED'::text, v_token;
END;
$$;

REVOKE ALL ON FUNCTION public.confirm_verified_appointment_payment(uuid, text, text, numeric) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_verified_appointment_payment(uuid, text, text, numeric) TO service_role;

-- 6. create_manual_appointment() y update_manual_appointment(): alinear colisión de PENDING a 7 minutos
CREATE OR REPLACE FUNCTION public.create_manual_appointment(p_barber_id uuid, p_service_id uuid DEFAULT NULL::uuid, p_custom_service_name text DEFAULT NULL::text, p_service_price_ars integer DEFAULT NULL::integer, p_booking_date date DEFAULT NULL::date, p_start_time time without time zone DEFAULT NULL::time without time zone, p_end_time time without time zone DEFAULT NULL::time without time zone, p_client_name text DEFAULT NULL::text, p_client_phone text DEFAULT NULL::text, p_client_email text DEFAULT NULL::text, p_notes text DEFAULT NULL::text, p_is_recurring boolean DEFAULT false, p_duration_minutes integer DEFAULT NULL::integer, p_deposit_required boolean DEFAULT false, p_client_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(appointment_id uuid, appointment_status appointment_status, booking_date date, start_time time without time zone, end_time time without time zone, request_number bigint, is_manual boolean, origin text, created_by_display_name text, custom_service_name text, service_price_ars integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
DECLARE
  v_staff_barber_id uuid;
  v_is_admin boolean;
  v_creator_user_id uuid := auth.uid();
  v_creator_name text;
  v_barber public.barbers%ROWTYPE;
  v_service public.services%ROWTYPE;
  v_duration_min integer;
  v_end_time time;
  v_start_ts timestamp;
  v_end_ts timestamp;
  v_client_id uuid;
  v_clean_name text;
  v_clean_email text;
  v_clean_phone text;
  v_final_service_name text;
  v_final_price integer;
  v_conflict_start time;
  v_conflict_end time;

  v_res_apt_id uuid;
  v_res_status public.appointment_status;
  v_res_booking_date date;
  v_res_start_time time;
  v_res_end_time time;
  v_res_req_num bigint;
BEGIN
  IF v_creator_user_id IS NULL THEN
    RAISE EXCEPTION USING errcode = '42501', message = 'AUTH_REQUIRED';
  END IF;

  v_is_admin := public.is_operator();
  v_staff_barber_id := public.current_staff_barber_id();

  IF NOT v_is_admin AND (v_staff_barber_id IS NULL OR v_staff_barber_id IS DISTINCT FROM p_barber_id) THEN
    RAISE EXCEPTION USING errcode = '42501', message = 'MANUAL_APPOINTMENT_NOT_ALLOWED';
  END IF;

  IF v_is_admin THEN
    select display_name into v_creator_name from public.staff_profiles where user_id=auth.uid() and active;
  ELSE
    SELECT b.name INTO v_creator_name FROM public.barbers b WHERE b.id = v_staff_barber_id;
    v_creator_name := coalesce(v_creator_name, 'Barbero');
  END IF;

  IF p_barber_id IS NULL THEN RAISE EXCEPTION USING errcode = '22023', message = 'BARBER_REQUIRED'; END IF;
  IF p_booking_date IS NULL THEN RAISE EXCEPTION USING errcode = '22023', message = 'DATE_REQUIRED'; END IF;
  IF p_start_time IS NULL THEN RAISE EXCEPTION USING errcode = '22023', message = 'START_TIME_REQUIRED'; END IF;

  SELECT b.* INTO STRICT v_barber
  FROM public.barbers b
  WHERE b.id = p_barber_id AND b.active = true;

  IF p_service_id IS NOT NULL THEN
    SELECT s.* INTO STRICT v_service
    FROM public.services s
    WHERE s.id = p_service_id AND s.active = true;
    v_final_service_name := v_service.name;
    v_final_price := coalesce(p_service_price_ars, v_service.price_ars);
    v_duration_min := coalesce(p_duration_minutes, v_service.duration_minutes, 45);
  ELSE
    v_final_service_name := nullif(trim(coalesce(p_custom_service_name, '')), '');
    IF v_final_service_name IS NULL THEN
      RAISE EXCEPTION USING errcode = '22023', message = 'CUSTOM_SERVICE_NAME_REQUIRED';
    END IF;
    v_final_price := coalesce(p_service_price_ars, 0);
    v_duration_min := coalesce(p_duration_minutes, 45);
  END IF;

  IF v_duration_min <= 0 THEN
    v_duration_min := 45;
  END IF;

  IF p_end_time IS NOT NULL THEN
    v_end_time := p_end_time;
  ELSE
    v_start_ts := p_booking_date + p_start_time;
    v_end_ts := v_start_ts + (v_duration_min * interval '1 minute');
    v_end_time := v_end_ts::time;
  END IF;

  v_clean_name := trim(coalesce(p_client_name, ''));
  IF length(v_clean_name) < 2 THEN
    RAISE EXCEPTION USING errcode = '22023', message = 'CLIENT_NAME_INVALID';
  END IF;

  v_clean_phone := trim(coalesce(p_client_phone, ''));
  IF length(regexp_replace(v_clean_phone, '[^0-9]', '', 'g')) < 6 THEN
    RAISE EXCEPTION USING errcode = '22023', message = 'CLIENT_PHONE_INVALID';
  END IF;

  v_clean_email := nullif(lower(trim(coalesce(p_client_email, ''))), '');
  IF v_clean_email IS NOT NULL AND (position('@' in v_clean_email) <= 1 OR v_clean_email LIKE '%@kanibarber.internal') THEN
    v_clean_email := NULL;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_barber.id::text || '|' || p_booking_date::text, 0));

  SELECT existing.start_time, existing.end_time
  INTO v_conflict_start, v_conflict_end
  FROM public.appointments existing
  WHERE existing.barber_id = v_barber.id
    AND existing.booking_date = p_booking_date
    AND existing.status IN ('CONFIRMED', 'COMPLETED', 'PENDING')
    AND (
      existing.status <> 'PENDING'
      OR existing.created_at + interval '7 minutes' > clock_timestamp()
    )
    AND (
      (v_end_time > p_start_time AND existing.start_time < v_end_time AND existing.end_time > p_start_time)
      OR (v_end_time <= p_start_time AND (existing.start_time >= p_start_time OR existing.end_time <= v_end_time))
    )
  ORDER BY existing.start_time ASC
  LIMIT 1;

  IF v_conflict_start IS NOT NULL THEN
    RAISE EXCEPTION USING errcode = '23505',
      message = 'APPOINTMENT_COLLISION_DETAILS|' || v_conflict_start::text || '|' || v_conflict_end::text;
  END IF;

  SELECT c.id INTO v_client_id FROM public.save_client(p_client_id,v_clean_name,v_clean_phone,v_clean_email) c;

  INSERT INTO public.appointments AS a (
    client_id,
    barber_id,
    service_id,
    custom_service_name,
    service_price_ars,
    booking_date,
    start_time,
    end_time,
    status,
    notes,
    is_manual,
    origin,
    created_by_user_id,
    created_by_display_name,
    deposit_required,
    deposit_paid,
    booking_client_name
  ) VALUES (
    v_client_id,
    v_barber.id,
    p_service_id,
    CASE WHEN p_service_id IS NULL THEN v_final_service_name ELSE NULL END,
    v_final_price,
    p_booking_date,
    p_start_time,
    v_end_time,
    'CONFIRMED',
    nullif(trim(coalesce(p_notes, '')), ''),
    true,
    'MANUAL',
    v_creator_user_id,
    v_creator_name,
    false,
    false,
    v_clean_name
  )
  RETURNING a.id, a.status, a.booking_date, a.start_time, a.end_time, a.request_number
  INTO v_res_apt_id, v_res_status, v_res_booking_date, v_res_start_time, v_res_end_time, v_res_req_num;

  RETURN QUERY SELECT
    v_res_apt_id,
    v_res_status,
    v_res_booking_date,
    v_res_start_time,
    v_res_end_time,
    v_res_req_num,
    true,
    'MANUAL'::text,
    v_creator_name,
    v_final_service_name,
    v_final_price;
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_manual_appointment(p_appointment_id uuid, p_barber_id uuid, p_service_id uuid DEFAULT NULL::uuid, p_custom_service_name text DEFAULT NULL::text, p_service_price_ars integer DEFAULT NULL::integer, p_booking_date date DEFAULT NULL::date, p_start_time time without time zone DEFAULT NULL::time without time zone, p_end_time time without time zone DEFAULT NULL::time without time zone, p_client_name text DEFAULT NULL::text, p_client_phone text DEFAULT NULL::text, p_client_email text DEFAULT NULL::text, p_notes text DEFAULT NULL::text, p_duration_minutes integer DEFAULT NULL::integer)
 RETURNS TABLE(appointment_id uuid, appointment_status appointment_status, booking_date date, start_time time without time zone, end_time time without time zone, request_number bigint, is_manual boolean, origin text, created_by_display_name text, custom_service_name text, service_price_ars integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
DECLARE
  v_staff_barber_id uuid;
  v_is_admin boolean;
  v_appt public.appointments%ROWTYPE;
  v_barber public.barbers%ROWTYPE;
  v_service public.services%ROWTYPE;
  v_duration_min integer;
  v_end_time time;
  v_start_ts timestamp;
  v_end_ts timestamp;
  v_clean_name text;
  v_clean_phone text;
  v_clean_email text;
  v_final_service_name text;
  v_final_price integer;
  v_conflict_start time;
  v_conflict_end time;

  v_res_apt_id uuid;
  v_res_status public.appointment_status;
  v_res_booking_date date;
  v_res_start_time time;
  v_res_end_time time;
  v_res_req_num bigint;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION USING errcode = '42501', message = 'AUTH_REQUIRED';
  END IF;

  v_is_admin := public.is_operator();
  v_staff_barber_id := public.current_staff_barber_id();

  SELECT a.* INTO STRICT v_appt
  FROM public.appointments a
  WHERE a.id = p_appointment_id;

  IF NOT v_is_admin AND (v_staff_barber_id IS NULL OR v_staff_barber_id IS DISTINCT FROM v_appt.barber_id OR v_staff_barber_id IS DISTINCT FROM p_barber_id) THEN
    RAISE EXCEPTION USING errcode = '42501', message = 'MANUAL_APPOINTMENT_NOT_ALLOWED';
  END IF;

  IF p_barber_id IS NULL THEN RAISE EXCEPTION USING errcode = '22023', message = 'BARBER_REQUIRED'; END IF;
  IF p_booking_date IS NULL THEN RAISE EXCEPTION USING errcode = '22023', message = 'DATE_REQUIRED'; END IF;
  IF p_start_time IS NULL THEN RAISE EXCEPTION USING errcode = '22023', message = 'START_TIME_REQUIRED'; END IF;

  SELECT b.* INTO STRICT v_barber
  FROM public.barbers b
  WHERE b.id = p_barber_id AND b.active = true;

  IF p_service_id IS NOT NULL THEN
    SELECT s.* INTO STRICT v_service
    FROM public.services s
    WHERE s.id = p_service_id AND s.active = true;
    v_final_service_name := v_service.name;
    v_final_price := coalesce(p_service_price_ars, v_service.price_ars);
    v_duration_min := coalesce(p_duration_minutes, v_service.duration_minutes, 45);
  ELSE
    v_final_service_name := nullif(trim(coalesce(p_custom_service_name, v_appt.custom_service_name, '')), '');
    IF v_final_service_name IS NULL THEN
      RAISE EXCEPTION USING errcode = '22023', message = 'CUSTOM_SERVICE_NAME_REQUIRED';
    END IF;
    v_final_price := coalesce(p_service_price_ars, v_appt.service_price_ars, 0);
    v_duration_min := coalesce(p_duration_minutes, 45);
  END IF;

  IF v_duration_min <= 0 THEN
    v_duration_min := 45;
  END IF;

  IF p_end_time IS NOT NULL THEN
    v_end_time := p_end_time;
  ELSE
    v_start_ts := p_booking_date + p_start_time;
    v_end_ts := v_start_ts + (v_duration_min * interval '1 minute');
    v_end_time := v_end_ts::time;
  END IF;

  v_clean_name := trim(coalesce(p_client_name, ''));
  v_clean_phone := trim(coalesce(p_client_phone, ''));
  v_clean_email := nullif(lower(trim(coalesce(p_client_email, ''))), '');
  IF v_clean_email IS NOT NULL AND (position('@' in v_clean_email) <= 1 OR v_clean_email LIKE '%@kanibarber.internal') THEN
    v_clean_email := NULL;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_barber.id::text || '|' || p_booking_date::text, 0));

  SELECT existing.start_time, existing.end_time
  INTO v_conflict_start, v_conflict_end
  FROM public.appointments existing
  WHERE existing.barber_id = v_barber.id
    AND existing.booking_date = p_booking_date
    AND existing.id <> p_appointment_id
    AND existing.status IN ('CONFIRMED', 'COMPLETED', 'PENDING')
    AND (
      existing.status <> 'PENDING'
      OR existing.created_at + interval '7 minutes' > clock_timestamp()
    )
    AND (
      (v_end_time > p_start_time AND existing.start_time < v_end_time AND existing.end_time > p_start_time)
      OR (v_end_time <= p_start_time AND (existing.start_time >= p_start_time OR existing.end_time <= v_end_time))
    )
  ORDER BY existing.start_time ASC
  LIMIT 1;

  IF v_conflict_start IS NOT NULL THEN
    RAISE EXCEPTION USING errcode = '23505',
      message = 'APPOINTMENT_COLLISION_DETAILS|' || v_conflict_start::text || '|' || v_conflict_end::text;
  END IF;

  IF v_appt.client_id IS NOT NULL AND (length(v_clean_name) >= 2 OR length(regexp_replace(v_clean_phone, '[^0-9]', '', 'g')) >= 6) THEN
    UPDATE public.clients
    SET name = CASE WHEN length(v_clean_name) >= 2 THEN v_clean_name ELSE name END,
        phone = CASE WHEN length(regexp_replace(v_clean_phone, '[^0-9]', '', 'g')) >= 6 THEN v_clean_phone ELSE phone END,
        email = coalesce(v_clean_email, email),
        updated_at = now()
    WHERE id = v_appt.client_id;
  END IF;

  UPDATE public.appointments AS a
  SET barber_id = p_barber_id,
      service_id = p_service_id,
      custom_service_name = CASE WHEN p_service_id IS NULL THEN v_final_service_name ELSE NULL END,
      service_price_ars = v_final_price,
      booking_date = p_booking_date,
      start_time = p_start_time,
      end_time = v_end_time,
      notes = nullif(trim(coalesce(p_notes, '')), ''),
      booking_client_name = CASE WHEN length(v_clean_name) >= 2 THEN v_clean_name ELSE booking_client_name END,
      updated_at = now()
  WHERE a.id = p_appointment_id
  RETURNING a.id, a.status, a.booking_date, a.start_time, a.end_time, a.request_number
  INTO v_res_apt_id, v_res_status, v_res_booking_date, v_res_start_time, v_res_end_time, v_res_req_num;

  RETURN QUERY SELECT
    v_res_apt_id,
    v_res_status,
    v_res_booking_date,
    v_res_start_time,
    v_res_end_time,
    v_res_req_num,
    v_appt.is_manual,
    v_appt.origin,
    v_appt.created_by_display_name,
    v_final_service_name,
    v_final_price;
END;
$function$;

NOTIFY pgrst, 'reload schema';

COMMIT;
