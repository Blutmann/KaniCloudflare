-- KANI Barber Studio — Fase 4.2: search_path seguro para funciones SECURITY DEFINER
-- pgcrypto instala digest en extensions; las tablas y helpers se referencian con public.*.
alter function public.create_appointment_notification_event(uuid, public.notification_type)
  set search_path to pg_catalog, extensions;
alter function public.request_appointment(text, text, date, time, text, text, text, text)
  set search_path to pg_catalog, extensions;
alter function public.update_appointment_status(uuid, public.appointment_status)
  set search_path to pg_catalog, extensions;
alter function public.claim_appointment_notification(uuid, text)
  set search_path to pg_catalog, extensions;
alter function public.complete_appointment_notification(uuid, text, text)
  set search_path to pg_catalog, extensions;
alter function public.fail_appointment_notification(uuid, text, text)
  set search_path to pg_catalog, extensions;
