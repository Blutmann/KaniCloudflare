-- Migration: 20261031000100_kani_secure_notification_dispatches_and_webhooks.sql
-- Kani Barber Studio — Seguridad, RLS estricta, autorización y correlación de notificaciones

-- 1. Agregar columna meta_message_id e índice para correlación inequívoca con wamid de Meta
alter table public.appointment_notification_dispatches
  add column if not exists meta_message_id text;

create index if not exists idx_notif_dispatches_meta_msg
  on public.appointment_notification_dispatches (meta_message_id)
  where meta_message_id is not null;

-- 2. Corregir RLS: Revocar accesos permisivos y restringir lecturas exclusivamente a staff autorizado
alter table public.appointment_notification_dispatches enable row level security;

-- Revocar permisos globales
revoke all on public.appointment_notification_dispatches from public, anon;
grant select on public.appointment_notification_dispatches to authenticated;
grant all on public.appointment_notification_dispatches to service_role;

-- Eliminar política permisiva previa
drop policy if exists "Allow reading dispatches" on public.appointment_notification_dispatches;
drop policy if exists "staff_can_read_notification_dispatches" on public.appointment_notification_dispatches;

-- Nueva política: solo administradores o el barbero asignado al turno pueden leer los despachos
create policy staff_can_read_notification_dispatches
  on public.appointment_notification_dispatches
  for select
  to authenticated
  using (
    public.is_admin()
    or exists (
      select 1
      from public.appointments a
      where a.id = appointment_notification_dispatches.appointment_id
        and a.barber_id = public.current_staff_barber_id()
    )
  );

-- 3. Función atómica segura para registrar o actualizar el estado de un canal
drop function if exists public.record_channel_dispatch_status(uuid, uuid, text, text, text, text, text, text, text, boolean);
drop function if exists public.record_channel_dispatch_status(uuid, uuid, text, text, text, text, text, text, text, boolean, text);

create or replace function public.record_channel_dispatch_status(
  p_appointment_id uuid,
  p_notification_event_id uuid,
  p_channel text,
  p_provider text,
  p_recipient text,
  p_provider_message_id text,
  p_status text,
  p_error_code text default null,
  p_error_description text default null,
  p_increment_attempt boolean default false,
  p_meta_message_id text default null
)
returns uuid
language plpgsql
security definer
set search_path = 'pg_catalog', 'extensions', 'public'
as $$
declare
  v_dispatch_id uuid;
  v_current_status text;
begin
  -- Validación estricta de autorización en el servidor
  if (select auth.role()) <> 'service_role' then
    if not (
      public.is_admin()
      or exists (
        select 1 from public.appointments a
        where a.id = p_appointment_id
          and a.barber_id = public.current_staff_barber_id()
      )
    ) then
      raise exception 'ACCESS_DENIED: No posee permisos para modificar el estado de despacho de este turno'
        using errcode = '42501';
    end if;
  end if;

  -- Bloqueo de fila para evitar condiciones de carrera concurrentes
  select id, status into v_dispatch_id, v_current_status
  from public.appointment_notification_dispatches
  where (
    (notification_event_id is not null and notification_event_id = p_notification_event_id and channel = p_channel)
    or (appointment_id = p_appointment_id and channel = p_channel)
  )
  limit 1
  for update;

  -- Jerarquía de estados: un mensaje entregado o leído no puede retroceder a estados inferiores ni a fallido tardío
  if v_current_status in ('DELIVERED', 'READ') and p_status in ('PROVIDER_ACCEPTED', 'SENT', 'PROCESSING', 'PENDING', 'FAILED') then
    return v_dispatch_id;
  end if;
  if v_current_status = 'READ' and p_status = 'DELIVERED' then
    return v_dispatch_id;
  end if;

  if v_dispatch_id is null then
    insert into public.appointment_notification_dispatches (
      appointment_id, notification_event_id, channel, provider,
      recipient, provider_message_id, meta_message_id, status, error_code, error_description,
      attempts, requested_at,
      delivered_at, read_at, updated_at
    ) values (
      p_appointment_id, p_notification_event_id, p_channel, p_provider,
      p_recipient, p_provider_message_id, p_meta_message_id, p_status, p_error_code, p_error_description,
      case when p_increment_attempt then 1 else 0 end,
      now(),
      case when p_status = 'DELIVERED' then now() else null end,
      case when p_status = 'READ' then now() else null end,
      now()
    )
    returning id into v_dispatch_id;
  else
    update public.appointment_notification_dispatches
    set provider_message_id = coalesce(p_provider_message_id, provider_message_id),
        meta_message_id = coalesce(p_meta_message_id, meta_message_id),
        recipient = coalesce(p_recipient, recipient),
        status = p_status,
        error_code = p_error_code,
        error_description = p_error_description,
        attempts = case when p_increment_attempt then attempts + 1 else attempts end,
        delivered_at = case
          when p_status in ('DELIVERED', 'READ') and delivered_at is null then now()
          else delivered_at
        end,
        read_at = case
          when p_status = 'READ' and read_at is null then now()
          else read_at
        end,
        updated_at = now()
    where id = v_dispatch_id;
  end if;

  return v_dispatch_id;
end;
$$;

-- Permisos mínimos: revocar de anon y public
revoke all on function public.record_channel_dispatch_status(uuid, uuid, text, text, text, text, text, text, text, boolean, text) from public, anon;
grant execute on function public.record_channel_dispatch_status(uuid, uuid, text, text, text, text, text, text, text, boolean, text) to authenticated, service_role;

-- 4. Función atómica segura para procesar webhooks entrantes de Pontiun / Meta
drop function if exists public.update_pontiun_webhook_message_status(text, text, text, text, text);

create or replace function public.update_pontiun_webhook_message_status(
  p_provider_message_id text,
  p_meta_message_id text,
  p_status text,
  p_error_code text default null,
  p_error_description text default null
)
returns boolean
language plpgsql
security definer
set search_path = 'pg_catalog', 'extensions', 'public'
as $$
declare
  v_dispatch public.appointment_notification_dispatches%rowtype;
  v_target_status text;
begin
  -- Validación estricta de autorización: solo service_role o admin pueden alterar estados por webhook
  if (select auth.role()) <> 'service_role' and not public.is_admin() then
    raise exception 'ACCESS_DENIED: Solo service_role o administradores pueden actualizar estados vía webhook'
      using errcode = '42501';
  end if;

  if (p_provider_message_id is null or trim(p_provider_message_id) = '')
     and (p_meta_message_id is null or trim(p_meta_message_id) = '') then
    return false;
  end if;

  -- Correlación unívoca e inequívoca buscando tanto por Pontiun ID como por Meta wamid
  -- con bloqueo de fila contra condiciones de carrera concurrentes
  select * into v_dispatch
  from public.appointment_notification_dispatches
  where channel = 'WHATSAPP'
    and (
      (p_provider_message_id is not null and (provider_message_id = p_provider_message_id or meta_message_id = p_provider_message_id))
      or (p_meta_message_id is not null and (provider_message_id = p_meta_message_id or meta_message_id = p_meta_message_id))
    )
  limit 1
  for update;

  if not found then
    return false;
  end if;

  -- Normalizar estados recibidos de Pontiun / Meta
  v_target_status := case lower(trim(p_status))
    when 'delivered' then 'DELIVERED'
    when 'read' then 'READ'
    when 'failed' then 'FAILED'
    when 'sent' then 'SENT'
    else 'UNKNOWN'
  end;

  -- Protección de orden: no degradar estados más avanzados
  if v_dispatch.status = 'READ' and v_target_status in ('DELIVERED', 'SENT', 'PROVIDER_ACCEPTED', 'FAILED', 'PENDING') then
    return true;
  end if;
  if v_dispatch.status = 'DELIVERED' and v_target_status in ('SENT', 'PROVIDER_ACCEPTED', 'FAILED', 'PENDING') then
    return true;
  end if;

  update public.appointment_notification_dispatches
  set status = v_target_status,
      meta_message_id = coalesce(p_meta_message_id, meta_message_id),
      provider_message_id = coalesce(p_provider_message_id, provider_message_id),
      error_code = coalesce(p_error_code, error_code),
      error_description = coalesce(p_error_description, error_description),
      delivered_at = case
        when v_target_status in ('DELIVERED', 'READ') and delivered_at is null then now()
        else delivered_at
      end,
      read_at = case
        when v_target_status = 'READ' and read_at is null then now()
        else read_at
      end,
      updated_at = now()
  where id = v_dispatch.id;

  return true;
end;
$$;

-- Permisos mínimos: revocar de anon y public
revoke all on function public.update_pontiun_webhook_message_status(text, text, text, text, text) from public, anon;
grant execute on function public.update_pontiun_webhook_message_status(text, text, text, text, text) to authenticated, service_role;

-- 5. Registrar versión en el ledger de migraciones
insert into supabase_migrations.schema_migrations (version)
values ('20261031000100')
on conflict (version) do nothing;

notify pgrst, 'reload schema';
