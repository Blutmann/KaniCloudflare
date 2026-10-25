-- Migration: 20261025000300_kani_auto_confirm_deposit.sql
-- 1. Asegura columnas de seña en appointments y permisos de lectura para staff
alter table public.appointments
  add column if not exists deposit_paid boolean not null default false,
  add column if not exists deposit_amount_ars integer;

-- Sincronizar turnos existentes con seña acreditada en appointment_payment_orders (p. ej. Turno #57)
update public.appointments a
set deposit_paid = true,
    deposit_amount_ars = coalesce(o.paid_amount_ars, 5000),
    updated_at = now()
from public.appointment_payment_orders o
where o.appointment_id = a.id
  and o.reconciliation_status = 'CONFIRMED'
  and a.deposit_paid is not true;

-- Permitir a authenticated leer órdenes de pago para el panel administrativo
grant select on public.appointment_payment_orders to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'appointment_payment_orders'
      and policyname = 'authenticated_staff_read_payment_orders'
  ) then
    create policy "authenticated_staff_read_payment_orders"
      on public.appointment_payment_orders
      for select
      to authenticated
      using (true);
  end if;
end;
$$;

-- 2. Asegura que confirm_appointment_from_payment actualice de forma atómica:
--    status = 'CONFIRMED', deposit_paid = true, deposit_amount_ars = 5000
--    Preserva idempotencia y guardas de conflicto/tardío (PAID_LATE_REVIEW, PAID_CANCELLED_REVIEW).
-- 3. Elimina la creación de eventos 'NEW_REQUEST' en request_appointment:
--    En el nuevo flujo de Mercado Pago, la solicitud PENDING no envía email de seña al cliente.
--    El único email automático es el de CONFIRMED al acreditar el pago.

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
  v_order public.appointment_payment_orders%rowtype;
  v_token text;
begin
  select * into v_appt from public.appointments where id = p_appointment_id;
  if not found then
    return query select null::public.appointment_status, 'APPOINTMENT_NOT_FOUND'::text, null::text;
    return;
  end if;

  -- Bloqueo transaccional por barbero y fecha (idéntico al flujo de reservas)
  perform pg_advisory_xact_lock(hashtextextended(v_appt.barber_id::text || '|' || v_appt.booking_date::text, 0));

  select * into v_appt from public.appointments where id = p_appointment_id for update;
  select * into v_order from public.appointment_payment_orders where appointment_id = p_appointment_id for update;

  if not found or p_order_id is null or v_order.order_id is distinct from p_order_id
     or p_paid_amount is distinct from v_order.expected_amount_ars then
    return query select v_appt.status, 'PAYMENT_MISMATCH'::text, null::text;
    return;
  end if;

  update public.appointment_payment_orders
  set paid_amount_ars = p_paid_amount, updated_at = now()
  where appointment_id = p_appointment_id;

  -- Idempotencia: si ya estaba confirmada, sincronizar flags de seña sin re-notificar
  if v_appt.status in ('CONFIRMED', 'COMPLETED') then
    update public.appointments
    set deposit_paid = true,
        deposit_amount_ars = coalesce(p_paid_amount, 5000),
        updated_at = now()
    where id = p_appointment_id and deposit_paid is not true;

    return query select v_appt.status, 'ALREADY_CONFIRMED'::text, null::text;
    return;
  end if;

  -- Guarda: Turno cancelado antes del pago
  if v_appt.status = 'CANCELLED' then
    update public.appointment_payment_orders
    set reconciliation_status = 'PAID_CANCELLED_REVIEW', updated_at = now()
    where appointment_id = p_appointment_id;

    return query select v_appt.status, 'APPOINTMENT_CANCELLED'::text, null::text;
    return;
  end if;

  -- Guarda: Conflicto de horario / pago tardío
  if exists (
    select 1 from public.appointments other
    where other.barber_id = v_appt.barber_id
      and other.booking_date = v_appt.booking_date
      and other.id <> v_appt.id
      and other.status in ('CONFIRMED', 'COMPLETED')
      and other.start_time < v_appt.end_time
      and other.end_time > v_appt.start_time
  ) or v_appt.booking_date + v_appt.start_time <= timezone('America/Argentina/Buenos_Aires', now()) then
    update public.appointment_payment_orders
    set reconciliation_status = 'PAID_LATE_REVIEW', updated_at = now()
    where appointment_id = p_appointment_id;

    return query select v_appt.status, 'SLOT_COLLISION_LATE_PAYMENT'::text, null::text;
    return;
  end if;

  -- Transición automática definitiva: PENDING -> CONFIRMED con seña registrada
  update public.appointments
  set status = 'CONFIRMED',
      deposit_paid = true,
      deposit_amount_ars = coalesce(p_paid_amount, 5000),
      updated_at = now()
  where id = p_appointment_id;

  update public.appointment_payment_orders
  set reconciliation_status = 'CONFIRMED', updated_at = now()
  where appointment_id = p_appointment_id;

  -- Creación del evento único de notificación con claim token
  v_token := public.create_appointment_notification_event(p_appointment_id, 'CONFIRMED');

  return query select 'CONFIRMED'::public.appointment_status, 'CONFIRMED'::text, v_token;
end;
$$;

revoke all on function public.confirm_appointment_from_payment(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.confirm_appointment_from_payment(uuid, text, integer) to service_role;

-- 2. request_appointment: Elimina la generación del evento NEW_REQUEST
create or replace function public.request_appointment(
  p_barber_name text,
  p_service_name text,
  p_booking_date date,
  p_start_time time,
  p_client_name text,
  p_client_phone text,
  p_client_email text,
  p_notes text default null
)
returns table (
  appointment_id uuid,
  appointment_status public.appointment_status,
  booking_date date,
  start_time time,
  end_time time,
  request_number bigint,
  notification_claim_token text
)
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  v_barber public.barbers%rowtype;
  v_service public.services%rowtype;
  v_client_id uuid;
  v_duration interval;
  v_start_at timestamp;
  v_end_at timestamp;
  v_last_segment integer;
begin
  if p_barber_name is null or length(trim(p_barber_name)) = 0 then
    raise exception using errcode = '22023', message = 'BARBER_REQUIRED';
  end if;
  if p_service_name is null or length(trim(p_service_name)) = 0 then
    raise exception using errcode = '22023', message = 'SERVICE_REQUIRED';
  end if;
  if p_client_name is null or length(trim(p_client_name)) < 3 then
    raise exception using errcode = '22023', message = 'CLIENT_NAME_INVALID';
  end if;
  if p_client_phone is null or length(trim(p_client_phone)) < 8 then
    raise exception using errcode = '22023', message = 'CLIENT_PHONE_INVALID';
  end if;
  if p_client_email is null or position('@' in trim(p_client_email)) <= 1 then
    raise exception using errcode = '22023', message = 'CLIENT_EMAIL_INVALID';
  end if;
  if p_booking_date < (timezone('America/Argentina/Buenos_Aires', clock_timestamp()))::date
     or p_booking_date > (timezone('America/Argentina/Buenos_Aires', clock_timestamp()))::date + 21 then
    raise exception using errcode = '22023', message = 'BOOKING_DATE_OUT_OF_RANGE';
  end if;
  if extract(isodow from p_booking_date) = 7 then
    raise exception using errcode = '22023', message = 'SUNDAY_CLOSED';
  end if;
  if p_start_time < time '10:00'
     or p_start_time > time '19:00'
     or extract(second from p_start_time) <> 0
     or mod(extract(epoch from (p_start_time - time '10:00'))::integer, 2700) <> 0 then
    raise exception using errcode = '22023', message = 'START_TIME_NOT_ALLOWED';
  end if;

  select b.* into strict v_barber
  from public.barbers b
  where b.name = trim(p_barber_name)
    and b.active = true;

  select s.* into strict v_service
  from public.services s
  where s.name = trim(p_service_name)
    and s.active = true;

  v_duration := v_service.duration_minutes * interval '1 minute';
  v_start_at := (p_booking_date + p_start_time)::timestamp;
  v_end_at := v_start_at + v_duration;

  if v_end_at > (p_booking_date + time '20:00')::timestamp then
    raise exception using errcode = '22023', message = 'SERVICE_OUTSIDE_BUSINESS_HOURS';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_barber.id::text || '|' || p_booking_date::text, 0));

  v_last_segment := ceil(extract(epoch from v_duration) / 300)::integer - 1;

  if exists (
    select 1
    from generate_series(0, v_last_segment) as requested(segment_index)
    where not exists (
      select 1
      from public.barber_availability_slots slot
      where slot.barber_id = v_barber.id
        and slot.slot_date = p_booking_date
        and slot.status = 'AVAILABLE'
        and slot.start_time <= (v_start_at + requested.segment_index * interval '5 minutes')::time
        and slot.end_time >= (v_start_at + (requested.segment_index + 1) * interval '5 minutes')::time
        and not exists (
          select 1
          from public.barber_availability_slots blocked
          where blocked.barber_id = v_barber.id
            and blocked.slot_date = p_booking_date
            and blocked.status = 'UNAVAILABLE'
            and tsrange(
              v_start_at + requested.segment_index * interval '5 minutes',
              v_start_at + (requested.segment_index + 1) * interval '5 minutes',
              '[)'
            ) && tsrange(
              (blocked.slot_date + blocked.start_time)::timestamp,
              (blocked.slot_date + blocked.end_time)::timestamp,
              '[)'
            )
        )
    )
  ) then
    raise exception using errcode = 'P0001', message = 'SLOT_UNAVAILABLE';
  end if;

  if exists (
    select 1
    from public.appointments a
    where a.barber_id = v_barber.id
      and a.booking_date = p_booking_date
      and a.status <> 'CANCELLED'
      and (a.booking_date + a.start_time)::timestamp < v_end_at
      and (a.booking_date + a.end_time)::timestamp > v_start_at
  ) then
    raise exception using errcode = '23P01', message = 'SLOT_ALREADY_BOOKED';
  end if;

  select c.id into v_client_id
  from public.clients c
  where lower(trim(c.email)) = lower(trim(p_client_email))
    and regexp_replace(c.phone, '[^0-9+]', '', 'g') = regexp_replace(trim(p_client_phone), '[^0-9+]', '', 'g')
  order by c.created_at asc
  limit 1;

  if v_client_id is null then
    insert into public.clients (name, phone, email)
    values (trim(p_client_name), trim(p_client_phone), lower(trim(p_client_email)))
    returning id into v_client_id;
  else
    update public.clients
    set name = trim(p_client_name),
        phone = trim(p_client_phone),
        email = lower(trim(p_client_email)),
        updated_at = now()
    where id = v_client_id;
  end if;

  insert into public.appointments as inserted (
    client_id,
    barber_id,
    service_id,
    booking_date,
    start_time,
    end_time,
    status,
    notes
  ) values (
    v_client_id,
    v_barber.id,
    v_service.id,
    p_booking_date,
    p_start_time,
    v_end_at::time,
    'PENDING',
    nullif(trim(coalesce(p_notes, '')), '')
  )
  returning inserted.id,
            inserted.status,
            inserted.booking_date,
            inserted.start_time,
            inserted.end_time,
            inserted.request_number
  into appointment_id,
       appointment_status,
       booking_date,
       start_time,
       end_time,
       request_number;

  -- Flujo definitivo Mercado Pago: No se genera evento NEW_REQUEST ni se envía email previo de seña.
  -- El único email automático es el de CONFIRMED al acreditar el pago de $5.000 ARS.
  notification_claim_token := null;
  return next;
exception
  when no_data_found then
    raise exception using errcode = 'P0001', message = 'BARBER_OR_SERVICE_NOT_FOUND';
end;
$$;

revoke execute on function public.request_appointment(text, text, date, time, text, text, text, text) from public;
grant execute on function public.request_appointment(text, text, date, time, text, text, text, text) to anon, authenticated;
