-- KANI Barber Studio — V12.40: Endurecimiento de persistencia, corte temporal anti-race y aislamiento por usuario
-- Preserva todos los modelos y protecciones de 20261114000100 sin borrado global en acciones de usuario.

drop function if exists public.mark_all_staff_activity_notifications_read();
drop function if exists public.dismiss_all_staff_activity_notifications_personal();

-- Marcar todas las notificaciones visibles (hasta p_before si se especifica) como leídas exclusivamente para auth.uid()
create or replace function public.mark_all_staff_activity_notifications_read(
  p_before timestamptz default null
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  v_uid uuid := (select auth.uid());
  v_is_operator boolean := public.is_operator();
  v_barber_id uuid := public.current_staff_barber_id();
  v_now timestamptz := now();
begin
  if v_uid is null or (not v_is_operator and v_barber_id is null) then
    raise exception 'No autorizado';
  end if;

  insert into public.admin_activity_user_state (notification_id, user_id, read_at, updated_at)
  select n.id, v_uid, v_now, v_now
  from public.admin_activity_notifications n
  left join public.admin_activity_user_state us
    on us.notification_id = n.id and us.user_id = v_uid
  where (v_is_operator or n.barber_id = v_barber_id)
    and us.dismissed_at is null
    and (p_before is null or n.created_at <= p_before)
  on conflict (notification_id, user_id)
  do update set
    read_at = coalesce(public.admin_activity_user_state.read_at, excluded.read_at),
    updated_at = v_now;
end;
$$;

-- Descartar todas las notificaciones visibles (hasta p_before si se especifica) solo para auth.uid().
-- Evita ocultar notificaciones nuevas generadas entre que el usuario abre el modal y confirma la acción.
create or replace function public.dismiss_all_staff_activity_notifications_personal(
  p_before timestamptz default null
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  v_uid uuid := (select auth.uid());
  v_is_operator boolean := public.is_operator();
  v_barber_id uuid := public.current_staff_barber_id();
  v_now timestamptz := now();
  v_count integer := 0;
begin
  if v_uid is null or (not v_is_operator and v_barber_id is null) then
    raise exception 'No autorizado';
  end if;

  with inserted as (
    insert into public.admin_activity_user_state (notification_id, user_id, dismissed_at, updated_at)
    select n.id, v_uid, v_now, v_now
    from public.admin_activity_notifications n
    left join public.admin_activity_user_state us
      on us.notification_id = n.id and us.user_id = v_uid
    where (v_is_operator or n.barber_id = v_barber_id)
      and us.dismissed_at is null
      and (p_before is null or n.created_at <= p_before)
    on conflict (notification_id, user_id)
    do update set
      dismissed_at = v_now,
      updated_at = v_now
    returning 1
  )
  select count(*) into v_count from inserted;

  return v_count;
end;
$$;

revoke all on function public.mark_all_staff_activity_notifications_read(timestamptz) from public, anon;
revoke all on function public.dismiss_all_staff_activity_notifications_personal(timestamptz) from public, anon;

grant execute on function public.mark_all_staff_activity_notifications_read(timestamptz) to authenticated;
grant execute on function public.dismiss_all_staff_activity_notifications_personal(timestamptz) to authenticated;
