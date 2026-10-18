-- Migration: 20261018000400_kani_notification_repairs.sql
-- KANI Barber Studio — Reparación integral del sistema de notificaciones
-- 1. Soporte para marcar todas las notificaciones como no leídas (mark_all_staff_activity_notifications_unread)
-- 2. Asegura permisos de DELETE, UPDATE, INSERT en admin_activity_notifications y admin_activity_user_state
-- 3. Asegura funciones RPC de eliminación global y descarte personal seguras e idempotentes

-- 1. Tabla de estado por usuario para notificaciones (si no existiera)
create table if not exists public.admin_activity_user_state (
  notification_id uuid not null references public.admin_activity_notifications(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  read_at timestamptz,
  dismissed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (notification_id, user_id)
);

create index if not exists admin_activity_user_state_user_idx
  on public.admin_activity_user_state (user_id, dismissed_at);

alter table public.admin_activity_user_state enable row level security;
grant select, insert, update, delete on table public.admin_activity_user_state to authenticated;

drop policy if exists user_can_manage_own_notification_state on public.admin_activity_user_state;
create policy user_can_manage_own_notification_state
  on public.admin_activity_user_state
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- 2. Permisos y políticas de eliminación en admin_activity_notifications
grant select, update, delete on table public.admin_activity_notifications to authenticated;

drop policy if exists admin_can_delete_activity_notifications on public.admin_activity_notifications;
create policy admin_can_delete_activity_notifications
  on public.admin_activity_notifications
  for delete to authenticated
  using (public.is_admin());

-- 3. RPC: Marcar todas como no leídas (bulk unread)
create or replace function public.mark_all_staff_activity_notifications_unread()
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  v_uid uuid := (select auth.uid());
  v_is_admin boolean := public.is_admin();
  v_barber_id uuid := public.current_staff_barber_id();
begin
  if v_uid is null or (not v_is_admin and v_barber_id is null) then
    raise exception 'No autorizado';
  end if;

  if v_is_admin then
    update public.admin_activity_notifications
    set read_at = null
    where read_at is not null;
  end if;

  update public.admin_activity_user_state
  set read_at = null,
      updated_at = now()
  where user_id = v_uid
    and read_at is not null;
end;
$$;

grant execute on function public.mark_all_staff_activity_notifications_unread to authenticated;

-- 4. RPC: Asegurar borrado global de todas las notificaciones (ADMIN)
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

grant execute on function public.delete_all_staff_activity_notifications_global to authenticated;

-- 5. RPC: Asegurar descarte de todas las notificaciones personales (BARBER / Staff)
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

grant execute on function public.dismiss_all_staff_activity_notifications_personal to authenticated;
