-- Kani Barber Studio — limpieza independiente del historial de disponibilidad
-- Solo ADMIN puede contar o eliminar eventos históricos de disponibilidad.

create table if not exists public.maintenance_availability_operations (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references auth.users(id) on delete set null,
  status text not null check (status in ('RUNNING', 'SUCCEEDED', 'FAILED')),
  notifications_deleted integer not null default 0 check (notifications_deleted >= 0),
  error_code text,
  started_at timestamptz not null default now(),
  completed_at timestamptz
);

alter table public.maintenance_availability_operations enable row level security;

revoke all on table public.maintenance_availability_operations from anon, authenticated;
grant select on table public.maintenance_availability_operations to authenticated;

create policy maintenance_availability_operations_admin_read
on public.maintenance_availability_operations
for select
to authenticated
using (public.is_admin());

create index if not exists admin_activity_notifications_availability_type_idx
  on public.admin_activity_notifications (event_type)
  where event_type in (
    'AVAILABILITY_UNAVAILABLE'::public.admin_activity_event_type,
    'AVAILABILITY_AVAILABLE'::public.admin_activity_event_type
  );

comment on table public.maintenance_availability_operations is
  'Auditoría mínima de limpiezas ADMIN del historial de disponibilidad.';

create or replace function public.admin_count_availability_notifications()
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'MAINTENANCE_ADMIN_REQUIRED' using errcode = '42501';
  end if;

  return (
    select count(*)::integer
    from public.admin_activity_notifications
    where event_type in (
      'AVAILABILITY_UNAVAILABLE'::public.admin_activity_event_type,
      'AVAILABILITY_AVAILABLE'::public.admin_activity_event_type
    )
  );
end;
$$;

create or replace function public.admin_cleanup_availability_notifications()
returns table (
  operation_id uuid,
  operation_status text,
  notifications_deleted integer,
  error_code text
)
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  v_operation_id uuid;
  v_actor_user_id uuid := auth.uid();
  v_sqlstate text;
  v_notifications_deleted integer := 0;
begin
  if v_actor_user_id is null or not public.is_admin() then
    raise exception 'MAINTENANCE_ADMIN_REQUIRED' using errcode = '42501';
  end if;

  if not pg_try_advisory_xact_lock(hashtextextended('kani-admin-availability-history-cleanup', 0)) then
    raise exception 'MAINTENANCE_AVAILABILITY_ALREADY_RUNNING' using errcode = '55P03';
  end if;

  insert into public.maintenance_availability_operations (
    actor_user_id,
    status
  )
  values (
    v_actor_user_id,
    'RUNNING'
  )
  returning id into v_operation_id;

  begin
    delete from public.admin_activity_notifications as n
    where n.event_type in (
      'AVAILABILITY_UNAVAILABLE'::public.admin_activity_event_type,
      'AVAILABILITY_AVAILABLE'::public.admin_activity_event_type
    );
    get diagnostics v_notifications_deleted = row_count;

    update public.maintenance_availability_operations
    set status = 'SUCCEEDED',
        notifications_deleted = v_notifications_deleted,
        completed_at = clock_timestamp()
    where id = v_operation_id;
  exception when others then
    get stacked diagnostics v_sqlstate = returned_sqlstate;

    update public.maintenance_availability_operations
    set status = 'FAILED',
        error_code = v_sqlstate,
        completed_at = clock_timestamp()
    where id = v_operation_id;
  end;

  return query
  select
    m.id,
    m.status,
    m.notifications_deleted,
    m.error_code
  from public.maintenance_availability_operations m
  where m.id = v_operation_id;
end;
$$;

revoke all on function public.admin_count_availability_notifications() from public, anon, authenticated;
grant execute on function public.admin_count_availability_notifications() to authenticated;

revoke all on function public.admin_cleanup_availability_notifications() from public, anon, authenticated;
grant execute on function public.admin_cleanup_availability_notifications() to authenticated;
