-- Migration: 20261021000100_kani_service_payments_rls_update_delete.sql
-- Kani Barber Studio — Políticas RLS de Edición y Eliminación en service_payments

-- 1. Otorgar permisos de DELETE al rol authenticated (controlado por RLS)
grant delete on table public.service_payments to authenticated;

-- 2. Política de eliminación: Exclusiva para administradores
drop policy if exists service_payments_delete on public.service_payments;
create policy service_payments_delete
  on public.service_payments
  for delete to authenticated
  using (
    public.is_admin()
  );

-- 3. Política de actualización:
-- - Administrador: puede editar cobros de cualquier barbero y asignar barbero.
-- - Barbero: puede editar únicamente sus propios cobros y NO puede modificar el barber_id (with check).
drop policy if exists service_payments_update on public.service_payments;
create policy service_payments_update
  on public.service_payments
  for update to authenticated
  using (
    public.is_admin()
    or barber_id = public.current_staff_barber_id()
  )
  with check (
    public.is_admin()
    or barber_id = public.current_staff_barber_id()
  );

-- 4. Notificar a PostgREST para recargar el schema cache
notify pgrst, 'reload schema';
