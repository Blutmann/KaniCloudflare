-- KANI Barber Studio — Unificación de estados: migración de COMPLETED a CONFIRMED
-- Elimina 'COMPLETED' como categoría independiente, consolidándolo en 'CONFIRMED'.

-- 1. Migrar registros existentes con estado COMPLETED a CONFIRMED
update public.appointments
set status = 'CONFIRMED'::public.appointment_status,
    updated_at = now()
where status = 'COMPLETED'::public.appointment_status;

-- 2. Actualizar función RPC update_appointment_status para admitir únicamente CONFIRMED y CANCELLED
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
  v_claim_token text := null;
begin
  if p_status not in ('CONFIRMED', 'CANCELLED') then
    raise exception 'INVALID_APPOINTMENT_STATUS_TRANSITION';
  end if;

  select status into v_current_status
  from public.appointments
  where id = p_appointment_id
  for update;

  if not found then
    raise exception 'APPOINTMENT_NOT_FOUND';
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
