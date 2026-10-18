-- Migration: 20261018000300_kani_delete_all_notifications_rpc.sql
-- KANI Barber Studio — Operaciones atómicas y seguras para eliminar y descartar todas las notificaciones
-- Resuelve el error "No se pudieron eliminar las notificaciones."
--
-- 1. public.delete_all_staff_activity_notifications_global():
--    Exclusivo para ADMIN.
--    Elimina todas las notificaciones de public.admin_activity_notifications de forma atómica.
--    La clave foránea en admin_activity_user_state (notification_id) tiene ON DELETE CASCADE,
--    por lo que se limpian automáticamente los estados asociados.
--    JAMÁS toca appointments, clients, pagos ni turnos manuales o recurrentes.
--
-- 2. public.dismiss_all_staff_activity_notifications_personal():
--    Para BARBERS (y staff individual).
--    Marca como dismissed_at = now() todas las notificaciones visibles para dicho usuario
--    en la tabla admin_activity_user_state sin afectar a otros barberos ni al ADMIN.

-- RPC 1: Borrado global de todas las notificaciones (ADMIN)
create or replace function public.delete_all_staff_activity_notifications_global()
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  v_uid uuid := (select auth.uid());
  v_is_admin boolean := public.is_admin();
  v_count integer := 0;
begin
  if v_uid is null or not v_is_admin then
    raise exception 'Acción reservada exclusivamente para el Administrador';
  end if;

  with deleted as (
    delete from public.admin_activity_notifications
    returning 1
  )
  select count(*) into v_count from deleted;

  return v_count;
end;
$$;

-- RPC 2: Descarte masivo de notificaciones de la vista personal (BARBER / Staff)
create or replace function public.dismiss_all_staff_activity_notifications_personal()
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  v_uid uuid := (select auth.uid());
  v_is_admin boolean := public.is_admin();
  v_barber_id uuid := public.current_staff_barber_id();
  v_now timestamptz := now();
  v_count integer := 0;
begin
  if v_uid is null or (not v_is_admin and v_barber_id is null) then
    raise exception 'No autorizado';
  end if;

  with inserted as (
    insert into public.admin_activity_user_state (notification_id, user_id, dismissed_at, updated_at)
    select n.id, v_uid, v_now, v_now
    from public.admin_activity_notifications n
    left join public.admin_activity_user_state us
      on us.notification_id = n.id and us.user_id = v_uid
    where (v_is_admin or n.barber_id = v_barber_id)
      and (us.dismissed_at is null)
    on conflict (notification_id, user_id)
    do update set
      dismissed_at = v_now,
      updated_at = v_now
    returning 1
  )
  select count(*) into v_count from inserted;

  return v_count;
end;
$$;

-- Asegurar permisos de ejecución a authenticated
grant execute on function public.delete_all_staff_activity_notifications_global to authenticated;
grant execute on function public.dismiss_all_staff_activity_notifications_personal to authenticated;

-- Asegurar que la política RLS de DELETE en admin_activity_notifications permita delete condicional
-- (como fallback en caso de ejecuciones directas de cliente autenticado con rol ADMIN)
grant delete on table public.admin_activity_notifications to authenticated;

drop policy if exists admin_can_delete_activity_notifications on public.admin_activity_notifications;
create policy admin_can_delete_activity_notifications
  on public.admin_activity_notifications
  for delete to authenticated
  using (public.is_admin());
