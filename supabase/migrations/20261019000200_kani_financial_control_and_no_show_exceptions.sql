-- Migration: 20261019000200_kani_financial_control_and_no_show_exceptions.sql
-- KANI Barber Studio — Control financiero de la barbería y gestión excepcional de inasistencias

-- 1. Ampliar el enum appointment_status para soportar inasistencias explícitas ('NO_SHOW')
alter type public.appointment_status add value if not exists 'NO_SHOW';

-- 2. Agregar columnas financieras y de auditoría a la tabla appointments
alter table public.appointments
  add column if not exists deposit_amount_ars integer default null,
  add column if not exists balance_paid boolean not null default false,
  add column if not exists no_show_decision text default null check (no_show_decision is null or no_show_decision in ('RETAIN', 'WAIVE', 'REFUND')),
  add column if not exists no_show_refund_amount_ars integer not null default 0 check (no_show_refund_amount_ars >= 0);

-- 3. Crear tabla auditable para excepciones de inasistencias
create table if not exists public.appointment_no_show_exceptions (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid not null unique references public.appointments(id) on delete cascade,
  decision text not null check (decision in ('RETAIN', 'WAIVE', 'REFUND')),
  deposit_amount_ars integer not null default 0 check (deposit_amount_ars >= 0),
  refund_amount_ars integer not null default 0 check (refund_amount_ars >= 0),
  reason text not null check (length(trim(reason)) >= 3),
  created_by_user_id uuid references auth.users(id),
  created_by_display_name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.appointment_no_show_exceptions enable row level security;
revoke all on table public.appointment_no_show_exceptions from anon, public;
grant select, insert, update on table public.appointment_no_show_exceptions to authenticated;

drop policy if exists appointment_no_show_exceptions_select on public.appointment_no_show_exceptions;
create policy appointment_no_show_exceptions_select
  on public.appointment_no_show_exceptions
  for select to authenticated
  using (
    public.is_admin()
    or exists (
      select 1 from public.appointments a
      where a.id = appointment_no_show_exceptions.appointment_id
        and a.barber_id = public.current_staff_barber_id()
    )
  );

drop policy if exists appointment_no_show_exceptions_insert on public.appointment_no_show_exceptions;
create policy appointment_no_show_exceptions_insert
  on public.appointment_no_show_exceptions
  for insert to authenticated
  with check (
    public.is_admin()
    or exists (
      select 1 from public.appointments a
      where a.id = appointment_no_show_exceptions.appointment_id
        and a.barber_id = public.current_staff_barber_id()
    )
  );

-- 4. Actualizar función RPC update_appointment_status para permitir CONFIRMED, CANCELLED, COMPLETED, NO_SHOW
create or replace function public.update_appointment_status(
  p_appointment_id uuid,
  p_status public.appointment_status
)
returns table (
  appointment_id uuid,
  appointment_status public.appointment_status,
  notification_claim_token text
)
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  v_current_status public.appointment_status;
  v_staff_barber_id uuid;
  v_is_admin boolean;
  v_barber_id uuid;
  v_claim_token text := null;
begin
  if p_status not in ('CONFIRMED', 'CANCELLED', 'COMPLETED', 'NO_SHOW') then
    raise exception 'INVALID_APPOINTMENT_STATUS_TRANSITION';
  end if;

  v_is_admin := public.is_admin();
  v_staff_barber_id := public.current_staff_barber_id();

  select status, barber_id into v_current_status, v_barber_id
  from public.appointments
  where id = p_appointment_id
  for update;

  if not found then
    raise exception 'APPOINTMENT_NOT_FOUND';
  end if;

  if not v_is_admin and (v_staff_barber_id is null or v_staff_barber_id is distinct from v_barber_id) then
    raise exception 'FORBIDDEN';
  end if;

  if v_current_status = p_status then
    return query select p_appointment_id, v_current_status, null::text;
    return;
  end if;

  update public.appointments
  set status = p_status,
      updated_at = clock_timestamp()
  where id = p_appointment_id;

  return query select p_appointment_id, p_status, v_claim_token;
end;
$$;

revoke all on function public.update_appointment_status(uuid, public.appointment_status) from public, anon;
grant execute on function public.update_appointment_status(uuid, public.appointment_status) to authenticated;

-- 5. Función RPC para completar turno y registrar cobro de saldo
create or replace function public.complete_appointment(
  p_appointment_id uuid,
  p_balance_paid boolean default true
)
returns table (
  appointment_id uuid,
  appointment_status public.appointment_status,
  balance_paid boolean
)
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  v_barber_id uuid;
  v_staff_barber_id uuid;
  v_is_admin boolean;
  v_curr_status public.appointment_status;
begin
  v_is_admin := public.is_admin();
  v_staff_barber_id := public.current_staff_barber_id();

  select barber_id, status into v_barber_id, v_curr_status
  from public.appointments
  where id = p_appointment_id
  for update;

  if not found then
    raise exception 'APPOINTMENT_NOT_FOUND';
  end if;

  if not v_is_admin and (v_staff_barber_id is null or v_staff_barber_id is distinct from v_barber_id) then
    raise exception 'FORBIDDEN';
  end if;

  if v_curr_status = 'CANCELLED' then
    raise exception 'CANNOT_COMPLETE_CANCELLED_APPOINTMENT';
  end if;

  update public.appointments
  set status = 'COMPLETED',
      balance_paid = coalesce(p_balance_paid, true),
      updated_at = clock_timestamp()
  where id = p_appointment_id;

  return query select p_appointment_id, 'COMPLETED'::public.appointment_status, coalesce(p_balance_paid, true);
end;
$$;

revoke all on function public.complete_appointment(uuid, boolean) from public, anon;
grant execute on function public.complete_appointment(uuid, boolean) to authenticated;

-- 6. Función RPC atómica para registrar inasistencia con decisión de seña y motivo auditable
create or replace function public.record_appointment_no_show_exception(
  p_appointment_id uuid,
  p_decision text, -- 'RETAIN' | 'WAIVE' | 'REFUND'
  p_reason text,
  p_refund_amount_ars integer default null
)
returns table (
  exception_id uuid,
  appointment_id uuid,
  decision text,
  deposit_amount_ars integer,
  refund_amount_ars integer,
  reason text,
  created_by_display_name text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  v_apt public.appointments%rowtype;
  v_user_id uuid := auth.uid();
  v_is_admin boolean;
  v_staff_barber_id uuid;
  v_user_display text;
  v_deposit_amount integer;
  v_refund_amount integer := 0;
  v_new_exception_id uuid;
  v_created_at timestamptz;
begin
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if p_decision not in ('RETAIN', 'WAIVE', 'REFUND') then
    raise exception 'INVALID_DECISION';
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

  -- Determinar display_name del operador
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

  -- Calcular importe de la seña correspondiente al turno
  if coalesce(v_apt.deposit_paid, false) then
    if v_apt.deposit_amount_ars is not null and v_apt.deposit_amount_ars > 0 then
      v_deposit_amount := v_apt.deposit_amount_ars;
    elsif coalesce(v_apt.is_manual, false) then
      v_deposit_amount := 5000;
    else
      -- Seña estándar de reserva pública
      select coalesce(td.down_payment_ars, 10000) into v_deposit_amount
      from public.barber_transfer_details td
      where td.barber_id = v_apt.barber_id and td.active = true
      limit 1;
      if v_deposit_amount is null then
        v_deposit_amount := 10000;
      end if;
    end if;
  else
    v_deposit_amount := 0;
  end if;

  -- Si la decisión es REFUND (devolver seña):
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

  -- Verificar si ya existe una excepción registrada para este turno (prevención de duplicados)
  if exists (
    select 1 from public.appointment_no_show_exceptions e
    where e.appointment_id = p_appointment_id
  ) then
    raise exception 'EXCEPTION_ALREADY_RECORDED';
  end if;

  -- Insertar registro auditable de la excepción
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
    v_user_id,
    v_user_display
  )
  returning id, appointment_no_show_exceptions.created_at
  into v_new_exception_id, v_created_at;

  -- Actualizar el turno con el estado NO_SHOW y los snapshots financieros
  update public.appointments
  set status = 'NO_SHOW',
      no_show_decision = p_decision,
      no_show_refund_amount_ars = v_refund_amount,
      updated_at = clock_timestamp()
  where id = p_appointment_id;

  return query select
    v_new_exception_id,
    p_appointment_id,
    p_decision,
    v_deposit_amount,
    v_refund_amount,
    trim(p_reason),
    v_user_display,
    v_created_at;
end;
$$;

revoke all on function public.record_appointment_no_show_exception(uuid, text, text, integer) from public, anon;
grant execute on function public.record_appointment_no_show_exception(uuid, text, text, integer) to authenticated;
