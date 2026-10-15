-- KANI Barber Studio — Endurecimiento de privilegios de RPCs.
-- request_appointment es pública; las funciones de autorización y administración no.

revoke all on function public.is_admin() from public, anon, authenticated;
revoke all on function public.current_staff_barber_id() from public, anon, authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.current_staff_barber_id() to authenticated;

revoke all on function public.request_appointment(text, text, date, time, text, text, text, text) from public, anon, authenticated;
grant execute on function public.request_appointment(text, text, date, time, text, text, text, text) to anon, authenticated;

revoke all on function public.update_appointment_status(uuid, public.appointment_status) from public, anon, authenticated;
grant execute on function public.update_appointment_status(uuid, public.appointment_status) to authenticated;
