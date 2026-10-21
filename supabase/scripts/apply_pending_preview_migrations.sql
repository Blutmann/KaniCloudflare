-- ==============================================================================
-- FILE: supabase/migrations/20261017000100_kani_whatsapp_notification_phone.sql
-- ==============================================================================

-- KANI Barber Studio - Soporte para notificaciones de WhatsApp
-- Almacena el teléfono del cliente en el evento de notificación y lo expone a través de claim_appointment_notification

alter table public.appointment_notification_events
  add column if not exists recipient_phone text;

create or replace function public.create_appointment_notification_event(
  p_appointment_id uuid,
  p_notification_type public.notification_type
)
returns text
language plpgsql
security definer
set search_path = pg_catalog, extensions
as $$
declare
  v_token text := gen_random_uuid()::text;
  v_recipient_email text;
  v_recipient_phone text;
  v_client_name text;
  v_barber_name text;
  v_service_name text;
  v_booking_date date;
  v_start_time time;
  v_end_time time;
  v_client_notes text;
  v_service_price_ars integer;
  v_service_duration_minutes integer;
  v_down_payment_ars integer;
  v_transfer_alias text;
  v_transfer_cuit text;
  v_transfer_holder_name text;
begin
  select c.email, c.phone, c.name, b.name, s.name, a.booking_date, a.start_time, a.end_time,
         a.notes, s.price_ars, s.duration_minutes, td.down_payment_ars,
         td.alias, td.cuit, td.holder_name
    into v_recipient_email, v_recipient_phone, v_client_name, v_barber_name, v_service_name,
         v_booking_date, v_start_time, v_end_time, v_client_notes,
         v_service_price_ars, v_service_duration_minutes, v_down_payment_ars,
         v_transfer_alias, v_transfer_cuit, v_transfer_holder_name
  from public.appointments a
  join public.clients c on c.id = a.client_id
  join public.barbers b on b.id = a.barber_id
  join public.services s on s.id = a.service_id
  left join public.barber_transfer_details td on td.barber_id = a.barber_id
    and td.active = true
  where a.id = p_appointment_id;

  if not found then
    raise exception using errcode = 'P0001', message = 'APPOINTMENT_NOT_FOUND';
  end if;

  insert into public.appointment_notification_events (
    appointment_id, notification_type, recipient_email, recipient_phone, client_name, barber_name,
    service_name, booking_date, start_time, end_time, client_notes,
    service_price_ars, service_duration_minutes, down_payment_ars,
    transfer_alias, transfer_cuit, transfer_holder_name, claim_token_digest
  ) values (
    p_appointment_id, p_notification_type, v_recipient_email, v_recipient_phone, v_client_name,
    v_barber_name, v_service_name, v_booking_date, v_start_time, v_end_time,
    v_client_notes, v_service_price_ars, v_service_duration_minutes,
    v_down_payment_ars, v_transfer_alias, v_transfer_cuit, v_transfer_holder_name,
    encode(digest(v_token, 'sha256'), 'hex')
  ) on conflict (appointment_id, notification_type) do nothing;

  if found then
    return v_token;
  end if;
  return null;
end;
$$;

drop function if exists public.claim_appointment_notification(uuid, text);

create function public.claim_appointment_notification(
  p_appointment_id uuid,
  p_claim_token text
)
returns table (
  notification_id uuid,
  notification_type public.notification_type,
  recipient_email text,
  recipient_phone text,
  client_name text,
  barber_name text,
  service_name text,
  booking_date date,
  start_time time,
  end_time time,
  client_notes text,
  service_price_ars integer,
  service_duration_minutes integer,
  down_payment_ars integer,
  transfer_alias text,
  transfer_cuit text,
  transfer_holder_name text,
  dispatch_status text,
  attempt integer
)
language plpgsql
security definer
set search_path = pg_catalog, extensions
as $$
declare
  v_event public.appointment_notification_events%rowtype;
begin
  if p_claim_token is null or length(trim(p_claim_token)) < 20 then
    raise exception using errcode = '42501', message = 'NOTIFICATION_CLAIM_INVALID';
  end if;

  select e.* into v_event
  from public.appointment_notification_events e
  where e.appointment_id = p_appointment_id
    and e.claim_token_digest = encode(digest(p_claim_token, 'sha256'), 'hex')
  for update;

  if not found then
    raise exception using errcode = '42501', message = 'NOTIFICATION_CLAIM_INVALID';
  end if;

  if v_event.status = 'SENT' then
    return query
    select v_event.id, v_event.notification_type, v_event.recipient_email,
           v_event.recipient_phone, v_event.client_name, v_event.barber_name,
           v_event.service_name, v_event.booking_date, v_event.start_time,
           v_event.end_time, v_event.client_notes, v_event.service_price_ars,
           v_event.service_duration_minutes, v_event.down_payment_ars,
           v_event.transfer_alias, v_event.transfer_cuit,
           v_event.transfer_holder_name, 'ALREADY_SENT'::text, v_event.attempts;
    return;
  end if;

  if v_event.status = 'SENDING' and v_event.updated_at > now() - interval '10 minutes' then
    return query
    select v_event.id, v_event.notification_type, v_event.recipient_email,
           v_event.recipient_phone, v_event.client_name, v_event.barber_name,
           v_event.service_name, v_event.booking_date, v_event.start_time,
           v_event.end_time, v_event.client_notes, v_event.service_price_ars,
           v_event.service_duration_minutes, v_event.down_payment_ars,
           v_event.transfer_alias, v_event.transfer_cuit,
           v_event.transfer_holder_name, 'IN_PROGRESS'::text, v_event.attempts;
    return;
  end if;

  update public.appointment_notification_events as updated
  set status = 'SENDING', attempts = updated.attempts + 1,
      last_error = null, updated_at = now()
  where updated.id = v_event.id;

  return query
  select v_event.id, v_event.notification_type, v_event.recipient_email,
         v_event.recipient_phone, v_event.client_name, v_event.barber_name,
         v_event.service_name, v_event.booking_date, v_event.start_time,
         v_event.end_time, v_event.client_notes, v_event.service_price_ars,
         v_event.service_duration_minutes, v_event.down_payment_ars,
         v_event.transfer_alias, v_event.transfer_cuit,
         v_event.transfer_holder_name, 'READY'::text, v_event.attempts + 1;
end;
$$;

revoke all on function public.claim_appointment_notification(uuid, text) from public;
grant execute on function public.claim_appointment_notification(uuid, text) to anon, authenticated;


-- ==============================================================================
-- FILE: supabase/migrations/20261017000500_kani_notification_role_dismissals.sql
-- ==============================================================================

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


-- ==============================================================================
-- FILE: supabase/migrations/20261018000200_kani_manual_and_recurring_appointments.sql
-- ==============================================================================

-- Kani Barber Studio — Turnos manuales y recurrencia semanal
-- Permite agendar turnos manuales por única vez y recurrentes (semanales) desde el panel administrativo.
-- Desacopla la seña (deposit_required = false) y amplía la franja horaria permitida para turnos manuales (00:00 a 23:59).

-- 1. Modificar tabla appointments
-- Eliminar restricción de horario comercial rígido para permitir turnos en cualquier franja validada
alter table public.appointments
  drop constraint if exists appointment_inside_business_hours;

-- Agregar columnas de auditoría y recurrencia
alter table public.appointments
  add column if not exists is_manual boolean not null default false,
  add column if not exists origin text not null default 'PUBLIC_WEB' check (origin in ('PUBLIC_WEB', 'MANUAL')),
  add column if not exists created_by_user_id uuid references auth.users(id) on delete set null,
  add column if not exists created_by_display_name text,
  add column if not exists recurring_rule_id uuid,
  add column if not exists deposit_required boolean not null default true,
  add column if not exists deposit_paid boolean not null default false;

-- 2. Tabla de reglas de recurrencia semanal
create table if not exists public.recurring_appointment_rules (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete restrict,
  barber_id uuid not null references public.barbers(id) on delete restrict,
  service_id uuid not null references public.services(id) on delete restrict,
  day_of_week integer not null check (day_of_week between 1 and 7), -- 1: Lunes, 7: Domingo
  start_time time not null,
  duration_minutes integer not null check (duration_minutes > 0),
  start_date date not null,
  end_date date,
  active boolean not null default true,
  created_by_user_id uuid references auth.users(id) on delete set null,
  created_by_display_name text not null,
  time_zone text not null default 'America/Argentina/Buenos_Aires',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Agregar foreign key desde appointments hacia recurring_appointment_rules
do $$
begin
  if not exists (
    select 1
    from information_schema.table_constraints
    where constraint_name = 'appointments_recurring_rule_id_fkey'
      and table_name = 'appointments'
  ) then
    alter table public.appointments
      add constraint appointments_recurring_rule_id_fkey
      foreign key (recurring_rule_id)
      references public.recurring_appointment_rules(id)
      on delete set null;
  end if;
end;
$$;

create index if not exists idx_recurring_rules_barber on public.recurring_appointment_rules (barber_id, active);
create index if not exists idx_recurring_rules_client on public.recurring_appointment_rules (client_id);
create index if not exists idx_appointments_recurring_rule on public.appointments (recurring_rule_id, booking_date);

-- 3. Tabla de conflictos detectados en la recurrencia
create table if not exists public.recurring_rule_conflicts (
  id uuid primary key default gen_random_uuid(),
  rule_id uuid not null references public.recurring_appointment_rules(id) on delete cascade,
  target_date date not null,
  conflict_reason text not null,
  conflicting_appointment_id uuid references public.appointments(id) on delete set null,
  resolved boolean not null default false,
  created_at timestamptz not null default now(),
  unique(rule_id, target_date)
);

-- 4. RLS para las nuevas tablas
alter table public.recurring_appointment_rules enable row level security;
alter table public.recurring_rule_conflicts enable row level security;

drop policy if exists staff_can_read_recurring_rules on public.recurring_appointment_rules;
create policy staff_can_read_recurring_rules
  on public.recurring_appointment_rules for select to authenticated
  using (
    public.is_admin()
    or barber_id = public.current_staff_barber_id()
  );

drop policy if exists staff_can_read_recurring_conflicts on public.recurring_rule_conflicts;
create policy staff_can_read_recurring_conflicts
  on public.recurring_rule_conflicts for select to authenticated
  using (
    public.is_admin()
    or exists (
      select 1 from public.recurring_appointment_rules r
      where r.id = rule_id and r.barber_id = public.current_staff_barber_id()
    )
  );

grant select on table public.appointments to authenticated;
grant select on table public.recurring_appointment_rules to authenticated;
grant select on table public.recurring_rule_conflicts to authenticated;

-- 5. RPC para sincronizar / proyectar recurrencias futuras de forma idempotente
create or replace function public.sync_recurring_appointment_rules(
  p_horizon_days integer default 28
)
returns table (
  rule_id uuid,
  target_date date,
  action_taken text,
  appointment_id uuid
)
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  v_today date := (timezone('America/Argentina/Buenos_Aires', clock_timestamp()))::date;
  v_horizon_end date := v_today + p_horizon_days;
  v_rule record;
  v_curr_date date;
  v_end_time time;
  v_target_end_ts timestamp;
  v_target_start_ts timestamp;
  v_conflict_id uuid;
  v_conflict_reason text;
  v_apt_id uuid;
  v_interval_days integer;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;

  for v_rule in
    select r.*, b.name as barber_name, s.name as service_name
    from public.recurring_appointment_rules r
    join public.barbers b on b.id = r.barber_id
    join public.services s on s.id = r.service_id
    where r.active = true
      and (r.end_date is null or r.end_date >= v_today)
      and (public.is_admin() or r.barber_id = public.current_staff_barber_id())
  loop
    v_curr_date := greatest(v_rule.start_date, v_today);

    v_interval_days := 7;
    if v_rule.notes like '%[Frecuencia: Una vez cada dos semanas]%' then
      v_interval_days := 14;
    elsif v_rule.notes like '%[Frecuencia: Una vez cada tres semanas]%' then
      v_interval_days := 21;
    elsif v_rule.notes like '%[Frecuencia: Una vez al mes]%' then
      v_interval_days := 28;
    end if;

    while v_curr_date <= v_horizon_end loop
      if v_rule.end_date is not null and v_curr_date > v_rule.end_date then
        exit;
      end if;

      -- Verificar si el día de la semana coincide (1: Lun .. 7: Dom) y respeta el intervalo de frecuencia
      if extract(isodow from v_curr_date)::integer = v_rule.day_of_week
         and ((v_curr_date - v_rule.start_date) % v_interval_days = 0) then
        v_end_time := (v_rule.start_time + (v_rule.duration_minutes || ' minutes')::interval)::time;
        v_target_start_ts := (v_curr_date + v_rule.start_time)::timestamp;
        v_target_end_ts := (v_curr_date + v_end_time)::timestamp;

        -- Bloqueo transaccional por barbero y fecha
        perform pg_advisory_xact_lock(hashtextextended(v_rule.barber_id::text || '|' || v_curr_date::text, 0));

        -- 1. Si ya existe un turno para esta regla en esta fecha (incluso si fue CANCELLED), no volver a crearlo
        if exists (
          select 1 from public.appointments a
          where a.recurring_rule_id = v_rule.id
            and a.booking_date = v_curr_date
        ) then
          -- Ya procesado previamente
          v_curr_date := v_curr_date + 1;
          continue;
        end if;

        -- 2. Verificar colisión con otro turno activo
        select a.id into v_conflict_id
        from public.appointments a
        where a.barber_id = v_rule.barber_id
          and a.booking_date = v_curr_date
          and a.status <> 'CANCELLED'
          and (a.booking_date + a.start_time)::timestamp < v_target_end_ts
          and (a.booking_date + a.end_time)::timestamp > v_target_start_ts
        limit 1;

        if v_conflict_id is not null then
          v_conflict_reason := 'SLOT_COLLISION_WITH_APPOINTMENT';
          insert into public.recurring_rule_conflicts (rule_id, target_date, conflict_reason, conflicting_appointment_id)
          values (v_rule.id, v_curr_date, v_conflict_reason, v_conflict_id)
          on conflict (rule_id, target_date)
          do update set conflict_reason = excluded.conflict_reason,
                        conflicting_appointment_id = excluded.conflicting_appointment_id,
                        resolved = false;

          return query select v_rule.id, v_curr_date, 'CONFLICT_RECORDED'::text, null::uuid;
          v_curr_date := v_curr_date + 1;
          continue;
        end if;

        -- 3. Asegurar slot en barber_availability_slots para cubrir el intervalo
        if not exists (
          select 1
          from public.barber_availability_slots s
          where s.barber_id = v_rule.barber_id
            and s.slot_date = v_curr_date
            and s.status = 'AVAILABLE'
            and s.start_time <= v_rule.start_time
            and s.end_time >= v_end_time
        ) then
          -- Insertar o actualizar slot
          insert into public.barber_availability_slots (
            barber_id, slot_date, start_time, end_time, status, internal_note
          ) values (
            v_rule.barber_id,
            v_curr_date,
            v_rule.start_time,
            v_end_time,
            'AVAILABLE',
            'Generado automáticamente por turno recurrente'
          )
          on conflict (barber_id, slot_date, start_time)
          do update set status = 'AVAILABLE', end_time = greatest(barber_availability_slots.end_time, v_end_time);
        end if;

        -- 4. Insertar la ocurrencia como turno confirmado exento de seña
        insert into public.appointments (
          client_id,
          barber_id,
          service_id,
          booking_date,
          start_time,
          end_time,
          status,
          notes,
          is_manual,
          origin,
          created_by_user_id,
          created_by_display_name,
          recurring_rule_id,
          deposit_required,
          deposit_paid
        ) values (
          v_rule.client_id,
          v_rule.barber_id,
          v_rule.service_id,
          v_curr_date,
          v_rule.start_time,
          v_end_time,
          'CONFIRMED',
          v_rule.notes,
          true,
          'MANUAL',
          v_rule.created_by_user_id,
          v_rule.created_by_display_name,
          v_rule.id,
          false,
          false
        )
        returning id into v_apt_id;

        return query select v_rule.id, v_curr_date, 'OCCURRENCE_CREATED'::text, v_apt_id;
      end if;

      v_curr_date := v_curr_date + 1;
    end loop;
  end loop;
end;
$$;

revoke all on function public.sync_recurring_appointment_rules(integer) from public;
grant execute on function public.sync_recurring_appointment_rules(integer) to authenticated;

-- 6. RPC para crear turno manual (por única vez o recurrente)
create or replace function public.create_manual_appointment(
  p_barber_id uuid,
  p_service_id uuid,
  p_booking_date date,
  p_start_time time,
  p_client_name text,
  p_client_phone text,
  p_client_email text,
  p_notes text default null,
  p_is_recurring boolean default false,
  p_duration_minutes integer default null
)
returns table (
  appointment_id uuid,
  appointment_status public.appointment_status,
  booking_date date,
  start_time time,
  end_time time,
  request_number bigint,
  is_manual boolean,
  origin text,
  created_by_display_name text,
  recurring_rule_id uuid
)
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  v_staff_barber_id uuid;
  v_is_admin boolean;
  v_creator_user_id uuid := auth.uid();
  v_creator_name text;
  v_barber public.barbers%rowtype;
  v_service public.services%rowtype;
  v_duration_min integer;
  v_duration interval;
  v_end_time time;
  v_start_ts timestamp;
  v_end_ts timestamp;
  v_client_id uuid;
  v_apt_id uuid;
  v_rule_id uuid := null;
  v_req_num bigint;
  v_day_of_week integer;
begin
  if v_creator_user_id is null then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;

  v_is_admin := public.is_admin();
  v_staff_barber_id := public.current_staff_barber_id();

  -- Validar permisos de barbero: si no es admin, solo puede agendar para su propio id
  if not v_is_admin and (v_staff_barber_id is null or v_staff_barber_id is distinct from p_barber_id) then
    raise exception using errcode = '42501', message = 'MANUAL_APPOINTMENT_NOT_ALLOWED';
  end if;

  -- Determinar nombre para auditoría "Turno generado por"
  if v_is_admin then
    v_creator_name := 'Admin';
  else
    select b.name into v_creator_name
    from public.barbers b
    where b.id = v_staff_barber_id;
    if v_creator_name is null then
      v_creator_name := 'Barbero';
    end if;
  end if;

  -- Validaciones de entrada
  if p_barber_id is null then
    raise exception using errcode = '22023', message = 'BARBER_REQUIRED';
  end if;
  if p_service_id is null then
    raise exception using errcode = '22023', message = 'SERVICE_REQUIRED';
  end if;
  if p_booking_date is null then
    raise exception using errcode = '22023', message = 'DATE_REQUIRED';
  end if;
  if p_start_time is null then
    raise exception using errcode = '22023', message = 'START_TIME_REQUIRED';
  end if;
  if p_client_name is null or length(trim(p_client_name)) < 3 then
    raise exception using errcode = '22023', message = 'CLIENT_NAME_INVALID';
  end if;
  if p_client_phone is null or length(trim(p_client_phone)) < 6 then
    raise exception using errcode = '22023', message = 'CLIENT_PHONE_INVALID';
  end if;

  select * into strict v_barber
  from public.barbers
  where id = p_barber_id and active = true;

  select * into strict v_service
  from public.services
  where id = p_service_id and active = true;

  v_duration_min := coalesce(p_duration_minutes, v_service.duration_minutes);
  if v_duration_min <= 0 then
    v_duration_min := 45;
  end if;
  v_duration := (v_duration_min || ' minutes')::interval;

  v_end_time := (p_start_time + v_duration)::time;
  v_start_ts := (p_booking_date + p_start_time)::timestamp;
  v_end_ts := (p_booking_date + v_end_time)::timestamp;

  -- Bloqueo transaccional
  perform pg_advisory_xact_lock(hashtextextended(v_barber.id::text || '|' || p_booking_date::text, 0));

  -- Validar colisión de turno activo
  if exists (
    select 1
    from public.appointments a
    where a.barber_id = v_barber.id
      and a.booking_date = p_booking_date
      and a.status <> 'CANCELLED'
      and (a.booking_date + a.start_time)::timestamp < v_end_ts
      and (a.booking_date + a.end_time)::timestamp > v_start_ts
  ) then
    raise exception using errcode = '23P01', message = 'SLOT_ALREADY_BOOKED';
  end if;

  -- Normalizar y upsert cliente
  select c.id into v_client_id
  from public.clients c
  where lower(trim(c.email)) = lower(trim(coalesce(p_client_email, '')))
     or regexp_replace(c.phone, '[^0-9+]', '', 'g') = regexp_replace(trim(p_client_phone), '[^0-9+]', '', 'g')
  order by c.created_at asc
  limit 1;

  if v_client_id is null then
    insert into public.clients (name, phone, email)
    values (
      trim(p_client_name),
      trim(p_client_phone),
      lower(trim(coalesce(p_client_email, 'sin-email@kanibarber.internal')))
    )
    returning id into v_client_id;
  else
    update public.clients
    set name = trim(p_client_name),
        phone = trim(p_client_phone),
        email = coalesce(nullif(lower(trim(p_client_email)), ''), email),
        updated_at = now()
    where id = v_client_id;
  end if;

  -- Asegurar disponibilidad en barber_availability_slots para cubrir el intervalo
  if not exists (
    select 1
    from public.barber_availability_slots s
    where s.barber_id = v_barber.id
      and s.slot_date = p_booking_date
      and s.status = 'AVAILABLE'
      and s.start_time <= p_start_time
      and s.end_time >= v_end_time
  ) then
    insert into public.barber_availability_slots (
      barber_id, slot_date, start_time, end_time, status, internal_note
    ) values (
      v_barber.id,
      p_booking_date,
      p_start_time,
      v_end_time,
      'AVAILABLE',
      'Habilitado automáticamente por turno manual'
    )
    on conflict (barber_id, slot_date, start_time)
    do update set status = 'AVAILABLE', end_time = greatest(barber_availability_slots.end_time, v_end_time);
  end if;

  -- Si es recurrente, crear regla de recurrencia
  if p_is_recurring then
    v_day_of_week := extract(isodow from p_booking_date)::integer;
    insert into public.recurring_appointment_rules (
      client_id,
      barber_id,
      service_id,
      day_of_week,
      start_time,
      duration_minutes,
      start_date,
      active,
      created_by_user_id,
      created_by_display_name,
      notes
    ) values (
      v_client_id,
      v_barber.id,
      v_service.id,
      v_day_of_week,
      p_start_time,
      v_duration_min,
      p_booking_date,
      true,
      v_creator_user_id,
      v_creator_name,
      nullif(trim(coalesce(p_notes, '')), '')
    )
    returning id into v_rule_id;
  end if;

  -- Insertar el turno manual (confirmado, sin seña)
  insert into public.appointments (
    client_id,
    barber_id,
    service_id,
    booking_date,
    start_time,
    end_time,
    status,
    notes,
    is_manual,
    origin,
    created_by_user_id,
    created_by_display_name,
    recurring_rule_id,
    deposit_required,
    deposit_paid
  ) values (
    v_client_id,
    v_barber.id,
    v_service.id,
    p_booking_date,
    p_start_time,
    v_end_time,
    'CONFIRMED',
    nullif(trim(coalesce(p_notes, '')), ''),
    true,
    'MANUAL',
    v_creator_user_id,
    v_creator_name,
    v_rule_id,
    false,
    false
  )
  returning id, status, booking_date, start_time, end_time, request_number
  into v_apt_id, appointment_status, booking_date, start_time, end_time, v_req_num;

  -- Si es recurrente, sincronizar las siguientes 4 semanas
  if p_is_recurring then
    perform public.sync_recurring_appointment_rules(28);
  end if;

  return query select
    v_apt_id,
    appointment_status,
    booking_date,
    start_time,
    end_time,
    v_req_num,
    true,
    'MANUAL'::text,
    v_creator_name,
    v_rule_id;
end;
$$;

revoke all on function public.create_manual_appointment(uuid, uuid, date, time, text, text, text, text, boolean, integer) from public;
grant execute on function public.create_manual_appointment(uuid, uuid, date, time, text, text, text, text, boolean, integer) to authenticated;

-- 7. RPC para activar o desactivar regla de recurrencia
create or replace function public.set_recurring_rule_active(
  p_rule_id uuid,
  p_active boolean
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  v_rule public.recurring_appointment_rules%rowtype;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;

  select * into strict v_rule
  from public.recurring_appointment_rules
  where id = p_rule_id;

  if not public.is_admin() and v_rule.barber_id is distinct from public.current_staff_barber_id() then
    raise exception using errcode = '42501', message = 'NOT_ALLOWED';
  end if;

  update public.recurring_appointment_rules
  set active = p_active,
      updated_at = now()
  where id = p_rule_id;

  return true;
end;
$$;

revoke all on function public.set_recurring_rule_active(uuid, boolean) from public;
grant execute on function public.set_recurring_rule_active(uuid, boolean) to authenticated;


-- ==============================================================================
-- FILE: supabase/migrations/20261018000300_kani_delete_all_notifications_rpc.sql
-- ==============================================================================

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


-- ==============================================================================
-- FILE: supabase/migrations/20261018000400_kani_notification_repairs.sql
-- ==============================================================================

-- Migration: 20261018000400_kani_notification_repairs.sql
-- KANI Barber Studio — Reparación integral del sistema de notificaciones y permisos Supabase
--
-- Causa raíz identificada:
-- 1. Faltaba GRANT UPDATE y política RLS 'FOR UPDATE' en admin_activity_notifications para authenticated.
-- 2. Faltaban funciones RPC críticas (delete_all_staff_activity_notifications_global, mark_all_staff_activity_notifications_unread).
-- 3. Faltaba GRANT DELETE en admin_activity_user_state para authenticated.
-- 4. Las fallas de RPC obligaban al frontend a ejecutar consultas directas que eran rechazadas con error 42501.

-- ==============================================================================
-- 1. Tabla de estado por usuario para notificaciones (admin_activity_user_state)
-- ==============================================================================
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

-- ==============================================================================
-- 2. Privilegios SQL y políticas RLS en admin_activity_notifications
-- ==============================================================================
revoke all on table public.admin_activity_notifications from anon, public;
grant select, update, delete on table public.admin_activity_notifications to authenticated;

alter table public.admin_activity_notifications enable row level security;

-- SELECT: ADMIN ve todo; BARBER solo sus eventos no descartados
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

-- UPDATE: Exclusivo para ADMIN (actualizar read_at)
drop policy if exists admin_can_update_activity_read_state on public.admin_activity_notifications;
drop policy if exists admin_can_update_activity_notifications on public.admin_activity_notifications;
create policy admin_can_update_activity_notifications
  on public.admin_activity_notifications
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- DELETE: Exclusivo para ADMIN (eliminación permanente)
drop policy if exists admin_can_delete_activity_notifications on public.admin_activity_notifications;
create policy admin_can_delete_activity_notifications
  on public.admin_activity_notifications
  for delete to authenticated
  using (public.is_admin());

-- ==============================================================================
-- 3. Funciones RPC seguras (SECURITY DEFINER con search_path explícito)
-- ==============================================================================

-- 3.1. Leer notificaciones del staff autenticado
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

-- 3.2. Marcar/desmarcar notificación individual como leída
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

-- 3.3. Marcar todas las notificaciones como leídas (bulk read)
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

-- 3.4. Marcar todas las notificaciones como no leídas (bulk unread)
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

-- 3.5. Borrado individual global (ADMIN)
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

-- 3.6. Borrado masivo global de todas las notificaciones (ADMIN)
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

-- 3.7. Descarte de notificación individual de la vista personal (BARBER)
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

-- 3.8. Descarte de todas las notificaciones personales (BARBER / Staff)
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

-- ==============================================================================
-- 4. Asignación de permisos de ejecución para funciones RPC
-- ==============================================================================
revoke all on function public.read_staff_activity_notifications() from public, anon;
revoke all on function public.set_staff_activity_notification_read(uuid, timestamptz) from public, anon;
revoke all on function public.mark_all_staff_activity_notifications_read() from public, anon;
revoke all on function public.mark_all_staff_activity_notifications_unread() from public, anon;
revoke all on function public.delete_staff_activity_notification_global(uuid) from public, anon;
revoke all on function public.delete_all_staff_activity_notifications_global() from public, anon;
revoke all on function public.dismiss_staff_activity_notification_personal(uuid) from public, anon;
revoke all on function public.dismiss_all_staff_activity_notifications_personal() from public, anon;

grant execute on function public.read_staff_activity_notifications() to authenticated;
grant execute on function public.set_staff_activity_notification_read(uuid, timestamptz) to authenticated;
grant execute on function public.mark_all_staff_activity_notifications_read() to authenticated;
grant execute on function public.mark_all_staff_activity_notifications_unread() to authenticated;
grant execute on function public.delete_staff_activity_notification_global(uuid) to authenticated;
grant execute on function public.delete_all_staff_activity_notifications_global() to authenticated;
grant execute on function public.dismiss_staff_activity_notification_personal(uuid) to authenticated;
grant execute on function public.dismiss_all_staff_activity_notifications_personal() to authenticated;


-- ==============================================================================
-- FILE: supabase/migrations/20261018000500_kani_client_consolidation.sql
-- ==============================================================================

-- Migration: 20261018000500_kani_client_consolidation.sql
-- KANI Barber Studio — Consolidación de clientes por teléfono o correo e historial unificado
-- 1. Función canónica find_or_create_consolidated_client
-- 2. Consolidación segura de registros preexistentes en clients y appointments
-- 3. Actualización de request_appointment y create_manual_appointment

-- 1. Función segura de resolución y consolidación de clientes
create or replace function public.find_or_create_consolidated_client(
  p_name text,
  p_phone text,
  p_email text
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  v_clean_name text := trim(coalesce(p_name, 'Cliente'));
  v_phone_digits text := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
  v_phone_canon text;
  v_email_norm text := lower(trim(coalesce(p_email, '')));
  v_client_by_phone record;
  v_client_by_email record;
  v_target_id uuid;
begin
  -- Canonizar teléfono argentino para comparación (+54...)
  if length(v_phone_digits) = 13 and v_phone_digits like '549%' then
    v_phone_canon := '54' || substr(v_phone_digits, 4);
  elsif length(v_phone_digits) = 10 then
    v_phone_canon := '54' || v_phone_digits;
  elsif length(v_phone_digits) >= 8 then
    v_phone_canon := v_phone_digits;
  else
    v_phone_canon := null;
  end if;

  -- Descartar emails inválidos o placeholders
  if v_email_norm = '' or v_email_norm like '%@kanibarber.internal' or position('@' in v_email_norm) <= 1 then
    v_email_norm := null;
  end if;

  -- Buscar por teléfono normalizado
  if v_phone_canon is not null then
    select c.id, c.name, c.phone, c.email into v_client_by_phone
    from public.clients c
    where (
      regexp_replace(c.phone, '[^0-9]', '', 'g') = v_phone_digits
      or (
        length(regexp_replace(c.phone, '[^0-9]', '', 'g')) = 13
        and regexp_replace(c.phone, '[^0-9]', '', 'g') like '549%'
        and '54' || substr(regexp_replace(c.phone, '[^0-9]', '', 'g'), 4) = v_phone_canon
      )
      or (
        length(regexp_replace(c.phone, '[^0-9]', '', 'g')) = 10
        and '54' || regexp_replace(c.phone, '[^0-9]', '', 'g') = v_phone_canon
      )
    )
    order by c.created_at asc
    limit 1;
  end if;

  -- Buscar por correo normalizado
  if v_email_norm is not null then
    select c.id, c.name, c.phone, c.email into v_client_by_email
    from public.clients c
    where lower(trim(c.email)) = v_email_norm
    order by c.created_at asc
    limit 1;
  end if;

  -- Reglas de identificación y resolución segura de conflictos
  if v_client_by_phone.id is not null and v_client_by_email.id is not null and v_client_by_phone.id <> v_client_by_email.id then
    -- Conflicto: teléfono pertenece al cliente A y correo al cliente B
    if lower(trim(v_clean_name)) = lower(trim(v_client_by_phone.name)) and lower(trim(v_clean_name)) <> lower(trim(v_client_by_email.name)) then
      v_target_id := v_client_by_phone.id;
    elsif lower(trim(v_clean_name)) = lower(trim(v_client_by_email.name)) and lower(trim(v_clean_name)) <> lower(trim(v_client_by_phone.name)) then
      v_target_id := v_client_by_email.id;
    else
      -- Conflicto irresoluble: no fusionar arbitrariamente registros de distintas personas
      v_target_id := null;
    end if;
  elsif v_client_by_phone.id is not null then
    v_target_id := v_client_by_phone.id;
    -- Si el cliente existente no tenía correo y ahora se aportó uno válido, completarlo
    if v_email_norm is not null and (v_client_by_phone.email is null or v_client_by_phone.email like '%@kanibarber.internal') then
      update public.clients set email = v_email_norm, updated_at = now() where id = v_target_id;
    end if;
  elsif v_client_by_email.id is not null then
    v_target_id := v_client_by_email.id;
    -- Si el cliente existente no tenía teléfono y ahora se aportó uno válido, completarlo
    if v_phone_canon is not null and (v_client_by_email.phone is null or length(trim(v_client_by_email.phone)) < 8) then
      update public.clients set phone = trim(p_phone), updated_at = now() where id = v_target_id;
    end if;
  end if;

  -- Crear cliente si no existía o si hubo conflicto no asociable
  if v_target_id is null then
    insert into public.clients (name, phone, email)
    values (
      v_clean_name,
      trim(p_phone),
      coalesce(v_email_norm, 'sin-email@kanibarber.internal')
    )
    returning id into v_target_id;
  else
    -- Si el nuevo nombre es más completo (mayor longitud descriptiva), actualizar
    if length(v_clean_name) > length(coalesce(v_client_by_phone.name, v_client_by_email.name, '')) then
      update public.clients set name = v_clean_name, updated_at = now() where id = v_target_id;
    end if;
  end if;

  return v_target_id;
end;
$$;

grant execute on function public.find_or_create_consolidated_client to authenticated, anon;

-- 2. Consolidar de forma segura datos preexistentes en clients y appointments
do $$
declare
  r record;
  v_canonical_id uuid;
begin
  -- 2.1 Consolidar duplicados por teléfono normalizado
  for r in
    select regexp_replace(phone, '[^0-9]', '', 'g') as norm_p, array_agg(id order by created_at asc) as client_ids
    from public.clients
    where length(regexp_replace(phone, '[^0-9]', '', 'g')) >= 8
    group by regexp_replace(phone, '[^0-9]', '', 'g')
    having count(*) > 1
  loop
    v_canonical_id := r.client_ids[1];
    -- Re-asociar turnos existentes al cliente canónico preservando turnos, estados e importes
    update public.appointments
    set client_id = v_canonical_id
    where client_id = any(r.client_ids[2:]);

    begin
      update public.recurring_appointment_rules
      set client_id = v_canonical_id
      where client_id = any(r.client_ids[2:]);
    exception when undefined_table then
      null;
    end;

    -- Eliminar registros redundantes que hayan quedado sin turnos asociados
    delete from public.clients
    where id = any(r.client_ids[2:])
      and not exists (select 1 from public.appointments where client_id = clients.id);
  end loop;

  -- 2.2 Consolidar duplicados por correo normalizado
  for r in
    select lower(trim(email)) as norm_e, array_agg(id order by created_at asc) as client_ids
    from public.clients
    where email is not null and email <> '' and email not like '%@kanibarber.internal' and position('@' in email) > 1
    group by lower(trim(email))
    having count(*) > 1
  loop
    v_canonical_id := r.client_ids[1];
    update public.appointments
    set client_id = v_canonical_id
    where client_id = any(r.client_ids[2:]);

    begin
      update public.recurring_appointment_rules
      set client_id = v_canonical_id
      where client_id = any(r.client_ids[2:]);
    exception when undefined_table then
      null;
    end;

    delete from public.clients
    where id = any(r.client_ids[2:])
      and not exists (select 1 from public.appointments where client_id = clients.id);
  end loop;
end;
$$;


-- Migration: 20261018000600_kani_manual_appointment_deposit_option.sql
-- KANI Barber Studio — Soporte de opción «Abona seña» (Sí / No) en turnos manuales

drop function if exists public.create_manual_appointment(uuid, uuid, date, time, text, text, text, text, boolean, integer);
drop function if exists public.create_manual_appointment(uuid, uuid, date, time, text, text, text, text, boolean, integer, boolean);

create or replace function public.create_manual_appointment(
  p_barber_id uuid,
  p_service_id uuid,
  p_booking_date date,
  p_start_time time,
  p_client_name text,
  p_client_phone text,
  p_client_email text,
  p_notes text default null,
  p_is_recurring boolean default false,
  p_duration_minutes integer default null,
  p_deposit_required boolean default false
)
returns table (
  appointment_id uuid,
  appointment_status public.appointment_status,
  booking_date date,
  start_time time,
  end_time time,
  request_number bigint,
  is_manual boolean,
  origin text,
  created_by_display_name text,
  recurring_rule_id uuid,
  deposit_required boolean,
  deposit_paid boolean
)
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  v_staff_barber_id uuid;
  v_is_admin boolean;
  v_creator_user_id uuid := auth.uid();
  v_creator_name text;
  v_barber public.barbers%rowtype;
  v_service public.services%rowtype;
  v_duration_min integer;
  v_duration interval;
  v_end_time time;
  v_start_ts timestamp;
  v_end_ts timestamp;
  v_client_id uuid;
  v_apt_id uuid;
  v_rule_id uuid := null;
  v_req_num bigint;
  v_day_of_week integer;
begin
  if v_creator_user_id is null then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;

  v_is_admin := public.is_admin();
  v_staff_barber_id := public.current_staff_barber_id();

  -- Validar permisos de barbero: si no es admin, solo puede agendar para su propio id
  if not v_is_admin and (v_staff_barber_id is null or v_staff_barber_id is distinct from p_barber_id) then
    raise exception using errcode = '42501', message = 'MANUAL_APPOINTMENT_NOT_ALLOWED';
  end if;

  -- Determinar nombre para auditoría "Turno generado por"
  if v_is_admin then
    v_creator_name := 'Admin';
  else
    select b.name into v_creator_name
    from public.barbers b
    where b.id = v_staff_barber_id;
    if v_creator_name is null then
      v_creator_name := 'Barbero';
    end if;
  end if;

  -- Validaciones de entrada
  if p_barber_id is null then
    raise exception using errcode = '22023', message = 'BARBER_REQUIRED';
  end if;
  if p_service_id is null then
    raise exception using errcode = '22023', message = 'SERVICE_REQUIRED';
  end if;
  if p_booking_date is null then
    raise exception using errcode = '22023', message = 'DATE_REQUIRED';
  end if;
  if p_start_time is null then
    raise exception using errcode = '22023', message = 'START_TIME_REQUIRED';
  end if;
  if p_client_name is null or length(trim(p_client_name)) < 3 then
    raise exception using errcode = '22023', message = 'CLIENT_NAME_INVALID';
  end if;
  if p_client_phone is null or length(trim(p_client_phone)) < 6 then
    raise exception using errcode = '22023', message = 'CLIENT_PHONE_INVALID';
  end if;
  if p_client_email is null or trim(p_client_email) = '' or position('@' in trim(p_client_email)) <= 1 then
    raise exception using errcode = '22023', message = 'CLIENT_EMAIL_REQUIRED';
  end if;

  -- Obtener barbero activo
  select * into v_barber
  from public.barbers b
  where b.id = p_barber_id and b.active = true;
  if not found then
    raise exception using errcode = '22023', message = 'BARBER_NOT_FOUND';
  end if;

  -- Obtener servicio activo
  select * into v_service
  from public.services s
  where s.id = p_service_id and s.active = true;
  if not found then
    raise exception using errcode = '22023', message = 'SERVICE_NOT_FOUND';
  end if;

  -- Calcular duración y horario de fin
  v_duration_min := coalesce(p_duration_minutes, v_service.duration_minutes, 30);
  v_duration := (v_duration_min || ' minutes')::interval;
  v_end_time := (p_start_time + v_duration)::time;
  v_start_ts := (p_booking_date + p_start_time)::timestamp;
  v_end_ts := (p_booking_date + v_end_time)::timestamp;

  -- Bloqueo consultivo por barbero y fecha para evitar condiciones de carrera
  perform pg_advisory_xact_lock(hashtextextended(p_barber_id::text || '|' || p_booking_date::text, 0));

  -- Validar que no se superponga con otro turno activo del mismo barbero
  if exists (
    select 1
    from public.appointments a
    where a.barber_id = v_barber.id
      and a.booking_date = p_booking_date
      and a.status <> 'CANCELLED'
      and (a.booking_date + a.start_time)::timestamp < v_end_ts
      and (a.booking_date + a.end_time)::timestamp > v_start_ts
  ) then
    raise exception using errcode = '23P01', message = 'SLOT_ALREADY_BOOKED';
  end if;

  -- Resolver o consolidar cliente
  begin
    v_client_id := public.find_or_create_consolidated_client(
      p_client_name,
      p_client_phone,
      p_client_email
    );
  exception when undefined_function then
    select c.id into v_client_id
    from public.clients c
    where lower(trim(c.email)) = lower(trim(coalesce(p_client_email, '')))
       or regexp_replace(c.phone, '[^0-9+]', '', 'g') = regexp_replace(trim(p_client_phone), '[^0-9+]', '', 'g')
    order by c.created_at asc
    limit 1;

    if v_client_id is null then
      insert into public.clients (name, phone, email)
      values (
        trim(p_client_name),
        trim(p_client_phone),
        lower(trim(coalesce(p_client_email, 'sin-email@kanibarber.internal')))
      )
      returning id into v_client_id;
    else
      update public.clients
      set name = trim(p_client_name),
          phone = trim(p_client_phone),
          email = coalesce(nullif(lower(trim(p_client_email)), ''), email),
          updated_at = now()
      where id = v_client_id;
    end if;
  end;

  -- Asegurar disponibilidad en barber_availability_slots para cubrir el intervalo
  if not exists (
    select 1
    from public.barber_availability_slots s
    where s.barber_id = v_barber.id
      and s.slot_date = p_booking_date
      and s.status = 'AVAILABLE'
      and s.start_time <= p_start_time
      and s.end_time >= v_end_time
  ) then
    insert into public.barber_availability_slots (
      barber_id, slot_date, start_time, end_time, status, internal_note
    ) values (
      v_barber.id,
      p_booking_date,
      p_start_time,
      v_end_time,
      'AVAILABLE',
      'Habilitado automáticamente por turno manual'
    )
    on conflict (barber_id, slot_date, start_time)
    do update set status = 'AVAILABLE', end_time = greatest(barber_availability_slots.end_time, v_end_time);
  end if;

  -- Si es recurrente, crear regla de recurrencia
  if p_is_recurring then
    v_day_of_week := extract(isodow from p_booking_date)::integer;
    insert into public.recurring_appointment_rules (
      client_id,
      barber_id,
      service_id,
      day_of_week,
      start_time,
      duration_minutes,
      start_date,
      active,
      created_by_user_id,
      created_by_display_name,
      notes
    ) values (
      v_client_id,
      v_barber.id,
      v_service.id,
      v_day_of_week,
      p_start_time,
      v_duration_min,
      p_booking_date,
      true,
      v_creator_user_id,
      v_creator_name,
      nullif(trim(coalesce(p_notes, '')), '')
    )
    returning id into v_rule_id;
  end if;

  -- Insertar el turno manual (confirmado, con opción de seña)
  insert into public.appointments (
    client_id,
    barber_id,
    service_id,
    booking_date,
    start_time,
    end_time,
    status,
    notes,
    is_manual,
    origin,
    created_by_user_id,
    created_by_display_name,
    recurring_rule_id,
    deposit_required,
    deposit_paid
  ) values (
    v_client_id,
    v_barber.id,
    v_service.id,
    p_booking_date,
    p_start_time,
    v_end_time,
    'CONFIRMED',
    nullif(trim(coalesce(p_notes, '')), ''),
    true,
    'MANUAL',
    v_creator_user_id,
    v_creator_name,
    v_rule_id,
    coalesce(p_deposit_required, false),
    false
  )
  returning id, status, booking_date, start_time, end_time, request_number
  into v_apt_id, appointment_status, booking_date, start_time, end_time, v_req_num;

  -- Si es recurrente, sincronizar las siguientes 4 semanas
  if p_is_recurring then
    perform public.sync_recurring_appointment_rules(28);
  end if;

  return query select
    v_apt_id,
    appointment_status,
    booking_date,
    start_time,
    end_time,
    v_req_num,
    true,
    'MANUAL'::text,
    v_creator_name,
    v_rule_id,
    coalesce(p_deposit_required, false),
    false::boolean;
end;
$$;

revoke all on function public.create_manual_appointment(uuid, uuid, date, time, text, text, text, text, boolean, integer, boolean) from public;
grant execute on function public.create_manual_appointment(uuid, uuid, date, time, text, text, text, text, boolean, integer, boolean) to authenticated;


-- ==============================================================================
-- FILE: supabase/migrations/20261020000100_kani_unify_deposit_to_5000.sql
-- ==============================================================================

-- KANI Barber Studio — Unificación del importe de la seña a $5.000 para todos los servicios (nuevas y anteriores)

alter table public.barber_transfer_details
  alter column down_payment_ars set default 5000;

update public.barber_transfer_details
set down_payment_ars = 5000
where down_payment_ars is distinct from 5000;

create or replace function public.read_public_deposit_amount(p_barber_name text default null)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, extensions
as $$
declare
  v_deposit integer;
begin
  if p_barber_name is not null and length(trim(p_barber_name)) > 0 then
    select td.down_payment_ars into v_deposit
    from public.barbers b
    join public.barber_transfer_details td on td.barber_id = b.id and td.active = true
    where b.name = trim(p_barber_name)
    limit 1;
  end if;

  if v_deposit is null then
    select td.down_payment_ars into v_deposit
    from public.barber_transfer_details td
    where td.active = true
    order by td.updated_at desc
    limit 1;
  end if;

  return coalesce(v_deposit, 5000);
end;
$$;

revoke all on function public.read_public_deposit_amount(text) from public;
grant execute on function public.read_public_deposit_amount(text) to anon, authenticated;

create or replace function public.get_appointment_payment_details(p_appointment_id uuid)
returns table (
  appointment_id uuid,
  appointment_status public.appointment_status,
  booking_date date,
  start_time time,
  end_time time,
  barber_id uuid,
  barber_name text,
  service_id uuid,
  service_name text,
  service_price_ars integer,
  down_payment_ars integer,
  client_name text,
  client_email text,
  client_phone text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, extensions
as $$
begin
  return query
  select
    a.id as appointment_id,
    a.status as appointment_status,
    a.booking_date,
    a.start_time,
    a.end_time,
    b.id as barber_id,
    b.name as barber_name,
    s.id as service_id,
    s.name as service_name,
    s.price_ars as service_price_ars,
    coalesce(a.deposit_amount_ars, td.down_payment_ars, 5000) as down_payment_ars,
    c.name as client_name,
    c.email as client_email,
    c.phone as client_phone,
    a.created_at
  from public.appointments a
  join public.barbers b on b.id = a.barber_id
  join public.services s on s.id = a.service_id
  join public.clients c on c.id = a.client_id
  left join public.barber_transfer_details td on td.barber_id = a.barber_id and td.active = true
  where a.id = p_appointment_id;
end;
$$;

revoke all on function public.get_appointment_payment_details(uuid) from public;
grant execute on function public.get_appointment_payment_details(uuid) to anon, authenticated;

create or replace function public.record_no_show_exception(
  p_appointment_id uuid,
  p_decision text,
  p_reason text,
  p_refund_amount_ars integer default null
)
returns table (
  appointment_id uuid,
  decision text,
  deposit_amount_ars integer,
  refund_amount_ars integer,
  reason text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  v_apt public.appointments%rowtype;
  v_staff_barber_id uuid;
  v_is_admin boolean;
  v_user_display text;
  v_deposit_amount integer := 0;
  v_refund_amount integer := 0;
  v_exception_id uuid;
begin
  if p_decision not in ('RETAIN', 'WAIVE', 'REFUND') then
    raise exception 'INVALID_NO_SHOW_DECISION';
  end if;

  if p_reason is null or length(trim(p_reason)) < 3 then
    raise exception 'REASON_REQUIRED';
  end if;

  v_is_admin := public.is_admin();
  v_staff_barber_id := public.current_staff_barber_id();

  select * into v_apt
  from public.appointments
  where id = p_appointment_id
  for update;

  if not found then
    raise exception 'APPOINTMENT_NOT_FOUND';
  end if;

  if not v_is_admin and (v_staff_barber_id is null or v_staff_barber_id is distinct from v_apt.barber_id) then
    raise exception 'FORBIDDEN';
  end if;

  if v_apt.status <> 'NO_SHOW' then
    raise exception 'APPOINTMENT_NOT_IN_NO_SHOW_STATUS';
  end if;

  if v_is_admin then
    v_user_display := 'Admin';
  else
    select b.name into v_user_display
    from public.barbers b
    where b.id = v_staff_barber_id;
    if v_user_display is null then
      v_user_display := 'Barbero';
    end if;
  end if;

  if coalesce(v_apt.deposit_paid, false) then
    if v_apt.deposit_amount_ars is not null and v_apt.deposit_amount_ars > 0 then
      v_deposit_amount := v_apt.deposit_amount_ars;
    else
      select coalesce(td.down_payment_ars, 5000) into v_deposit_amount
      from public.barber_transfer_details td
      where td.barber_id = v_apt.barber_id and td.active = true
      limit 1;
      if v_deposit_amount is null then
        v_deposit_amount := 5000;
      end if;
    end if;
  else
    v_deposit_amount := 0;
  end if;

  if p_decision = 'REFUND' then
    if not coalesce(v_apt.deposit_paid, false) or v_deposit_amount <= 0 then
      raise exception 'CANNOT_REFUND_UNPAID_DEPOSIT';
    end if;
    v_refund_amount := coalesce(p_refund_amount_ars, v_deposit_amount);
    if v_refund_amount <= 0 or v_refund_amount > v_deposit_amount then
      v_refund_amount := v_deposit_amount;
    end if;
  else
    v_refund_amount := 0;
  end if;

  if exists (
    select 1 from public.appointment_no_show_exceptions e
    where e.appointment_id = p_appointment_id
  ) then
    raise exception 'EXCEPTION_ALREADY_RECORDED';
  end if;

  insert into public.appointment_no_show_exceptions (
    appointment_id,
    decision,
    deposit_amount_ars,
    refund_amount_ars,
    reason,
    created_by_user_id,
    created_by_display_name
  ) values (
    p_appointment_id,
    p_decision,
    v_deposit_amount,
    v_refund_amount,
    trim(p_reason),
    auth.uid(),
    v_user_display
  )
  returning id into v_exception_id;

  update public.appointments
  set
    no_show_decision = p_decision,
    no_show_refund_amount_ars = v_refund_amount,
    deposit_amount_ars = case when coalesce(deposit_paid, false) and (deposit_amount_ars is null or deposit_amount_ars = 0) then v_deposit_amount else deposit_amount_ars end,
    updated_at = now()
  where id = p_appointment_id;

  return query select
    p_appointment_id,
    p_decision,
    v_deposit_amount,
    v_refund_amount,
    trim(p_reason),
    now();
end;
$$;

revoke all on function public.record_no_show_exception(uuid, text, text, integer) from public;
grant execute on function public.record_no_show_exception(uuid, text, text, integer) to authenticated;


-- ==============================================================================
-- Migration: 20261020000200_kani_fix_notifications_schema_cache.sql
-- KANI Barber Studio — Garantizar existencia de tabla admin_activity_user_state, permisos RLS, RPCs y recarga de schema cache en Supabase
-- ==============================================================================
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

revoke all on table public.admin_activity_notifications from anon, public;
grant select, update, delete on table public.admin_activity_notifications to authenticated;

alter table public.admin_activity_notifications enable row level security;

drop policy if exists admin_can_delete_activity_notifications on public.admin_activity_notifications;
create policy admin_can_delete_activity_notifications
  on public.admin_activity_notifications
  for delete to authenticated
  using (public.is_admin());

drop policy if exists admin_can_update_activity_notifications on public.admin_activity_notifications;
create policy admin_can_update_activity_notifications
  on public.admin_activity_notifications
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

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
  v_is_admin boolean := public.is_admin();
  v_barber_id uuid := public.current_staff_barber_id();
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

  insert into public.admin_activity_user_state (notification_id, user_id, read_at, updated_at)
  values (p_notification_id, v_uid, p_read_at, now())
  on conflict (notification_id, user_id)
  do update set
    read_at = p_read_at,
    updated_at = now();

  if v_is_admin then
    update public.admin_activity_notifications
    set read_at = p_read_at
    where id = p_notification_id;
  end if;
end;
$$;

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

  if v_is_admin then
    update public.admin_activity_notifications
    set read_at = v_now
    where read_at is null;
  end if;
end;
$$;

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
  set
    read_at = null,
    updated_at = now()
  where user_id = v_uid
    and read_at is not null;
end;
$$;

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

revoke all on function public.read_staff_activity_notifications() from public, anon;
revoke all on function public.set_staff_activity_notification_read(uuid, timestamptz) from public, anon;
revoke all on function public.mark_all_staff_activity_notifications_read() from public, anon;
revoke all on function public.mark_all_staff_activity_notifications_unread() from public, anon;
revoke all on function public.delete_staff_activity_notification_global(uuid) from public, anon;
revoke all on function public.delete_all_staff_activity_notifications_global() from public, anon;
revoke all on function public.dismiss_staff_activity_notification_personal(uuid) from public, anon;
revoke all on function public.dismiss_all_staff_activity_notifications_personal() from public, anon;

grant execute on function public.read_staff_activity_notifications() to authenticated;
grant execute on function public.set_staff_activity_notification_read(uuid, timestamptz) to authenticated;
grant execute on function public.mark_all_staff_activity_notifications_read() to authenticated;
grant execute on function public.mark_all_staff_activity_notifications_unread() to authenticated;
grant execute on function public.delete_staff_activity_notification_global(uuid) to authenticated;
grant execute on function public.delete_all_staff_activity_notifications_global() to authenticated;
grant execute on function public.dismiss_staff_activity_notification_personal(uuid) to authenticated;
grant execute on function public.dismiss_all_staff_activity_notifications_personal() to authenticated;

notify pgrst, 'reload schema';
-- Migration: 20261020000300_kani_service_payments.sql
-- KANI Barber Studio — Nueva sección «Pagos»: Registro de servicios y control de cobros

-- ==============================================================================
-- 1. Tabla service_payments
-- ==============================================================================
create table if not exists public.service_payments (
  id uuid primary key default gen_random_uuid(),
  barber_id uuid not null references public.barbers(id) on delete restrict,
  service_id uuid references public.services(id) on delete set null,
  service_name text not null check (service_name in ('Corte', 'Corte y barba', 'Corte + barba', 'Barba', 'Otros')),
  service_other_detail text,
  service_price_ars integer not null check (service_price_ars > 0),
  discount_ars integer not null default 0 check (discount_ars >= 0 and discount_ars <= service_price_ars),
  final_amount_ars integer not null check (final_amount_ars = service_price_ars - discount_ars),
  payment_date date not null default (timezone('America/Argentina/Buenos_Aires', clock_timestamp()))::date,
  payment_time time not null default (timezone('America/Argentina/Buenos_Aires', clock_timestamp()))::time,
  payment_method text not null check (payment_method in ('Efectivo', 'Transferencia')),
  online_deposit_paid boolean not null default false,
  online_deposit_amount_ars integer not null default 0 check (online_deposit_amount_ars >= 0),
  collected_amount_ars integer not null check (collected_amount_ars >= 0),
  client_name text,
  client_contact text,
  appointment_id uuid unique references public.appointments(id) on delete set null,
  created_by_user_id uuid references auth.users(id) on delete set null,
  created_by_display_name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint service_other_requires_detail check (
    service_name <> 'Otros' or (service_other_detail is not null and length(trim(service_other_detail)) > 0)
  )
);

create index if not exists idx_service_payments_date on public.service_payments (payment_date desc, payment_time desc);
create index if not exists idx_service_payments_barber on public.service_payments (barber_id, payment_date desc);
create index if not exists idx_service_payments_appointment on public.service_payments (appointment_id);

-- ==============================================================================
-- 2. Privilegios y Políticas RLS
-- ==============================================================================
alter table public.service_payments enable row level security;
revoke all on table public.service_payments from anon, public;
grant select, insert, update on table public.service_payments to authenticated;

drop policy if exists service_payments_select on public.service_payments;
create policy service_payments_select
  on public.service_payments
  for select to authenticated
  using (
    public.is_admin()
    or barber_id = public.current_staff_barber_id()
  );

drop policy if exists service_payments_insert on public.service_payments;
create policy service_payments_insert
  on public.service_payments
  for insert to authenticated
  with check (
    public.is_admin()
    or (
      barber_id = public.current_staff_barber_id()
      and (created_by_user_id is null or created_by_user_id = auth.uid())
    )
  );

drop policy if exists service_payments_update on public.service_payments;
create policy service_payments_update
  on public.service_payments
  for update to authenticated
  using (
    public.is_admin()
    or barber_id = public.current_staff_barber_id()
  );

-- ==============================================================================
-- 3. Función RPC transaccional: record_service_payment
-- ==============================================================================
create or replace function public.record_service_payment(
  p_barber_id uuid,
  p_service_name text,
  p_service_other_detail text default null,
  p_service_price_ars integer default null,
  p_discount_ars integer default 0,
  p_payment_date date default null,
  p_payment_time time default null,
  p_payment_method text default 'Efectivo',
  p_online_deposit_paid boolean default false,
  p_client_name text default null,
  p_client_contact text default null,
  p_appointment_id uuid default null
)
returns table (
  payment_id uuid,
  barber_id uuid,
  service_name text,
  final_amount_ars integer,
  collected_amount_ars integer,
  payment_date date,
  payment_time time,
  appointment_id uuid
)
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  v_uid uuid := auth.uid();
  v_is_admin boolean := public.is_admin();
  v_staff_barber_id uuid := public.current_staff_barber_id();
  v_creator_name text;
  v_service_id uuid := null;
  v_service_price integer;
  v_discount integer := coalesce(p_discount_ars, 0);
  v_final_amount integer;
  v_date date;
  v_time time;
  v_online_deposit_paid boolean := false;
  v_online_deposit_amount integer := 0;
  v_collected_amount integer;
  v_apt record;
  v_new_id uuid;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if not v_is_admin and (v_staff_barber_id is null or v_staff_barber_id is distinct from p_barber_id) then
    raise exception 'FORBIDDEN_BARBER_SCOPE';
  end if;

  if v_is_admin then
    v_creator_name := 'Admin';
  else
    select name into v_creator_name from public.barbers where id = v_staff_barber_id;
    v_creator_name := coalesce(v_creator_name, 'Barbero');
  end if;

  -- Validar precio y servicio
  if p_service_name in ('Corte', 'Corte y barba', 'Corte + barba', 'Barba') then
    select id, price_ars into v_service_id, v_service_price
    from public.services
    where name = p_service_name or (p_service_name = 'Corte y barba' and name = 'Corte + barba')
    limit 1;

    v_service_price := coalesce(p_service_price_ars, v_service_price, 25000);
  elsif p_service_name = 'Otros' then
    if p_service_other_detail is null or length(trim(p_service_other_detail)) = 0 then
      raise exception 'OTHER_SERVICE_DETAIL_REQUIRED';
    end if;
    if p_service_price_ars is null or p_service_price_ars <= 0 then
      raise exception 'OTHER_SERVICE_PRICE_REQUIRED';
    end if;
    v_service_price := p_service_price_ars;
  else
    raise exception 'INVALID_SERVICE_NAME';
  end if;

  -- Validar descuento
  if v_discount < 0 or v_discount > v_service_price then
    raise exception 'INVALID_DISCOUNT_AMOUNT';
  end if;
  v_final_amount := v_service_price - v_discount;

  -- Validar método de pago
  if p_payment_method not in ('Efectivo', 'Transferencia') then
    raise exception 'INVALID_PAYMENT_METHOD';
  end if;

  -- Resolver fecha y hora
  v_date := coalesce(p_payment_date, (timezone('America/Argentina/Buenos_Aires', clock_timestamp()))::date);
  v_time := coalesce(p_payment_time, (timezone('America/Argentina/Buenos_Aires', clock_timestamp()))::time);

  -- Validar vinculación a turno si existe
  if p_appointment_id is not null then
    select * into v_apt
    from public.appointments
    where id = p_appointment_id
    for update;

    if not found then
      raise exception 'APPOINTMENT_NOT_FOUND';
    end if;

    if not v_is_admin and v_apt.barber_id <> v_staff_barber_id then
      raise exception 'FORBIDDEN_APPOINTMENT_SCOPE';
    end if;

    if exists (select 1 from public.service_payments sp where sp.appointment_id = p_appointment_id) then
      raise exception 'APPOINTMENT_ALREADY_LINKED';
    end if;

    -- Validar seña online
    if coalesce(v_apt.deposit_paid, false) = true then
      v_online_deposit_paid := true;
      v_online_deposit_amount := coalesce(v_apt.deposit_amount_ars, 5000);
    else
      if p_online_deposit_paid = true then
        raise exception 'INVALID_ONLINE_DEPOSIT_CLAIM';
      end if;
      v_online_deposit_paid := false;
      v_online_deposit_amount := 0;
    end if;

    -- Calcular saldo restante a cobrar en el local
    v_collected_amount := greatest(0, v_final_amount - (case when v_online_deposit_paid then v_online_deposit_amount else 0 end));

    -- Actualizar el turno para marcarlo con balance cobrado y ejecutado
    update public.appointments
    set
      balance_paid = true,
      status = case when status in ('PENDING', 'CONFIRMED') then 'COMPLETED'::public.appointment_status else status end,
      updated_at = now()
    where id = p_appointment_id;
  else
    -- Sin turno asociado: no puede reclamar seña online no validada
    if p_online_deposit_paid = true then
      raise exception 'INVALID_ONLINE_DEPOSIT_WITHOUT_APPOINTMENT';
    end if;
    v_online_deposit_paid := false;
    v_online_deposit_amount := 0;
    v_collected_amount := v_final_amount;
  end if;

  -- Insertar el registro de servicio y cobro
  insert into public.service_payments (
    barber_id,
    service_id,
    service_name,
    service_other_detail,
    service_price_ars,
    discount_ars,
    final_amount_ars,
    payment_date,
    payment_time,
    payment_method,
    online_deposit_paid,
    online_deposit_amount_ars,
    collected_amount_ars,
    client_name,
    client_contact,
    appointment_id,
    created_by_user_id,
    created_by_display_name
  ) values (
    p_barber_id,
    v_service_id,
    p_service_name,
    nullif(trim(p_service_other_detail), ''),
    v_service_price,
    v_discount,
    v_final_amount,
    v_date,
    v_time,
    p_payment_method,
    v_online_deposit_paid,
    v_online_deposit_amount,
    v_collected_amount,
    nullif(trim(p_client_name), ''),
    nullif(trim(p_client_contact), ''),
    p_appointment_id,
    v_uid,
    v_creator_name
  )
  returning id into v_new_id;

  return query select
    v_new_id,
    p_barber_id,
    p_service_name,
    v_final_amount,
    v_collected_amount,
    v_date,
    v_time,
    p_appointment_id;
end;
$$;

revoke all on function public.record_service_payment(uuid, text, text, integer, integer, date, time, text, boolean, text, text, uuid) from public, anon;
grant execute on function public.record_service_payment(uuid, text, text, integer, integer, date, time, text, boolean, text, text, uuid) to authenticated;

-- ==============================================================================
-- 4. Notificar a PostgREST para recargar el schema cache
-- ==============================================================================
notify pgrst, 'reload schema';
