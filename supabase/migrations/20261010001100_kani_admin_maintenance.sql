create table if not exists public.maintenance_operations (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references auth.users(id) on delete set null,
  selected_statuses public.appointment_status[] not null,
  status text not null check (status in ('RUNNING', 'SUCCEEDED', 'FAILED')),
  appointments_deleted integer not null default 0 check (appointments_deleted >= 0),
  notification_events_deleted integer not null default 0 check (notification_events_deleted >= 0),
  admin_notifications_deleted integer not null default 0 check (admin_notifications_deleted >= 0),
  error_code text,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint maintenance_operations_selected_statuses_check check (
    cardinality(selected_statuses) > 0
    and selected_statuses <@ array[
      'PENDING'::public.appointment_status,
      'CONFIRMED'::public.appointment_status,
      'COMPLETED'::public.appointment_status,
      'CANCELLED'::public.appointment_status
    ]
  )
);

alter table public.maintenance_operations enable row level security;

revoke all on table public.maintenance_operations from anon, authenticated;
grant select on table public.maintenance_operations to authenticated;

create policy maintenance_operations_admin_read
on public.maintenance_operations
for select
to authenticated
using (public.is_admin());

create or replace function public.admin_cleanup_appointment_records(
  p_statuses public.appointment_status[]
)
returns table (
  operation_id uuid,
  operation_status text,
  selected_statuses public.appointment_status[],
  appointments_deleted integer,
  notification_events_deleted integer,
  admin_notifications_deleted integer,
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
  v_appointments_deleted integer := 0;
  v_notification_events_deleted integer := 0;
  v_admin_notifications_deleted integer := 0;
begin
  if v_actor_user_id is null or not public.is_admin() then
    raise exception 'MAINTENANCE_ADMIN_REQUIRED' using errcode = '42501';
  end if;

  if p_statuses is null
     or cardinality(p_statuses) = 0
     or not p_statuses <@ array[
       'PENDING'::public.appointment_status,
       'CONFIRMED'::public.appointment_status,
       'COMPLETED'::public.appointment_status,
       'CANCELLED'::public.appointment_status
     ] then
    raise exception 'MAINTENANCE_INVALID_STATUS_SELECTION' using errcode = '22023';
  end if;

  if not pg_try_advisory_xact_lock(hashtextextended('kani-admin-maintenance-cleanup', 0)) then
    raise exception 'MAINTENANCE_ALREADY_RUNNING' using errcode = '55P03';
  end if;

  insert into public.maintenance_operations (
    actor_user_id,
    selected_statuses,
    status
  )
  values (
    v_actor_user_id,
    p_statuses,
    'RUNNING'
  )
  returning id into v_operation_id;

  begin
    delete from public.admin_activity_notifications
    where appointment_id in (
      select id
      from public.appointments
      where status = any (p_statuses)
    );
    get diagnostics v_admin_notifications_deleted = row_count;

    delete from public.appointment_notification_events
    where appointment_id in (
      select id
      from public.appointments
      where status = any (p_statuses)
    );
    get diagnostics v_notification_events_deleted = row_count;

    delete from public.appointments
    where status = any (p_statuses);
    get diagnostics v_appointments_deleted = row_count;

    update public.maintenance_operations
    set status = 'SUCCEEDED',
        appointments_deleted = v_appointments_deleted,
        notification_events_deleted = v_notification_events_deleted,
        admin_notifications_deleted = v_admin_notifications_deleted,
        completed_at = clock_timestamp()
    where id = v_operation_id;
  exception when others then
    get stacked diagnostics v_sqlstate = returned_sqlstate;

    update public.maintenance_operations
    set status = 'FAILED',
        error_code = v_sqlstate,
        completed_at = clock_timestamp()
    where id = v_operation_id;
  end;

  return query
  select
    m.id,
    m.status,
    m.selected_statuses,
    m.appointments_deleted,
    m.notification_events_deleted,
    m.admin_notifications_deleted,
    m.error_code
  from public.maintenance_operations m
  where m.id = v_operation_id;
end;
$$;

revoke all on function public.admin_cleanup_appointment_records(public.appointment_status[]) from public, anon, authenticated;
grant execute on function public.admin_cleanup_appointment_records(public.appointment_status[]) to authenticated;
