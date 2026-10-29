-- Migration: 20261029000100_kani_admin_v2_structural_fixes.sql
-- KANI Barber Studio — Corrección estructural del panel de administración
-- 1. Clientes: RLS completa para staff y RPC save_client
-- 2. Turnos Manuales: Duraciones flexibles, soporte de medianoche, anti-solapamiento con detalle exacto
-- 3. Pagos: Columnas de borrado lógico, trazabilidad, RPC soft_delete y RPC update_service_payment_client
-- 4. Horarios: Mensajes detallados de conflicto con reservas existentes

-- ==============================================================================
-- 1. CLIENTES: Persistencia y Políticas RLS
-- ==============================================================================

-- Permitir a todo el staff activo (Admin o Barbero) leer y gestionar clientes
drop policy if exists staff_can_read_clients on public.clients;
create policy staff_can_read_clients
  on public.clients
  for select
  to authenticated
  using (
    public.is_admin()
    or public.current_staff_barber_id() is not null
  );

drop policy if exists admin_can_manage_clients on public.clients;
drop policy if exists staff_can_manage_clients on public.clients;
create policy staff_can_manage_clients
  on public.clients
  for all
  to authenticated
  using (
    public.is_admin()
    or public.current_staff_barber_id() is not null
  )
  with check (
    public.is_admin()
    or public.current_staff_barber_id() is not null
  );

-- RPC seguro para guardar o editar clientes con consolidación
create or replace function public.save_client(
  p_id uuid default null,
  p_name text default null,
  p_phone text default null,
  p_email text default null
)
returns public.clients
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  v_uid uuid := auth.uid();
  v_is_admin boolean := public.is_admin();
  v_staff_barber_id uuid := public.current_staff_barber_id();
  v_clean_name text := trim(coalesce(p_name, ''));
  v_clean_phone text := trim(coalesce(p_phone, ''));
  v_phone_digits text := regexp_replace(v_clean_phone, '[^0-9]', '', 'g');
  v_clean_email text := nullif(lower(trim(coalesce(p_email, ''))), '');
  v_client public.clients%rowtype;
  v_existing_id uuid;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;

  if not v_is_admin and v_staff_barber_id is null then
    raise exception using errcode = '42501', message = 'FORBIDDEN_STAFF_REQUIRED';
  end if;

  if length(v_clean_name) < 2 then
    raise exception using errcode = '22023', message = 'CLIENT_NAME_INVALID';
  end if;

  if length(v_phone_digits) < 6 then
    raise exception using errcode = '22023', message = 'CLIENT_PHONE_INVALID';
  end if;

  if v_clean_email is not null and (position('@' in v_clean_email) <= 1 or v_clean_email like '%@kanibarber.internal') then
    v_clean_email := null;
  end if;

  if p_id is not null then
    -- Actualización de cliente existente
    select * into v_client from public.clients where id = p_id;
    if not found then
      raise exception using errcode = 'P0002', message = 'CLIENT_NOT_FOUND';
    end if;

    update public.clients
    set name = v_clean_name,
        phone = v_clean_phone,
        email = v_clean_email,
        updated_at = now()
    where id = p_id
    returning * into v_client;

    return v_client;
  else
    -- Alta con detección de duplicados por teléfono o email
    select id into v_existing_id
    from public.clients c
    where regexp_replace(c.phone, '[^0-9]', '', 'g') = v_phone_digits
       or (v_clean_email is not null and lower(trim(coalesce(c.email, ''))) = v_clean_email)
    order by c.created_at asc
    limit 1;

    if v_existing_id is not null then
      update public.clients
      set name = v_clean_name,
          phone = v_clean_phone,
          email = coalesce(v_clean_email, email),
          updated_at = now()
      where id = v_existing_id
      returning * into v_client;

      return v_client;
    end if;

    insert into public.clients (name, phone, email, created_at, updated_at)
    values (v_clean_name, v_clean_phone, v_clean_email, now(), now())
    returning * into v_client;

    return v_client;
  end if;
end;
$$;

revoke all on function public.save_client(uuid, text, text, text) from public, anon;
grant execute on function public.save_client(uuid, text, text, text) to authenticated;

-- ==============================================================================
-- 2. TURNOS MANUALES: Flexibilidad horaria, medianoche y anti-solapamiento exacto
-- ==============================================================================

drop function if exists public.create_manual_appointment(uuid, uuid, text, integer, date, time, time, text, text, text, text, boolean, integer, boolean);
drop function if exists public.create_manual_appointment(uuid, uuid, text, integer, date, time, time, text, text, text, text, boolean, integer, boolean, uuid);

create or replace function public.create_manual_appointment(
  p_barber_id uuid,
  p_service_id uuid default null,
  p_custom_service_name text default null,
  p_service_price_ars integer default null,
  p_booking_date date default null,
  p_start_time time default null,
  p_end_time time default null,
  p_client_name text default null,
  p_client_phone text default null,
  p_client_email text default null,
  p_notes text default null,
  p_is_recurring boolean default false,
  p_duration_minutes integer default null,
  p_deposit_required boolean default false,
  p_client_id uuid default null
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
  custom_service_name text,
  service_price_ars integer
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
  v_req_num bigint;
  v_clean_email text;
  v_clean_phone text;
  v_final_service_name text;
  v_final_price integer;
  v_conflict_start time;
  v_conflict_end time;
begin
  if v_creator_user_id is null then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;

  v_is_admin := public.is_admin();
  v_staff_barber_id := public.current_staff_barber_id();

  -- Permisos de barbero: BARBER solo para sí mismo
  if not v_is_admin and (v_staff_barber_id is null or v_staff_barber_id is distinct from p_barber_id) then
    raise exception using errcode = '42501', message = 'MANUAL_APPOINTMENT_NOT_ALLOWED';
  end if;

  if v_is_admin then
    v_creator_name := 'Admin';
  else
    select b.name into v_creator_name from public.barbers b where b.id = v_staff_barber_id;
    v_creator_name := coalesce(v_creator_name, 'Barbero');
  end if;

  -- Validaciones básicas
  if p_barber_id is null then raise exception using errcode = '22023', message = 'BARBER_REQUIRED'; end if;
  if p_booking_date is null then raise exception using errcode = '22023', message = 'DATE_REQUIRED'; end if;
  if p_start_time is null then raise exception using errcode = '22023', message = 'START_TIME_REQUIRED'; end if;
  if p_client_name is null or length(trim(p_client_name)) < 2 then raise exception using errcode = '22023', message = 'CLIENT_NAME_INVALID'; end if;

  v_clean_phone := trim(coalesce(p_client_phone, ''));
  if length(regexp_replace(v_clean_phone, '[^0-9]', '', 'g')) < 6 then raise exception using errcode = '22023', message = 'CLIENT_PHONE_INVALID'; end if;

  v_clean_email := nullif(lower(trim(coalesce(p_client_email, ''))), '');
  if v_clean_email is not null and (position('@' in v_clean_email) <= 1 or v_clean_email like '%@kanibarber.internal') then
    v_clean_email := null;
  end if;

  -- Validar barbero activo
  select * into v_barber from public.barbers b where b.id = p_barber_id and b.active = true;
  if not found then raise exception using errcode = '22023', message = 'BARBER_NOT_FOUND'; end if;

  -- Resolver Servicio
  if p_service_id is not null then
    select * into v_service from public.services s where s.id = p_service_id and s.active = true;
    if not found then raise exception using errcode = '22023', message = 'SERVICE_NOT_FOUND'; end if;
    v_duration_min := coalesce(p_duration_minutes, v_service.duration_minutes, 45);
    v_duration := (v_duration_min || ' minutes')::interval;
    v_end_time := coalesce(p_end_time, (p_start_time + v_duration)::time);
    v_final_service_name := v_service.name;
    v_final_price := coalesce(p_service_price_ars, v_service.price_ars, 25000);
  else
    v_final_service_name := trim(coalesce(p_custom_service_name, ''));
    if length(v_final_service_name) < 2 then
      raise exception using errcode = '22023', message = 'CUSTOM_SERVICE_NAME_REQUIRED';
    end if;
    if p_service_price_ars is null or p_service_price_ars < 0 then
      raise exception using errcode = '22023', message = 'CUSTOM_SERVICE_PRICE_REQUIRED';
    end if;
    v_final_price := p_service_price_ars;

    if p_end_time is not null then
      v_end_time := p_end_time;
    elsif p_duration_minutes is not null and p_duration_minutes > 0 then
      v_duration_min := p_duration_minutes;
      v_duration := (v_duration_min || ' minutes')::interval;
      v_end_time := (p_start_time + v_duration)::time;
    else
      raise exception using errcode = '22023', message = 'END_TIME_REQUIRED';
    end if;
  end if;

  -- Calcular timestamps de inicio y fin con soporte de cruce de medianoche
  v_start_ts := (p_booking_date + p_start_time)::timestamp;
  if v_end_time <= p_start_time then
    v_end_ts := (p_booking_date + interval '1 day' + v_end_time)::timestamp;
  else
    v_end_ts := (p_booking_date + v_end_time)::timestamp;
  end if;

  -- Bloqueo consultivo por barbero y fecha para evitar condiciones de carrera
  perform pg_advisory_xact_lock(hashtextextended(p_barber_id::text || '|' || p_booking_date::text, 0));

  -- Validar anti-solapamiento estricto por intervalo con reporte exacto
  select a.start_time, a.end_time into v_conflict_start, v_conflict_end
  from public.appointments a
  where a.barber_id = v_barber.id
    and a.status <> 'CANCELLED'
    and a.booking_date between (p_booking_date - interval '1 day')::date and (p_booking_date + interval '1 day')::date
    and (a.booking_date + a.start_time)::timestamp < v_end_ts
    and (case when a.end_time <= a.start_time then (a.booking_date + interval '1 day' + a.end_time)::timestamp else (a.booking_date + a.end_time)::timestamp end) > v_start_ts
  order by a.start_time asc
  limit 1;

  if found then
    raise exception using errcode = '23P01', message = 'OVERLAP_CONFLICT:' || to_char(v_conflict_start, 'HH24:MI') || ':' || to_char(v_conflict_end, 'HH24:MI');
  end if;

  -- Resolver o consolidar cliente
  if p_client_id is not null and exists (select 1 from public.clients where id = p_client_id) then
    v_client_id := p_client_id;
    update public.clients
    set name = trim(p_client_name),
        phone = v_clean_phone,
        email = coalesce(v_clean_email, email),
        updated_at = now()
    where id = v_client_id;
  else
    select c.id into v_client_id
    from public.clients c
    where (v_clean_email is not null and lower(trim(coalesce(c.email, ''))) = v_clean_email)
       or regexp_replace(c.phone, '[^0-9]', '', 'g') = regexp_replace(v_clean_phone, '[^0-9]', '', 'g')
    order by c.created_at asc
    limit 1;

    if v_client_id is null then
      insert into public.clients (name, phone, email)
      values (trim(p_client_name), v_clean_phone, v_clean_email)
      returning id into v_client_id;
    else
      update public.clients
      set name = trim(p_client_name),
          phone = v_clean_phone,
          email = coalesce(v_clean_email, email),
          updated_at = now()
      where id = v_client_id;
    end if;
  end if;

  -- Insertar turno manual directamente confirmado
  insert into public.appointments (
    client_id,
    barber_id,
    service_id,
    custom_service_name,
    service_price_ars,
    booking_date,
    start_time,
    end_time,
    status,
    notes,
    is_manual,
    origin,
    created_by_user_id,
    created_by_display_name,
    deposit_required,
    deposit_paid
  ) values (
    v_client_id,
    v_barber.id,
    p_service_id,
    case when p_service_id is null then v_final_service_name else null end,
    v_final_price,
    p_booking_date,
    p_start_time,
    v_end_time,
    'CONFIRMED',
    nullif(trim(coalesce(p_notes, '')), ''),
    true,
    'MANUAL',
    v_creator_user_id,
    v_creator_name,
    false,
    false
  )
  returning id, status, booking_date, start_time, end_time, request_number
  into v_apt_id, appointment_status, booking_date, start_time, end_time, v_req_num;

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
    case when p_service_id is null then v_final_service_name else null end,
    v_final_price;
end;
$$;

revoke all on function public.create_manual_appointment(uuid, uuid, text, integer, date, time, time, text, text, text, text, boolean, integer, boolean, uuid) from public, anon;
grant execute on function public.create_manual_appointment(uuid, uuid, text, integer, date, time, time, text, text, text, text, boolean, integer, boolean, uuid) to authenticated;

-- Actualizar update_manual_appointment
create or replace function public.update_manual_appointment(
  p_appointment_id uuid,
  p_barber_id uuid,
  p_service_id uuid default null,
  p_custom_service_name text default null,
  p_service_price_ars integer default null,
  p_booking_date date default null,
  p_start_time time default null,
  p_end_time time default null,
  p_client_name text default null,
  p_client_phone text default null,
  p_client_email text default null,
  p_notes text default null,
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
  custom_service_name text,
  service_price_ars integer
)
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  v_appt public.appointments%rowtype;
  v_service public.services%rowtype;
  v_is_admin boolean;
  v_staff_barber_id uuid;
  v_duration_min integer;
  v_duration interval;
  v_end_time time;
  v_start_ts timestamp;
  v_end_ts timestamp;
  v_clean_email text;
  v_clean_phone text;
  v_final_service_name text;
  v_final_price integer;
  v_conflict_start time;
  v_conflict_end time;
begin
  if (select auth.uid()) is null then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;

  v_is_admin := public.is_admin();
  v_staff_barber_id := public.current_staff_barber_id();

  select * into v_appt
  from public.appointments
  where id = p_appointment_id;

  if not found then
    raise exception using errcode = '22023', message = 'APPOINTMENT_NOT_FOUND';
  end if;

  if not v_is_admin then
    if v_staff_barber_id is null or v_appt.barber_id is distinct from v_staff_barber_id then
      raise exception using errcode = '42501', message = 'MANUAL_APPOINTMENT_NOT_ALLOWED';
    end if;
    if p_barber_id is distinct from v_staff_barber_id then
      raise exception using errcode = '42501', message = 'BARBER_CANNOT_REASSIGN_APPOINTMENT';
    end if;
  end if;

  if p_barber_id is null then raise exception using errcode = '22023', message = 'BARBER_REQUIRED'; end if;
  if p_booking_date is null then raise exception using errcode = '22023', message = 'DATE_REQUIRED'; end if;
  if p_start_time is null then raise exception using errcode = '22023', message = 'START_TIME_REQUIRED'; end if;
  if p_client_name is null or length(trim(p_client_name)) < 2 then raise exception using errcode = '22023', message = 'CLIENT_NAME_INVALID'; end if;

  v_clean_phone := trim(coalesce(p_client_phone, ''));
  if length(regexp_replace(v_clean_phone, '[^0-9]', '', 'g')) < 6 then raise exception using errcode = '22023', message = 'CLIENT_PHONE_INVALID'; end if;

  v_clean_email := nullif(lower(trim(coalesce(p_client_email, ''))), '');
  if v_clean_email is not null and (position('@' in v_clean_email) <= 1 or v_clean_email like '%@kanibarber.internal') then
    v_clean_email := null;
  end if;

  -- Resolver Servicio
  if p_service_id is not null then
    select * into v_service from public.services s where s.id = p_service_id and s.active = true;
    if not found then raise exception using errcode = '22023', message = 'SERVICE_NOT_FOUND'; end if;
    v_duration_min := coalesce(p_duration_minutes, v_service.duration_minutes, 45);
    v_duration := (v_duration_min || ' minutes')::interval;
    v_end_time := coalesce(p_end_time, (p_start_time + v_duration)::time);
    v_final_service_name := v_service.name;
    v_final_price := coalesce(p_service_price_ars, v_appt.service_price_ars, v_service.price_ars, 0);
  else
    v_final_service_name := trim(coalesce(p_custom_service_name, v_appt.custom_service_name, ''));
    if length(v_final_service_name) < 2 then
      raise exception using errcode = '22023', message = 'CUSTOM_SERVICE_NAME_REQUIRED';
    end if;
    v_final_price := coalesce(p_service_price_ars, v_appt.service_price_ars, 0);

    if p_end_time is not null then
      v_end_time := p_end_time;
    elsif p_duration_minutes is not null and p_duration_minutes > 0 then
      v_duration_min := p_duration_minutes;
      v_duration := (v_duration_min || ' minutes')::interval;
      v_end_time := (p_start_time + v_duration)::time;
    else
      v_end_time := v_appt.end_time;
    end if;
  end if;

  -- Timestamps de inicio y fin con soporte de cruce de medianoche
  v_start_ts := (p_booking_date + p_start_time)::timestamp;
  if v_end_time <= p_start_time then
    v_end_ts := (p_booking_date + interval '1 day' + v_end_time)::timestamp;
  else
    v_end_ts := (p_booking_date + v_end_time)::timestamp;
  end if;

  -- Bloqueo consultivo
  perform pg_advisory_xact_lock(hashtextextended(p_barber_id::text || '|' || p_booking_date::text, 0));

  -- Validar anti-solapamiento excluyendo el propio turno
  select a.start_time, a.end_time into v_conflict_start, v_conflict_end
  from public.appointments a
  where a.barber_id = p_barber_id
    and a.status <> 'CANCELLED'
    and a.id <> p_appointment_id
    and a.booking_date between (p_booking_date - interval '1 day')::date and (p_booking_date + interval '1 day')::date
    and (a.booking_date + a.start_time)::timestamp < v_end_ts
    and (case when a.end_time <= a.start_time then (a.booking_date + interval '1 day' + a.end_time)::timestamp else (a.booking_date + a.end_time)::timestamp end) > v_start_ts
  order by a.start_time asc
  limit 1;

  if found then
    raise exception using errcode = '23P01', message = 'OVERLAP_CONFLICT:' || to_char(v_conflict_start, 'HH24:MI') || ':' || to_char(v_conflict_end, 'HH24:MI');
  end if;

  -- Actualizar cliente
  update public.clients
  set name = trim(p_client_name),
      phone = v_clean_phone,
      email = coalesce(v_clean_email, email),
      updated_at = now()
  where id = v_appt.client_id;

  -- Actualizar appointment
  update public.appointments
  set barber_id = p_barber_id,
      service_id = p_service_id,
      custom_service_name = case when p_service_id is null then v_final_service_name else null end,
      service_price_ars = v_final_price,
      booking_date = p_booking_date,
      start_time = p_start_time,
      end_time = v_end_time,
      notes = nullif(trim(coalesce(p_notes, '')), ''),
      updated_at = now()
  where id = p_appointment_id
  returning id, status, booking_date, start_time, end_time, request_number
  into appointment_id, appointment_status, booking_date, start_time, end_time, request_number;

  return query select
    appointment_id,
    appointment_status,
    booking_date,
    start_time,
    end_time,
    request_number,
    v_appt.is_manual,
    v_appt.origin,
    v_appt.created_by_display_name,
    case when p_service_id is null then v_final_service_name else null end,
    v_final_price;
end;
$$;

revoke all on function public.update_manual_appointment(uuid, uuid, uuid, text, integer, date, time, time, text, text, text, text, integer) from public, anon;
grant execute on function public.update_manual_appointment(uuid, uuid, uuid, text, integer, date, time, time, text, text, text, text, integer) to authenticated;

-- ==============================================================================
-- 3. PAGOS: Trazabilidad, soft-delete y actualización de cliente
-- ==============================================================================

alter table public.service_payments
  add column if not exists deleted_at timestamptz default null,
  add column if not exists deleted_by_user_id uuid references auth.users(id) default null,
  add column if not exists deleted_by_display_name text default null;

create index if not exists idx_service_payments_deleted_at
  on public.service_payments (deleted_at);

-- RPC de soft-delete para administradores
create or replace function public.soft_delete_service_payment(p_payment_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  v_uid uuid := auth.uid();
  v_is_admin boolean := public.is_admin();
  v_user_name text;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;

  if not v_is_admin then
    raise exception using errcode = '42501', message = 'FORBIDDEN_ADMIN_ONLY';
  end if;

  select coalesce(name, 'Admin') into v_user_name
  from public.staff_profiles
  where user_id = v_uid;

  update public.service_payments
  set deleted_at = timezone('America/Argentina/Buenos_Aires', clock_timestamp()),
      deleted_by_user_id = v_uid,
      deleted_by_display_name = coalesce(v_user_name, 'Admin'),
      updated_at = timezone('America/Argentina/Buenos_Aires', clock_timestamp())
  where id = p_payment_id
    and deleted_at is null;

  if not found then
    raise exception using errcode = 'P0002', message = 'PAYMENT_NOT_FOUND_OR_ALREADY_DELETED';
  end if;
end;
$$;

revoke all on function public.soft_delete_service_payment(uuid) from public, anon;
grant execute on function public.soft_delete_service_payment(uuid) to authenticated;

-- RPC para que barberos (en sus propios cobros) y admins actualicen datos de contacto del cliente
create or replace function public.update_service_payment_client(
  p_payment_id uuid,
  p_client_name text,
  p_client_contact text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  v_uid uuid := auth.uid();
  v_is_admin boolean := public.is_admin();
  v_staff_barber_id uuid := public.current_staff_barber_id();
  v_payment record;
  v_apt_client_id uuid;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;

  select * into v_payment
  from public.service_payments
  where id = p_payment_id
    and deleted_at is null;

  if not found then
    raise exception using errcode = 'P0002', message = 'PAYMENT_NOT_FOUND';
  end if;

  if not v_is_admin and (v_staff_barber_id is null or v_payment.barber_id <> v_staff_barber_id) then
    raise exception using errcode = '42501', message = 'FORBIDDEN_BARBER_SCOPE';
  end if;

  update public.service_payments
  set client_name = nullif(trim(p_client_name), ''),
      client_contact = nullif(trim(p_client_contact), ''),
      updated_at = timezone('America/Argentina/Buenos_Aires', clock_timestamp())
  where id = p_payment_id;

  -- Sincronizar con ficha de cliente si está vinculado a un appointment
  if v_payment.appointment_id is not null then
    select client_id into v_apt_client_id
    from public.appointments
    where id = v_payment.appointment_id;

    if v_apt_client_id is not null and p_client_name is not null and length(trim(p_client_name)) >= 2 then
      update public.clients
      set name = trim(p_client_name),
          phone = coalesce(nullif(trim(p_client_contact), ''), phone),
          updated_at = now()
      where id = v_apt_client_id;
    end if;
  end if;
end;
$$;

revoke all on function public.update_service_payment_client(uuid, text, text) from public, anon;
grant execute on function public.update_service_payment_client(uuid, text, text) to authenticated;

-- ==============================================================================
-- 4. HORARIOS: Detalle explicito de solapamientos con reservas existentes
-- ==============================================================================

create or replace function public.create_availability_slots(
  p_barber_id uuid,
  p_slot_dates date[],
  p_start_time time,
  p_end_time time default null
)
returns setof public.barber_availability_slots
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  v_date date;
  v_today date := (timezone('America/Argentina/Buenos_Aires', clock_timestamp()))::date;
  v_next_block_start time;
  v_end_time time;
  v_existing public.barber_availability_slots%rowtype;
  v_slot public.barber_availability_slots%rowtype;
  v_conflict_apt record;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;

  if not public.is_admin() and public.current_staff_barber_id() is distinct from p_barber_id then
    raise exception using errcode = '42501', message = 'AVAILABILITY_NOT_ALLOWED';
  end if;

  if not exists (select 1 from public.barbers b where b.id = p_barber_id and b.active = true) then
    raise exception using errcode = '22023', message = 'BARBER_NOT_FOUND';
  end if;

  if p_slot_dates is null or cardinality(p_slot_dates) = 0 then
    raise exception using errcode = '22023', message = 'DATE_REQUIRED';
  end if;

  if p_start_time is null
     or extract(second from p_start_time) <> 0
     or p_start_time < time '00:00'
     or p_start_time > time '23:59'
     or (extract(minute from p_start_time)::int % 5 <> 0 and p_start_time <> time '00:00') then
    raise exception using errcode = '22023', message = 'START_TIME_NOT_ALLOWED';
  end if;

  if p_end_time is not null
     and (extract(second from p_end_time) <> 0
       or (extract(minute from p_end_time)::int % 5 <> 0 and p_end_time <> time '23:59')
       or p_end_time <= p_start_time
       or p_end_time > time '23:59') then
    raise exception using errcode = '22023', message = 'END_TIME_INVALID';
  end if;

  foreach v_date in array p_slot_dates loop
    if v_date is null or v_date < v_today or extract(isodow from v_date) = 7 then
      raise exception using errcode = '22023', message = 'AVAILABILITY_DATE_INVALID';
    end if;

    perform pg_advisory_xact_lock(hashtextextended(p_barber_id::text || '|' || v_date::text, 0));

    -- Check if an existing available slot already covers the interval
    select s.* into v_existing
    from public.barber_availability_slots s
    where s.barber_id = p_barber_id
      and s.slot_date = v_date
      and s.status = 'AVAILABLE'
      and s.start_time <= p_start_time
      and (p_end_time is null and s.end_time > p_start_time or p_end_time is not null and s.end_time >= p_end_time)
    order by s.start_time, s.id
    limit 1;

    if found then
      return next v_existing;
      continue;
    end if;

    -- Validar colisión con turnos existentes reportando detalles
    select a.start_time, a.end_time, b.name into v_conflict_apt
    from public.appointments a
    join public.barbers b on b.id = a.barber_id
    where a.barber_id = p_barber_id
      and a.booking_date = v_date
      and a.status <> 'CANCELLED'
      and (
        (p_end_time is null and a.start_time <= p_start_time and a.end_time > p_start_time)
        or
        (p_end_time is not null and a.start_time < p_end_time and a.end_time > p_start_time)
      )
    order by a.start_time
    limit 1;

    if found then
      raise exception using errcode = '23P01', message = 'AVAILABILITY_APPOINTMENT_CONFLICT:' || v_conflict_apt.name || ':' || to_char(v_conflict_apt.start_time, 'HH24:MI') || ':' || to_char(v_conflict_apt.end_time, 'HH24:MI');
    end if;

    if exists (
      select 1 from public.barber_availability_slots s
      where s.barber_id = p_barber_id
        and s.slot_date = v_date
        and s.status = 'UNAVAILABLE'
        and s.start_time <= p_start_time
        and s.end_time > p_start_time
    ) then
      raise exception using errcode = '23P01', message = 'AVAILABILITY_BLOCKED_START';
    end if;

    select min(candidate_start) into v_next_block_start
    from (
      select min(a.start_time) as candidate_start
      from public.appointments a
      where a.barber_id = p_barber_id
        and a.booking_date = v_date
        and a.status <> 'CANCELLED'
        and a.start_time > p_start_time
      union all
      select min(s.start_time) as candidate_start
      from public.barber_availability_slots s
      where s.barber_id = p_barber_id
        and s.slot_date = v_date
        and s.status = 'UNAVAILABLE'
        and s.start_time > p_start_time
    ) candidates;

    v_end_time := least(
      coalesce(
        p_end_time,
        case
          when p_start_time >= time '23:00' then time '23:59'
          else (p_start_time + interval '1 hour')::time
        end
      ),
      coalesce(v_next_block_start, coalesce(p_end_time, time '23:59'))
    );

    if v_end_time <= p_start_time then
      raise exception using errcode = '22023', message = 'AVAILABILITY_INTERVAL_INVALID';
    end if;

    select s.* into v_existing
    from public.barber_availability_slots s
    where s.barber_id = p_barber_id
      and s.slot_date = v_date
      and s.status = 'AVAILABLE'
      and s.start_time < v_end_time
      and s.end_time > p_start_time
    order by s.start_time, s.id
    limit 1;

    if found then
      update public.barber_availability_slots
      set start_time = least(v_existing.start_time, p_start_time),
          end_time = greatest(v_existing.end_time, v_end_time),
          updated_by = auth.uid(),
          updated_at = now()
      where id = v_existing.id
      returning * into v_slot;
      return next v_slot;
      continue;
    end if;

    insert into public.barber_availability_slots (
      barber_id, slot_date, start_time, end_time, status, updated_by
    ) values (
      p_barber_id, v_date, p_start_time, v_end_time, 'AVAILABLE', auth.uid()
    ) returning * into v_slot;

    return next v_slot;
  end loop;
end;
$$;

revoke all on function public.create_availability_slots(uuid, date[], time, time) from public, anon, authenticated;
grant execute on function public.create_availability_slots(uuid, date[], time, time) to authenticated;

-- Actualizar update_availability_slot con reporte de conflicto
create or replace function public.update_availability_slot(
  p_slot_id uuid,
  p_status public.availability_status,
  p_internal_note text
)
returns setof public.barber_availability_slots
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  v_barber_id uuid;
  v_slot_date date;
  v_slot public.barber_availability_slots%rowtype;
  v_conflict_apt record;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;

  if p_internal_note is not null and length(p_internal_note) > 500 then
    raise exception using errcode = '22023', message = 'INTERNAL_NOTE_TOO_LONG';
  end if;

  select s.barber_id, s.slot_date into v_barber_id, v_slot_date
  from public.barber_availability_slots s
  where s.id = p_slot_id
    and (public.is_admin() or s.barber_id = public.current_staff_barber_id());

  if not found then
    raise exception using errcode = '42501', message = 'AVAILABILITY_NOT_ALLOWED';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_barber_id::text || '|' || v_slot_date::text, 0));

  select s.* into v_slot
  from public.barber_availability_slots s
  where s.id = p_slot_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'AVAILABILITY_NOT_FOUND';
  end if;

  -- Comprobar conflicto con turno existente
  select a.start_time, a.end_time, b.name into v_conflict_apt
  from public.appointments a
  join public.barbers b on b.id = a.barber_id
  where a.barber_id = v_slot.barber_id
    and a.booking_date = v_slot.slot_date
    and a.status <> 'CANCELLED'
    and a.start_time < v_slot.end_time
    and a.end_time > v_slot.start_time
  order by a.start_time asc
  limit 1;

  if found then
    raise exception using errcode = '23P01', message = 'AVAILABILITY_APPOINTMENT_CONFLICT:' || v_conflict_apt.name || ':' || to_char(v_conflict_apt.start_time, 'HH24:MI') || ':' || to_char(v_conflict_apt.end_time, 'HH24:MI');
  end if;

  update public.barber_availability_slots
  set status = p_status,
      internal_note = nullif(trim(p_internal_note), ''),
      updated_by = auth.uid(),
      updated_at = now()
  where id = p_slot_id
  returning * into v_slot;

  return next v_slot;
end;
$$;

revoke all on function public.update_availability_slot(uuid, public.availability_status, text) from public, anon, authenticated;
grant execute on function public.update_availability_slot(uuid, public.availability_status, text) to authenticated;

notify pgrst, 'reload schema';
