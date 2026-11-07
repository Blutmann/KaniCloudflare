-- Exact production routines, schema only; no customer rows or secrets.
CREATE OR REPLACE FUNCTION public.check_is_admin_user()
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
DECLARE
  v_role text;
  v_jwt_claim text;
BEGIN
  -- 1. Usuario autenticado con token de sesión
  IF auth.uid() IS NOT NULL THEN
    SELECT role INTO v_role
    FROM public.staff_profiles
    WHERE user_id = auth.uid() AND active = true;
    RETURN (v_role = 'ADMIN');
  END IF;

  -- 2. Llamadas internas desde servidor de Antigravity validadas
  BEGIN
    v_jwt_claim := current_setting('request.jwt.claim.role', true);
    IF v_jwt_claim = 'service_role' THEN
      RETURN true;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    -- In case setting is not present
  END;

  RETURN false;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.admin_create_benefit_code(p_type text, p_internal_note text DEFAULT NULL::text, p_code text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
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
$function$
;
CREATE OR REPLACE FUNCTION public.admin_disable_benefit_code(p_code_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
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
$function$
;
CREATE OR REPLACE FUNCTION public.admin_list_benefit_codes()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
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
$function$
;
revoke all on function public.check_is_admin_user(),public.admin_create_benefit_code(text,text,text),public.admin_disable_benefit_code(uuid),public.admin_list_benefit_codes() from public,anon;
grant execute on function public.check_is_admin_user(),public.admin_create_benefit_code(text,text,text),public.admin_disable_benefit_code(uuid),public.admin_list_benefit_codes() to authenticated,service_role;
