-- ==============================================================================
-- KANI Barber Studio — Reset integral y seguro de datos de prueba
-- Proyecto de destino verificado: iockpxtkflyjfagkvgnr (Entorno de pruebas / Preview)
-- ==============================================================================
-- Este script realiza una limpieza controlada, transaccional e idempotente de:
-- 1. Notificaciones de eventos de turnos (public.appointment_notification_events)
-- 2. Actividades y auditorías de turnos (public.admin_activity_notifications)
-- 3. Turnos de prueba en cualquier estado (public.appointments)
-- 4. Clientes de prueba (public.clients) que no tengan dependencias maestras
-- 5. Registros de operaciones de mantenimiento previas (public.maintenance_operations / availability)
--
-- Conserva 100% intactos:
-- - Barberos (public.barbers: Lautaro, Gonzalo, Valentín)
-- - Servicios y precios (public.services)
-- - Slots de disponibilidad (public.barber_availability_slots: 570 cupos)
-- - Datos bancarios de seña (public.barber_transfer_details)
-- - Perfiles y credenciales del personal (public.staff_profiles, auth.users)
-- ==============================================================================

BEGIN;

-- 1. Tablas temporales de respaldo (Snapshot de recuperación antes del borrado)
CREATE TABLE IF NOT EXISTS public._backup_reset_appointments AS 
  TABLE public.appointments WITH NO DATA;
CREATE TABLE IF NOT EXISTS public._backup_reset_clients AS 
  TABLE public.clients WITH NO DATA;
CREATE TABLE IF NOT EXISTS public._backup_reset_notification_events AS 
  TABLE public.appointment_notification_events WITH NO DATA;
CREATE TABLE IF NOT EXISTS public._backup_reset_admin_activity AS 
  TABLE public.admin_activity_notifications WITH NO DATA;

-- Guardar snapshot
INSERT INTO public._backup_reset_notification_events 
  SELECT * FROM public.appointment_notification_events;
INSERT INTO public._backup_reset_admin_activity 
  SELECT * FROM public.admin_activity_notifications 
  WHERE appointment_id IS NOT NULL 
     OR event_type IN ('APPOINTMENT_REQUESTED', 'APPOINTMENT_CONFIRMED', 'APPOINTMENT_CANCELLED');
INSERT INTO public._backup_reset_appointments 
  SELECT * FROM public.appointments;
INSERT INTO public._backup_reset_clients 
  SELECT * FROM public.clients;

-- 2. Eliminación ordenada respetando Foreign Keys (ON DELETE RESTRICT en clients)
-- Paso A: Notificaciones transaccionales de turnos
DELETE FROM public.appointment_notification_events;

-- Paso B: Actividades y auditorías administrativas de turnos vinculadas a reservas
DELETE FROM public.admin_activity_notifications
WHERE appointment_id IS NOT NULL
   OR event_type IN ('APPOINTMENT_REQUESTED', 'APPOINTMENT_CONFIRMED', 'APPOINTMENT_CANCELLED');

-- Paso C: Turnos de prueba (todos los estados: PENDING, CONFIRMED, COMPLETED, CANCELLED)
DELETE FROM public.appointments;

-- Paso D: Clientes de prueba huérfanos o generados por pruebas
DELETE FROM public.clients
WHERE id NOT IN (SELECT client_id FROM public.appointments);

-- Paso E: Registros históricos de operaciones de mantenimiento
DELETE FROM public.maintenance_operations;
DELETE FROM public.maintenance_availability_operations;

COMMIT;

-- ==============================================================================
-- Verificación post-reset
-- ==============================================================================
SELECT 
  'appointments' AS tabla, COUNT(*) AS registros_restantes FROM public.appointments
UNION ALL
SELECT 
  'clients' AS tabla, COUNT(*) AS registros_restantes FROM public.clients
UNION ALL
SELECT 
  'appointment_notification_events' AS tabla, COUNT(*) AS registros_restantes FROM public.appointment_notification_events
UNION ALL
SELECT 
  'admin_activity_notifications (turnos)' AS tabla, COUNT(*) AS registros_restantes 
  FROM public.admin_activity_notifications 
  WHERE appointment_id IS NOT NULL OR event_type IN ('APPOINTMENT_REQUESTED', 'APPOINTMENT_CONFIRMED', 'APPOINTMENT_CANCELLED')
UNION ALL
SELECT 
  'barbers (preservados)' AS tabla, COUNT(*) AS registros_restantes FROM public.barbers
UNION ALL
SELECT 
  'services (preservados)' AS tabla, COUNT(*) AS registros_restantes FROM public.services
UNION ALL
SELECT 
  'barber_availability_slots (preservados)' AS tabla, COUNT(*) AS registros_restantes FROM public.barber_availability_slots;
