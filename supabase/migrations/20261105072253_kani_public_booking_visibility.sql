-- Commercial visibility is independent of staff/account activation.
-- Additive migration; existing appointments, payments and internal schedules are untouched.
set local lock_timeout = '5s';

alter table public.barbers
  add column public_booking_enabled boolean not null default true;
comment on column public.barbers.public_booking_enabled is
  'Allows NEW public bookings only; does not disable staff access or historical/payment operations.';
-- Needed by the invoker view even on installations using column-only grants.
grant select(public_booking_enabled) on public.barbers to anon;

alter policy public_can_read_active_barbers on public.barbers
  using (active and public_booking_enabled);
alter policy public_can_read_available_slots on public.barber_availability_slots
  using (status = 'AVAILABLE' and exists (
    select 1 from public.barbers b
    where b.id = barber_availability_slots.barber_id and b.active and b.public_booking_enabled
  ));

-- The same public roster for visitors and signed-in staff. Table RLS still keeps
-- staff-only table reads scoped; this RPC exposes only the enabled public rows.
create or replace function public.read_public_booking_barbers()
returns table(id uuid, name text, public_booking_enabled boolean)
language sql stable security definer set search_path = ''
as $$
  select b.id, b.name, b.public_booking_enabled
  from public.barbers b where b.active and b.public_booking_enabled
  order by b.display_order, b.name;
$$;
revoke all on function public.read_public_booking_barbers() from public;
grant execute on function public.read_public_booking_barbers() to anon, authenticated, service_role;

-- This view is a public booking surface. Internal schedules use the scoped table/RPC.
create or replace view public.available_barber_slots with (security_invoker = true) as
 SELECT DISTINCT ON (s.barber_id, s.slot_date, segment.segment_start) s.id,
    s.barber_id,
    s.slot_date,
    (segment.segment_start)::time without time zone AS start_time,
    ((segment.segment_start + '00:05:00'::interval))::time without time zone AS end_time,
    'AVAILABLE'::availability_status AS status
   FROM ((barber_availability_slots s
     JOIN barbers b ON ((b.id = s.barber_id)))
     CROSS JOIN LATERAL generate_series((s.slot_date + s.start_time), ((s.slot_date + s.end_time) - '00:05:00'::interval), '00:05:00'::interval) segment(segment_start))
  WHERE (b.active AND b.public_booking_enabled AND (s.status = 'AVAILABLE'::availability_status) AND (s.start_time >= '10:00:00'::time without time zone) AND (s.end_time <= '20:00:00'::time without time zone) AND (s.end_time > s.start_time) AND (NOT is_public_slot_booked(s.barber_id, s.slot_date, (segment.segment_start)::time without time zone, ((segment.segment_start + '00:05:00'::interval))::time without time zone)) AND (NOT is_public_slot_blocked(s.barber_id, s.slot_date, (segment.segment_start)::time without time zone, ((segment.segment_start + '00:05:00'::interval))::time without time zone)))
  ORDER BY s.barber_id, s.slot_date, segment.segment_start, s.id;

-- Keep internal availability for the owning BARBER and ADMIN/MANAGER.
-- Anonymous, unaffiliated and service-only public lookups exclude hidden professionals.
CREATE OR REPLACE FUNCTION public.read_valid_availability_starts(p_barber_id uuid DEFAULT NULL::uuid, p_from_date date DEFAULT NULL::date, p_to_date date DEFAULT NULL::date)
 RETURNS TABLE(barber_id uuid, slot_date date, start_time time without time zone, is_exception boolean, compatible_services text[])
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
DECLARE
  v_from date := coalesce(p_from_date, (timezone('America/Argentina/Buenos_Aires', clock_timestamp()))::date);
  v_to date := coalesce(p_to_date, v_from + 21);
BEGIN
  IF v_from > v_to THEN
    RAISE EXCEPTION USING errcode = '22023', message = 'DATE_RANGE_INVALID';
  END IF;

  RETURN QUERY
  WITH recurring_base_slots AS (
    -- Horizonte dinámico continuo para Franco (Sábados 15:00 a 20:00)
    SELECT
      b.id AS barber_id,
      d::date AS slot_date,
      slot_def.start_time,
      slot_def.end_time,
      (d::date + slot_def.start_time)::timestamp AS slot_start_ts,
      ((d::date + CASE WHEN slot_def.end_time <= slot_def.start_time THEN 1 ELSE 0 END) + slot_def.end_time)::timestamp AS slot_end_ts
    FROM public.barbers b
    CROSS JOIN generate_series(v_from, v_to, interval '1 day') AS d
    CROSS JOIN (
      VALUES
        (time '15:00:00', time '15:45:00'),
        (time '15:45:00', time '16:30:00'),
        (time '16:30:00', time '17:15:00'),
        (time '17:15:00', time '18:00:00'),
        (time '18:00:00', time '18:45:00'),
        (time '18:45:00', time '19:30:00'),
        (time '19:30:00', time '20:00:00')
    ) AS slot_def(start_time, end_time)
    WHERE b.name = 'Franco'
      AND b.active = true
      AND (b.public_booking_enabled OR (select public.is_operator()) OR b.id = (select public.current_staff_barber_id()))
      AND extract(isodow from d) = 6
      AND (p_barber_id IS NULL OR b.id = p_barber_id)
      AND NOT EXISTS (
        SELECT 1
        FROM public.barber_availability_slots blk
        WHERE blk.barber_id = b.id
          AND blk.slot_date = d::date
          AND blk.status = 'UNAVAILABLE'
          AND tsrange(
            d::date + slot_def.start_time,
            (d::date + CASE WHEN slot_def.end_time <= slot_def.start_time THEN 1 ELSE 0 END) + slot_def.end_time,
            '[)'
          ) && tsrange(
            blk.slot_date + blk.start_time,
            (blk.slot_date + CASE WHEN blk.end_time <= blk.start_time THEN 1 ELSE 0 END) + blk.end_time,
            '[)'
          )
      )
  ), stored_available_slots AS (
    -- Slots explícitos almacenados en BD (incluye disponibilidades extraordinarias y manuales de barberos)
    SELECT
      s.barber_id,
      s.slot_date,
      s.start_time,
      s.end_time,
      (s.slot_date + s.start_time)::timestamp AS slot_start_ts,
      ((s.slot_date + CASE WHEN s.end_time <= s.start_time THEN 1 ELSE 0 END) + s.end_time)::timestamp AS slot_end_ts
    FROM public.barber_availability_slots s
    JOIN public.barbers b ON b.id = s.barber_id AND b.active = true
      AND (b.public_booking_enabled OR (select public.is_operator()) OR b.id = (select public.current_staff_barber_id()))
    WHERE s.status = 'AVAILABLE'
      AND s.slot_date BETWEEN v_from AND v_to
      AND (p_barber_id IS NULL OR s.barber_id = p_barber_id)
      AND (s.end_time > s.start_time OR s.end_time = time '00:00:00')
  ), available_slots AS (
    SELECT
      s.barber_id,
      s.slot_date,
      s.start_time,
      s.end_time,
      s.slot_start_ts,
      s.slot_end_ts
    FROM stored_available_slots s
    UNION
    SELECT
      r.barber_id,
      r.slot_date,
      r.start_time,
      r.end_time,
      r.slot_start_ts,
      r.slot_end_ts
    FROM recurring_base_slots r
  ), standard_candidates AS (
    SELECT DISTINCT
      s.barber_id,
      s.slot_date,
      gs.candidate_start,
      (extract(isodow from s.slot_date) = 7) AS is_exception
    FROM available_slots s
    CROSS JOIN LATERAL generate_series(
      s.slot_date + time '10:00',
      s.slot_date + time '19:00',
      interval '45 minutes'
    ) AS gs(candidate_start)
    WHERE gs.candidate_start >= s.slot_start_ts
      AND gs.candidate_start < s.slot_end_ts
  ), franco_saturday_candidates AS (
    SELECT DISTINCT
      s.barber_id,
      s.slot_date,
      (s.slot_date + franco_time.t)::timestamp AS candidate_start,
      false AS is_exception
    FROM available_slots s
    JOIN public.barbers b ON b.id = s.barber_id AND b.name = 'Franco'
    CROSS JOIN (
      VALUES
        (time '15:00:00'),
        (time '15:45:00'),
        (time '16:30:00'),
        (time '17:15:00'),
        (time '18:00:00'),
        (time '18:45:00'),
        (time '19:00:00'),
        (time '19:15:00'),
        (time '19:30:00')
    ) AS franco_time(t)
    WHERE extract(isodow from s.slot_date) = 6
      AND (s.slot_date + franco_time.t)::timestamp >= s.slot_start_ts
      AND (s.slot_date + franco_time.t)::timestamp < s.slot_end_ts
  ), extended_candidates AS (
    SELECT DISTINCT
      s.barber_id,
      s.slot_date,
      gs.candidate_start,
      true AS is_exception
    FROM available_slots s
    CROSS JOIN LATERAL generate_series(
      s.slot_start_ts,
      s.slot_end_ts - interval '5 minutes',
      interval '45 minutes'
    ) AS gs(candidate_start)
    WHERE gs.candidate_start::date = s.slot_date
  ), closing_candidates AS (
    SELECT DISTINCT
      s.barber_id,
      s.slot_date,
      (s.slot_date + offset_time.t)::timestamp AS candidate_start,
      false AS is_exception
    FROM available_slots s
    CROSS JOIN (
      VALUES (time '19:00:00'), (time '19:15:00'), (time '19:30:00')
    ) AS offset_time(t)
    WHERE (s.slot_date + offset_time.t)::timestamp >= s.slot_start_ts
      AND (s.slot_date + offset_time.t)::timestamp < s.slot_end_ts
  ), all_candidates AS (
    SELECT
      u.barber_id,
      u.slot_date,
      u.candidate_start,
      bool_and(u.is_exception) AS is_exception
    FROM (
      SELECT sc.barber_id, sc.slot_date, sc.candidate_start, sc.is_exception FROM standard_candidates sc
      UNION ALL
      SELECT fc.barber_id, fc.slot_date, fc.candidate_start, fc.is_exception FROM franco_saturday_candidates fc
      UNION ALL
      SELECT ec.barber_id, ec.slot_date, ec.candidate_start, ec.is_exception FROM extended_candidates ec
      UNION ALL
      SELECT cc.barber_id, cc.slot_date, cc.candidate_start, cc.is_exception FROM closing_candidates cc
    ) u
    GROUP BY u.barber_id, u.slot_date, u.candidate_start
  )
  SELECT
    c.barber_id,
    c.slot_date,
    c.candidate_start::time AS start_time,
    c.is_exception,
    compatibility.compatible_services
  FROM all_candidates c
  CROSS JOIN LATERAL (
    SELECT coalesce(array_agg(svc.name ORDER BY svc.name), '{}'::text[]) AS compatible_services
    FROM public.services svc
    WHERE svc.active
      AND svc.duration_minutes > 0
      AND NOT EXISTS (
        SELECT 1
        FROM generate_series(
          0,
          ceil(svc.duration_minutes::numeric / 5)::integer - 1
        ) AS requested(segment_index)
        WHERE NOT EXISTS (
          SELECT 1
          FROM available_slots available
          WHERE available.barber_id = c.barber_id
            AND available.slot_date = c.slot_date
            AND tsrange(
              c.candidate_start + requested.segment_index * interval '5 minutes',
              c.candidate_start + (requested.segment_index + 1) * interval '5 minutes', '[)'
            ) <@ tsrange(
              available.slot_date + available.start_time,
              (available.slot_date + CASE WHEN available.end_time <= available.start_time THEN 1 ELSE 0 END) + available.end_time, '[)'
            )
            AND NOT EXISTS (
              SELECT 1
              FROM public.barber_availability_slots blocked
              WHERE blocked.barber_id = c.barber_id
                AND blocked.slot_date = c.slot_date
                AND blocked.status = 'UNAVAILABLE'
                AND tsrange(
                  c.candidate_start + requested.segment_index * interval '5 minutes',
                  c.candidate_start + (requested.segment_index + 1) * interval '5 minutes', '[)'
                ) && tsrange(
                  blocked.slot_date + blocked.start_time,
                  (blocked.slot_date + CASE WHEN blocked.end_time <= blocked.start_time THEN 1 ELSE 0 END) + blocked.end_time, '[)'
                )
            )
            AND NOT EXISTS (
              SELECT 1
              FROM public.appointments a
              WHERE a.barber_id = c.barber_id
                AND a.booking_date = c.slot_date
                AND a.status <> 'CANCELLED'
                AND tsrange(
                  c.candidate_start + requested.segment_index * interval '5 minutes',
                  c.candidate_start + (requested.segment_index + 1) * interval '5 minutes', '[)'
                ) && tsrange(
                  a.booking_date + a.start_time,
                  (a.booking_date + CASE WHEN a.end_time <= a.start_time THEN 1 ELSE 0 END) + a.end_time, '[)'
                )
            )
        )
      )
  ) compatibility
  WHERE cardinality(compatibility.compatible_services) > 0
  ORDER BY c.barber_id, c.slot_date, c.candidate_start;
END;
$function$;


-- Reject before modifying contacts, generating slots or allocating a request number.
-- Lock the barber row through booking creation so disabling the flag is atomic.
CREATE OR REPLACE FUNCTION public.request_appointment(p_barber_name text, p_service_name text, p_booking_date date, p_start_time time without time zone, p_client_name text, p_client_phone text, p_client_email text, p_notes text DEFAULT NULL::text)
 RETURNS TABLE(appointment_id uuid, appointment_status appointment_status, booking_date date, start_time time without time zone, end_time time without time zone, request_number bigint, notification_claim_token text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
#variable_conflict use_column
DECLARE
  v_barber public.barbers%ROWTYPE;
  v_service public.services%ROWTYPE;
  v_client_id uuid;
  v_clean_name text := trim(coalesce(p_client_name, ''));
  v_clean_phone text := trim(coalesce(p_client_phone, ''));
  v_clean_email text := lower(trim(coalesce(p_client_email, '')));
  v_duration interval;
  v_start_at timestamp;
  v_end_at timestamp;
  v_last_segment integer;
  v_effective_price integer;
BEGIN
  IF p_barber_name IS NULL OR length(trim(p_barber_name)) = 0 THEN
    RAISE EXCEPTION USING errcode = '22023', message = 'BARBER_REQUIRED';
  END IF;
  IF p_service_name IS NULL OR length(trim(p_service_name)) = 0 THEN
    RAISE EXCEPTION USING errcode = '22023', message = 'SERVICE_REQUIRED';
  END IF;
  IF length(v_clean_name) < 2 THEN
    RAISE EXCEPTION USING errcode = '22023', message = 'CLIENT_NAME_INVALID';
  END IF;
  IF length(regexp_replace(v_clean_phone, '[^0-9]', '', 'g')) < 6 THEN
    RAISE EXCEPTION USING errcode = '22023', message = 'CLIENT_PHONE_INVALID';
  END IF;
  IF v_clean_email IS NULL OR position('@' in v_clean_email) <= 1 THEN
    RAISE EXCEPTION USING errcode = '22023', message = 'CLIENT_EMAIL_INVALID';
  END IF;
  IF p_booking_date < (timezone('America/Argentina/Buenos_Aires', clock_timestamp()))::date
     OR p_booking_date > (timezone('America/Argentina/Buenos_Aires', clock_timestamp()))::date + 21 THEN
    RAISE EXCEPTION USING errcode = '22023', message = 'BOOKING_DATE_OUT_OF_RANGE';
  END IF;
  IF p_start_time IS NULL
     OR extract(second from p_start_time) <> 0
     OR extract(minute from p_start_time)::int % 5 <> 0 THEN
    RAISE EXCEPTION USING errcode = '22023', message = 'START_TIME_NOT_ALLOWED';
  END IF;

  SELECT b.* INTO STRICT v_barber
  FROM public.barbers b
  WHERE b.name = trim(p_barber_name)
    AND b.active = true
  FOR SHARE;

  IF NOT v_barber.public_booking_enabled THEN
    RAISE EXCEPTION USING errcode = '42501', message = 'BARBER_NOT_PUBLICLY_BOOKABLE';
  END IF;

  IF auth.uid() IS NOT NULL AND EXISTS(SELECT 1 FROM public.staff_profiles WHERE user_id=auth.uid() AND role='BARBER')
   AND v_barber.id IS DISTINCT FROM public.current_staff_barber_id() THEN
   RAISE EXCEPTION USING errcode='42501',message='APPOINTMENT_NOT_ALLOWED';
  END IF;

  SELECT s.* INTO STRICT v_service
  FROM public.services s
  WHERE s.name = trim(p_service_name)
    AND s.active = true;

  v_duration := v_service.duration_minutes * interval '1 minute';
  v_start_at := (p_booking_date + p_start_time)::timestamp;
  v_end_at := v_start_at + v_duration;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_barber.id::text || '|' || p_booking_date::text, 0));

  -- Garantizar atómicamente el slot base recurrente en public.barber_availability_slots si no existiera
  IF v_barber.name = 'Franco' AND extract(isodow from p_booking_date) = 6 THEN
    INSERT INTO public.barber_availability_slots (barber_id, slot_date, start_time, end_time, status)
    VALUES
      (v_barber.id, p_booking_date, time '15:00:00', time '15:45:00', 'AVAILABLE'),
      (v_barber.id, p_booking_date, time '15:45:00', time '16:30:00', 'AVAILABLE'),
      (v_barber.id, p_booking_date, time '16:30:00', time '17:15:00', 'AVAILABLE'),
      (v_barber.id, p_booking_date, time '17:15:00', time '18:00:00', 'AVAILABLE'),
      (v_barber.id, p_booking_date, time '18:00:00', time '18:45:00', 'AVAILABLE'),
      (v_barber.id, p_booking_date, time '18:45:00', time '19:30:00', 'AVAILABLE'),
      (v_barber.id, p_booking_date, time '19:30:00', time '20:00:00', 'AVAILABLE')
    ON CONFLICT (barber_id, slot_date, start_time) DO NOTHING;
  ELSIF v_barber.name <> 'Franco' AND extract(isodow from p_booking_date) BETWEEN 1 AND 6 THEN
    INSERT INTO public.barber_availability_slots (barber_id, slot_date, start_time, end_time, status)
    SELECT
      v_barber.id,
      p_booking_date,
      gs::time AS slot_start,
      (gs + interval '45 minutes')::time AS slot_end,
      'AVAILABLE'::public.availability_status
    FROM generate_series(
      timestamp '2000-01-01 10:00:00',
      timestamp '2000-01-01 19:00:00',
      interval '45 minutes'
    ) AS gs
    ON CONFLICT (barber_id, slot_date, start_time) DO NOTHING;
  END IF;

  v_last_segment := ceil(extract(epoch from v_duration) / 300)::integer - 1;

  IF EXISTS (
    SELECT 1
    FROM generate_series(0, v_last_segment) AS requested(segment_index)
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.barber_availability_slots slot
      WHERE slot.barber_id = v_barber.id
        AND slot.slot_date = p_booking_date
        AND slot.status = 'AVAILABLE'
        AND tsrange(
          v_start_at + requested.segment_index * interval '5 minutes',
          v_start_at + (requested.segment_index + 1) * interval '5 minutes',
          '[)'
        ) <@ tsrange(
          (slot.slot_date + slot.start_time)::timestamp,
          ((slot.slot_date + CASE WHEN slot.end_time <= slot.start_time THEN 1 ELSE 0 END) + slot.end_time)::timestamp,
          '[)'
        )
        AND NOT EXISTS (
          SELECT 1
          FROM public.barber_availability_slots blocked
          WHERE blocked.barber_id = v_barber.id
            AND blocked.slot_date = p_booking_date
            AND blocked.status = 'UNAVAILABLE'
            AND tsrange(
              v_start_at + requested.segment_index * interval '5 minutes',
              v_start_at + (requested.segment_index + 1) * interval '5 minutes',
              '[)'
            ) && tsrange(
              (blocked.slot_date + blocked.start_time)::timestamp,
              ((blocked.slot_date + CASE WHEN blocked.end_time <= blocked.start_time THEN 1 ELSE 0 END) + blocked.end_time)::timestamp,
              '[)'
            )
        )
    )
  ) THEN
    RAISE EXCEPTION USING errcode = 'P0001', message = 'SLOT_UNAVAILABLE';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.appointments a
    WHERE a.barber_id = v_barber.id
      AND a.booking_date = p_booking_date
      AND a.status <> 'CANCELLED'
      AND tsrange(
        (a.booking_date + a.start_time)::timestamp,
        ((a.booking_date + CASE WHEN a.end_time <= a.start_time THEN 1 ELSE 0 END) + a.end_time)::timestamp,
        '[)'
      ) && tsrange(v_start_at, v_end_at, '[)')
  ) THEN
    RAISE EXCEPTION USING errcode = '23P01', message = 'SLOT_ALREADY_BOOKED';
  END IF;

  -- Serialize contact reuse across public and staff flows after taking the agenda lock.
  PERFORM pg_advisory_xact_lock(hashtextextended('client-phone:'||regexp_replace(v_clean_phone,'[^0-9]','','g'),0));
  SELECT c.id INTO v_client_id
  FROM public.clients c
  WHERE (c.email is null or lower(trim(coalesce(c.email,'')))=v_clean_email)
    AND regexp_replace(c.phone,'[^0-9]','','g')=regexp_replace(v_clean_phone,'[^0-9]','','g')
  ORDER BY c.deleted_at NULLS FIRST, c.created_at ASC
  LIMIT 1;

  IF v_client_id IS NULL THEN
    INSERT INTO public.clients (name, phone, email)
    VALUES (v_clean_name, v_clean_phone, v_clean_email)
    RETURNING id INTO v_client_id;
  ELSE
    UPDATE public.clients
    SET name = v_clean_name,
        phone = v_clean_phone,
        email = v_clean_email,
        deleted_at = NULL,
        updated_at = now()
    WHERE id = v_client_id;
  END IF;

  -- Calcular precio efectivo (promocional si existe en barber_service_prices o estándar de services)
  SELECT coalesce(
    (SELECT bsp.price_ars FROM public.barber_service_prices bsp WHERE bsp.barber_id = v_barber.id AND bsp.service_id = v_service.id AND bsp.active = true LIMIT 1),
    v_service.price_ars
  ) INTO v_effective_price;

  INSERT INTO public.appointments AS inserted (
    client_id,
    barber_id,
    service_id,
    booking_date,
    start_time,
    end_time,
    status,
    notes,
    booking_client_name,
    service_price_ars,
    deposit_amount_ars
  ) VALUES (
    v_client_id,
    v_barber.id,
    v_service.id,
    p_booking_date,
    p_start_time,
    v_end_at::time,
    'PENDING',
    nullif(trim(coalesce(p_notes, '')), ''),
    v_clean_name,
    v_effective_price,
    5000
  )
  RETURNING inserted.id,
            inserted.status,
            inserted.booking_date,
            inserted.start_time,
            inserted.end_time,
            inserted.request_number
  INTO appointment_id,
       appointment_status,
       booking_date,
       start_time,
       end_time,
       request_number;

  notification_claim_token := NULL;
  RETURN NEXT;
EXCEPTION
  WHEN no_data_found THEN
    RAISE EXCEPTION USING errcode = 'P0001', message = 'BARBER_OR_SERVICE_NOT_FOUND';
END;
$function$;

-- Enforce the commercial flag at the common INSERT boundary, including requests
-- from request_appointment, prepare_payway_attempt and zero-deposit benefits.
-- MANUAL staff appointments remain governed by their existing RPC/RLS checks.
-- INSERT-only: already-existing bookings and payment confirmations remain valid.
create or replace function kani_private.guard_public_booking_visibility()
returns trigger language plpgsql security definer
set search_path = ''
as $$
declare v_enabled boolean;
begin
  if new.origin is distinct from 'MANUAL' or not new.is_manual then
    select b.active and b.public_booking_enabled into v_enabled
    from public.barbers b where b.id = new.barber_id for share;
    if v_enabled is distinct from true then
      raise exception using errcode = '42501', message = 'BARBER_NOT_PUBLICLY_BOOKABLE';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function kani_private.guard_public_booking_visibility() from public, anon, authenticated, service_role;
create trigger guard_public_booking_visibility
  before insert on public.appointments
  for each row execute function kani_private.guard_public_booking_visibility();

-- Reversible without new accounts, deletion or a new UI. Existing ADMIN RLS applies.
create or replace function public.admin_set_barber_public_booking(p_barber_id uuid, p_enabled boolean)
returns boolean language plpgsql security invoker
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception using errcode = '42501', message = 'ADMIN_REQUIRED';
  end if;
  if p_enabled is null then
    raise exception using errcode = '22023', message = 'PUBLIC_BOOKING_STATE_REQUIRED';
  end if;
  update public.barbers set public_booking_enabled = p_enabled where id = p_barber_id;
  if not found then
    raise exception using errcode = '22023', message = 'BARBER_NOT_FOUND';
  end if;
  return p_enabled;
end;
$$;
revoke all on function public.admin_set_barber_public_booking(uuid, boolean) from public, anon, service_role;
grant execute on function public.admin_set_barber_public_booking(uuid, boolean) to authenticated;

-- Name is a unique business key; never hardcode generated Auth/barber UUIDs.
do $$
begin
  if (select count(*) from public.barbers where name = 'Franco' and active) <> 1 then
    raise exception 'EXPECTED_ONE_ACTIVE_FRANCO';
  end if;
  update public.barbers set public_booking_enabled = false where name = 'Franco';
end;
$$;
notify pgrst, 'reload schema';
