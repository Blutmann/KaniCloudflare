-- KANI Barber Studio — estado de lectura de actividad ADMIN
-- Conserva todos los eventos existentes como NO LEÍDOS (read_at NULL).

alter table public.admin_activity_notifications
  add column if not exists read_at timestamptz;

create index if not exists admin_activity_notifications_unread_idx
  on public.admin_activity_notifications (created_at desc)
  where read_at is null;

-- La API solo puede actualizar la columna de lectura; el resto de la tabla
-- permanece protegida y append-only para clientes autenticados.
revoke update on table public.admin_activity_notifications from anon, authenticated;
grant update (read_at) on table public.admin_activity_notifications to authenticated;

drop policy if exists admin_can_update_activity_read_state
  on public.admin_activity_notifications;
create policy admin_can_update_activity_read_state
  on public.admin_activity_notifications
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

comment on column public.admin_activity_notifications.read_at is
  'Momento en que un usuario ADMIN marcó la notificación como leída; NULL significa no leída.';
