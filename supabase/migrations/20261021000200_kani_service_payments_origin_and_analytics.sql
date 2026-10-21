-- Migration: 20261021000200_kani_service_payments_origin_and_analytics.sql
-- KANI Barber Studio — Origen del servicio (Con turno / Sin turno), integridad y permisos analíticos

-- ==============================================================================
-- 1. Agregar columna service_origin y actualizar registros existentes
-- ==============================================================================
alter table public.service_payments
  add column if not exists service_origin text not null default 'walk_in';

-- Backfill compatible con históricos
update public.service_payments
set service_origin = case
  when appointment_id is not null then 'appointment'
  else 'walk_in'
end
where service_origin is null or service_origin not in ('appointment', 'walk_in', 'legacy');

-- Constraints de integridad
alter table public.service_payments
  drop constraint if exists service_payments_origin_check;

alter table public.service_payments
  add constraint service_payments_origin_check check (
    service_origin in ('appointment', 'walk_in', 'legacy')
  );

alter table public.service_payments
  drop constraint if exists service_payments_origin_appointment_consistency;

alter table public.service_payments
  add constraint service_payments_origin_appointment_consistency check (
    (service_origin = 'appointment' and appointment_id is not null) or
    (service_origin = 'walk_in' and appointment_id is null) or
    (service_origin = 'legacy')
  );

-- ==============================================================================
-- 2. Índices para analítica y rendimiento
-- ==============================================================================
create index if not exists idx_service_payments_origin
  on public.service_payments (service_origin);

create index if not exists idx_service_payments_service_name
  on public.service_payments (service_name);

-- ==============================================================================
-- 3. Políticas RLS reforzadas para evitar manipulación de appointment_id
-- ==============================================================================
drop policy if exists service_payments_insert on public.service_payments;
create policy service_payments_insert
  on public.service_payments
  for insert to authenticated
  with check (
    public.is_admin()
    or (
      barber_id = public.current_staff_barber_id()
      and (created_by_user_id is null or created_by_user_id = auth.uid())
      and (
        appointment_id is null
        or exists (
          select 1 from public.appointments a
          where a.id = appointment_id
            and a.barber_id = public.current_staff_barber_id()
        )
      )
    )
  );

drop policy if exists service_payments_update on public.service_payments;
create policy service_payments_update
  on public.service_payments
  for update to authenticated
  using (
    public.is_admin()
    or barber_id = public.current_staff_barber_id()
  )
  with check (
    public.is_admin()
    or (
      barber_id = public.current_staff_barber_id()
      and (
        appointment_id is null
        or exists (
          select 1 from public.appointments a
          where a.id = appointment_id
            and a.barber_id = public.current_staff_barber_id()
        )
      )
    )
  );

-- ==============================================================================
-- 4. Función RPC actualizada: record_service_payment
-- ==============================================================================
drop function if exists public.record_service_payment(uuid, text, text, integer, integer, date, time, text, boolean, text, text, uuid);
drop function if exists public.record_service_payment(uuid, text, text, integer, integer, date, time, text, boolean, text, text, uuid, text);

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
  p_appointment_id uuid default null,
  p_service_origin text default null
)
returns table (
  payment_id uuid,
  barber_id uuid,
  service_name text,
  final_amount_ars integer,
  collected_amount_ars integer,
  payment_date date,
  payment_time time,
  appointment_id uuid,
  service_origin text
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
  v_origin text;
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

  -- Resolver origen del servicio
  v_origin := coalesce(p_service_origin, case when p_appointment_id is not null then 'appointment' else 'walk_in' end);
  if v_origin not in ('appointment', 'walk_in', 'legacy') then
    raise exception 'INVALID_SERVICE_ORIGIN';
  end if;

  if v_origin = 'appointment' and p_appointment_id is null then
    raise exception 'APPOINTMENT_ID_REQUIRED_FOR_ORIGIN';
  end if;

  if v_origin = 'walk_in' and p_appointment_id is not null then
    raise exception 'APPOINTMENT_ID_NOT_ALLOWED_FOR_WALK_IN';
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
    -- Sin turno asociado
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
    service_origin,
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
    v_origin,
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
    p_appointment_id,
    v_origin;
end;
$$;

revoke all on function public.record_service_payment(uuid, text, text, integer, integer, date, time, text, boolean, text, text, uuid, text) from public, anon;
grant execute on function public.record_service_payment(uuid, text, text, integer, integer, date, time, text, boolean, text, text, uuid, text) to authenticated;

-- Notificar recarga de schema a PostgREST
notify pgrst, 'reload schema';
