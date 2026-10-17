-- KANI Barber Studio — Notificaciones: borrado por rol y estado por usuario
-- ADMIN: borrado global (elimina de admin_activity_notifications en cascada).
-- BARBER: borrado personal de su vista (registrado en admin_activity_user_state como dismissed_at).
-- Preserva la visibilidad y lectura aislada para cada barbero y el administrador.

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
revoke all on table public.admin_activity_user_state from anon, authenticated;
grant select, insert, update on table public.admin_activity_user_state to authenticated;

create policy user_can_manage_own_notification_state
  on public.admin_activity_user_state
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- Permitir DELETE en admin_activity_notifications exclusivamente para ADMIN
grant delete on table public.admin_activity_notifications to authenticated;

drop policy if exists admin_can_delete_activity_notifications on public.admin_activity_notifications;
create policy admin_can_delete_activity_notifications
  on public.admin_activity_notifications
  for delete to authenticated
  using (public.is_admin());

-- Actualizar política de SELECT para barberos y admin:
-- ADMIN ve todo lo que no haya sido eliminado globalmente.
-- BARBER ve solo sus notificaciones (donde barber_id = current_staff_barber_id() o barber_name coincide)
-- y que no hayan sido ocultadas/descartadas por este barbero en admin_activity_user_state.
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

-- RPC: Leer notificaciones del staff autenticado (resuelve estado de lectura por usuario o fallback global)
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
    coalesce(us.read_at, case when v_is_admin then n.read_at else null end) as read_at
  from public.admin_activity_notifications n
  left join public.admin_activity_user_state us
    on us.notification_id = n.id and us.user_id = v_uid
  where
    (v_is_admin or n.barber_id = v_barber_id)
    and (us.dismissed_at is null)
  order by n.created_at desc
  limit 40;
end;
$$;

-- RPC: Marcar notificación como leída o no leída
create or replace function public.set_staff_activity_notification_read(
  p_notification_id uuid,
  p_read_at timestamptz
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
begin
  if v_uid is null or (not v_is_admin and v_barber_id is null) then
    raise exception 'No autorizado';
  end if;

  -- Para admin, actualizamos también la columna legacy n.read_at
  if v_is_admin then
    update public.admin_activity_notifications
    set read_at = p_read_at
    where id = p_notification_id;
  end if;

  insert into public.admin_activity_user_state (notification_id, user_id, read_at, updated_at)
  values (p_notification_id, v_uid, p_read_at, now())
  on conflict (notification_id, user_id)
  do update set
    read_at = p_read_at,
    updated_at = now();
end;
$$;

-- RPC: Marcar todas como leídas
create or replace function public.mark_all_staff_activity_notifications_read()
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

  if v_is_admin then
    update public.admin_activity_notifications
    set read_at = v_now
    where read_at is null;
  end if;

  insert into public.admin_activity_user_state (notification_id, user_id, read_at, updated_at)
  select n.id, v_uid, v_now, v_now
  from public.admin_activity_notifications n
  left join public.admin_activity_user_state us
    on us.notification_id = n.id and us.user_id = v_uid
  where (v_is_admin or n.barber_id = v_barber_id)
    and (us.dismissed_at is null)
  on conflict (notification_id, user_id)
  do update set
    read_at = v_now,
    updated_at = v_now;
end;
$$;

-- RPC: Descartar de la vista personal (BARBER o ADMIN de su propia vista sin borrar para el resto)
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
  v_notif_barber uuid;
begin
  if v_uid is null or (not v_is_admin and v_barber_id is null) then
    raise exception 'No autorizado';
  end if;

  select barber_id into v_notif_barber
  from public.admin_activity_notifications
  where id = p_notification_id;

  if not found then
    return;
  end if;

  if not v_is_admin and v_notif_barber is distinct from v_barber_id then
    raise exception 'No autorizado para modificar esta notificación';
  end if;

  insert into public.admin_activity_user_state (notification_id, user_id, dismissed_at, updated_at)
  values (p_notification_id, v_uid, now(), now())
  on conflict (notification_id, user_id)
  do update set
    dismissed_at = now(),
    updated_at = now();
end;
$$;

-- RPC: Borrado global exclusivo para ADMIN
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

grant execute on function public.read_staff_activity_notifications to authenticated;
grant execute on function public.set_staff_activity_notification_read to authenticated;
grant execute on function public.mark_all_staff_activity_notifications_read to authenticated;
grant execute on function public.dismiss_staff_activity_notification_personal to authenticated;
grant execute on function public.delete_staff_activity_notification_global to authenticated;
