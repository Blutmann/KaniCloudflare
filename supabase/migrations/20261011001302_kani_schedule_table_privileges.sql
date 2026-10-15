-- Kani Barber Studio — privilegios explícitos de disponibilidad (Preview)
revoke all on table public.barber_availability_slots from anon, authenticated;
grant select on table public.barber_availability_slots to anon, authenticated;
