-- Migration: 20261116000100_kani_notifications_persistence_hotfix.sql
-- KANI Barber Studio — Hotfix integral de persistencia de notificaciones por usuario en Supabase
--
-- Problema observado en producción:
--   Los RPCs de notificaciones (`read_staff_activity_notifications`, etc.) no estaban presentes en Postgres /
--   PostgREST schema cache (404 PGRST202) y el fallback directo sobre `public.admin_activity_user_state`
--   fallaba con `42501 permission denied` o ciclo potencial entre políticas RLS al faltar grants/políticas
--   actualizadas de V12.39/V12.40.
--
-- Garantías de esta migración (100% autocontenida e idempotente):
--   1. Crea/repara `public.admin_activity_user_state`, sus columnas e índices si faltan.
--   2. Elimina cualquier sobrecarga legada de 0 argumentos en `mark_all_*` / `dismiss_all_*`.
--   3. Elimina el ciclo RLS entre `admin_activity_notifications` y `admin_activity_user_state` usando
--      un helper `SECURITY DEFINER` privado (`kani_private.staff_can_access_activity_notification`).
--   4. Restaura `GRANT`s explícitos para `authenticated` y `service_role`, revoca `anon`/`public`,
--      backfillea estado heredado sin sobrescribir estados por usuario existentes y recarga PostgREST.

-- ==============================================================================
-- 1. Schema privado e infraestructura base
-- ==============================================================================
create schema if not exists kani_private;
revoke all on schema kani_private from public, anon;
grant usage on schema kani_private to authenticated, service_role;

create index if not exists admin_activity_notifications_barber_created_idx
  on public.admin_activity_notifications (barber_id, created_at desc);

create table if not exists public.admin_activity_user_state (
  notification_id uuid not null references public.admin_activity_notifications(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  read_at timestamptz,
  dismissed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (notification_id, user_id)
);

alter table public.admin_activity_user_state
  add column if not exists read_at timestamptz;

alter table public.admin_activity_user_state
  add column if not exists dismissed_at timestamptz;

alter table public.admin_activity_user_state
  add column if not exists created_at timestamptz not null default now();

alter table public.admin_activity_user_state
  add column if not exists updated_at timestamptz not null default now();

create index if not exists admin_activity_user_state_user_idx
  on public.admin_activity_user_state (user_id, dismissed_at);

create index if not exists admin_activity_user_state_user_active_idx
  on public.admin_activity_user_state (user_id, notification_id)
  where dismissed_at is null;

-- ==============================================================================
-- 2. Backfill idempotente desde filas heredadas (sin pisar estado existente)
-- ==============================================================================
insert into public.admin_activity_user_state (
  notification_id,
  user_id,
  read_at,
  dismissed_at,
  created_at,
  updated_at
)
select
  n.id,
  sp.user_id,
  n.read_at,
  null,
  coalesce(n.read_at, now()),
  now()
from public.admin_activity_notifications n
join public.staff_profiles sp
  on sp.active = true
 and (
   sp.role in ('ADMIN', 'MANAGER')
   or (n.barber_id is not null and sp.barber_id = n.barber_id)
 )
where n.read_at is not null
on conflict (notification_id, user_id) do nothing;

-- ==============================================================================
-- 3. Helper de alcance sin recursión RLS + permisos y políticas no cíclicas
-- ==============================================================================
create or replace function kani_private.staff_can_access_activity_notification(
  p_notification_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.admin_activity_notifications n
    where n.id = p_notification_id
      and (
        public.is_operator()
        or (
          n.barber_id is not null
          and n.barber_id = public.current_staff_barber_id()
        )
      )
  );
$$;

revoke all on function kani_private.staff_can_access_activity_notification(uuid) from public, anon;
grant execute on function kani_private.staff_can_access_activity_notification(uuid) to authenticated, service_role;

-- 3a. Tabla compartida de notificaciones: append-only desde triggers, solo SELECT desde clientes
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

-- 3b. Estado por usuario: aislamiento estricto por auth.uid() sin ciclo hacia admin_activity_notifications
revoke all on table public.admin_activity_user_state from anon, public;
grant select, insert, update, delete on table public.admin_activity_user_state to authenticated;
grant all on table public.admin_activity_user_state to service_role;

alter table public.admin_activity_user_state enable row level security;

drop policy if exists user_can_manage_own_notification_state on public.admin_activity_user_state;
drop policy if exists user_can_select_own_notification_state on public.admin_activity_user_state;
drop policy if exists user_can_insert_own_notification_state on public.admin_activity_user_state;
drop policy if exists user_can_update_own_notification_state on public.admin_activity_user_state;
drop policy if exists user_can_delete_own_notification_state on public.admin_activity_user_state;

create policy user_can_select_own_notification_state
  on public.admin_activity_user_state
  for select to authenticated
  using (
    user_id = (select auth.uid())
    and (select kani_private.staff_can_access_activity_notification(notification_id))
  );

create policy user_can_insert_own_notification_state
  on public.admin_activity_user_state
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and (select kani_private.staff_can_access_activity_notification(notification_id))
  );

create policy user_can_update_own_notification_state
  on public.admin_activity_user_state
  for update to authenticated
  using (
    user_id = (select auth.uid())
    and (select kani_private.staff_can_access_activity_notification(notification_id))
  )
  with check (
    user_id = (select auth.uid())
    and (select kani_private.staff_can_access_activity_notification(notification_id))
  );

create policy user_can_delete_own_notification_state
  on public.admin_activity_user_state
  for delete to authenticated
  using (
    user_id = (select auth.uid())
    and (select kani_private.staff_can_access_activity_notification(notification_id))
  );

-- ==============================================================================
-- 4. Limpieza de sobrecargas previas y recreación idempotente de RPCs
-- ==============================================================================
drop function if exists public.mark_all_staff_activity_notifications_read();
drop function if exists public.dismiss_all_staff_activity_notifications_personal();

-- 4a. read_staff_activity_notifications
create or replace function public.read_staff_activity_notifications()
returns setof public.admin_activity_notifications
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_uid uuid := (select auth.uid());
  v_is_operator boolean := coalesce(public.is_operator(), false);
  v_barber_id uuid := public.current_staff_barber_id();
begin
  if v_uid is null then
    raise exception 'Sesión requerida para leer notificaciones.' using errcode = '42501';
  end if;

  if not v_is_operator and v_barber_id is null then
    raise exception 'Solo personal autorizado puede consultar notificaciones.' using errcode = '42501';
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
  where (
      v_is_operator
      or (
        n.barber_id is not null
        and n.barber_id = v_barber_id
      )
    )
    and (us.dismissed_at is null)
  order by n.created_at desc
  limit 80;
end;
$$;

-- 4b. set_staff_activity_notification_read
create or replace function public.set_staff_activity_notification_read(
  p_notification_id uuid,
  p_read_at timestamptz default now()
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_uid uuid := (select auth.uid());
  v_is_operator boolean := coalesce(public.is_operator(), false);
  v_barber_id uuid := public.current_staff_barber_id();
begin
  if v_uid is null then
    raise exception 'Sesión requerida para actualizar notificaciones.' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.admin_activity_notifications n
    where n.id = p_notification_id
      and (
        v_is_operator
        or (
          n.barber_id is not null
          and n.barber_id = v_barber_id
        )
      )
  ) then
    raise exception 'Notificación no encontrada o fuera de alcance para este usuario.' using errcode = '42501';
  end if;

  insert into public.admin_activity_user_state (
    notification_id,
    user_id,
    read_at,
    created_at,
    updated_at
  )
  values (
    p_notification_id,
    v_uid,
    p_read_at,
    now(),
    now()
  )
  on conflict (notification_id, user_id) do update
    set read_at = excluded.read_at,
        updated_at = now();
end;
$$;

-- 4c. mark_all_staff_activity_notifications_read (con p_before opcional)
create or replace function public.mark_all_staff_activity_notifications_read(
  p_before timestamptz default null
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_uid uuid := (select auth.uid());
  v_is_operator boolean := coalesce(public.is_operator(), false);
  v_barber_id uuid := public.current_staff_barber_id();
  v_now timestamptz := now();
begin
  if v_uid is null then
    raise exception 'Sesión requerida para actualizar notificaciones.' using errcode = '42501';
  end if;

  if not v_is_operator and v_barber_id is null then
    raise exception 'Solo personal autorizado puede actualizar notificaciones.' using errcode = '42501';
  end if;

  insert into public.admin_activity_user_state (
    notification_id,
    user_id,
    read_at,
    created_at,
    updated_at
  )
  select
    n.id,
    v_uid,
    v_now,
    v_now,
    v_now
  from public.admin_activity_notifications n
  where (
      v_is_operator
      or (
        n.barber_id is not null
        and n.barber_id = v_barber_id
      )
    )
    and (p_before is null or n.created_at <= p_before)
    and not exists (
      select 1
      from public.admin_activity_user_state us_d
      where us_d.notification_id = n.id
        and us_d.user_id = v_uid
        and us_d.dismissed_at is not null
    )
  on conflict (notification_id, user_id) do update
    set read_at = coalesce(public.admin_activity_user_state.read_at, excluded.read_at),
        updated_at = v_now
    where public.admin_activity_user_state.dismissed_at is null;
end;
$$;

-- 4d. mark_all_staff_activity_notifications_unread
create or replace function public.mark_all_staff_activity_notifications_unread()
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_uid uuid := (select auth.uid());
  v_is_operator boolean := coalesce(public.is_operator(), false);
  v_barber_id uuid := public.current_staff_barber_id();
begin
  if v_uid is null then
    raise exception 'Sesión requerida para actualizar notificaciones.' using errcode = '42501';
  end if;

  if not v_is_operator and v_barber_id is null then
    raise exception 'Solo personal autorizado puede actualizar notificaciones.' using errcode = '42501';
  end if;

  update public.admin_activity_user_state us
     set read_at = null,
         updated_at = now()
   where us.user_id = v_uid
     and us.dismissed_at is null
     and us.read_at is not null
     and exists (
       select 1
       from public.admin_activity_notifications n
       where n.id = us.notification_id
         and (
           v_is_operator
           or (
             n.barber_id is not null
             and n.barber_id = v_barber_id
           )
         )
     );
end;
$$;

-- 4e. dismiss_staff_activity_notification_personal
create or replace function public.dismiss_staff_activity_notification_personal(
  p_notification_id uuid
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_uid uuid := (select auth.uid());
  v_is_operator boolean := coalesce(public.is_operator(), false);
  v_barber_id uuid := public.current_staff_barber_id();
begin
  if v_uid is null then
    raise exception 'Sesión requerida para eliminar notificaciones.' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.admin_activity_notifications n
    where n.id = p_notification_id
      and (
        v_is_operator
        or (
          n.barber_id is not null
          and n.barber_id = v_barber_id
        )
      )
  ) then
    raise exception 'Notificación no encontrada o fuera de alcance para este usuario.' using errcode = '42501';
  end if;

  insert into public.admin_activity_user_state (
    notification_id,
    user_id,
    dismissed_at,
    created_at,
    updated_at
  )
  values (
    p_notification_id,
    v_uid,
    now(),
    now(),
    now()
  )
  on conflict (notification_id, user_id) do update
    set dismissed_at = excluded.dismissed_at,
        updated_at = now();
end;
$$;

-- 4f. dismiss_all_staff_activity_notifications_personal (con p_before opcional)
create or replace function public.dismiss_all_staff_activity_notifications_personal(
  p_before timestamptz default null
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_uid uuid := (select auth.uid());
  v_is_operator boolean := coalesce(public.is_operator(), false);
  v_barber_id uuid := public.current_staff_barber_id();
  v_count integer := 0;
  v_now timestamptz := now();
begin
  if v_uid is null then
    raise exception 'Sesión requerida para eliminar notificaciones.' using errcode = '42501';
  end if;

  if not v_is_operator and v_barber_id is null then
    raise exception 'Solo personal autorizado puede eliminar notificaciones.' using errcode = '42501';
  end if;

  with upserted as (
    insert into public.admin_activity_user_state (
      notification_id,
      user_id,
      dismissed_at,
      created_at,
      updated_at
    )
    select
      n.id,
      v_uid,
      v_now,
      v_now,
      v_now
    from public.admin_activity_notifications n
    where (
        v_is_operator
        or (
          n.barber_id is not null
          and n.barber_id = v_barber_id
        )
      )
      and (p_before is null or n.created_at <= p_before)
      and not exists (
        select 1
        from public.admin_activity_user_state us_d
        where us_d.notification_id = n.id
          and us_d.user_id = v_uid
          and us_d.dismissed_at is not null
      )
    on conflict (notification_id, user_id) do update
      set dismissed_at = coalesce(public.admin_activity_user_state.dismissed_at, excluded.dismissed_at),
          updated_at = v_now
      where public.admin_activity_user_state.dismissed_at is null
    returning 1
  )
  select count(*) into v_count from upserted;

  return v_count;
end;
$$;

-- 4g. Wrappers legados de compatibilidad -> solo descarte personal (nunca borrado global)
create or replace function public.delete_staff_activity_notification_global(
  p_notification_id uuid
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  perform public.dismiss_staff_activity_notification_personal(p_notification_id);
end;
$$;

create or replace function public.delete_all_staff_activity_notifications_global()
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  return public.dismiss_all_staff_activity_notifications_personal(null);
end;
$$;

-- ==============================================================================
-- 5. Permisos explícitos sobre RPCs, publicación Realtime y recarga PostgREST
-- ==============================================================================
revoke all on function public.read_staff_activity_notifications() from public, anon;
revoke all on function public.set_staff_activity_notification_read(uuid, timestamptz) from public, anon;
revoke all on function public.mark_all_staff_activity_notifications_read(timestamptz) from public, anon;
revoke all on function public.mark_all_staff_activity_notifications_unread() from public, anon;
revoke all on function public.dismiss_staff_activity_notification_personal(uuid) from public, anon;
revoke all on function public.dismiss_all_staff_activity_notifications_personal(timestamptz) from public, anon;
revoke all on function public.delete_staff_activity_notification_global(uuid) from public, anon;
revoke all on function public.delete_all_staff_activity_notifications_global() from public, anon;

grant execute on function public.read_staff_activity_notifications() to authenticated, service_role;
grant execute on function public.set_staff_activity_notification_read(uuid, timestamptz) to authenticated, service_role;
grant execute on function public.mark_all_staff_activity_notifications_read(timestamptz) to authenticated, service_role;
grant execute on function public.mark_all_staff_activity_notifications_unread() to authenticated, service_role;
grant execute on function public.dismiss_staff_activity_notification_personal(uuid) to authenticated, service_role;
grant execute on function public.dismiss_all_staff_activity_notifications_personal(timestamptz) to authenticated, service_role;
grant execute on function public.delete_staff_activity_notification_global(uuid) to authenticated, service_role;
grant execute on function public.delete_all_staff_activity_notifications_global() to authenticated, service_role;

do $$
begin
  alter publication supabase_realtime add table public.admin_activity_notifications;
exception
  when duplicate_object or undefined_object then null;
end;
$$;

do $$
begin
  alter publication supabase_realtime add table public.admin_activity_user_state;
exception
  when duplicate_object or undefined_object then null;
end;
$$;

notify pgrst, 'reload schema';
notify pgrst, 'reload config';
