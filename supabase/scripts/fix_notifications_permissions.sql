-- ==============================================================================
-- KANI Barber Studio — Reparación Integral de Permisos y Eliminación de Notificaciones
-- Destino: Proyecto Supabase Preview (iockpxtkflyjfagkvgnr)
--
-- Ejecutar este script completo en el SQL Editor del Dashboard de Supabase.
-- Resuelve definitivamente:
--   1. "permission denied for table admin_activity_notifications" (Error PostgreSQL 42501)
--   2. "Could not find the function public.delete_all_staff_activity_notifications_global in the schema cache" (PGRST202)
--   3. "Could not find the table 'public.admin_activity_user_state' in the schema cache" (PGRST205)
-- ==============================================================================

-- 1. Tabla de descartes personales y estado por usuario (BARBER)
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
revoke all on table public.admin_activity_user_state from anon, public;
grant select, insert, update, delete on table public.admin_activity_user_state to authenticated;

drop policy if exists user_can_manage_own_notification_state on public.admin_activity_user_state;
create policy user_can_manage_own_notification_state
  on public.admin_activity_user_state
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- 2. Privilegios de PostgreSQL a nivel de tabla en admin_activity_notifications
-- Otorga DELETE a authenticated (PostgreSQL valida esto ANTES de evaluar RLS)
revoke all on table public.admin_activity_notifications from anon, public;
grant select, update, delete on table public.admin_activity_notifications to authenticated;

alter table public.admin_activity_notifications enable row level security;

-- Política RLS: Solo ADMIN puede borrar registros de admin_activity_notifications
drop policy if exists admin_can_delete_activity_notifications on public.admin_activity_notifications;
create policy admin_can_delete_activity_notifications
  on public.admin_activity_notifications
  for delete to authenticated
  using (public.is_admin());

-- Política RLS: Solo ADMIN puede actualizar registros completos
drop policy if exists admin_can_update_activity_notifications on public.admin_activity_notifications;
create policy admin_can_update_activity_notifications
  on public.admin_activity_notifications
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- Política RLS: Lectura por rol respetando descartes individuales
drop policy if exists admin_can_read_activity_notifications on public.admin_activity_notifications;
drop policy if exists staff_can_read_activity_notifications on public.admin_activity_notifications;
create policy staff_can_read_activity_notifications
  on public.admin_activity_notifications
  for select to authenticated
  using (
    (
      public.is_admin()
      or (
        barber_id is not null
        and barber_id = public.current_staff_barber_id()
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

-- 3. Funciones RPC con SECURITY DEFINER

-- 3.1. Borrado masivo global de todas las notificaciones (ADMIN)
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

-- 3.2. Borrado individual global (ADMIN)
create or replace function public.delete_staff_activity_notification_global(
  p_notification_id uuid
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
begin
  if not public.is_admin() then
    raise exception 'Acción reservada exclusivamente para el Administrador';
  end if;

  delete from public.admin_activity_notifications
  where id = p_notification_id;
end;
$$;

-- 3.3. Descarte individual de la vista personal (BARBER)
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
  v_is_admin boolean := public.is_admin();
  v_barber_id uuid := public.current_staff_barber_id();
  v_now timestamptz := now();
begin
  if v_uid is null or (not v_is_admin and v_barber_id is null) then
    raise exception 'No autorizado';
  end if;

  if not v_is_admin then
    if not exists (
      select 1
      from public.admin_activity_notifications
      where id = p_notification_id
        and barber_id = v_barber_id
    ) then
      raise exception 'Notificación fuera de alcance';
    end if;
  end if;

  insert into public.admin_activity_user_state (notification_id, user_id, dismissed_at, updated_at)
  values (p_notification_id, v_uid, v_now, v_now)
  on conflict (notification_id, user_id)
  do update set
    dismissed_at = v_now,
    updated_at = v_now;
end;
$$;

-- 3.4. Descarte masivo de la vista personal (BARBER)
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

-- 3.5. Lectura protegida de notificaciones con join a user_state
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
  v_is_admin boolean := public.is_admin();
  v_barber_id uuid := public.current_staff_barber_id();
begin
  if v_uid is null or (not v_is_admin and v_barber_id is null) then
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
    coalesce(us.read_at, n.read_at) as read_at
  from public.admin_activity_notifications n
  left join public.admin_activity_user_state us
    on us.notification_id = n.id and us.user_id = v_uid
  where (v_is_admin or n.barber_id = v_barber_id)
    and (us.dismissed_at is null)
  order by n.created_at desc
  limit 50;
end;
$$;

-- Permisos de ejecución de funciones RPC
revoke all on function public.delete_all_staff_activity_notifications_global() from public, anon;
revoke all on function public.delete_staff_activity_notification_global(uuid) from public, anon;
revoke all on function public.dismiss_staff_activity_notification_personal(uuid) from public, anon;
revoke all on function public.dismiss_all_staff_activity_notifications_personal() from public, anon;
revoke all on function public.read_staff_activity_notifications() from public, anon;

grant execute on function public.delete_all_staff_activity_notifications_global() to authenticated;
grant execute on function public.delete_staff_activity_notification_global(uuid) to authenticated;
grant execute on function public.dismiss_staff_activity_notification_personal(uuid) to authenticated;
grant execute on function public.dismiss_all_staff_activity_notifications_personal() to authenticated;
grant execute on function public.read_staff_activity_notifications() to authenticated;

-- Forzar recarga inmediata de caché en PostgREST
notify pgrst, 'reload schema';
