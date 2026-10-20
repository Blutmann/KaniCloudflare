-- Migration: 20261020000100_kani_unify_deposit_to_5000.sql
-- KANI Barber Studio — Unificación del importe de la seña a $5.000 para todos los servicios (nuevas y anteriores)

-- 1. Actualizar el valor por omisión y las configuraciones activas de seña en barber_transfer_details
alter table public.barber_transfer_details
  alter column down_payment_ars set default 5000;

update public.barber_transfer_details
set down_payment_ars = 5000
where down_payment_ars is distinct from 5000;

-- 2. Actualizar función RPC read_public_deposit_amount para retornar $5.000 como estándar unificado
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

-- 3. Actualizar función RPC get_appointment_payment_details para reflejar la seña unificada de $5.000
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

-- 4. Actualizar función RPC record_no_show_exception para usar $5.000 como seña estándar en inasistencias
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

  -- Calcular importe de la seña correspondiente al turno ($5.000 unificada salvo monto específico registrado)
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

  -- Verificar si ya existe una excepción registrada para este turno
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
    auth.uid(),
    v_user_display
  )
  returning id into v_exception_id;

  -- Actualizar datos desnormalizados en appointments para trazabilidad
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
