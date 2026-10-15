-- KANI Barber Studio — La disponibilidad pública no depende de la sesión.
-- La vista solo expone columnas públicas; el RLS privado de la tabla base
-- continúa protegiendo internal_note y la gestión administrativa.

create or replace view public.available_barber_slots
with (security_invoker = false)
as
select
  s.id,
  s.barber_id,
  s.slot_date,
  s.start_time,
  s.end_time,
  s.status
from public.barber_availability_slots s
join public.barbers b on b.id = s.barber_id
where s.status = 'AVAILABLE'::public.availability_status
  and b.active = true
  and not public.is_public_slot_booked(s.barber_id, s.slot_date, s.start_time, s.end_time);

grant select on public.available_barber_slots to anon, authenticated;
