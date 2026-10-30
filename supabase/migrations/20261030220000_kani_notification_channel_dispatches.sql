-- Migration: 20261030220000_kani_notification_channel_dispatches.sql
-- Kani Barber Studio — Seguimiento independiente por canal de notificaciones (WhatsApp / Email)
-- Registra estados verificables (PROVIDER_ACCEPTED, DELIVERED, READ, FAILED, SKIPPED)
-- e impide confundir la aceptación del proveedor con entrega efectiva.

-- 1. Tabla de despachos individuales por canal
create table if not exists public.appointment_notification_dispatches (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid not null references public.appointments(id) on delete cascade,
  notification_event_id uuid references public.appointment_notification_events(id) on delete cascade,
  channel text not null check (channel in ('WHATSAPP', 'EMAIL')),
  provider text not null check (provider in ('PONTIUN', 'RESEND')),
  recipient text,
  provider_message_id text,
  status text not null check (
    status in (
      'PENDING',
      'PROCESSING',
      'PROVIDER_ACCEPTED',
      'SENT',
      'DELIVERED',
      'READ',
      'FAILED',
      'SKIPPED',
      'UNKNOWN'
    )
  ),
  error_code text,
  error_description text,
  attempts integer not null default 0,
  requested_at timestamp with time zone not null default now(),
  delivered_at timestamp with time zone,
  read_at timestamp with time zone,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint appointment_notification_dispatches_event_channel_key unique (notification_event_id, channel)
);

-- 2. Índices para consultas operativas rápidas y webhooks
create index if not exists idx_notif_dispatches_app on public.appointment_notification_dispatches (appointment_id);
create index if not exists idx_notif_dispatches_provider_msg on public.appointment_notification_dispatches (provider_message_id) where provider_message_id is not null;
create index if not exists idx_notif_dispatches_status on public.appointment_notification_dispatches (status);

-- 3. Seguridad a nivel de fila (RLS)
alter table public.appointment_notification_dispatches enable row level security;

revoke all on public.appointment_notification_dispatches from public;
grant all on public.appointment_notification_dispatches to service_role;
grant select on public.appointment_notification_dispatches to authenticated, anon;

drop policy if exists "Allow reading dispatches" on public.appointment_notification_dispatches;
create policy "Allow reading dispatches"
  on public.appointment_notification_dispatches
  for select
  to authenticated, anon
  using (true);

-- 4. Función atómica para registrar o actualizar el estado de un canal
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
  p_increment_attempt boolean default false
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
  select id, status into v_dispatch_id, v_current_status
  from public.appointment_notification_dispatches
  where notification_event_id = p_notification_event_id and channel = p_channel;

  -- Jerarquía de estados: no permitir que estados anteriores degraden uno más avanzado
  if v_current_status in ('DELIVERED', 'READ') and p_status in ('PROVIDER_ACCEPTED', 'SENT', 'PROCESSING', 'PENDING') then
    return v_dispatch_id;
  end if;
  if v_current_status = 'READ' and p_status = 'DELIVERED' then
    return v_dispatch_id;
  end if;

  if v_dispatch_id is null then
    insert into public.appointment_notification_dispatches (
      appointment_id, notification_event_id, channel, provider,
      recipient, provider_message_id, status, error_code, error_description,
      attempts, requested_at,
      delivered_at, read_at, updated_at
    ) values (
      p_appointment_id, p_notification_event_id, p_channel, p_provider,
      p_recipient, p_provider_message_id, p_status, p_error_code, p_error_description,
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

revoke all on function public.record_channel_dispatch_status from public;
grant execute on function public.record_channel_dispatch_status to anon, authenticated, service_role;

-- 5. Función atómica para procesar actualizaciones de entrega desde webhooks de Pontiun
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
  if p_provider_message_id is null and p_meta_message_id is null then
    return false;
  end if;

  select * into v_dispatch
  from public.appointment_notification_dispatches
  where channel = 'WHATSAPP'
    and (
      (p_provider_message_id is not null and provider_message_id = p_provider_message_id)
      or (p_meta_message_id is not null and provider_message_id = p_meta_message_id)
    )
  limit 1;

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

  -- Protección de orden: no degradar estados
  if v_dispatch.status = 'READ' and v_target_status in ('DELIVERED', 'SENT', 'PROVIDER_ACCEPTED') then
    return true;
  end if;
  if v_dispatch.status = 'DELIVERED' and v_target_status in ('SENT', 'PROVIDER_ACCEPTED') then
    return true;
  end if;

  update public.appointment_notification_dispatches
  set status = v_target_status,
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

revoke all on function public.update_pontiun_webhook_message_status from public;
grant execute on function public.update_pontiun_webhook_message_status to anon, authenticated, service_role;

-- 6. Migración de registros históricos existentes preservando fidelidad
do $$
declare
  r record;
  v_pontiun_id text;
  v_resend_id text;
begin
  for r in
    select e.*, a.id as app_id
    from public.appointment_notification_events e
    join public.appointments a on a.id = e.appointment_id
  loop
    -- Extraer IDs de proveedores si existen
    v_pontiun_id := null;
    v_resend_id := null;

    if r.provider_message_id like '%pontiun:%' then
      v_pontiun_id := substring(r.provider_message_id from 'pontiun:([^|]+)');
    end if;

    if r.provider_message_id like '%resend:%' then
      v_resend_id := substring(r.provider_message_id from 'resend:([^|]+)');
    end if;

    -- Canal EMAIL (Resend)
    if r.recipient_email is not null and r.recipient_email <> '' then
      insert into public.appointment_notification_dispatches (
        appointment_id, notification_event_id, channel, provider,
        recipient, provider_message_id, status, error_code, error_description,
        attempts, requested_at, updated_at
      ) values (
        r.app_id, r.id, 'EMAIL', 'RESEND',
        r.recipient_email, v_resend_id,
        case when v_resend_id is not null then 'SENT' else (case when r.status = 'FAILED' then 'FAILED' else 'PENDING' end) end,
        case when v_resend_id is null and r.status = 'FAILED' then 'RESEND_DISPATCH_FAILED' else null end,
        r.last_error,
        r.attempts, r.created_at, coalesce(r.updated_at, r.created_at)
      ) on conflict (notification_event_id, channel) do nothing;
    else
      insert into public.appointment_notification_dispatches (
        appointment_id, notification_event_id, channel, provider,
        recipient, provider_message_id, status, error_code, error_description,
        attempts, requested_at, updated_at
      ) values (
        r.app_id, r.id, 'EMAIL', 'RESEND',
        null, null, 'SKIPPED', null, 'Cliente sin correo registrado',
        0, r.created_at, coalesce(r.updated_at, r.created_at)
      ) on conflict (notification_event_id, channel) do nothing;
    end if;

    -- Canal WHATSAPP (Pontiun)
    if r.recipient_phone is not null and r.recipient_phone <> '' then
      -- Para las dos pruebas recientes del 30/10/2026, el error confirmado es 131042 (Meta currency billing)
      if r.id in ('58bd907b-3172-4c48-abd8-fb23bd6fc264', 'a916bf4d-850e-4d2e-9a7e-1ef35ccd89da') then
        insert into public.appointment_notification_dispatches (
          appointment_id, notification_event_id, channel, provider,
          recipient, provider_message_id, status, error_code, error_description,
          attempts, requested_at, updated_at
        ) values (
          r.app_id, r.id, 'WHATSAPP', 'PONTIUN',
          r.recipient_phone, v_pontiun_id, 'FAILED', '131042',
          'Business eligibility payment issue: Your WhatsApp Business account currency is not configured.',
          1, r.created_at, coalesce(r.updated_at, r.created_at)
        ) on conflict (notification_event_id, channel) do nothing;
      elsif v_pontiun_id is not null then
        -- Aceptado por Pontiun (no equivale a delivered)
        insert into public.appointment_notification_dispatches (
          appointment_id, notification_event_id, channel, provider,
          recipient, provider_message_id, status, error_code, error_description,
          attempts, requested_at, updated_at
        ) values (
          r.app_id, r.id, 'WHATSAPP', 'PONTIUN',
          r.recipient_phone, v_pontiun_id, 'PROVIDER_ACCEPTED', null, null,
          1, r.created_at, coalesce(r.updated_at, r.created_at)
        ) on conflict (notification_event_id, channel) do nothing;
      else
        insert into public.appointment_notification_dispatches (
          appointment_id, notification_event_id, channel, provider,
          recipient, provider_message_id, status, error_code, error_description,
          attempts, requested_at, updated_at
        ) values (
          r.app_id, r.id, 'WHATSAPP', 'PONTIUN',
          r.recipient_phone, null,
          case when r.status = 'FAILED' then 'FAILED' else 'PENDING' end,
          case when r.status = 'FAILED' then 'PONTIUN_DISPATCH_FAILED' else null end,
          r.last_error,
          r.attempts, r.created_at, coalesce(r.updated_at, r.created_at)
        ) on conflict (notification_event_id, channel) do nothing;
      end if;
    else
      insert into public.appointment_notification_dispatches (
        appointment_id, notification_event_id, channel, provider,
        recipient, provider_message_id, status, error_code, error_description,
        attempts, requested_at, updated_at
      ) values (
        r.app_id, r.id, 'WHATSAPP', 'PONTIUN',
        null, null, 'SKIPPED', null, 'Cliente sin teléfono registrado',
        0, r.created_at, coalesce(r.updated_at, r.created_at)
      ) on conflict (notification_event_id, channel) do nothing;
    end if;
  end loop;
end $$;

-- 7. Registrar versión en el ledger de migraciones
insert into supabase_migrations.schema_migrations (version)
values ('20261030220000')
on conflict (version) do nothing;

notify pgrst, 'reload schema';
