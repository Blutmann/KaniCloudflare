-- KANI Barber Studio — Fase 4.1: endurecimiento explícito de privilegios
-- update_appointment_status valida auth.uid(), pero anon tampoco debe tener EXECUTE.
revoke execute on function public.update_appointment_status(uuid, public.appointment_status) from public, anon;
grant execute on function public.update_appointment_status(uuid, public.appointment_status) to authenticated;
