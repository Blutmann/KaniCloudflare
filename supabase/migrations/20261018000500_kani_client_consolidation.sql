-- Migration: 20261018000500_kani_client_consolidation.sql
-- KANI Barber Studio — Consolidación de clientes por teléfono o correo e historial unificado
-- 1. Función canónica find_or_create_consolidated_client
-- 2. Consolidación segura de registros preexistentes en clients y appointments
-- 3. Actualización de request_appointment y create_manual_appointment

-- 1. Función segura de resolución y consolidación de clientes
create or replace function public.find_or_create_consolidated_client(
  p_name text,
  p_phone text,
  p_email text
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  v_clean_name text := trim(coalesce(p_name, 'Cliente'));
  v_phone_digits text := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
  v_phone_canon text;
  v_email_norm text := lower(trim(coalesce(p_email, '')));
  v_client_by_phone record;
  v_client_by_email record;
  v_target_id uuid;
begin
  -- Canonizar teléfono argentino para comparación (+54...)
  if length(v_phone_digits) = 13 and v_phone_digits like '549%' then
    v_phone_canon := '54' || substr(v_phone_digits, 4);
  elsif length(v_phone_digits) = 10 then
    v_phone_canon := '54' || v_phone_digits;
  elsif length(v_phone_digits) >= 8 then
    v_phone_canon := v_phone_digits;
  else
    v_phone_canon := null;
  end if;

  -- Descartar emails inválidos o placeholders
  if v_email_norm = '' or v_email_norm like '%@kanibarber.internal' or position('@' in v_email_norm) <= 1 then
    v_email_norm := null;
  end if;

  -- Buscar por teléfono normalizado
  if v_phone_canon is not null then
    select c.id, c.name, c.phone, c.email into v_client_by_phone
    from public.clients c
    where (
      regexp_replace(c.phone, '[^0-9]', '', 'g') = v_phone_digits
      or (
        length(regexp_replace(c.phone, '[^0-9]', '', 'g')) = 13
        and regexp_replace(c.phone, '[^0-9]', '', 'g') like '549%'
        and '54' || substr(regexp_replace(c.phone, '[^0-9]', '', 'g'), 4) = v_phone_canon
      )
      or (
        length(regexp_replace(c.phone, '[^0-9]', '', 'g')) = 10
        and '54' || regexp_replace(c.phone, '[^0-9]', '', 'g') = v_phone_canon
      )
    )
    order by c.created_at asc
    limit 1;
  end if;

  -- Buscar por correo normalizado
  if v_email_norm is not null then
    select c.id, c.name, c.phone, c.email into v_client_by_email
    from public.clients c
    where lower(trim(c.email)) = v_email_norm
    order by c.created_at asc
    limit 1;
  end if;

  -- Reglas de identificación y resolución segura de conflictos
  if v_client_by_phone.id is not null and v_client_by_email.id is not null and v_client_by_phone.id <> v_client_by_email.id then
    -- Conflicto: teléfono pertenece al cliente A y correo al cliente B
    if lower(trim(v_clean_name)) = lower(trim(v_client_by_phone.name)) and lower(trim(v_clean_name)) <> lower(trim(v_client_by_email.name)) then
      v_target_id := v_client_by_phone.id;
    elsif lower(trim(v_clean_name)) = lower(trim(v_client_by_email.name)) and lower(trim(v_clean_name)) <> lower(trim(v_client_by_phone.name)) then
      v_target_id := v_client_by_email.id;
    else
      -- Conflicto irresoluble: no fusionar arbitrariamente registros de distintas personas
      v_target_id := null;
    end if;
  elsif v_client_by_phone.id is not null then
    v_target_id := v_client_by_phone.id;
    -- Si el cliente existente no tenía correo y ahora se aportó uno válido, completarlo
    if v_email_norm is not null and (v_client_by_phone.email is null or v_client_by_phone.email like '%@kanibarber.internal') then
      update public.clients set email = v_email_norm, updated_at = now() where id = v_target_id;
    end if;
  elsif v_client_by_email.id is not null then
    v_target_id := v_client_by_email.id;
    -- Si el cliente existente no tenía teléfono y ahora se aportó uno válido, completarlo
    if v_phone_canon is not null and (v_client_by_email.phone is null or length(trim(v_client_by_email.phone)) < 8) then
      update public.clients set phone = trim(p_phone), updated_at = now() where id = v_target_id;
    end if;
  end if;

  -- Crear cliente si no existía o si hubo conflicto no asociable
  if v_target_id is null then
    insert into public.clients (name, phone, email)
    values (
      v_clean_name,
      trim(p_phone),
      coalesce(v_email_norm, 'sin-email@kanibarber.internal')
    )
    returning id into v_target_id;
  else
    -- Si el nuevo nombre es más completo (mayor longitud descriptiva), actualizar
    if length(v_clean_name) > length(coalesce(v_client_by_phone.name, v_client_by_email.name, '')) then
      update public.clients set name = v_clean_name, updated_at = now() where id = v_target_id;
    end if;
  end if;

  return v_target_id;
end;
$$;

grant execute on function public.find_or_create_consolidated_client to authenticated, anon;

-- 2. Consolidar de forma segura datos preexistentes en clients y appointments
do $$
declare
  r record;
  v_canonical_id uuid;
begin
  -- 2.1 Consolidar duplicados por teléfono normalizado
  for r in
    select regexp_replace(phone, '[^0-9]', '', 'g') as norm_p, array_agg(id order by created_at asc) as client_ids
    from public.clients
    where length(regexp_replace(phone, '[^0-9]', '', 'g')) >= 8
    group by regexp_replace(phone, '[^0-9]', '', 'g')
    having count(*) > 1
  loop
    v_canonical_id := r.client_ids[1];
    -- Re-asociar turnos existentes al cliente canónico preservando turnos, estados e importes
    update public.appointments
    set client_id = v_canonical_id
    where client_id = any(r.client_ids[2:]);

    begin
      update public.recurring_appointment_rules
      set client_id = v_canonical_id
      where client_id = any(r.client_ids[2:]);
    exception when undefined_table then
      null;
    end;

    -- Eliminar registros redundantes que hayan quedado sin turnos asociados
    delete from public.clients
    where id = any(r.client_ids[2:])
      and not exists (select 1 from public.appointments where client_id = clients.id);
  end loop;

  -- 2.2 Consolidar duplicados por correo normalizado
  for r in
    select lower(trim(email)) as norm_e, array_agg(id order by created_at asc) as client_ids
    from public.clients
    where email is not null and email <> '' and email not like '%@kanibarber.internal' and position('@' in email) > 1
    group by lower(trim(email))
    having count(*) > 1
  loop
    v_canonical_id := r.client_ids[1];
    update public.appointments
    set client_id = v_canonical_id
    where client_id = any(r.client_ids[2:]);

    begin
      update public.recurring_appointment_rules
      set client_id = v_canonical_id
      where client_id = any(r.client_ids[2:]);
    exception when undefined_table then
      null;
    end;

    delete from public.clients
    where id = any(r.client_ids[2:])
      and not exists (select 1 from public.appointments where client_id = clients.id);
  end loop;
end;
$$;
