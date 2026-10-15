-- Kani Barber Studio — datos provisionales para pruebas.
-- Reemplazar alias y CUIT antes de habilitar el sistema para clientes reales.

insert into public.barber_transfer_details (barber_id, alias, cuit, holder_name, down_payment_ars, active)
select b.id, v.alias, v.cuit, v.holder_name, 10000, true
from public.barbers b
join (values
  ('Lautaro', 'LautiKani.SUPV', '20-43456902-0', 'Lautaro Gabriel de Jesus'),
  ('Gonzalo', 'GonzaloPierucci.Kani', '20-40567912-0', 'Gonzalo Matias Pierucci'),
  ('Valentín', 'ValentinCarrizo.MP', '20-45442987-0', 'Valentin Carrizo')
) as v(barber_name, alias, cuit, holder_name) on v.barber_name = b.name
on conflict (barber_id) do update
set alias = excluded.alias,
    cuit = excluded.cuit,
    holder_name = excluded.holder_name,
    down_payment_ars = excluded.down_payment_ars,
    active = excluded.active,
    updated_at = now();

comment on table public.barber_transfer_details is
  'Datos provisionales de pruebas. Reemplazar alias y CUIT antes del uso con clientes reales.';
