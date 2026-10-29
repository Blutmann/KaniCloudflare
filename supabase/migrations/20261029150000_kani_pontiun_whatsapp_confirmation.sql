-- Migration: 20261029150000_kani_pontiun_whatsapp_confirmation.sql
-- Kani Barber Studio — Integración definitiva de Pontiun (WhatsApp)
-- Garantiza idempotencia de confirmación (1 notificación lógica por turno y tipo),
-- índice único (appointment_id, notification_type), soporte de service_id nulo para servicios custom,
-- y privilegios de ejecución para service_role y authenticated.

-- 1. Asegurar restricción de unicidad estricta para evitar duplicaciones
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'appointment_notification_events_appointment_id_notification_type_key'
  ) and not exists (
    select 1 from pg_indexes
    where schemaname = 'public' and tablename = 'appointment_notification_events'
      and indexname = 'appointment_notification_events_appointment_type_unique'
  ) then
    create unique index appointment_notification_events_appointment_type_unique
      on public.appointment_notification_events (appointment_id, notification_type);
  end if;
end $$;

-- 2. Asegurar privilegios de ejecución sobre RPCs transaccionales
grant execute on function public.create_appointment_notification_event(uuid, public.notification_type) to service_role, authenticated;
grant execute on function public.claim_appointment_notification(uuid, text) to service_role, authenticated, anon;
grant execute on function public.complete_appointment_notification(uuid, text, text) to service_role, authenticated, anon;
grant execute on function public.fail_appointment_notification(uuid, text, text) to service_role, authenticated, anon;
grant execute on function public.record_appointment_notification_dispatch_error(uuid, text, text) to service_role, authenticated, anon;
