-- KANI Barber Studio — Corrección de casteo de eventos ADMIN.
-- La migración 00700 usaba CASE de texto para columnas enum.
-- Eso hacía fallar el UPDATE de disponibilidad antes de devolver el slot.

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
