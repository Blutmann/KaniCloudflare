-- KANI Barber Studio — Corrección de aislamiento RLS del panel
-- La migración inicial permitía leer barberos activos a anon y authenticated.
-- Eso no exponía agendas, pero sí permitía a un BARBER enumerar otros barberos.
-- El acceso público debe aplicar únicamente al rol anon.

 drop policy if exists public_can_read_active_barbers on public.barbers;

 create policy public_can_read_active_barbers
   on public.barbers for select to anon
   using (active = true);

-- authenticated queda cubierto exclusivamente por staff_can_read_barbers:
-- ADMIN ve barberos activos; BARBER ve únicamente su barber_id.
