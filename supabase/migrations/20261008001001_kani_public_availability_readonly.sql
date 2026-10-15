-- KANI Barber Studio — La vista pública de disponibilidad es estrictamente de lectura.
revoke all on table public.available_barber_slots from anon, authenticated;
grant select on table public.available_barber_slots to anon, authenticated;
