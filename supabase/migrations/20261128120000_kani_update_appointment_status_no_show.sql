-- Habilitar transición CONFIRMED -> NO_SHOW en public.update_appointment_status
-- manteniendo notificaciones únicamente para CONFIRMED y CANCELLED (nunca para NO_SHOW ni COMPLETED).

CREATE OR REPLACE FUNCTION public.update_appointment_status(
  p_appointment_id uuid,
  p_status public.appointment_status
)
RETURNS TABLE(appointment_status public.appointment_status, notification_claim_token text)
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
  if p_status not in ('CANCELLED', 'COMPLETED', 'NO_SHOW') then
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
  select a.status into v_current_status from public.appointments a where a.id = p_appointment_id for update;

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
  if p_status = 'NO_SHOW' and v_current_status <> 'CONFIRMED' then
    raise exception using errcode = '22023', message = 'STATUS_TRANSITION_NOT_ALLOWED';
  end if;

  update public.appointments as updated
  set status = p_status,
      updated_at = now(),
      cancellation_reason = case when p_status = 'CANCELLED' then 'STAFF_CANCELLED' else updated.cancellation_reason end,
      cancelled_at = case when p_status = 'CANCELLED' then now() else updated.cancelled_at end,
      cancelled_by = case when p_status = 'CANCELLED' then auth.uid() else updated.cancelled_by end
  where updated.id = p_appointment_id
  returning updated.status into appointment_status;

  if appointment_status = 'CONFIRMED' then
    notification_claim_token := public.create_appointment_notification_event(p_appointment_id, 'CONFIRMED');
  elsif appointment_status = 'CANCELLED' then
    notification_claim_token := public.create_appointment_notification_event(p_appointment_id, 'CANCELLED');
  else
    -- COMPLETED y NO_SHOW no disparan notificaciones automáticas de cancelación/confirmación
    notification_claim_token := null;
  end if;

  return next;
end;
$function$;

revoke all on function public.update_appointment_status(uuid, public.appointment_status) from public, anon;
grant execute on function public.update_appointment_status(uuid, public.appointment_status) to authenticated;
