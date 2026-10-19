-- KANI Barber Studio — Soporte de textos abreviados de frecuencia en generación recurrente
-- Permite que generate_recurring_appointments interprete tanto las formas numéricas ('1 vez cada 2 semanas', '1 vez cada 3 semanas', '1 vez al mes')
-- como las formas anteriores en palabras ('Una vez cada dos semanas', 'Una vez cada tres semanas', 'Una vez al mes').

create or replace function public.generate_recurring_appointments(
  p_horizon_days integer default 30
)
returns table (
  rule_id uuid,
  generated_date date,
  result_status text,
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
    if v_rule.notes like '%[Frecuencia: Una vez cada dos semanas]%' or v_rule.notes like '%[Frecuencia: 1 vez cada 2 semanas]%' then
      v_interval_days := 14;
    elsif v_rule.notes like '%[Frecuencia: Una vez cada tres semanas]%' or v_rule.notes like '%[Frecuencia: 1 vez cada 3 semanas]%' then
      v_interval_days := 21;
    elsif v_rule.notes like '%[Frecuencia: Una vez al mes]%' or v_rule.notes like '%[Frecuencia: 1 vez al mes]%' then
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
          do update set end_time = greatest(barber_availability_slots.end_time, excluded.end_time),
                        status = 'AVAILABLE';
        end if;

        -- 4. Crear turno confirmado vinculado a la regla
        insert into public.appointments (
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
          recurring_rule_id
        ) values (
          v_rule.barber_id,
          v_rule.service_id,
          v_curr_date,
          v_rule.start_time,
          v_end_time,
          'CONFIRMED',
          v_rule.notes,
          true,
          'MANUAL',
          auth.uid(),
          'Sistema (Turno recurrente)',
          v_rule.id
        )
        returning id into v_apt_id;

        return query select v_rule.id, v_curr_date, 'APPOINTMENT_CREATED'::text, v_apt_id;
      end if;

      v_curr_date := v_curr_date + 1;
    end loop;
  end loop;
end;
$$;
