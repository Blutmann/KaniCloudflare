-- Migration: 20261025000300_kani_auto_confirm_deposit.sql
-- Asegura que confirm_appointment_from_payment actualice de forma atómica:
-- status = 'CONFIRMED', deposit_paid = true, deposit_amount_ars = 5000
-- Preserva idempotencia y guardas de conflicto/tardío (PAID_LATE_REVIEW, PAID_CANCELLED_REVIEW).

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
