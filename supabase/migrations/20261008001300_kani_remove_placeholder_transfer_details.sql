-- Kani Barber Studio — retirar valores bancarios provisionales no confirmados.
-- No se conservan aliases, CUIT ni titulares inventados en producción.

delete from public.barber_transfer_details
where (alias, cuit, holder_name) in (
  ('lautaro.barber', '20-12345678-9', 'Lautaro Barber Studio'),
  ('gonzalo.barber', '20-23456789-0', 'Gonzalo Barber Studio'),
  ('valentin.barber', '20-34567890-1', 'Valentín Barber Studio')
);
