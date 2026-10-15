-- Kani Barber Studio — actualización de duraciones oficiales.
-- No modifica appointments existentes: sus end_time queda snapshotado al crear la cita.
update public.services
set duration_minutes = case name
  when 'Corte' then 45
  when 'Corte + barba' then 60
  when 'Barba' then 30
  else duration_minutes
end,
updated_at = now()
where name in ('Corte', 'Corte + barba', 'Barba');
