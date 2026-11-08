-- Production notification definitions, schema only; no business data.
CREATE OR REPLACE FUNCTION public.get_appointment_payment_details(p_appointment_id uuid)
 RETURNS TABLE(appointment_id uuid, appointment_status appointment_status, booking_date date, start_time time without time zone, end_time time without time zone, barber_id uuid, barber_name text, service_id uuid, service_name text, service_price_ars integer, down_payment_ars integer, client_name text, client_email text, client_phone text, created_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
DECLARE
  v_is_privileged boolean;
BEGIN
  -- Autorización estricta:
  -- Privilegiado si es service_role (backend de Mercado Pago / Payway), administrador o staff autorizado
  v_is_privileged := (
    coalesce((SELECT auth.role()), '') = 'service_role'
    OR current_user = 'service_role'
    OR public.is_operator()
    OR public.current_staff_barber_id() IS NOT NULL
  );

  RETURN QUERY
  SELECT
    a.id AS appointment_id,
    a.status AS appointment_status,
    a.booking_date,
    a.start_time,
    a.end_time,
    b.id AS barber_id,
    b.name AS barber_name,
    s.id AS service_id,
    s.name AS service_name,
    coalesce(a.service_price_ars, bsp.price_ars, s.price_ars) AS service_price_ars,
    coalesce(a.deposit_amount_ars, 5000) AS down_payment_ars,
    coalesce(a.booking_client_name, c.name) AS client_name,
    -- Protección de datos personales (PII): anon no recibe email ni teléfono sin enmascarar
    CASE
      WHEN v_is_privileged THEN coalesce(c.email, '')
      ELSE regexp_replace(coalesce(c.email, ''), '^(.)(.*)(@.*)$', '\1***\3')
    END AS client_email,
    CASE
      WHEN v_is_privileged THEN coalesce(c.phone, '')
      ELSE regexp_replace(coalesce(c.phone, ''), '(\d{2})\d+(\d{2})$', '\1****\2')
    END AS client_phone,
    a.created_at
  FROM public.appointments a
  JOIN public.barbers b ON b.id = a.barber_id
  JOIN public.services s ON s.id = a.service_id
  LEFT JOIN public.clients c ON c.id = a.client_id
  LEFT JOIN public.barber_service_prices bsp ON bsp.barber_id = a.barber_id AND bsp.service_id = a.service_id AND bsp.active = true
  WHERE a.id = p_appointment_id
    -- Si el visitante es anónimo (no privilegiado), solo puede consultar reservas recientes (ventana de pago / confirmación de 48 hs)
    -- en estado PENDING o CONFIRMED, impidiendo el scraping de turnos históricos
    AND (
      v_is_privileged
      OR (a.created_at >= (now() - interval '48 hours') AND a.status IN ('PENDING', 'CONFIRMED'))
    );
END;
$function$
;
CREATE OR REPLACE FUNCTION public.log_admin_activity_appointment()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
declare
  v_actor_user_id uuid := (select auth.uid());
  v_actor_display_name text;
  v_client_name text;
  v_barber_name text;
begin
  select c.name, b.name
    into v_client_name, v_barber_name
  from public.clients c
  join public.barbers b on b.id = new.barber_id
  where c.id = new.client_id;

  if tg_op = 'INSERT' then
    insert into public.admin_activity_notifications (
      event_type,
      actor_user_id,
      actor_display_name,
      barber_id,
      appointment_id,
      barber_name,
      client_name,
      event_date,
      event_time
    )
    values (
      'APPOINTMENT_REQUESTED'::public.admin_activity_event_type,
      null,
      coalesce(v_client_name, 'Cliente'),
      new.barber_id,
      new.id,
      coalesce(v_barber_name, 'Barbero'),
      v_client_name,
      new.booking_date,
      new.start_time
    );
  elsif new.status is distinct from old.status and new.status in ('CONFIRMED', 'CANCELLED') then
    select sp.display_name
      into v_actor_display_name
    from public.staff_profiles sp
    where sp.user_id = v_actor_user_id
      and sp.active = true;

    insert into public.admin_activity_notifications (
      event_type,
      actor_user_id,
      actor_display_name,
      barber_id,
      appointment_id,
      barber_name,
      client_name,
      event_date,
      event_time
    )
    values (
      case
        when new.status = 'CONFIRMED' then 'APPOINTMENT_CONFIRMED'::public.admin_activity_event_type
        else 'APPOINTMENT_CANCELLED'::public.admin_activity_event_type
      end,
      v_actor_user_id,
      coalesce(v_actor_display_name, 'Personal KANI'),
      new.barber_id,
      new.id,
      coalesce(v_barber_name, 'Barbero'),
      v_client_name,
      new.booking_date,
      new.start_time
    );
  end if;

  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.log_admin_activity_availability()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
declare
  v_actor_user_id uuid := coalesce(new.updated_by, (select auth.uid()));
  v_actor_display_name text;
  v_barber_name text;
begin
  if new.status is distinct from old.status then
    select sp.display_name
      into v_actor_display_name
    from public.staff_profiles sp
    where sp.user_id = v_actor_user_id
      and sp.active = true;

    select b.name
      into v_barber_name
    from public.barbers b
    where b.id = new.barber_id;

    insert into public.admin_activity_notifications (
      event_type,
      actor_user_id,
      actor_display_name,
      barber_id,
      availability_slot_id,
      barber_name,
      event_date,
      event_time
    )
    values (
      case
        when new.status = 'UNAVAILABLE' then 'AVAILABILITY_UNAVAILABLE'::public.admin_activity_event_type
        else 'AVAILABILITY_AVAILABLE'::public.admin_activity_event_type
      end,
      v_actor_user_id,
      coalesce(v_actor_display_name, 'Personal KANI'),
      new.barber_id,
      new.id,
      coalesce(v_barber_name, 'Barbero'),
      new.slot_date,
      new.start_time
    );
  end if;

  return new;
end;
$function$
;
CREATE TRIGGER appointments_admin_activity_insert_trigger AFTER INSERT ON public.appointments FOR EACH ROW EXECUTE FUNCTION log_admin_activity_appointment();
CREATE TRIGGER appointments_admin_activity_status_trigger AFTER UPDATE OF status ON public.appointments FOR EACH ROW EXECUTE FUNCTION log_admin_activity_appointment();
CREATE TRIGGER barber_availability_admin_activity_trigger AFTER UPDATE OF status ON public.barber_availability_slots FOR EACH ROW EXECUTE FUNCTION log_admin_activity_availability();
