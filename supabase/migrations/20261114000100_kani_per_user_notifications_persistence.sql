-- Migration: 20261114000100_kani_per_user_notifications_persistence.sql
-- KANI Barber Studio — LIQUID GLASS V12.39
-- Persistencia estrictamente individual (por user_id autenticado) de lectura y eliminación de notificaciones.
--
-- Garantías de arquitectura y seguridad:
--   1. public.admin_activity_notifications es una fuente append-only compartida e inmutable desde clientes
--      (se revocan UPDATE y DELETE para authenticated; solo SELECT filtrado por alcance y descartes personales).
--   2. public.admin_activity_user_state almacena read_at y dismissed_at por (notification_id, user_id),
--      tanto para ADMIN y MANAGER (is_operator()) como para BARBER (current_staff_barber_id()).
--   3. Ninguna acción de lectura, no lectura o eliminación de un usuario afecta a otros usuarios.
--   4. Ningún RPC vuelve a escribir en public.admin_activity_notifications.read_at ni borra filas compartidas.
--   5. Backfill único e idempotente de lecturas legacy previas de ADMIN hacia admin_activity_user_state.

-- ==============================================================================
-- 1. Índice de soporte para consultas filtradas por barbero y orden cronológico
-- ==============================================================================
create index if not exists admin_activity_notifications_barber_created_idx
  on public.admin_activity_notifications (barber_id, created_at desc);

create index if not exists admin_activity_user_state_user_dismissed_idx
  on public.admin_activity_user_state (user_id, dismissed_at, notification_id);

-- ==============================================================================
-- 2. Backfill idempotente de lecturas previas exclusivamente para cuentas ADMIN activas
-- ==============================================================================
insert into public.admin_activity_user_state (notification_id, user_id, read_at, created_at, updated_at)
select
  n.id,
  sp.user_id,
  n.read_at,
  coalesce(n.read_at, n.created_at, now()),
  now()
from public.admin_activity_notifications n
join public.staff_profiles sp
  on sp.active = true
 and sp.role = 'ADMIN'
where n.read_at is not null
on conflict (notification_id, user_id) do nothing;

-- ==============================================================================
-- 3. Endurecimiento de privilegios y políticas RLS
-- ==============================================================================
revoke all on table public.admin_activity_notifications from anon, public;
revoke insert, update, delete on table public.admin_activity_notifications from authenticated;
grant select on table public.admin_activity_notifications to authenticated;
grant all on table public.admin_activity_notifications to service_role;

alter table public.admin_activity_notifications enable row level security;

drop policy if exists admin_can_delete_activity_notifications on public.admin_activity_notifications;
drop policy if exists admin_can_update_activity_notifications on public.admin_activity_notifications;
drop policy if exists admin_can_update_activity_read_state on public.admin_activity_notifications;
drop policy if exists admin_can_read_activity_notifications on public.admin_activity_notifications;
drop policy if exists staff_can_read_activity_notifications on public.admin_activity_notifications;

create policy staff_can_read_activity_notifications
  on public.admin_activity_notifications
  for select to authenticated
  using (
    (
      (select public.is_operator())
      or (
        barber_id is not null
        and barber_id = (select public.current_staff_barber_id())
      )
    )
    and not exists (
      select 1
      from public.admin_activity_user_state us
      where us.notification_id = admin_activity_notifications.id
        and us.user_id = (select auth.uid())
        and us.dismissed_at is not null
    )
  );

-- Estado individual por destinatario: un usuario solo accede y modifica sus propios registros
-- y únicamente para notificaciones dentro de su alcance de rol.
revoke all on table public.admin_activity_user_state from anon, public;
grant select, insert, update, delete on table public.admin_activity_user_state to authenticated;
grant all on table public.admin_activity_user_state to service_role;

alter table public.admin_activity_user_state enable row level security;

drop policy if exists user_can_manage_own_notification_state on public.admin_activity_user_state;
create policy user_can_manage_own_notification_state
  on public.admin_activity_user_state
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and (
      (select public.is_operator())
      or exists (
        select 1
        from public.admin_activity_notifications n
        where n.id = admin_activity_user_state.notification_id
          and n.barber_id is not null
          and n.barber_id = (select public.current_staff_barber_id())
      )
    )
  );

-- ==============================================================================
-- 4. RPCs por usuario autenticado (sin mutar la tabla compartida)
-- ==============================================================================

-- 4.1. Leer notificaciones visibles para auth.uid() con estado de lectura estrictamente propio
create or replace function public.read_staff_activity_notifications()
returns table (
  id uuid,
  event_type public.admin_activity_event_type,
  actor_user_id uuid,
  actor_display_name text,
  barber_id uuid,
  appointment_id uuid,
  availability_slot_id uuid,
  barber_name text,
  client_name text,
  event_date date,
  event_time time,
  created_at timestamptz,
  read_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  v_uid uuid := (select auth.uid());
  v_is_operator boolean := public.is_operator();
  v_barber_id uuid := public.current_staff_barber_id();
begin
  if v_uid is null or (not v_is_operator and v_barber_id is null) then
    return;
  end if;

  return query
  select
    n.id,
    n.event_type,
    n.actor_user_id,
    n.actor_display_name,
    n.barber_id,
    n.appointment_id,
    n.availability_slot_id,
    n.barber_name,
    n.client_name,
    n.event_date,
    n.event_time,
    n.created_at,
    us.read_at as read_at
  from public.admin_activity_notifications n
  left join public.admin_activity_user_state us
    on us.notification_id = n.id
   and us.user_id = v_uid
  where (v_is_operator or n.barber_id = v_barber_id)
    and us.dismissed_at is null
  order by n.created_at desc
  limit 50;
end;
$$;

-- 4.2. Marcar o desmarcar una notificación como leída exclusivamente para auth.uid()
create or replace function public.set_staff_activity_notification_read(
  p_notification_id uuid,
  p_read_at timestamptz default now()
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  v_uid uuid := (select auth.uid());
  v_is_operator boolean := public.is_operator();
  v_barber_id uuid := public.current_staff_barber_id();
  v_notif_barber uuid;
begin
  if v_uid is null or (not v_is_operator and v_barber_id is null) then
    raise exception 'No autorizado';
  end if;

  select n.barber_id
    into v_notif_barber
  from public.admin_activity_notifications n
  where n.id = p_notification_id;

  if not found then
    raise exception 'Notificación no encontrada';
  end if;

  if not v_is_operator and v_notif_barber is distinct from v_barber_id then
    raise exception 'Notificación fuera de alcance';
  end if;

  insert into public.admin_activity_user_state (notification_id, user_id, read_at, updated_at)
  values (p_notification_id, v_uid, p_read_at, now())
  on conflict (notification_id, user_id)
  do update set
    read_at = excluded.read_at,
    updated_at = now();
end;
$$;

-- 4.3. Marcar todas las notificaciones no descartadas del usuario como leídas
create or replace function public.mark_all_staff_activity_notifications_read()
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  v_uid uuid := (select auth.uid());
  v_is_operator boolean := public.is_operator();
  v_barber_id uuid := public.current_staff_barber_id();
  v_now timestamptz := now();
begin
  if v_uid is null or (not v_is_operator and v_barber_id is null) then
    raise exception 'No autorizado';
  end if;

  insert into public.admin_activity_user_state (notification_id, user_id, read_at, updated_at)
  select n.id, v_uid, v_now, v_now
  from public.admin_activity_notifications n
  left join public.admin_activity_user_state us
    on us.notification_id = n.id
   and us.user_id = v_uid
  where (v_is_operator or n.barber_id = v_barber_id)
    and us.dismissed_at is null
  on conflict (notification_id, user_id)
  do update set
    read_at = v_now,
    updated_at = v_now;
end;
$$;

-- 4.4. Marcar todas las notificaciones no descartadas del usuario como no leídas
create or replace function public.mark_all_staff_activity_notifications_unread()
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  v_uid uuid := (select auth.uid());
  v_is_operator boolean := public.is_operator();
  v_barber_id uuid := public.current_staff_barber_id();
begin
  if v_uid is null or (not v_is_operator and v_barber_id is null) then
    raise exception 'No autorizado';
  end if;

  update public.admin_activity_user_state
  set
    read_at = null,
    updated_at = now()
  where user_id = v_uid
    and dismissed_at is null
    and read_at is not null;
end;
$$;

-- 4.5. Eliminar (descartar) una notificación exclusivamente para auth.uid()
create or replace function public.dismiss_staff_activity_notification_personal(
  p_notification_id uuid
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  v_uid uuid := (select auth.uid());
  v_is_operator boolean := public.is_operator();
  v_barber_id uuid := public.current_staff_barber_id();
  v_notif_barber uuid;
  v_now timestamptz := now();
begin
  if v_uid is null or (not v_is_operator and v_barber_id is null) then
    raise exception 'No autorizado';
  end if;

  select n.barber_id
    into v_notif_barber
  from public.admin_activity_notifications n
  where n.id = p_notification_id;

  if not found then
    return;
  end if;

  if not v_is_operator and v_notif_barber is distinct from v_barber_id then
    raise exception 'Notificación fuera de alcance';
  end if;

  insert into public.admin_activity_user_state (notification_id, user_id, dismissed_at, updated_at)
  values (p_notification_id, v_uid, v_now, v_now)
  on conflict (notification_id, user_id)
  do update set
    dismissed_at = v_now,
    updated_at = v_now;
end;
$$;

-- 4.6. Eliminar (descartar) todas las notificaciones visibles exclusivamente para auth.uid()
create or replace function public.dismiss_all_staff_activity_notifications_personal()
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  v_uid uuid := (select auth.uid());
  v_is_operator boolean := public.is_operator();
  v_barber_id uuid := public.current_staff_barber_id();
  v_now timestamptz := now();
  v_count integer := 0;
begin
  if v_uid is null or (not v_is_operator and v_barber_id is null) then
    raise exception 'No autorizado';
  end if;

  with inserted as (
    insert into public.admin_activity_user_state (notification_id, user_id, dismissed_at, updated_at)
    select n.id, v_uid, v_now, v_now
    from public.admin_activity_notifications n
    left join public.admin_activity_user_state us
      on us.notification_id = n.id
     and us.user_id = v_uid
    where (v_is_operator or n.barber_id = v_barber_id)
      and us.dismissed_at is null
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

-- 4.7. Wrappers de compatibilidad: si un cliente legado invoca los RPCs *_global,
-- ejecutan únicamente descarte personal para auth.uid() sin borrar filas de otros usuarios.
create or replace function public.delete_staff_activity_notification_global(
  p_notification_id uuid
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
begin
  if not public.is_operator() then
    raise exception 'No autorizado';
  end if;

  perform public.dismiss_staff_activity_notification_personal(p_notification_id);
end;
$$;

create or replace function public.delete_all_staff_activity_notifications_global()
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
begin
  if not public.is_operator() then
    raise exception 'No autorizado';
  end if;

  return public.dismiss_all_staff_activity_notifications_personal();
end;
$$;

revoke all on function public.read_staff_activity_notifications() from public, anon;
revoke all on function public.set_staff_activity_notification_read(uuid, timestamptz) from public, anon;
revoke all on function public.mark_all_staff_activity_notifications_read() from public, anon;
revoke all on function public.mark_all_staff_activity_notifications_unread() from public, anon;
revoke all on function public.dismiss_staff_activity_notification_personal(uuid) from public, anon;
revoke all on function public.dismiss_all_staff_activity_notifications_personal() from public, anon;
revoke all on function public.delete_staff_activity_notification_global(uuid) from public, anon;
revoke all on function public.delete_all_staff_activity_notifications_global() from public, anon;

grant execute on function public.read_staff_activity_notifications() to authenticated;
grant execute on function public.set_staff_activity_notification_read(uuid, timestamptz) to authenticated;
grant execute on function public.mark_all_staff_activity_notifications_read() to authenticated;
grant execute on function public.mark_all_staff_activity_notifications_unread() to authenticated;
grant execute on function public.dismiss_staff_activity_notification_personal(uuid) to authenticated;
grant execute on function public.dismiss_all_staff_activity_notifications_personal() to authenticated;
grant execute on function public.delete_staff_activity_notification_global(uuid) to authenticated;
grant execute on function public.delete_all_staff_activity_notifications_global() to authenticated;

notify pgrst, 'reload schema';
