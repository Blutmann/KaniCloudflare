-- Migration: 20261025000200_kani_sync_deposit_and_notification_amount.sql
-- Sincroniza la seña unificada a ARS 5.000 en configuraciones y eventos de notificación.

update public.barber_transfer_details
set down_payment_ars = 5000
where down_payment_ars is distinct from 5000;

-- Asegurar la existencia de la columna recipient_phone para WhatsApp y compatibilidad de eventos
alter table public.appointment_notification_events
  add column if not exists recipient_phone text;

create or replace function public.create_appointment_notification_event(
  p_appointment_id uuid,
  p_notification_type public.notification_type
)
returns text
language plpgsql
security definer
set search_path = pg_catalog, extensions
as $$
declare
  v_token text := gen_random_uuid()::text;
  v_recipient_email text;
  v_recipient_phone text;
  v_client_name text;
  v_barber_name text;
  v_service_name text;
  v_booking_date date;
  v_start_time time;
  v_end_time time;
  v_client_notes text;
  v_service_price_ars integer;
  v_service_duration_minutes integer;
  v_down_payment_ars integer;
  v_transfer_alias text;
  v_transfer_cuit text;
  v_transfer_holder_name text;
begin
  select c.email, c.phone, c.name, b.name, s.name, a.booking_date, a.start_time, a.end_time,
         a.notes, s.price_ars, s.duration_minutes,
         coalesce(nullif(td.down_payment_ars, 10000), 5000),
         td.alias, td.cuit, td.holder_name
    into v_recipient_email, v_recipient_phone, v_client_name, v_barber_name, v_service_name,
         v_booking_date, v_start_time, v_end_time, v_client_notes,
         v_service_price_ars, v_service_duration_minutes, v_down_payment_ars,
         v_transfer_alias, v_transfer_cuit, v_transfer_holder_name
  from public.appointments a
  join public.clients c on c.id = a.client_id
  join public.barbers b on b.id = a.barber_id
  join public.services s on s.id = a.service_id
  left join public.barber_transfer_details td on td.barber_id = a.barber_id
    and td.active = true
  where a.id = p_appointment_id;

  if not found then
    raise exception using errcode = 'P0001', message = 'APPOINTMENT_NOT_FOUND';
  end if;

  insert into public.appointment_notification_events (
    appointment_id, notification_type, recipient_email, recipient_phone, client_name, barber_name,
    service_name, booking_date, start_time, end_time, client_notes,
    service_price_ars, service_duration_minutes, down_payment_ars,
    transfer_alias, transfer_cuit, transfer_holder_name, claim_token_digest
  ) values (
    p_appointment_id, p_notification_type, v_recipient_email, v_recipient_phone, v_client_name,
    v_barber_name, v_service_name, v_booking_date, v_start_time, v_end_time,
    v_client_notes, v_service_price_ars, v_service_duration_minutes,
    coalesce(v_down_payment_ars, 5000), v_transfer_alias, v_transfer_cuit, v_transfer_holder_name,
    encode(digest(v_token, 'sha256'), 'hex')
  ) on conflict (appointment_id, notification_type) do nothing;

  if found then
    return v_token;
  end if;
  return null;
end;
$$;

revoke all on function public.create_appointment_notification_event(uuid, public.notification_type) from public, anon, authenticated;
grant execute on function public.create_appointment_notification_event(uuid, public.notification_type) to service_role;

