-- Operational authorization. Maintenance and role management retain is_admin().
-- Additive: preserves Auth identities, barber IDs, financial rows and provider flows.
alter table public.staff_profiles drop constraint barber_profile_requires_barber;
alter table public.staff_profiles add constraint barber_profile_requires_barber check (
 (role = 'BARBER' and barber_id is not null) or
 (role in ('ADMIN','MANAGER') and barber_id is null)
);
create or replace function public.is_operator() returns boolean
language sql stable security definer set search_path = pg_catalog, public as $$
 select exists(select 1 from public.staff_profiles
 where user_id = (select auth.uid()) and active and role in ('ADMIN','MANAGER'));
$$;
revoke all on function public.is_operator() from public, anon;
grant execute on function public.is_operator() to authenticated, service_role;

create table public.client_barbers (
 client_id uuid not null references public.clients(id) on delete restrict,
 barber_id uuid not null references public.barbers(id) on delete restrict,
 created_at timestamptz not null default now(),
 primary key(client_id, barber_id)
);
create index client_barbers_barber_idx on public.client_barbers(barber_id, client_id);
alter table public.client_barbers enable row level security;
revoke all on public.client_barbers from public, anon, authenticated;
grant select on public.client_barbers to authenticated;
grant all on public.client_barbers to service_role;
create policy client_barbers_read on public.client_barbers for select to authenticated
 using ((select public.is_operator()) or barber_id=(select public.current_staff_barber_id()));
insert into public.client_barbers(client_id,barber_id)
 select distinct client_id,barber_id from public.appointments where client_id is not null
 on conflict do nothing;

create schema if not exists kani_private;
revoke all on schema kani_private from public;
grant usage on schema kani_private to authenticated, service_role;
create function kani_private.link_appointment_client() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
begin
 if new.client_id is not null then
  insert into public.client_barbers(client_id,barber_id) values(new.client_id,new.barber_id) on conflict do nothing;
 end if;
 return new;
end; $$;
revoke all on function kani_private.link_appointment_client() from public, anon, authenticated;
create trigger link_appointment_client after insert or update of client_id,barber_id on public.appointments
 for each row execute function kani_private.link_appointment_client();

-- Existing broad client visibility is replaced with a durable many-to-many relation.
drop policy staff_can_read_clients on public.clients;
drop policy staff_can_insert_clients on public.clients;
drop policy staff_can_update_clients on public.clients;
drop policy admin_can_delete_clients on public.clients;
create policy clients_read_related on public.clients for select to authenticated using (
 (select public.is_operator()) or exists(select 1 from public.client_barbers cb
 where cb.client_id=clients.id and cb.barber_id=(select public.current_staff_barber_id()))
);
create policy clients_update_related on public.clients for update to authenticated using (
 (select public.is_operator()) or exists(select 1 from public.client_barbers cb
 where cb.client_id=clients.id and cb.barber_id=(select public.current_staff_barber_id()))
) with check (
 (select public.is_operator()) or exists(select 1 from public.client_barbers cb
 where cb.client_id=clients.id and cb.barber_id=(select public.current_staff_barber_id()))
);
-- Creation and deletion go through authenticated RPCs, never unrestricted table writes.
revoke insert, delete on public.clients from authenticated;
create function kani_private.protect_client_deletion() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
begin
 if new.id is distinct from old.id then raise exception using errcode='42501',message='CLIENT_ID_IMMUTABLE'; end if;
 if auth.uid() is not null and not public.is_operator()
 and new.deleted_at is distinct from old.deleted_at then
  raise exception using errcode='42501',message='CLIENT_DELETE_NOT_ALLOWED';
 end if;
 return new;
end; $$;
revoke all on function kani_private.protect_client_deletion() from public, anon, authenticated;
create trigger protect_client_deletion before update on public.clients
 for each row execute function kani_private.protect_client_deletion();

create or replace function public.save_client(p_id uuid default null,p_name text default null,
 p_phone text default null,p_email text default null) returns public.clients
language plpgsql security definer set search_path=pg_catalog,public,extensions as $$
declare
 v_barber uuid := public.current_staff_barber_id();
 v_operator boolean := public.is_operator();
 v_name text := trim(coalesce(p_name,''));
 v_phone text := trim(coalesce(p_phone,''));
 v_digits text := regexp_replace(coalesce(p_phone,''),'[^0-9]','','g');
 v_email text := nullif(lower(trim(coalesce(p_email,''))),'');
 v_client public.clients;
begin
 if auth.uid() is null or (not v_operator and v_barber is null) then
  raise exception using errcode='42501',message='STAFF_REQUIRED';
 end if;
 if length(v_name)<2 or length(v_digits)<6 then
  raise exception using errcode='22023',message='CLIENT_DETAILS_INVALID';
 end if;
 if v_email is not null and (position('@' in v_email)<=1 or v_email like '%@kanibarber.internal') then v_email:=null; end if;
 -- Serialize staff reuse of a normalized phone to avoid duplicate manual cards.
 perform pg_advisory_xact_lock(hashtextextended('client-phone:'||v_digits,0));
 if p_id is not null then
  select c.* into v_client from public.clients c where c.id=p_id
   and (v_operator or exists(select 1 from public.client_barbers cb where cb.client_id=c.id and cb.barber_id=v_barber)) for update;
  if not found then raise exception using errcode='42501',message='CLIENT_NOT_ALLOWED'; end if;
 else
  select c.* into v_client from public.clients c
   where regexp_replace(c.phone,'[^0-9]','','g')=v_digits
      or (v_email is not null and lower(trim(c.email))=v_email)
   order by c.deleted_at nulls first,c.created_at limit 1 for update;
 end if;
 if v_client.id is null then
  insert into public.clients(name,phone,email) values(v_name,v_phone,v_email) returning * into v_client;
 elsif p_id is null and not v_operator and not exists(
  select 1 from public.client_barbers cb where cb.client_id=v_client.id and cb.barber_id=v_barber
 ) then
  -- Reuse without exposing or changing the unrelated card. Linking grants visibility.
  -- Contact matching is limited to staff who provide the complete phone or email.
  null;
 else
  update public.clients set name=v_name,phone=v_phone,email=v_email,updated_at=now()
   where id=v_client.id returning * into v_client;
 end if;
 if v_barber is not null then
  insert into public.client_barbers(client_id,barber_id) values(v_client.id,v_barber) on conflict do nothing;
 end if;
 return v_client;
end; $$;
revoke all on function public.save_client(uuid,text,text,text) from public,anon;
grant execute on function public.save_client(uuid,text,text,text) to authenticated;

-- Remove unrestricted cross-barber order access.
drop policy authenticated_staff_read_payment_orders on public.appointment_payment_orders;
create policy staff_read_payment_orders on public.appointment_payment_orders for select to authenticated
 using ((select public.is_operator()) or exists(select 1 from public.appointments a
 where a.id=appointment_payment_orders.appointment_id and a.barber_id=(select public.current_staff_barber_id())));

-- Scope the existing operational policies; do not expand maintenance/profile policies.
alter policy "barber_can_read_own_appointments" on public."appointments" using ((public.is_operator() OR (barber_id = current_staff_barber_id())));
alter policy "staff_can_read_own_availability" on public."barber_availability_slots" using ((public.is_operator() OR (barber_id = current_staff_barber_id())));
alter policy "service_payments_select" on public."service_payments" using ((public.is_operator() OR (barber_id = current_staff_barber_id())));
alter policy "service_payments_insert" on public."service_payments" with check ((public.is_operator() OR ((barber_id = current_staff_barber_id()) AND ((created_by_user_id IS NULL) OR (created_by_user_id = auth.uid())) AND ((appointment_id IS NULL) OR (EXISTS ( SELECT 1
   FROM appointments a
  WHERE ((a.id = service_payments.appointment_id) AND (a.barber_id = current_staff_barber_id()))))))));
alter policy "service_payments_update" on public."service_payments" using ((public.is_operator() OR (barber_id = current_staff_barber_id()))) with check ((public.is_operator() OR ((barber_id = current_staff_barber_id()) AND ((appointment_id IS NULL) OR (EXISTS ( SELECT 1
   FROM appointments a
  WHERE ((a.id = service_payments.appointment_id) AND (a.barber_id = current_staff_barber_id()))))))));
alter policy "payment_attempts_staff_read" on public."payment_attempts" using ((public.is_operator() OR (EXISTS ( SELECT 1
   FROM appointments a
  WHERE ((a.id = payment_attempts.appointment_id) AND (a.barber_id = current_staff_barber_id()))))));
alter policy "staff_can_read_notification_dispatches" on public."appointment_notification_dispatches" using ((public.is_operator() OR (EXISTS ( SELECT 1
   FROM appointments a
  WHERE ((a.id = appointment_notification_dispatches.appointment_id) AND (a.barber_id = current_staff_barber_id()))))));

CREATE OR REPLACE FUNCTION public.create_availability_slots(p_barber_id uuid, p_slot_dates date[], p_start_time time without time zone, p_end_time time without time zone DEFAULT NULL::time without time zone)
 RETURNS SETOF barber_availability_slots
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
DECLARE
  v_date date;
  v_today date := (timezone('America/Argentina/Buenos_Aires', clock_timestamp()))::date;
  v_is_admin boolean := public.is_operator();
  v_staff_barber_id uuid := public.current_staff_barber_id();
  v_end_time time;
  v_existing public.barber_availability_slots%ROWTYPE;
  v_slot public.barber_availability_slots%ROWTYPE;
  v_conflict_apt record;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION USING errcode = '42501', message = 'AUTH_REQUIRED';
  END IF;

  IF NOT v_is_admin AND (v_staff_barber_id IS NULL OR v_staff_barber_id IS DISTINCT FROM p_barber_id) THEN
    RAISE EXCEPTION USING errcode = '42501', message = 'AVAILABILITY_NOT_ALLOWED';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.barbers b WHERE b.id = p_barber_id AND b.active = true) THEN
    RAISE EXCEPTION USING errcode = '22023', message = 'BARBER_NOT_FOUND';
  END IF;

  IF p_slot_dates IS NULL OR cardinality(p_slot_dates) = 0 THEN
    RAISE EXCEPTION USING errcode = '22023', message = 'DATE_REQUIRED';
  END IF;

  IF p_start_time IS NULL
     OR extract(second from p_start_time) <> 0
     OR p_start_time < time '00:00'
     OR p_start_time > time '23:55'
     OR (extract(minute from p_start_time)::int % 5 <> 0 AND p_start_time <> time '00:00') THEN
    RAISE EXCEPTION USING errcode = '22023', message = 'START_TIME_NOT_ALLOWED';
  END IF;

  IF p_end_time IS NOT NULL
     AND (extract(second from p_end_time) <> 0
       OR (extract(minute from p_end_time)::int % 5 <> 0)
       OR (p_end_time <= p_start_time AND p_end_time <> time '00:00:00')
       OR p_end_time > time '23:55') THEN
    RAISE EXCEPTION USING errcode = '22023', message = 'END_TIME_INVALID';
  END IF;

  v_end_time := coalesce(
    p_end_time,
    (p_start_time + interval '45 minutes')::time
  );

  FOREACH v_date IN ARRAY p_slot_dates LOOP
    -- Permitir cualquier fecha vigente o futura, incluyendo domingos (para ADMIN y BARBER propio)
    IF v_date IS NULL OR v_date < v_today THEN
      RAISE EXCEPTION USING errcode = '22023', message = 'AVAILABILITY_DATE_INVALID';
    END IF;

    PERFORM pg_advisory_xact_lock(hashtextextended(p_barber_id::text || '|' || v_date::text, 0));

    SELECT s.* INTO v_existing
    FROM public.barber_availability_slots s
    WHERE s.barber_id = p_barber_id
      AND s.slot_date = v_date
      AND s.start_time = p_start_time
    LIMIT 1;

    SELECT a.start_time, a.end_time, b.name INTO v_conflict_apt
    FROM public.appointments a
    JOIN public.barbers b ON b.id = a.barber_id
    WHERE a.barber_id = p_barber_id
      AND a.booking_date = v_date
      AND a.status <> 'CANCELLED'
      AND tsrange(
        v_date + p_start_time,
        (v_date + CASE WHEN v_end_time <= p_start_time THEN 1 ELSE 0 END) + v_end_time,
        '[)'
      ) && tsrange(
        a.booking_date + a.start_time,
        (a.booking_date + CASE WHEN a.end_time <= a.start_time THEN 1 ELSE 0 END) + a.end_time,
        '[)'
      )
    ORDER BY a.start_time
    LIMIT 1;

    IF FOUND THEN
      RAISE EXCEPTION USING errcode = '23P01',
        message = 'AVAILABILITY_APPOINTMENT_CONFLICT:' || v_conflict_apt.name || ':' || to_char(v_conflict_apt.start_time, 'HH24:MI') || ':' || to_char(v_conflict_apt.end_time, 'HH24:MI');
    END IF;

    IF EXISTS (
      SELECT 1 FROM public.barber_availability_slots s
      WHERE s.barber_id = p_barber_id
        AND s.slot_date = v_date
        AND s.status = 'UNAVAILABLE'
        AND s.start_time <> p_start_time
        AND tsrange(
          v_date + p_start_time,
          (v_date + CASE WHEN v_end_time <= p_start_time THEN 1 ELSE 0 END) + v_end_time,
          '[)'
        ) && tsrange(
          s.slot_date + s.start_time,
          (s.slot_date + CASE WHEN s.end_time <= s.start_time THEN 1 ELSE 0 END) + s.end_time,
          '[)'
        )
    ) THEN
      RAISE EXCEPTION USING errcode = '23P01', message = 'AVAILABILITY_BLOCKED_START';
    END IF;

    IF v_existing.id IS NOT NULL THEN
      UPDATE public.barber_availability_slots
      SET end_time = v_end_time,
          status = 'AVAILABLE',
          updated_by = auth.uid(),
          updated_at = now()
      WHERE id = v_existing.id
      RETURNING * INTO v_slot;

      RETURN NEXT v_slot;
      CONTINUE;
    END IF;

    INSERT INTO public.barber_availability_slots (
      barber_id, slot_date, start_time, end_time, status, updated_by
    ) VALUES (
      p_barber_id, v_date, p_start_time, v_end_time, 'AVAILABLE', auth.uid()
    ) RETURNING * INTO v_slot;

    RETURN NEXT v_slot;
  END LOOP;
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_availability_slot(p_slot_id uuid, p_status availability_status, p_internal_note text DEFAULT NULL::text)
 RETURNS SETOF barber_availability_slots
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
DECLARE
  v_barber_id uuid;
  v_slot_date date;
  v_slot public.barber_availability_slots%ROWTYPE;
  v_conflict_apt record;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION USING errcode = '42501', message = 'AUTH_REQUIRED';
  END IF;

  IF p_internal_note IS NOT NULL AND length(p_internal_note) > 500 THEN
    RAISE EXCEPTION USING errcode = '22023', message = 'INTERNAL_NOTE_TOO_LONG';
  END IF;

  SELECT s.barber_id, s.slot_date INTO v_barber_id, v_slot_date
  FROM public.barber_availability_slots s
  WHERE s.id = p_slot_id
    AND (public.is_operator() OR s.barber_id = public.current_staff_barber_id());

  IF NOT found THEN
    RAISE EXCEPTION USING errcode = '42501', message = 'AVAILABILITY_NOT_ALLOWED';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_barber_id::text || '|' || v_slot_date::text, 0));

  SELECT s.* INTO v_slot
  FROM public.barber_availability_slots s
  WHERE s.id = p_slot_id
  FOR UPDATE;

  IF NOT found THEN
    RAISE EXCEPTION USING errcode = 'P0002', message = 'AVAILABILITY_NOT_FOUND';
  END IF;

  -- Comprobar conflicto con turno existente usando tsrange para soportar cruce de medianoche
  SELECT a.start_time, a.end_time, b.name INTO v_conflict_apt
  FROM public.appointments a
  JOIN public.barbers b ON b.id = a.barber_id
  WHERE a.barber_id = v_slot.barber_id
    AND a.booking_date = v_slot.slot_date
    AND a.status <> 'CANCELLED'
    AND tsrange(
      a.booking_date + a.start_time,
      (a.booking_date + CASE WHEN a.end_time <= a.start_time THEN 1 ELSE 0 END) + a.end_time,
      '[)'
    ) && tsrange(
      v_slot.slot_date + v_slot.start_time,
      (v_slot.slot_date + CASE WHEN v_slot.end_time <= v_slot.start_time THEN 1 ELSE 0 END) + v_slot.end_time,
      '[)'
    )
  ORDER BY a.start_time ASC
  LIMIT 1;

  IF found AND p_status = 'UNAVAILABLE' THEN
    RAISE EXCEPTION USING errcode = '23P01', message = 'AVAILABILITY_APPOINTMENT_CONFLICT:' || v_conflict_apt.name || ':' || to_char(v_conflict_apt.start_time, 'HH24:MI') || ':' || to_char(v_conflict_apt.end_time, 'HH24:MI');
  END IF;

  UPDATE public.barber_availability_slots
  SET status = p_status,
      internal_note = nullif(trim(p_internal_note), ''),
      updated_by = auth.uid(),
      updated_at = now()
  WHERE id = p_slot_id
  RETURNING * INTO v_slot;

  RETURN NEXT v_slot;
END;
$function$;

CREATE OR REPLACE FUNCTION public.create_manual_appointment(p_barber_id uuid, p_service_id uuid DEFAULT NULL::uuid, p_custom_service_name text DEFAULT NULL::text, p_service_price_ars integer DEFAULT NULL::integer, p_booking_date date DEFAULT NULL::date, p_start_time time without time zone DEFAULT NULL::time without time zone, p_end_time time without time zone DEFAULT NULL::time without time zone, p_client_name text DEFAULT NULL::text, p_client_phone text DEFAULT NULL::text, p_client_email text DEFAULT NULL::text, p_notes text DEFAULT NULL::text, p_is_recurring boolean DEFAULT false, p_duration_minutes integer DEFAULT NULL::integer, p_deposit_required boolean DEFAULT false, p_client_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(appointment_id uuid, appointment_status appointment_status, booking_date date, start_time time without time zone, end_time time without time zone, request_number bigint, is_manual boolean, origin text, created_by_display_name text, custom_service_name text, service_price_ars integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
DECLARE
  v_staff_barber_id uuid;
  v_is_admin boolean;
  v_creator_user_id uuid := auth.uid();
  v_creator_name text;
  v_barber public.barbers%ROWTYPE;
  v_service public.services%ROWTYPE;
  v_duration_min integer;
  v_end_time time;
  v_start_ts timestamp;
  v_end_ts timestamp;
  v_client_id uuid;
  v_clean_name text;
  v_clean_email text;
  v_clean_phone text;
  v_final_service_name text;
  v_final_price integer;
  v_conflict_start time;
  v_conflict_end time;

  v_res_apt_id uuid;
  v_res_status public.appointment_status;
  v_res_booking_date date;
  v_res_start_time time;
  v_res_end_time time;
  v_res_req_num bigint;
BEGIN
  IF v_creator_user_id IS NULL THEN
    RAISE EXCEPTION USING errcode = '42501', message = 'AUTH_REQUIRED';
  END IF;

  v_is_admin := public.is_operator();
  v_staff_barber_id := public.current_staff_barber_id();

  IF NOT v_is_admin AND (v_staff_barber_id IS NULL OR v_staff_barber_id IS DISTINCT FROM p_barber_id) THEN
    RAISE EXCEPTION USING errcode = '42501', message = 'MANUAL_APPOINTMENT_NOT_ALLOWED';
  END IF;

  IF v_is_admin THEN
    select display_name into v_creator_name from public.staff_profiles where user_id=auth.uid() and active;
  ELSE
    SELECT b.name INTO v_creator_name FROM public.barbers b WHERE b.id = v_staff_barber_id;
    v_creator_name := coalesce(v_creator_name, 'Barbero');
  END IF;

  IF p_barber_id IS NULL THEN RAISE EXCEPTION USING errcode = '22023', message = 'BARBER_REQUIRED'; END IF;
  IF p_booking_date IS NULL THEN RAISE EXCEPTION USING errcode = '22023', message = 'DATE_REQUIRED'; END IF;
  IF p_start_time IS NULL THEN RAISE EXCEPTION USING errcode = '22023', message = 'START_TIME_REQUIRED'; END IF;

  SELECT b.* INTO STRICT v_barber
  FROM public.barbers b
  WHERE b.id = p_barber_id AND b.active = true;

  IF p_service_id IS NOT NULL THEN
    SELECT s.* INTO STRICT v_service
    FROM public.services s
    WHERE s.id = p_service_id AND s.active = true;
    v_final_service_name := v_service.name;
    v_final_price := coalesce(p_service_price_ars, v_service.price_ars);
    v_duration_min := coalesce(p_duration_minutes, v_service.duration_minutes, 45);
  ELSE
    v_final_service_name := nullif(trim(coalesce(p_custom_service_name, '')), '');
    IF v_final_service_name IS NULL THEN
      RAISE EXCEPTION USING errcode = '22023', message = 'CUSTOM_SERVICE_NAME_REQUIRED';
    END IF;
    v_final_price := coalesce(p_service_price_ars, 0);
    v_duration_min := coalesce(p_duration_minutes, 45);
  END IF;

  IF v_duration_min <= 0 THEN
    v_duration_min := 45;
  END IF;

  IF p_end_time IS NOT NULL THEN
    v_end_time := p_end_time;
  ELSE
    v_start_ts := p_booking_date + p_start_time;
    v_end_ts := v_start_ts + (v_duration_min * interval '1 minute');
    v_end_time := v_end_ts::time;
  END IF;

  v_clean_name := trim(coalesce(p_client_name, ''));
  IF length(v_clean_name) < 2 THEN
    RAISE EXCEPTION USING errcode = '22023', message = 'CLIENT_NAME_INVALID';
  END IF;

  v_clean_phone := trim(coalesce(p_client_phone, ''));
  IF length(regexp_replace(v_clean_phone, '[^0-9]', '', 'g')) < 6 THEN
    RAISE EXCEPTION USING errcode = '22023', message = 'CLIENT_PHONE_INVALID';
  END IF;

  v_clean_email := nullif(lower(trim(coalesce(p_client_email, ''))), '');
  IF v_clean_email IS NOT NULL AND (position('@' in v_clean_email) <= 1 OR v_clean_email LIKE '%@kanibarber.internal') THEN
    v_clean_email := NULL;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_barber.id::text || '|' || p_booking_date::text, 0));

  SELECT existing.start_time, existing.end_time
  INTO v_conflict_start, v_conflict_end
  FROM public.appointments existing
  WHERE existing.barber_id = v_barber.id
    AND existing.booking_date = p_booking_date
    AND existing.status IN ('CONFIRMED', 'COMPLETED', 'PENDING')
    AND (
      existing.status <> 'PENDING'
      OR existing.created_at + interval '10 minutes' > clock_timestamp()
    )
    AND (
      (v_end_time > p_start_time AND existing.start_time < v_end_time AND existing.end_time > p_start_time)
      OR (v_end_time <= p_start_time AND (existing.start_time >= p_start_time OR existing.end_time <= v_end_time))
    )
  ORDER BY existing.start_time ASC
  LIMIT 1;

  IF v_conflict_start IS NOT NULL THEN
    RAISE EXCEPTION USING errcode = '23505',
      message = 'APPOINTMENT_COLLISION_DETAILS|' || v_conflict_start::text || '|' || v_conflict_end::text;
  END IF;

  SELECT c.id INTO v_client_id FROM public.save_client(p_client_id,v_clean_name,v_clean_phone,v_clean_email) c;

  -- Importante: el turno manual reserva directamente el intervalo para este cliente
  -- SIN crear ni abrir disponibilidad pública en barber_availability_slots.
  INSERT INTO public.appointments AS a (
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
    deposit_paid,
    booking_client_name
  ) VALUES (
    v_client_id,
    v_barber.id,
    p_service_id,
    CASE WHEN p_service_id IS NULL THEN v_final_service_name ELSE NULL END,
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
    false,
    v_clean_name
  )
  RETURNING a.id, a.status, a.booking_date, a.start_time, a.end_time, a.request_number
  INTO v_res_apt_id, v_res_status, v_res_booking_date, v_res_start_time, v_res_end_time, v_res_req_num;

  RETURN QUERY SELECT
    v_res_apt_id,
    v_res_status,
    v_res_booking_date,
    v_res_start_time,
    v_res_end_time,
    v_res_req_num,
    true,
    'MANUAL'::text,
    v_creator_name,
    v_final_service_name,
    v_final_price;
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_manual_appointment(p_appointment_id uuid, p_barber_id uuid, p_service_id uuid DEFAULT NULL::uuid, p_custom_service_name text DEFAULT NULL::text, p_service_price_ars integer DEFAULT NULL::integer, p_booking_date date DEFAULT NULL::date, p_start_time time without time zone DEFAULT NULL::time without time zone, p_end_time time without time zone DEFAULT NULL::time without time zone, p_client_name text DEFAULT NULL::text, p_client_phone text DEFAULT NULL::text, p_client_email text DEFAULT NULL::text, p_notes text DEFAULT NULL::text, p_duration_minutes integer DEFAULT NULL::integer)
 RETURNS TABLE(appointment_id uuid, appointment_status appointment_status, booking_date date, start_time time without time zone, end_time time without time zone, request_number bigint, is_manual boolean, origin text, created_by_display_name text, custom_service_name text, service_price_ars integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
DECLARE
  v_staff_barber_id uuid;
  v_is_admin boolean;
  v_appt public.appointments%ROWTYPE;
  v_barber public.barbers%ROWTYPE;
  v_service public.services%ROWTYPE;
  v_duration_min integer;
  v_end_time time;
  v_start_ts timestamp;
  v_end_ts timestamp;
  v_clean_name text;
  v_clean_phone text;
  v_clean_email text;
  v_final_service_name text;
  v_final_price integer;
  v_conflict_start time;
  v_conflict_end time;

  v_res_apt_id uuid;
  v_res_status public.appointment_status;
  v_res_booking_date date;
  v_res_start_time time;
  v_res_end_time time;
  v_res_req_num bigint;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION USING errcode = '42501', message = 'AUTH_REQUIRED';
  END IF;

  v_is_admin := public.is_operator();
  v_staff_barber_id := public.current_staff_barber_id();

  SELECT a.* INTO STRICT v_appt
  FROM public.appointments a
  WHERE a.id = p_appointment_id;

  IF NOT v_is_admin AND (v_staff_barber_id IS NULL OR v_staff_barber_id IS DISTINCT FROM v_appt.barber_id OR v_staff_barber_id IS DISTINCT FROM p_barber_id) THEN
    RAISE EXCEPTION USING errcode = '42501', message = 'MANUAL_APPOINTMENT_NOT_ALLOWED';
  END IF;

  IF p_barber_id IS NULL THEN RAISE EXCEPTION USING errcode = '22023', message = 'BARBER_REQUIRED'; END IF;
  IF p_booking_date IS NULL THEN RAISE EXCEPTION USING errcode = '22023', message = 'DATE_REQUIRED'; END IF;
  IF p_start_time IS NULL THEN RAISE EXCEPTION USING errcode = '22023', message = 'START_TIME_REQUIRED'; END IF;

  SELECT b.* INTO STRICT v_barber
  FROM public.barbers b
  WHERE b.id = p_barber_id AND b.active = true;

  IF p_service_id IS NOT NULL THEN
    SELECT s.* INTO STRICT v_service
    FROM public.services s
    WHERE s.id = p_service_id AND s.active = true;
    v_final_service_name := v_service.name;
    v_final_price := coalesce(p_service_price_ars, v_service.price_ars);
    v_duration_min := coalesce(p_duration_minutes, v_service.duration_minutes, 45);
  ELSE
    v_final_service_name := nullif(trim(coalesce(p_custom_service_name, v_appt.custom_service_name, '')), '');
    IF v_final_service_name IS NULL THEN
      RAISE EXCEPTION USING errcode = '22023', message = 'CUSTOM_SERVICE_NAME_REQUIRED';
    END IF;
    v_final_price := coalesce(p_service_price_ars, v_appt.service_price_ars, 0);
    v_duration_min := coalesce(p_duration_minutes, 45);
  END IF;

  IF v_duration_min <= 0 THEN
    v_duration_min := 45;
  END IF;

  IF p_end_time IS NOT NULL THEN
    v_end_time := p_end_time;
  ELSE
    v_start_ts := p_booking_date + p_start_time;
    v_end_ts := v_start_ts + (v_duration_min * interval '1 minute');
    v_end_time := v_end_ts::time;
  END IF;

  v_clean_name := trim(coalesce(p_client_name, ''));
  v_clean_phone := trim(coalesce(p_client_phone, ''));
  v_clean_email := nullif(lower(trim(coalesce(p_client_email, ''))), '');
  IF v_clean_email IS NOT NULL AND (position('@' in v_clean_email) <= 1 OR v_clean_email LIKE '%@kanibarber.internal') THEN
    v_clean_email := NULL;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_barber.id::text || '|' || p_booking_date::text, 0));

  SELECT existing.start_time, existing.end_time
  INTO v_conflict_start, v_conflict_end
  FROM public.appointments existing
  WHERE existing.barber_id = v_barber.id
    AND existing.booking_date = p_booking_date
    AND existing.id <> p_appointment_id
    AND existing.status IN ('CONFIRMED', 'COMPLETED', 'PENDING')
    AND (
      existing.status <> 'PENDING'
      OR existing.created_at + interval '10 minutes' > clock_timestamp()
    )
    AND (
      (v_end_time > p_start_time AND existing.start_time < v_end_time AND existing.end_time > p_start_time)
      OR (v_end_time <= p_start_time AND (existing.start_time >= p_start_time OR existing.end_time <= v_end_time))
    )
  ORDER BY existing.start_time ASC
  LIMIT 1;

  IF v_conflict_start IS NOT NULL THEN
    RAISE EXCEPTION USING errcode = '23505',
      message = 'APPOINTMENT_COLLISION_DETAILS|' || v_conflict_start::text || '|' || v_conflict_end::text;
  END IF;

  IF v_appt.client_id IS NOT NULL AND (length(v_clean_name) >= 2 OR length(regexp_replace(v_clean_phone, '[^0-9]', '', 'g')) >= 6) THEN
    UPDATE public.clients
    SET name = CASE WHEN length(v_clean_name) >= 2 THEN v_clean_name ELSE name END,
        phone = CASE WHEN length(regexp_replace(v_clean_phone, '[^0-9]', '', 'g')) >= 6 THEN v_clean_phone ELSE phone END,
        email = coalesce(v_clean_email, email),
        updated_at = now()
    WHERE id = v_appt.client_id;
  END IF;

  UPDATE public.appointments AS a
  SET barber_id = p_barber_id,
      service_id = p_service_id,
      custom_service_name = CASE WHEN p_service_id IS NULL THEN v_final_service_name ELSE NULL END,
      service_price_ars = v_final_price,
      booking_date = p_booking_date,
      start_time = p_start_time,
      end_time = v_end_time,
      notes = nullif(trim(coalesce(p_notes, '')), ''),
      booking_client_name = CASE WHEN length(v_clean_name) >= 2 THEN v_clean_name ELSE booking_client_name END,
      updated_at = now()
  WHERE a.id = p_appointment_id
  RETURNING a.id, a.status, a.booking_date, a.start_time, a.end_time, a.request_number
  INTO v_res_apt_id, v_res_status, v_res_booking_date, v_res_start_time, v_res_end_time, v_res_req_num;

  RETURN QUERY SELECT
    v_res_apt_id,
    v_res_status,
    v_res_booking_date,
    v_res_start_time,
    v_res_end_time,
    v_res_req_num,
    v_appt.is_manual,
    v_appt.origin,
    v_appt.created_by_display_name,
    v_final_service_name,
    v_final_price;
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_appointment_status(p_appointment_id uuid, p_status appointment_status)
 RETURNS TABLE(appointment_status appointment_status, notification_claim_token text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'extensions'
AS $function$
declare
  v_current_status public.appointment_status;
  v_barber_id uuid;
  v_booking_date date;
  v_is_manual boolean;
begin
  if (select auth.uid()) is null then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;
  if p_status not in ('CANCELLED', 'COMPLETED') then
    raise exception using errcode = '22023', message = 'STATUS_NOT_ALLOWED';
  end if;

  select a.status, a.barber_id, a.booking_date, a.is_manual
    into v_current_status, v_barber_id, v_booking_date, v_is_manual
  from public.appointments a
  where a.id = p_appointment_id
    and (public.is_operator() or a.barber_id = public.current_staff_barber_id());

  if v_barber_id is null then
    raise exception using errcode = '42501', message = 'APPOINTMENT_NOT_ALLOWED';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_barber_id::text || '|' || v_booking_date::text, 0));
  select a.status into v_current_status from public.appointments a where a.id=p_appointment_id for update;

  if v_current_status = p_status then
    appointment_status := v_current_status;
    notification_claim_token := null;
    return next;
    return;
  end if;

  if p_status = 'CONFIRMED' and v_current_status <> 'PENDING' then
    raise exception using errcode = '22023', message = 'STATUS_TRANSITION_NOT_ALLOWED';
  end if;
  if p_status = 'CANCELLED' and v_current_status not in ('PENDING', 'CONFIRMED') then
    raise exception using errcode = '22023', message = 'STATUS_TRANSITION_NOT_ALLOWED';
  end if;
  if p_status = 'COMPLETED' and v_current_status <> 'CONFIRMED' then
    raise exception using errcode = '22023', message = 'STATUS_TRANSITION_NOT_ALLOWED';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_barber_id::text || '|' || v_booking_date::text, 0));

  update public.appointments as updated
  set status = p_status, updated_at = now(),
      cancellation_reason = case when p_status='CANCELLED' then 'STAFF_CANCELLED' else updated.cancellation_reason end,
      cancelled_at = case when p_status='CANCELLED' then now() else updated.cancelled_at end,
      cancelled_by = case when p_status='CANCELLED' then auth.uid() else updated.cancelled_by end
  where updated.id = p_appointment_id
  returning updated.status into appointment_status;

  if appointment_status = 'CONFIRMED' then
    notification_claim_token := public.create_appointment_notification_event(p_appointment_id, 'CONFIRMED');
  elsif appointment_status = 'CANCELLED' then
    notification_claim_token := public.create_appointment_notification_event(p_appointment_id, 'CANCELLED');
  else
    notification_claim_token := null;
  end if;

  return next;
end;
$function$;

CREATE OR REPLACE FUNCTION public.retry_appointment_notification(p_appointment_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'extensions'
AS $function$
declare
  v_token text := gen_random_uuid()::text;
  v_event_id uuid;
begin
  if (select auth.uid()) is null then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;
  select e.id into v_event_id
  from public.appointments a
  join public.appointment_notification_events e on e.appointment_id = a.id
  where a.id = p_appointment_id
    and (public.is_operator() or a.barber_id = public.current_staff_barber_id())
    and e.notification_type = case a.status
      when 'PENDING' then 'NEW_REQUEST'::public.notification_type
      when 'CONFIRMED' then 'CONFIRMED'::public.notification_type
      when 'CANCELLED' then 'CANCELLED'::public.notification_type
      else null::public.notification_type
    end
    and (e.status in ('PENDING', 'FAILED') or
         (e.status = 'SENDING' and e.updated_at <= now() - interval '10 minutes'))
  limit 1
  for update of e;

  if v_event_id is null then
    return null;
  end if;
  update public.appointment_notification_events as e
  set claim_token_digest = encode(digest(v_token, 'sha256'), 'hex'),
      status = 'PENDING', updated_at = now()
  where e.id = v_event_id;
  return v_token;
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_online_deposit_movements(p_barber_id uuid DEFAULT NULL::uuid, p_start_date date DEFAULT NULL::date, p_end_date date DEFAULT NULL::date)
 RETURNS TABLE(movement_id text, appointment_id uuid, provider text, amount_ars numeric, payment_date date, payment_time text, payment_timestamp timestamp with time zone, barber_id uuid, barber_name text, service_name text, client_name text, client_contact text, appointment_date date, appointment_time text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
DECLARE
  v_is_admin boolean := public.is_operator();
  v_staff_barber_id uuid := public.current_staff_barber_id();
  v_filter_barber uuid;
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN
    RAISE EXCEPTION USING errcode = '42501', message = 'AUTH_REQUIRED';
  END IF;

  IF NOT v_is_admin THEN
    IF v_staff_barber_id IS NULL THEN
      RAISE EXCEPTION USING errcode = '42501', message = 'FORBIDDEN_STAFF_REQUIRED';
    END IF;
    v_filter_barber := v_staff_barber_id;
  ELSE
    v_filter_barber := p_barber_id;
  END IF;

  RETURN QUERY
  SELECT
    ('deposit-' || a.id::text)::text AS movement_id,
    a.id AS appointment_id,
    coalesce(pa.provider, 'PAYWAY')::text AS provider,
    coalesce(pa.amount_ars, a.deposit_amount_ars::numeric, 5000::numeric) AS amount_ars,
    (timezone('America/Argentina/Buenos_Aires', coalesce(pa.created_at, a.created_at)))::date AS payment_date,
    to_char(timezone('America/Argentina/Buenos_Aires', coalesce(pa.created_at, a.created_at)), 'HH24:MI') AS payment_time,
    coalesce(pa.created_at, a.created_at) AS payment_timestamp,
    a.barber_id,
    coalesce(b.name, 'Barbero')::text AS barber_name,
    ('Seña - ' || CASE WHEN coalesce(a.custom_service_name, s.name, 'Corte') = 'Corte + barba' THEN 'Corte y barba' ELSE coalesce(a.custom_service_name, s.name, 'Corte') END)::text AS service_name,
    coalesce(a.booking_client_name, c.name, 'Cliente')::text AS client_name,
    coalesce(c.phone, '')::text AS client_contact,
    a.booking_date AS appointment_date,
    to_char(a.start_time, 'HH24:MI') AS appointment_time
  FROM public.appointments a
  JOIN LATERAL (
    SELECT p.id, p.provider, p.amount_ars, p.created_at
    FROM public.payment_attempts p
    WHERE p.appointment_id = a.id
      AND p.state = 'APPROVED'
    ORDER BY p.created_at DESC
    LIMIT 1
  ) pa ON true
  JOIN public.barbers b ON b.id = a.barber_id
  LEFT JOIN public.services s ON s.id = a.service_id
  LEFT JOIN public.clients c ON c.id = a.client_id
  WHERE a.status <> 'CANCELLED'
    AND (v_filter_barber IS NULL OR a.barber_id = v_filter_barber)
    AND (
      p_start_date IS NULL
      OR (timezone('America/Argentina/Buenos_Aires', coalesce(pa.created_at, a.created_at)))::date >= p_start_date
    )
    AND (
      p_end_date IS NULL
      OR (timezone('America/Argentina/Buenos_Aires', coalesce(pa.created_at, a.created_at)))::date <= p_end_date
    )
  ORDER BY coalesce(pa.created_at, a.created_at) DESC;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_appointment_payment_details(p_appointment_id uuid)
 RETURNS TABLE(appointment_id uuid, appointment_status appointment_status, booking_date date, start_time time without time zone, end_time time without time zone, barber_id uuid, barber_name text, service_id uuid, service_name text, service_price_ars integer, down_payment_ars integer, client_name text, client_email text, client_phone text, created_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
DECLARE
  v_is_privileged boolean;
BEGIN
  -- Autorización estricta:
  -- Privilegiado si es service_role (backend de Mercado Pago / Payway), administrador o staff autorizado
  v_is_privileged := (
    coalesce((SELECT auth.role()), '') = 'service_role'
    OR current_user = 'service_role'
    OR public.is_operator()
    OR public.current_staff_barber_id() IS NOT NULL
  );

  RETURN QUERY
  SELECT
    a.id AS appointment_id,
    a.status AS appointment_status,
    a.booking_date,
    a.start_time,
    a.end_time,
    b.id AS barber_id,
    b.name AS barber_name,
    s.id AS service_id,
    s.name AS service_name,
    coalesce(a.service_price_ars, bsp.price_ars, s.price_ars) AS service_price_ars,
    coalesce(a.deposit_amount_ars, 5000) AS down_payment_ars,
    coalesce(a.booking_client_name, c.name) AS client_name,
    -- Protección de datos personales (PII): anon no recibe email ni teléfono sin enmascarar
    CASE
      WHEN v_is_privileged THEN coalesce(c.email, '')
      ELSE regexp_replace(coalesce(c.email, ''), '^(.)(.*)(@.*)$', '\1***\3')
    END AS client_email,
    CASE
      WHEN v_is_privileged THEN coalesce(c.phone, '')
      ELSE regexp_replace(coalesce(c.phone, ''), '(\d{2})\d+(\d{2})$', '\1****\2')
    END AS client_phone,
    a.created_at
  FROM public.appointments a
  JOIN public.barbers b ON b.id = a.barber_id
  JOIN public.services s ON s.id = a.service_id
  LEFT JOIN public.clients c ON c.id = a.client_id
  LEFT JOIN public.barber_service_prices bsp ON bsp.barber_id = a.barber_id AND bsp.service_id = a.service_id AND bsp.active = true
  WHERE a.id = p_appointment_id
    -- Si el visitante es anónimo (no privilegiado), solo puede consultar reservas recientes (ventana de pago / confirmación de 48 hs)
    -- en estado PENDING o CONFIRMED, impidiendo el scraping de turnos históricos
    AND (
      v_is_privileged
      OR (a.created_at >= (now() - interval '48 hours') AND a.status IN ('PENDING', 'CONFIRMED'))
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.delete_client(p_client_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_is_admin boolean := public.is_operator();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION USING errcode = '42501', message = 'AUTH_REQUIRED';
  END IF;

  IF NOT v_is_admin THEN
    RAISE EXCEPTION USING errcode = '42501', message = 'FORBIDDEN_ADMIN_REQUIRED: Solo los administradores pueden eliminar clientes.';
  END IF;

  IF p_client_id IS NULL THEN
    RAISE EXCEPTION USING errcode = '22023', message = 'CLIENT_ID_REQUIRED';
  END IF;

  -- Baja lógica: preservar integridad de turnos, pagos y registros históricos
  UPDATE public.clients
  SET deleted_at = now(),
      updated_at = now()
  WHERE id = p_client_id
    AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING errcode = 'P0002', message = 'CLIENT_NOT_FOUND';
  END IF;

  RETURN true;
END;
$function$;

CREATE OR REPLACE FUNCTION public.record_service_payment(p_barber_id uuid, p_service_name text, p_service_other_detail text DEFAULT NULL::text, p_service_price_ars integer DEFAULT NULL::integer, p_discount_ars integer DEFAULT 0, p_payment_date date DEFAULT NULL::date, p_payment_time time without time zone DEFAULT NULL::time without time zone, p_payment_method text DEFAULT 'Efectivo'::text, p_online_deposit_paid boolean DEFAULT false, p_client_name text DEFAULT NULL::text, p_client_contact text DEFAULT NULL::text, p_appointment_id uuid DEFAULT NULL::uuid, p_service_origin text DEFAULT NULL::text)
 RETURNS TABLE(payment_id uuid, barber_id uuid, service_name text, final_amount_ars integer, collected_amount_ars integer, payment_date date, payment_time time without time zone, appointment_id uuid, service_origin text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_is_admin boolean := public.is_operator();
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
  v_final_service_name text;
  v_other_detail text;
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

  -- Resolver nombre y precio del servicio
  v_other_detail := nullif(trim(coalesce(p_service_other_detail, '')), '');

  if p_service_name in ('Corte', 'Corte y barba', 'Corte + barba', 'Barba') then
    select id, price_ars into v_service_id, v_service_price
    from public.services
    where name = p_service_name or (p_service_name = 'Corte y barba' and name = 'Corte + barba')
    limit 1;

    v_service_price := coalesce(p_service_price_ars, v_service_price, 25000);
    v_final_service_name := p_service_name;
  elsif p_service_name in ('Otro', 'Otros') then
    if v_other_detail is null then
      raise exception 'OTHER_SERVICE_DETAIL_REQUIRED';
    end if;
    if p_service_price_ars is null or p_service_price_ars <= 0 then
      raise exception 'OTHER_SERVICE_PRICE_REQUIRED';
    end if;
    v_service_price := p_service_price_ars;
    v_final_service_name := v_other_detail;
  else
    -- Nombre libre (ej. 'Tintura de color' proveniente de un appointment o manual)
    if length(trim(coalesce(p_service_name, ''))) < 2 then
      raise exception 'INVALID_SERVICE_NAME';
    end if;
    if p_service_price_ars is null or p_service_price_ars <= 0 then
      raise exception 'OTHER_SERVICE_PRICE_REQUIRED';
    end if;
    v_service_price := p_service_price_ars;
    v_final_service_name := trim(p_service_name);
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

  v_date := coalesce(p_payment_date, (timezone('America/Argentina/Buenos_Aires', clock_timestamp()))::date);
  v_time := coalesce(p_payment_time, (timezone('America/Argentina/Buenos_Aires', clock_timestamp()))::time);

  -- Validar vinculación a turno
  if p_appointment_id is not null then
    select * into v_apt from public.appointments where id = p_appointment_id for update;
    if not found then raise exception 'APPOINTMENT_NOT_FOUND'; end if;
    if not v_is_admin and v_apt.barber_id <> v_staff_barber_id then raise exception 'FORBIDDEN_APPOINTMENT_SCOPE'; end if;
    if exists (select 1 from public.service_payments sp where sp.appointment_id = p_appointment_id) then
      raise exception 'APPOINTMENT_ALREADY_LINKED';
    end if;

    if coalesce(v_apt.deposit_paid, false) = true then
      v_online_deposit_paid := true;
      v_online_deposit_amount := coalesce(v_apt.deposit_amount_ars, 5000);
    else
      if p_online_deposit_paid = true then raise exception 'INVALID_ONLINE_DEPOSIT_CLAIM'; end if;
      v_online_deposit_paid := false;
      v_online_deposit_amount := 0;
    end if;

    v_collected_amount := greatest(0, v_final_amount - (case when v_online_deposit_paid then v_online_deposit_amount else 0 end));

    update public.appointments
    set balance_paid = true,
        status = case when status in ('PENDING', 'CONFIRMED') then 'COMPLETED'::public.appointment_status else status end,
        updated_at = now()
    where id = p_appointment_id;
  else
    if p_online_deposit_paid = true then raise exception 'INVALID_ONLINE_DEPOSIT_WITHOUT_APPOINTMENT'; end if;
    v_online_deposit_paid := false;
    v_online_deposit_amount := 0;
    v_collected_amount := v_final_amount;
  end if;

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
    v_final_service_name,
    v_other_detail,
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
    v_final_service_name,
    v_final_amount,
    v_collected_amount,
    v_date,
    v_time,
    p_appointment_id,
    v_origin;
end;
$function$;

CREATE OR REPLACE FUNCTION public.update_service_payment_client(p_payment_id uuid, p_client_name text, p_client_contact text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_is_admin boolean := public.is_operator();
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
$function$;

alter table public.appointment_calendar_sync enable row level security;
alter table public.barber_google_calendars enable row level security;
alter table public.benefit_codes enable row level security;
alter table public.google_calendar_oauth_tokens enable row level security;
revoke all on public.google_calendar_oauth_tokens from public,anon,authenticated;
create policy calendar_sync_admin on public.appointment_calendar_sync for all to authenticated
 using ((select public.is_admin())) with check ((select public.is_admin()));
create policy calendar_mapping_admin on public.barber_google_calendars for all to authenticated
 using ((select public.is_admin())) with check ((select public.is_admin()));
create policy benefit_codes_read_operations on public.benefit_codes for select to authenticated
 using ((select public.is_operator()));
create policy benefit_codes_admin_insert on public.benefit_codes for insert to authenticated
 with check ((select public.is_admin()));
create policy benefit_codes_admin_update on public.benefit_codes for update to authenticated
 using ((select public.is_admin())) with check ((select public.is_admin()));
create policy benefit_codes_admin_delete on public.benefit_codes for delete to authenticated
 using ((select public.is_admin()));

create table public.staff_operation_audit (
 id bigint generated always as identity primary key,
 occurred_at timestamptz not null default now(),
 actor_id uuid, actor_role public.staff_role,
 table_name text not null, record_id uuid not null, operation text not null,
 old_values jsonb, new_values jsonb
);
alter table public.staff_operation_audit enable row level security;
revoke all on public.staff_operation_audit from public,anon,authenticated;
grant select on public.staff_operation_audit to authenticated;
create policy audit_operator_read on public.staff_operation_audit for select to authenticated
 using ((select public.is_operator()));
create function kani_private.audit_staff_operation() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_before jsonb; v_after jsonb; v_role public.staff_role;
begin
 if tg_op<>'INSERT' then v_before:=to_jsonb(old); end if;
 if tg_op<>'DELETE' then v_after:=to_jsonb(new); end if;
 select role into v_role from public.staff_profiles where user_id=auth.uid() and active;
 insert into public.staff_operation_audit(actor_id,actor_role,table_name,record_id,operation,old_values,new_values)
 values(auth.uid(),v_role,tg_table_name,coalesce(new.id,old.id),tg_op,v_before,v_after);
 return coalesce(new,old);
end; $$;
revoke all on function kani_private.audit_staff_operation() from public,anon,authenticated;
create trigger audit_appointments after insert or update on public.appointments for each row execute function kani_private.audit_staff_operation();
create trigger audit_availability after insert or update or delete on public.barber_availability_slots for each row execute function kani_private.audit_staff_operation();
create trigger audit_service_payments after insert or update or delete on public.service_payments for each row execute function kani_private.audit_staff_operation();
create trigger audit_clients after update of deleted_at on public.clients for each row when (old.deleted_at is distinct from new.deleted_at) execute function kani_private.audit_staff_operation();
