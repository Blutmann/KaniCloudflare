-- KANI Barber Studio — Integración Mercado Pago Orders API y confirmación atómica
-- Permite consultar el monto dinámico de la seña y confirmar turnos de forma atómica
-- respetando el bloqueo advisory lock y previniendo solapamientos por pago tardío.

-- 1. Función para obtener el monto dinámico de seña
create or replace function public.read_public_deposit_amount(p_barber_name text default null)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, extensions
as $$
declare
  v_deposit integer;
begin
  if p_barber_name is not null and length(trim(p_barber_name)) > 0 then
    select td.down_payment_ars into v_deposit
    from public.barbers b
    join public.barber_transfer_details td on td.barber_id = b.id and td.active = true
    where b.name = trim(p_barber_name)
    limit 1;
  end if;

  if v_deposit is null then
    select td.down_payment_ars into v_deposit
    from public.barber_transfer_details td
    where td.active = true
    order by td.updated_at desc
    limit 1;
  end if;

  return coalesce(v_deposit, 10000);
end;
$$;

revoke all on function public.read_public_deposit_amount(text) from public;
grant execute on function public.read_public_deposit_amount(text) to anon, authenticated;

-- 2. Función para obtener detalles de pago y seña de una reserva
create or replace function public.get_appointment_payment_details(p_appointment_id uuid)
returns table (
  appointment_id uuid,
  appointment_status public.appointment_status,
  booking_date date,
  start_time time,
  end_time time,
  barber_id uuid,
  barber_name text,
  service_id uuid,
  service_name text,
  service_price_ars integer,
  down_payment_ars integer,
  client_name text,
  client_email text,
  client_phone text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, extensions
as $$
begin
  return query
  select
    a.id as appointment_id,
    a.status as appointment_status,
    a.booking_date,
    a.start_time,
    a.end_time,
    b.id as barber_id,
    b.name as barber_name,
    s.id as service_id,
    s.name as service_name,
    s.price_ars as service_price_ars,
    coalesce(td.down_payment_ars, 10000) as down_payment_ars,
    c.name as client_name,
    c.email as client_email,
    c.phone as client_phone,
    a.created_at
  from public.appointments a
  join public.barbers b on b.id = a.barber_id
  join public.services s on s.id = a.service_id
  join public.clients c on c.id = a.client_id
  left join public.barber_transfer_details td on td.barber_id = a.barber_id and td.active = true
  where a.id = p_appointment_id;
end;
$$;

revoke all on function public.get_appointment_payment_details(uuid) from public;
grant execute on function public.get_appointment_payment_details(uuid) to anon, authenticated;

-- 3. Confirmación atómica desde webhook / pago aprobado
create or replace function public.confirm_appointment_from_payment(
  p_appointment_id uuid,
  p_order_id text default null,
  p_paid_amount integer default null
)
returns table (
  appointment_status public.appointment_status,
  result_code text,
  notification_claim_token text
)
language plpgsql
security definer
set search_path = pg_catalog, extensions
as $$
declare
  v_appt public.appointments%rowtype;
  v_token text;
begin
  select * into v_appt
  from public.appointments a
  where a.id = p_appointment_id
  for update;

  if not found then
    return query select null::public.appointment_status, 'APPOINTMENT_NOT_FOUND'::text, null::text;
    return;
  end if;

  -- Idempotencia: si ya estaba confirmada, retornar OK sin error ni duplicar
  if v_appt.status = 'CONFIRMED' then
    return query select 'CONFIRMED'::public.appointment_status, 'ALREADY_CONFIRMED'::text, null::text;
    return;
  end if;

  if v_appt.status = 'CANCELLED' then
    return query select 'CANCELLED'::public.appointment_status, 'APPOINTMENT_CANCELLED'::text, null::text;
    return;
  end if;

  if v_appt.status = 'COMPLETED' then
    return query select 'COMPLETED'::public.appointment_status, 'ALREADY_COMPLETED'::text, null::text;
    return;
  end if;

  -- Bloqueo atómico por barbero y fecha para prevenir colisiones de concurrencia
  perform pg_advisory_xact_lock(hashtextextended(v_appt.barber_id::text || '|' || v_appt.booking_date::text, 0));

  -- Verificar si el slot fue ocupado por otro turno ya confirmado o completado (caso de pago tardío)
  if exists (
    select 1
    from public.appointments other
    where other.barber_id = v_appt.barber_id
      and other.booking_date = v_appt.booking_date
      and other.id <> v_appt.id
      and other.status in ('CONFIRMED', 'COMPLETED')
      and other.start_time < v_appt.end_time
      and other.end_time > v_appt.start_time
  ) then
    return query select v_appt.status, 'SLOT_COLLISION_LATE_PAYMENT'::text, null::text;
    return;
  end if;

  -- Actualizar estado a CONFIRMED
  update public.appointments
  set status = 'CONFIRMED', updated_at = now()
  where id = p_appointment_id;

  -- Crear el evento de notificación CONFIRMED para despacho vía Resend y WhatsApp
  v_token := public.create_appointment_notification_event(p_appointment_id, 'CONFIRMED');

  return query select 'CONFIRMED'::public.appointment_status, 'CONFIRMED'::text, v_token;
end;
$$;

revoke all on function public.confirm_appointment_from_payment(uuid, text, integer) from public;
grant execute on function public.confirm_appointment_from_payment(uuid, text, integer) to anon, authenticated;
