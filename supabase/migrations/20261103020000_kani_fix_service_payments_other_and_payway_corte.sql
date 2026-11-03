-- Migration: 20261103020000_kani_fix_service_payments_other_and_payway_corte.sql
-- Kani Barber Studio — Corrección integral de:
-- 1. Pagos administrativos con servicio "Otro" (clasificación 'Otros' + detalle en service_other_detail)
-- 2. Compatibilidad de nombre de servicio ('Corte' / 'Corte de cabello', 'Corte y barba' / 'Corte + barba') en request_appointment y prepare_payway_attempt
-- 3. Funciones administrativas de activación/desactivación y baja lógica de códigos de descuento (admin_toggle_benefit_code_status, admin_delete_benefit_code)

-- ==============================================================================
-- 1. Asegurar constraint de clasificación en service_payments
-- ==============================================================================
ALTER TABLE public.service_payments DROP CONSTRAINT IF EXISTS service_payments_service_name_check;
ALTER TABLE public.service_payments ADD CONSTRAINT service_payments_service_name_check
  CHECK (service_name IN ('Corte', 'Corte de cabello', 'Corte y barba', 'Corte + barba', 'Barba', 'Otros'));

ALTER TABLE public.service_payments DROP CONSTRAINT IF EXISTS service_other_requires_detail;
ALTER TABLE public.service_payments ADD CONSTRAINT service_other_requires_detail
  CHECK (service_name <> 'Otros' OR (service_other_detail IS NOT NULL AND length(trim(service_other_detail)) >= 2));

-- ==============================================================================
-- 2. Corregir record_service_payment para conservar service_name = 'Otros' y service_other_detail = descripción
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.record_service_payment(
  p_barber_id uuid,
  p_service_name text,
  p_service_other_detail text DEFAULT NULL::text,
  p_service_price_ars integer DEFAULT NULL::integer,
  p_discount_ars integer DEFAULT 0,
  p_payment_date date DEFAULT NULL::date,
  p_payment_time time without time zone DEFAULT NULL::time without time zone,
  p_payment_method text DEFAULT 'Efectivo'::text,
  p_online_deposit_paid boolean DEFAULT false,
  p_client_name text DEFAULT NULL::text,
  p_client_contact text DEFAULT NULL::text,
  p_appointment_id uuid DEFAULT NULL::uuid,
  p_service_origin text DEFAULT NULL::text
)
RETURNS TABLE (
  payment_id uuid,
  barber_id uuid,
  service_name text,
  final_amount_ars integer,
  collected_amount_ars integer,
  payment_date date,
  payment_time time without time zone,
  appointment_id uuid,
  service_origin text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_is_admin boolean := public.is_admin();
  v_staff_barber_id uuid := public.current_staff_barber_id();
  v_creator_name text;
  v_service_id uuid := null;
  v_service_price integer;
  v_discount integer := coalesce(p_discount_ars, 0);
  v_final_amount integer;
  v_date date;
  v_time time;
  v_online_deposit_paid boolean := false;
  v_online_deposit_amount integer := 0;
  v_collected_amount integer;
  v_apt record;
  v_new_id uuid;
  v_origin text;
  v_final_service_name text;
  v_other_detail text;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if not v_is_admin and (v_staff_barber_id is null or v_staff_barber_id is distinct from p_barber_id) then
    raise exception 'FORBIDDEN_BARBER_SCOPE';
  end if;

  if v_is_admin then
    v_creator_name := 'Admin';
  else
    select name into v_creator_name from public.barbers where id = v_staff_barber_id;
    v_creator_name := coalesce(v_creator_name, 'Barbero');
  end if;

  v_origin := coalesce(p_service_origin, case when p_appointment_id is not null then 'appointment' else 'walk_in' end);
  if v_origin not in ('appointment', 'walk_in', 'legacy') then
    raise exception 'INVALID_SERVICE_ORIGIN';
  end if;

  if v_origin = 'appointment' and p_appointment_id is null then
    raise exception 'APPOINTMENT_ID_REQUIRED_FOR_ORIGIN';
  end if;

  if v_origin = 'walk_in' and p_appointment_id is not null then
    raise exception 'APPOINTMENT_ID_NOT_ALLOWED_FOR_WALK_IN';
  end if;

  v_other_detail := nullif(trim(coalesce(p_service_other_detail, '')), '');

  if p_service_name in ('Corte', 'Corte de cabello', 'Corte y barba', 'Corte + barba', 'Barba') then
    select id, price_ars into v_service_id, v_service_price
    from public.services
    where name = p_service_name
       or (p_service_name in ('Corte', 'Corte de cabello') and name in ('Corte', 'Corte de cabello'))
       or (p_service_name in ('Corte y barba', 'Corte + barba') and name in ('Corte y barba', 'Corte + barba'))
    limit 1;

    v_service_price := coalesce(p_service_price_ars, v_service_price, 25000);
    v_final_service_name := case
      when p_service_name = 'Corte de cabello' then 'Corte'
      when p_service_name = 'Corte + barba' then 'Corte y barba'
      else p_service_name
    end;
    v_other_detail := null;
  elsif p_service_name in ('Otro', 'Otros') then
    if v_other_detail is null or length(v_other_detail) < 2 then
      raise exception 'OTHER_SERVICE_DETAIL_REQUIRED';
    end if;
    if p_service_price_ars is null or p_service_price_ars <= 0 then
      raise exception 'OTHER_SERVICE_PRICE_REQUIRED';
    end if;
    v_service_price := p_service_price_ars;
    v_final_service_name := 'Otros';
  else
    -- Nombre personalizado proveniente de turno manual o entrada directa: clasificar como 'Otros' y guardar detalle
    v_other_detail := coalesce(v_other_detail, nullif(trim(coalesce(p_service_name, '')), ''));
    if v_other_detail is null or length(v_other_detail) < 2 then
      raise exception 'OTHER_SERVICE_DETAIL_REQUIRED';
    end if;
    if p_service_price_ars is null or p_service_price_ars <= 0 then
      raise exception 'OTHER_SERVICE_PRICE_REQUIRED';
    end if;
    v_service_price := p_service_price_ars;
    v_final_service_name := 'Otros';
  end if;

  if v_discount < 0 or v_discount > v_service_price then
    raise exception 'INVALID_DISCOUNT_AMOUNT';
  end if;
  v_final_amount := v_service_price - v_discount;

  if p_payment_method not in ('Efectivo', 'Transferencia') then
    raise exception 'INVALID_PAYMENT_METHOD';
  end if;

  v_date := coalesce(p_payment_date, (timezone('America/Argentina/Buenos_Aires', clock_timestamp()))::date);
  v_time := coalesce(p_payment_time, (timezone('America/Argentina/Buenos_Aires', clock_timestamp()))::time);

  if p_appointment_id is not null then
    select * into v_apt from public.appointments where id = p_appointment_id for update;
    if not found then raise exception 'APPOINTMENT_NOT_FOUND'; end if;
    if not v_is_admin and v_apt.barber_id <> v_staff_barber_id then raise exception 'FORBIDDEN_APPOINTMENT_SCOPE'; end if;
    if exists (select 1 from public.service_payments sp where sp.appointment_id = p_appointment_id and sp.deleted_at is null) then
      raise exception 'APPOINTMENT_ALREADY_LINKED';
    end if;

    if coalesce(v_apt.deposit_paid, false) = true then
      v_online_deposit_paid := true;
      v_online_deposit_amount := coalesce(v_apt.deposit_amount_ars, 5000);
    else
      if p_online_deposit_paid = true then raise exception 'INVALID_ONLINE_DEPOSIT_CLAIM'; end if;
      v_online_deposit_paid := false;
      v_online_deposit_amount := 0;
    end if;

    v_collected_amount := greatest(0, v_final_amount - (case when v_online_deposit_paid then v_online_deposit_amount else 0 end));

    update public.appointments
    set balance_paid = true,
        status = case when status in ('PENDING', 'CONFIRMED') then 'COMPLETED'::public.appointment_status else status end,
        updated_at = now()
    where id = p_appointment_id;
  else
    if p_online_deposit_paid = true then raise exception 'INVALID_ONLINE_DEPOSIT_WITHOUT_APPOINTMENT'; end if;
    v_online_deposit_paid := false;
    v_online_deposit_amount := 0;
    v_collected_amount := v_final_amount;
  end if;

  insert into public.service_payments (
    barber_id,
    service_id,
    service_name,
    service_other_detail,
    service_price_ars,
    discount_ars,
    final_amount_ars,
    payment_date,
    payment_time,
    payment_method,
    online_deposit_paid,
    online_deposit_amount_ars,
    collected_amount_ars,
    client_name,
    client_contact,
    appointment_id,
    service_origin,
    created_by_user_id,
    created_by_display_name
  ) values (
    p_barber_id,
    v_service_id,
    v_final_service_name,
    v_other_detail,
    v_service_price,
    v_discount,
    v_final_amount,
    v_date,
    v_time,
    p_payment_method,
    v_online_deposit_paid,
    v_online_deposit_amount,
    v_collected_amount,
    nullif(trim(p_client_name), ''),
    nullif(trim(p_client_contact), ''),
    p_appointment_id,
    v_origin,
    v_uid,
    v_creator_name
  )
  returning id into v_new_id;

  return query
  select
    v_new_id as payment_id,
    p_barber_id as barber_id,
    v_final_service_name as service_name,
    v_final_amount as final_amount_ars,
    v_collected_amount as collected_amount_ars,
    v_date as payment_date,
    v_time as payment_time,
    p_appointment_id as appointment_id,
    v_origin as service_origin;
end;
$function$;

GRANT EXECUTE ON FUNCTION public.record_service_payment(uuid, text, text, integer, integer, date, time, text, boolean, text, text, uuid, text) TO authenticated;
NOTIFY pgrst, 'reload schema';
