-- KANI Barber Studio — Reset integral de datos de prueba
-- Función RPC y operación transaccional para limpiar reservas, clientes de prueba,
-- notificaciones y auditorías, preservando intactos barberos, servicios y disponibilidad.

create or replace function public.admin_reset_test_data()
returns table (
  appointments_deleted integer,
  clients_deleted integer,
  notifications_deleted integer,
  activity_deleted integer,
  status text
)
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  v_appointments_deleted integer := 0;
  v_clients_deleted integer := 0;
  v_notifications_deleted integer := 0;
  v_activity_deleted integer := 0;
begin
  -- 1. Respaldo preventivo antes de eliminar
  create table if not exists public._backup_reset_appointments as table public.appointments with no data;
  create table if not exists public._backup_reset_clients as table public.clients with no data;
  create table if not exists public._backup_reset_notification_events as table public.appointment_notification_events with no data;
  create table if not exists public._backup_reset_admin_activity as table public.admin_activity_notifications with no data;

  insert into public._backup_reset_notification_events select * from public.appointment_notification_events;
  insert into public._backup_reset_admin_activity 
    select * from public.admin_activity_notifications 
    where appointment_id is not null 
       or event_type in ('APPOINTMENT_REQUESTED', 'APPOINTMENT_CONFIRMED', 'APPOINTMENT_CANCELLED');
  insert into public._backup_reset_appointments select * from public.appointments;
  insert into public._backup_reset_clients select * from public.clients;

  -- 2. Eliminar notificaciones transaccionales de turnos
  delete from public.appointment_notification_events;
  get diagnostics v_notifications_deleted = row_count;

  -- 3. Eliminar auditorías de turnos
  delete from public.admin_activity_notifications
  where appointment_id is not null
     or event_type in ('APPOINTMENT_REQUESTED', 'APPOINTMENT_CONFIRMED', 'APPOINTMENT_CANCELLED');
  get diagnostics v_activity_deleted = row_count;

  -- 4. Eliminar turnos de prueba
  delete from public.appointments;
  get diagnostics v_appointments_deleted = row_count;

  -- 5. Eliminar clientes de prueba huérfanos
  delete from public.clients
  where id not in (select client_id from public.appointments);
  get diagnostics v_clients_deleted = row_count;

  -- 6. Limpiar historiales de mantenimiento
  delete from public.maintenance_operations;
  delete from public.maintenance_availability_operations;

  return query select
    v_appointments_deleted,
    v_clients_deleted,
    v_notifications_deleted,
    v_activity_deleted,
    'SUCCEEDED'::text;
end;
$$;

revoke all on function public.admin_reset_test_data() from public, anon;
grant execute on function public.admin_reset_test_data() to authenticated;
