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

    while v_curr_date <= v_horizon_end loop
      if v_rule.end_date is not null and v_curr_date > v_rule.end_date then
        exit;
      end if;

      -- Verificar si el día de la semana coincide (1: Lun .. 7: Dom)
      if extract(isodow from v_curr_date)::integer = v_rule.day_of_week then
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
          v_curr_date := v_curr_date + 7;
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
          v_curr_date := v_curr_date + 7;
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
