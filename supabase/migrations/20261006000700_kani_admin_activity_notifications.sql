-- KANI Barber Studio — Actividad real del panel ADMIN
-- Append-only: los eventos se crean únicamente desde triggers de operaciones exitosas.

create type public.admin_activity_event_type as enum (
  'AVAILABILITY_UNAVAILABLE',
  'AVAILABILITY_AVAILABLE',
  'APPOINTMENT_REQUESTED',
  'APPOINTMENT_CONFIRMED',
  'APPOINTMENT_CANCELLED'
);

create table public.admin_activity_notifications (
  id uuid primary key default gen_random_uuid(),
  event_type public.admin_activity_event_type not null,
  actor_user_id uuid references auth.users(id) on delete set null,
  actor_display_name text not null check (length(trim(actor_display_name)) > 0),
  barber_id uuid references public.barbers(id) on delete set null,
  appointment_id uuid references public.appointments(id) on delete set null,
  availability_slot_id uuid references public.barber_availability_slots(id) on delete set null,
  barber_name text not null check (length(trim(barber_name)) > 0),
  client_name text,
  event_date date not null,
  event_time time,
  created_at timestamptz not null default now()
);

create index admin_activity_notifications_created_at_idx
  on public.admin_activity_notifications (created_at desc);
create index admin_activity_notifications_event_date_idx
  on public.admin_activity_notifications (event_date desc, event_time desc);

alter table public.admin_activity_notifications enable row level security;
revoke all on table public.admin_activity_notifications from anon, authenticated;
grant select on table public.admin_activity_notifications to authenticated;

create policy admin_can_read_activity_notifications
  on public.admin_activity_notifications
  for select to authenticated
  using (public.is_admin());

comment on table public.admin_activity_notifications is
  'Auditoría append-only de actividad visible exclusivamente para ADMIN.';
comment on column public.admin_activity_notifications.actor_user_id is
  'Usuario interno que ejecutó la operación; NULL para solicitudes públicas de clientes.';

create or replace function public.log_admin_activity_availability()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  v_actor_user_id uuid := coalesce(new.updated_by, (select auth.uid()));
  v_actor_display_name text;
  v_barber_name text;
begin
  if new.status is distinct from old.status then
    select sp.display_name
      into v_actor_display_name
    from public.staff_profiles sp
    where sp.user_id = v_actor_user_id
      and sp.active = true;

    select b.name
      into v_barber_name
    from public.barbers b
    where b.id = new.barber_id;

    insert into public.admin_activity_notifications (
      event_type,
      actor_user_id,
      actor_display_name,
      barber_id,
      availability_slot_id,
      barber_name,
      event_date,
      event_time
    )
    values (
      case
        when new.status = 'UNAVAILABLE' then 'AVAILABILITY_UNAVAILABLE'::public.admin_activity_event_type
        else 'AVAILABILITY_AVAILABLE'::public.admin_activity_event_type
      end,
      v_actor_user_id,
      coalesce(v_actor_display_name, 'Personal KANI'),
      new.barber_id,
      new.id,
      coalesce(v_barber_name, 'Barbero'),
      new.slot_date,
      new.start_time
    );
  end if;

  return new;
end;
$$;

create or replace function public.log_admin_activity_appointment()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  v_actor_user_id uuid := (select auth.uid());
  v_actor_display_name text;
  v_client_name text;
  v_barber_name text;
begin
  select c.name, b.name
    into v_client_name, v_barber_name
  from public.clients c
  join public.barbers b on b.id = new.barber_id
  where c.id = new.client_id;

  if tg_op = 'INSERT' then
    insert into public.admin_activity_notifications (
      event_type,
      actor_user_id,
      actor_display_name,
      barber_id,
      appointment_id,
      barber_name,
      client_name,
      event_date,
      event_time
    )
    values (
      'APPOINTMENT_REQUESTED'::public.admin_activity_event_type,
      null,
      coalesce(v_client_name, 'Cliente'),
      new.barber_id,
      new.id,
      coalesce(v_barber_name, 'Barbero'),
      v_client_name,
      new.booking_date,
      new.start_time
    );
  elsif new.status is distinct from old.status and new.status in ('CONFIRMED', 'CANCELLED') then
    select sp.display_name
      into v_actor_display_name
    from public.staff_profiles sp
    where sp.user_id = v_actor_user_id
      and sp.active = true;

    insert into public.admin_activity_notifications (
      event_type,
      actor_user_id,
      actor_display_name,
      barber_id,
      appointment_id,
      barber_name,
      client_name,
      event_date,
      event_time
    )
    values (
      case
        when new.status = 'CONFIRMED' then 'APPOINTMENT_CONFIRMED'::public.admin_activity_event_type
        else 'APPOINTMENT_CANCELLED'::public.admin_activity_event_type
      end,
      v_actor_user_id,
      coalesce(v_actor_display_name, 'Personal KANI'),
      new.barber_id,
      new.id,
      coalesce(v_barber_name, 'Barbero'),
      v_client_name,
      new.booking_date,
      new.start_time
    );
  end if;

  return new;
end;
$$;

revoke all on function public.log_admin_activity_availability() from public, anon, authenticated;
revoke all on function public.log_admin_activity_appointment() from public, anon, authenticated;

drop trigger if exists barber_availability_admin_activity_trigger on public.barber_availability_slots;
create trigger barber_availability_admin_activity_trigger
after update of status on public.barber_availability_slots
for each row execute function public.log_admin_activity_availability();

drop trigger if exists appointments_admin_activity_insert_trigger on public.appointments;
create trigger appointments_admin_activity_insert_trigger
after insert on public.appointments
for each row execute function public.log_admin_activity_appointment();

drop trigger if exists appointments_admin_activity_status_trigger on public.appointments;
create trigger appointments_admin_activity_status_trigger
after update of status on public.appointments
for each row execute function public.log_admin_activity_appointment();
