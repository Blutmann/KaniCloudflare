-- La disponibilidad pública debe excluir intervalos ocupados sin exponer appointments ni internal_note.
-- La vista mantiene security_invoker=true; el helper solo expone un booleano de ocupación.
create or replace function public.is_public_slot_booked(
  p_barber_id uuid, p_slot_date date, p_start_time time, p_end_time time
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.appointments a
    where a.barber_id = p_barber_id
      and a.booking_date = p_slot_date
      and a.status <> 'CANCELLED'
      and a.start_time < p_end_time
      and a.end_time > p_start_time
  );
$$;
revoke all on function public.is_public_slot_booked(uuid, date, time, time) from public;
grant execute on function public.is_public_slot_booked(uuid, date, time, time) to anon, authenticated;

create or replace view public.available_barber_slots
with (security_invoker = true)
as
select s.id, s.barber_id, s.slot_date, s.start_time, s.end_time, s.status
from public.barber_availability_slots s
join public.barbers b on b.id = s.barber_id
where s.status = 'AVAILABLE'
  and b.active = true
  and not public.is_public_slot_booked(s.barber_id, s.slot_date, s.start_time, s.end_time);

grant select on public.available_barber_slots to anon, authenticated;
