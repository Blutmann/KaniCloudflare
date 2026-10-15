-- KANI Barber Studio — Fase 1
-- Modelo de datos, autenticación interna, RLS y disponibilidad individual.
-- Esta migración no crea el flujo de reservas, emails ni cancelaciones públicas.
--
-- Los usuarios internos se crean posteriormente mediante Supabase Auth y sus
-- staff_profiles se provisionan explícitamente por un proceso administrativo.
-- No se crea ningún trigger global sobre auth.users.

create extension if not exists pgcrypto;

create type public.staff_role as enum ('BARBER', 'ADMIN');
create type public.appointment_status as enum ('PENDING', 'CONFIRMED', 'CANCELLED', 'COMPLETED');
create type public.availability_status as enum ('AVAILABLE', 'UNAVAILABLE');

create table public.barbers (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (length(trim(name)) > 0),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.staff_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role public.staff_role not null,
  barber_id uuid references public.barbers(id) on delete restrict,
  display_name text not null check (length(trim(display_name)) > 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint barber_profile_requires_barber check (
    (role = 'BARBER' and barber_id is not null) or
    (role = 'ADMIN' and barber_id is null)
  )
);

create unique index staff_profiles_one_user_per_barber
  on public.staff_profiles (barber_id)
  where barber_id is not null;

create table public.services (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (length(trim(name)) > 0),
  duration_minutes integer not null check (duration_minutes > 0),
  price_ars integer not null check (price_ars >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.clients (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) >= 3),
  phone text not null check (length(trim(phone)) >= 8),
  email text not null check (position('@' in email) > 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index clients_email_normalized_idx on public.clients (lower(trim(email)));
create index clients_phone_normalized_idx on public.clients (regexp_replace(phone, '[^0-9+]', '', 'g'));

create table public.appointments (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete restrict,
  barber_id uuid not null references public.barbers(id) on delete restrict,
  service_id uuid not null references public.services(id) on delete restrict,
  booking_date date not null,
  start_time time not null,
  end_time time not null,
  status public.appointment_status not null default 'PENDING',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint appointment_interval_valid check (end_time > start_time),
  constraint appointment_inside_business_hours check (
    start_time >= time '10:00' and end_time <= time '20:00'
  )
);

create index appointments_barber_date_idx
  on public.appointments (barber_id, booking_date, start_time);
create index appointments_client_idx on public.appointments (client_id);
create index appointments_status_idx on public.appointments (status);

create table public.barber_availability_slots (
  id uuid primary key default gen_random_uuid(),
  barber_id uuid not null references public.barbers(id) on delete cascade,
  slot_date date not null,
  start_time time not null,
  end_time time not null,
  status public.availability_status not null default 'AVAILABLE',
  internal_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  constraint availability_interval_valid check (end_time > start_time),
  constraint availability_inside_business_hours check (
    start_time >= time '10:00' and end_time <= time '20:00'
  ),
  constraint availability_hourly_slot check (end_time - start_time = interval '1 hour'),
  unique (barber_id, slot_date, start_time)
);

-- Datos base oficiales. Corte es de 60 minutos en el MVP.
insert into public.barbers (name) values
  ('Lautaro'), ('Gonzalo'), ('Valentín');

insert into public.services (name, duration_minutes, price_ars) values
  ('Corte', 60, 25000),
  ('Corte + barba', 60, 30000),
  ('Barba', 30, 10000);

-- Genera la grilla estándar individual para los próximos 21 días.
-- Los domingos se excluyen; cada slot puede bloquearse independientemente.
insert into public.barber_availability_slots (barber_id, slot_date, start_time, end_time)
select
  b.id,
  d::date,
  s::time,
  (s + interval '1 hour')::time
from public.barbers b
cross join generate_series(current_date, current_date + 21, interval '1 day') d
cross join generate_series(
  timestamp '2000-01-01 10:00:00',
  timestamp '2000-01-01 19:00:00',
  interval '1 hour'
) s
where extract(isodow from d) between 1 and 6;

-- La autorización efectiva proviene exclusivamente de staff_profiles asociado
-- a auth.uid(). No se consulta raw_user_meta_data ni auth.jwt metadata.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.staff_profiles
    where user_id = (select auth.uid())
      and role = 'ADMIN'
      and active = true
  );
$$;

create or replace function public.current_staff_barber_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select barber_id
  from public.staff_profiles
  where user_id = (select auth.uid())
    and role = 'BARBER'
    and active = true;
$$;

-- El esquema Auth no crea staff_profiles automáticamente. Los cuatro usuarios
-- internos se provisionan después de crear sus cuentas Auth mediante un proceso
-- administrativo server-side que inserta explícitamente en staff_profiles.

alter table public.barbers enable row level security;
alter table public.staff_profiles enable row level security;
alter table public.services enable row level security;
alter table public.clients enable row level security;
alter table public.appointments enable row level security;
alter table public.barber_availability_slots enable row level security;

create policy public_can_read_active_barbers
  on public.barbers for select to anon, authenticated
  using (active = true);

create policy staff_can_read_barbers
  on public.barbers for select to authenticated
  using (public.is_admin() or id = public.current_staff_barber_id());

create policy admin_can_manage_barbers
  on public.barbers for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy staff_can_read_own_profile
  on public.staff_profiles for select to authenticated
  using (user_id = (select auth.uid()) or public.is_admin());

create policy admin_can_manage_staff_profiles
  on public.staff_profiles for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy public_can_read_active_services
  on public.services for select to anon, authenticated
  using (active = true);

create policy admin_can_manage_services
  on public.services for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy staff_can_read_clients
  on public.clients for select to authenticated
  using (public.is_admin() or exists (
    select 1
    from public.appointments a
    where a.client_id = clients.id
      and a.barber_id = public.current_staff_barber_id()
  ));

create policy admin_can_manage_clients
  on public.clients for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy barber_can_read_own_appointments
  on public.appointments for select to authenticated
  using (public.is_admin() or barber_id = public.current_staff_barber_id());

create policy barber_can_update_own_appointments
  on public.appointments for update to authenticated
  using (public.is_admin() or barber_id = public.current_staff_barber_id())
  with check (public.is_admin() or barber_id = public.current_staff_barber_id());

create policy admin_can_insert_appointments
  on public.appointments for insert to authenticated
  with check (public.is_admin());

create policy staff_can_read_own_availability
  on public.barber_availability_slots for select to authenticated
  using (public.is_admin() or barber_id = public.current_staff_barber_id());

create policy public_can_read_available_slots
  on public.barber_availability_slots for select to anon
  using (status = 'AVAILABLE');

create policy staff_can_manage_own_availability
  on public.barber_availability_slots for insert to authenticated
  with check (public.is_admin() or barber_id = public.current_staff_barber_id());

create policy staff_can_update_own_availability
  on public.barber_availability_slots for update to authenticated
  using (public.is_admin() or barber_id = public.current_staff_barber_id())
  with check (public.is_admin() or barber_id = public.current_staff_barber_id());

create policy staff_can_delete_own_availability
  on public.barber_availability_slots for delete to authenticated
  using (public.is_admin() or barber_id = public.current_staff_barber_id());

-- La vista usa security_invoker=true. La política pública solo permite filas
-- AVAILABLE y los privilegios por columna impiden leer internal_note como anon.
create or replace view public.available_barber_slots
with (security_invoker = true)
as
select
  s.id,
  s.barber_id,
  s.slot_date,
  s.start_time,
  s.end_time,
  s.status
from public.barber_availability_slots s
join public.barbers b on b.id = s.barber_id
where s.status = 'AVAILABLE'
  and b.active = true;

-- Evita que anon consulte internal_note o cualquier otra columna privada de la
-- tabla base. authenticated mantiene acceso a las columnas internas sujeto a RLS.
revoke select on public.barber_availability_slots from anon;
grant select (id, barber_id, slot_date, start_time, end_time, status)
  on public.barber_availability_slots to anon;
grant select on public.barber_availability_slots to authenticated;
grant select on public.available_barber_slots to anon, authenticated;

-- Las funciones auxiliares se usan desde políticas RLS y no quedan abiertas a
-- PUBLIC como privilegio innecesario. La función de trigger global fue eliminada.
revoke execute on function public.is_admin() from public;
revoke execute on function public.current_staff_barber_id() from public;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.current_staff_barber_id() to authenticated;

comment on table public.barber_availability_slots is
  'Disponibilidad individual por barbero, fecha y slot horario. internal_note es exclusivamente interno.';
comment on column public.barber_availability_slots.internal_note is
  'Motivo interno opcional; nunca exponer mediante consultas públicas.';
comment on table public.appointments is
  'Entidad base de reservas. La creación pública y protección contra doble reserva se implementan en Fase 2.';
