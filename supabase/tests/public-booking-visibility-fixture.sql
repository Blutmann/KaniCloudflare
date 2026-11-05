-- Exact production routine definitions captured before the visibility change.
-- No production rows, emails, credentials or generated IDs.

CREATE OR REPLACE FUNCTION public.confirm_zero_deposit_appointment(p_barber_name text, p_service_name text, p_booking_date date, p_start_time time without time zone, p_client_name text, p_client_phone text, p_client_email text, p_benefit_code text, p_notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.prepare_payway_attempt(p_attempt_id uuid, p_site_id text, p_barber_name text, p_service_name text, p_booking_date date, p_start_time time without time zone, p_client_name text, p_client_phone text, p_client_email text, p_notes text DEFAULT NULL::text, p_existing_appointment_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_id uuid; v_appt public.appointments%rowtype; v_attempt public.payment_attempts%rowtype;
  v_barber text; v_price integer; v_deposit numeric;
begin
  if p_site_id is null or p_site_id !~ '^[0-9]{1,20}$' or p_attempt_id is null then raise exception 'PAYMENT_CONFIGURATION_INVALID'; end if;
  if p_existing_appointment_id is null then
    -- Existing booking RPC validates interval availability, clients and business rules.
    -- Appointment and ledger insert commit together or both roll back.
    select r.appointment_id into v_id from public.request_appointment(
      p_barber_name,p_service_name,p_booking_date,p_start_time,p_client_name,p_client_phone,p_client_email,p_notes
    ) r;
  else
    v_id := p_existing_appointment_id;
  end if;
  select * into strict v_appt from public.appointments where id=v_id;
  perform pg_advisory_xact_lock(hashtextextended(v_appt.barber_id::text || '|' || v_appt.booking_date::text,0));
  select * into strict v_appt from public.appointments where id=v_id for update;
  if not exists (
    select 1 from public.appointments a join public.barbers b on b.id=a.barber_id
    join public.services s on s.id=a.service_id join public.clients c on c.id=a.client_id
    where a.id=v_id and b.name=trim(p_barber_name) and s.name=trim(p_service_name)
      and a.booking_date=p_booking_date and a.start_time=p_start_time
      and c.name=trim(p_client_name) and lower(c.email)=lower(trim(p_client_email)) and c.phone=trim(p_client_phone)
      and coalesce(a.notes,'')=trim(coalesce(p_notes,''))
  ) then raise exception 'CHECKOUT_RESERVATION_CHANGED'; end if;
  if v_appt.status <> 'PENDING' or v_appt.deposit_paid or v_appt.created_at+interval '10 minutes' <= clock_timestamp() then
    raise exception 'APPOINTMENT_NOT_PAYABLE';
  end if;
  if exists(select 1 from public.appointment_payment_orders where appointment_id=v_id) then raise exception 'PAYMENT_PROVIDER_CONFLICT'; end if;
  select * into v_attempt from public.payment_attempts where appointment_id=v_id
    and state in ('CREATED','PROCESSING','APPROVED','UNKNOWN') for update;
  if found then
    if v_attempt.state <> 'CREATED' or v_attempt.expires_at <= clock_timestamp() then raise exception 'PAYMENT_REVIEW_REQUIRED'; end if;
    return to_jsonb(v_attempt);
  end if;
  select b.name,s.price_ars into v_barber,v_price from public.barbers b join public.services s on s.id=v_appt.service_id where b.id=v_appt.barber_id;
  v_deposit := public.read_public_deposit_amount(v_barber);
  if v_deposit is null or v_deposit <= 0 or v_deposit > v_price then raise exception 'DEPOSIT_CONFIGURATION_INVALID'; end if;
  insert into public.payment_attempts(id,appointment_id,provider,site_transaction_id,provider_site_id,amount_ars,amount_minor_units,expires_at)
    values(p_attempt_id,v_id,'PAYWAY','KANI'||replace(p_attempt_id::text,'-',''),p_site_id,v_deposit,(v_deposit*100)::bigint,v_appt.created_at+interval '10 minutes')
    returning * into v_attempt;
  return to_jsonb(v_attempt);
end; $function$;

CREATE OR REPLACE FUNCTION public.read_valid_availability_starts(p_barber_id uuid DEFAULT NULL::uuid, p_from_date date DEFAULT NULL::date, p_to_date date DEFAULT NULL::date)
 RETURNS TABLE(barber_id uuid, slot_date date, start_time time without time zone, is_exception boolean, compatible_services text[])
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
DECLARE
  v_from date := coalesce(p_from_date, (timezone('America/Argentina/Buenos_Aires', clock_timestamp()))::date);
  v_to date := coalesce(p_to_date, v_from + 21);
BEGIN
  IF v_from > v_to THEN
    RAISE EXCEPTION USING errcode = '22023', message = 'DATE_RANGE_INVALID';
  END IF;

  RETURN QUERY
  WITH recurring_base_slots AS (
    -- Horizonte dinámico continuo para Franco (Sábados 15:00 a 20:00)
    SELECT
      b.id AS barber_id,
      d::date AS slot_date,
      slot_def.start_time,
      slot_def.end_time,
      (d::date + slot_def.start_time)::timestamp AS slot_start_ts,
      ((d::date + CASE WHEN slot_def.end_time <= slot_def.start_time THEN 1 ELSE 0 END) + slot_def.end_time)::timestamp AS slot_end_ts
    FROM public.barbers b
    CROSS JOIN generate_series(v_from, v_to, interval '1 day') AS d
    CROSS JOIN (
      VALUES
        (time '15:00:00', time '15:45:00'),
        (time '15:45:00', time '16:30:00'),
        (time '16:30:00', time '17:15:00'),
        (time '17:15:00', time '18:00:00'),
        (time '18:00:00', time '18:45:00'),
        (time '18:45:00', time '19:30:00'),
        (time '19:30:00', time '20:00:00')
    ) AS slot_def(start_time, end_time)
    WHERE b.name = 'Franco'
      AND b.active = true
      AND extract(isodow from d) = 6
      AND (p_barber_id IS NULL OR b.id = p_barber_id)
      AND NOT EXISTS (
        SELECT 1
        FROM public.barber_availability_slots blk
        WHERE blk.barber_id = b.id
          AND blk.slot_date = d::date
          AND blk.status = 'UNAVAILABLE'
          AND tsrange(
            d::date + slot_def.start_time,
            (d::date + CASE WHEN slot_def.end_time <= slot_def.start_time THEN 1 ELSE 0 END) + slot_def.end_time,
            '[)'
          ) && tsrange(
            blk.slot_date + blk.start_time,
            (blk.slot_date + CASE WHEN blk.end_time <= blk.start_time THEN 1 ELSE 0 END) + blk.end_time,
            '[)'
          )
      )
  ), stored_available_slots AS (
    -- Slots explícitos almacenados en BD (incluye disponibilidades extraordinarias y manuales de barberos)
    SELECT
      s.barber_id,
      s.slot_date,
      s.start_time,
      s.end_time,
      (s.slot_date + s.start_time)::timestamp AS slot_start_ts,
      ((s.slot_date + CASE WHEN s.end_time <= s.start_time THEN 1 ELSE 0 END) + s.end_time)::timestamp AS slot_end_ts
    FROM public.barber_availability_slots s
    JOIN public.barbers b ON b.id = s.barber_id AND b.active = true
    WHERE s.status = 'AVAILABLE'
      AND s.slot_date BETWEEN v_from AND v_to
      AND (p_barber_id IS NULL OR s.barber_id = p_barber_id)
      AND (s.end_time > s.start_time OR s.end_time = time '00:00:00')
  ), available_slots AS (
    SELECT
      s.barber_id,
      s.slot_date,
      s.start_time,
      s.end_time,
      s.slot_start_ts,
      s.slot_end_ts
    FROM stored_available_slots s
    UNION
    SELECT
      r.barber_id,
      r.slot_date,
      r.start_time,
      r.end_time,
      r.slot_start_ts,
      r.slot_end_ts
    FROM recurring_base_slots r
  ), standard_candidates AS (
    SELECT DISTINCT
      s.barber_id,
      s.slot_date,
      gs.candidate_start,
      (extract(isodow from s.slot_date) = 7) AS is_exception
    FROM available_slots s
    CROSS JOIN LATERAL generate_series(
      s.slot_date + time '10:00',
      s.slot_date + time '19:00',
      interval '45 minutes'
    ) AS gs(candidate_start)
    WHERE gs.candidate_start >= s.slot_start_ts
      AND gs.candidate_start < s.slot_end_ts
  ), franco_saturday_candidates AS (
    SELECT DISTINCT
      s.barber_id,
      s.slot_date,
      (s.slot_date + franco_time.t)::timestamp AS candidate_start,
      false AS is_exception
    FROM available_slots s
    JOIN public.barbers b ON b.id = s.barber_id AND b.name = 'Franco'
    CROSS JOIN (
      VALUES
        (time '15:00:00'),
        (time '15:45:00'),
        (time '16:30:00'),
        (time '17:15:00'),
        (time '18:00:00'),
        (time '18:45:00'),
        (time '19:00:00'),
        (time '19:15:00'),
        (time '19:30:00')
    ) AS franco_time(t)
    WHERE extract(isodow from s.slot_date) = 6
      AND (s.slot_date + franco_time.t)::timestamp >= s.slot_start_ts
      AND (s.slot_date + franco_time.t)::timestamp < s.slot_end_ts
  ), extended_candidates AS (
    SELECT DISTINCT
      s.barber_id,
      s.slot_date,
      gs.candidate_start,
      true AS is_exception
    FROM available_slots s
    CROSS JOIN LATERAL generate_series(
      s.slot_start_ts,
      s.slot_end_ts - interval '5 minutes',
      interval '45 minutes'
    ) AS gs(candidate_start)
    WHERE gs.candidate_start::date = s.slot_date
  ), closing_candidates AS (
    SELECT DISTINCT
      s.barber_id,
      s.slot_date,
      (s.slot_date + offset_time.t)::timestamp AS candidate_start,
      false AS is_exception
    FROM available_slots s
    CROSS JOIN (
      VALUES (time '19:00:00'), (time '19:15:00'), (time '19:30:00')
    ) AS offset_time(t)
    WHERE (s.slot_date + offset_time.t)::timestamp >= s.slot_start_ts
      AND (s.slot_date + offset_time.t)::timestamp < s.slot_end_ts
  ), all_candidates AS (
    SELECT
      u.barber_id,
      u.slot_date,
      u.candidate_start,
      bool_and(u.is_exception) AS is_exception
    FROM (
      SELECT sc.barber_id, sc.slot_date, sc.candidate_start, sc.is_exception FROM standard_candidates sc
      UNION ALL
      SELECT fc.barber_id, fc.slot_date, fc.candidate_start, fc.is_exception FROM franco_saturday_candidates fc
      UNION ALL
      SELECT ec.barber_id, ec.slot_date, ec.candidate_start, ec.is_exception FROM extended_candidates ec
      UNION ALL
      SELECT cc.barber_id, cc.slot_date, cc.candidate_start, cc.is_exception FROM closing_candidates cc
    ) u
    GROUP BY u.barber_id, u.slot_date, u.candidate_start
  )
  SELECT
    c.barber_id,
    c.slot_date,
    c.candidate_start::time AS start_time,
    c.is_exception,
    compatibility.compatible_services
  FROM all_candidates c
  CROSS JOIN LATERAL (
    SELECT coalesce(array_agg(svc.name ORDER BY svc.name), '{}'::text[]) AS compatible_services
    FROM public.services svc
    WHERE svc.active
      AND svc.duration_minutes > 0
      AND NOT EXISTS (
        SELECT 1
        FROM generate_series(
          0,
          ceil(svc.duration_minutes::numeric / 5)::integer - 1
        ) AS requested(segment_index)
        WHERE NOT EXISTS (
          SELECT 1
          FROM available_slots available
          WHERE available.barber_id = c.barber_id
            AND available.slot_date = c.slot_date
            AND tsrange(
              c.candidate_start + requested.segment_index * interval '5 minutes',
              c.candidate_start + (requested.segment_index + 1) * interval '5 minutes', '[)'
            ) <@ tsrange(
              available.slot_date + available.start_time,
              (available.slot_date + CASE WHEN available.end_time <= available.start_time THEN 1 ELSE 0 END) + available.end_time, '[)'
            )
            AND NOT EXISTS (
              SELECT 1
              FROM public.barber_availability_slots blocked
              WHERE blocked.barber_id = c.barber_id
                AND blocked.slot_date = c.slot_date
                AND blocked.status = 'UNAVAILABLE'
                AND tsrange(
                  c.candidate_start + requested.segment_index * interval '5 minutes',
                  c.candidate_start + (requested.segment_index + 1) * interval '5 minutes', '[)'
                ) && tsrange(
                  blocked.slot_date + blocked.start_time,
                  (blocked.slot_date + CASE WHEN blocked.end_time <= blocked.start_time THEN 1 ELSE 0 END) + blocked.end_time, '[)'
                )
            )
            AND NOT EXISTS (
              SELECT 1
              FROM public.appointments a
              WHERE a.barber_id = c.barber_id
                AND a.booking_date = c.slot_date
                AND a.status <> 'CANCELLED'
                AND tsrange(
                  c.candidate_start + requested.segment_index * interval '5 minutes',
                  c.candidate_start + (requested.segment_index + 1) * interval '5 minutes', '[)'
                ) && tsrange(
                  a.booking_date + a.start_time,
                  (a.booking_date + CASE WHEN a.end_time <= a.start_time THEN 1 ELSE 0 END) + a.end_time, '[)'
                )
            )
        )
      )
  ) compatibility
  WHERE cardinality(compatibility.compatible_services) > 0
  ORDER BY c.barber_id, c.slot_date, c.candidate_start;
END;
$function$;

CREATE OR REPLACE FUNCTION public.confirm_payway_attempt(p_appointment_id uuid, p_attempt_id uuid, p_provider_id text, p_amount_minor bigint)
 RETURNS TABLE(appointment_status appointment_status, result_code text, notification_claim_token text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not exists(select 1 from public.payment_attempts where id=p_attempt_id and appointment_id=p_appointment_id and provider='PAYWAY'
    and state='APPROVED' and provider_transaction_id=p_provider_id and amount_minor_units=p_amount_minor) then
    return query select null::public.appointment_status,'PAYMENT_MISMATCH'::text,null::text; return;
  end if;
  return query select * from public.confirm_verified_appointment_payment(p_appointment_id,'PAYWAY',p_attempt_id::text,p_amount_minor::numeric/100);
end; $function$;

CREATE OR REPLACE FUNCTION public.confirm_verified_appointment_payment(p_appointment_id uuid, p_provider text, p_reference text, p_paid_amount numeric)
 RETURNS TABLE(appointment_status appointment_status, result_code text, notification_claim_token text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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

  IF v_appt.status = 'CANCELLED' AND coalesce(v_appt.cancellation_reason, '') <> 'PAYMENT_EXPIRED' THEN
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
    RETURN QUERY SELECT v_appt.status, CASE WHEN v_resolution = 'PAID_CANCELLED_REVIEW' THEN 'APPOINTMENT_CANCELLED' ELSE 'SLOT_COLLISION_LATE_PAYMENT' end, null::text;
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
$function$;

CREATE OR REPLACE FUNCTION public.read_public_deposit_amount(p_barber_name text DEFAULT NULL::text)
 RETURNS integer
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
BEGIN
  -- Seña pública unificada y centralizada de Kani Barber Studio: $5.000 para todos los barberos y servicios
  RETURN 5000;
END;
$function$;

revoke all on function public.read_valid_availability_starts(uuid,date,date) from public;
grant execute on function public.read_valid_availability_starts(uuid,date,date) to anon,authenticated,service_role;
revoke all on function public.prepare_payway_attempt(uuid,text,text,text,date,time,text,text,text,text,uuid), public.confirm_zero_deposit_appointment(text,text,date,time,text,text,text,text,text), public.confirm_payway_attempt(uuid,uuid,text,bigint), public.confirm_verified_appointment_payment(uuid,text,text,numeric) from public,anon,authenticated;
grant execute on function public.prepare_payway_attempt(uuid,text,text,text,date,time,text,text,text,text,uuid), public.confirm_zero_deposit_appointment(text,text,date,time,text,text,text,text,text), public.confirm_payway_attempt(uuid,uuid,text,bigint), public.confirm_verified_appointment_payment(uuid,text,text,numeric) to service_role;
