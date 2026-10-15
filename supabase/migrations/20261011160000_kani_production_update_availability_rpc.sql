-- Kani Barber Studio — RPC faltante para alternar disponibilidad en Production.
-- No modifica datos, políticas RLS ni permisos de tablas.
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

comment on function public.update_availability_slot(uuid, public.availability_status, text) is
  'Actualiza únicamente estado y nota interna de un slot perteneciente a la agenda autorizada.';
