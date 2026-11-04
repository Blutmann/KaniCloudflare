-- Completes the recovered draft; no existing identities or provider transactions are removed.
alter policy staff_can_read_barbers on public.barbers using (
 (select public.is_operator()) or id=(select public.current_staff_barber_id())
);
alter policy service_payments_delete on public.service_payments using ((select public.is_operator()));
-- Financial writes require the checked RPCs, including soft deletion. RLS remains on reads.
revoke all on public.service_payments from anon,authenticated;
grant select on public.service_payments to authenticated;

alter table public.service_payments
 add column discount_kind text not null default 'FIXED' check (discount_kind in ('FIXED','PERCENT')),
 add column discount_value numeric not null default 0 check (discount_value>=0),
 add column final_amount_override_ars integer check (final_amount_override_ars>=0),
 add column client_id uuid references public.clients(id) on delete restrict,
 add column voided_at timestamptz,
 add column voided_by_user_id uuid references auth.users(id);
update public.service_payments set discount_value=discount_ars;
update public.service_payments p set client_id=a.client_id
 from public.appointments a where a.id=p.appointment_id;
alter table public.service_payments drop constraint service_payments_service_name_check;
alter table public.service_payments add constraint service_payments_service_name_check
 check (service_name in ('Corte','Corte de cabello','Corte y barba','Corte + barba','Barba','Otros','Anulado'));
alter table public.service_payments drop constraint service_payments_service_price_ars_check;
alter table public.service_payments add constraint service_payments_service_price_ars_check
 check (service_price_ars>0 or (service_name='Anulado' and service_price_ars=0));
alter table public.service_payments drop constraint service_payments_check1;
alter table public.service_payments add constraint service_payments_check1
 check (final_amount_ars=coalesce(final_amount_override_ars, service_price_ars-discount_ars));
alter table public.service_payments add constraint service_payments_void_check
 check (service_name<>'Anulado' or (final_amount_ars=0 and collected_amount_ars=0 and online_deposit_amount_ars=0));
create index service_payments_client_idx on public.service_payments(client_id);
insert into public.client_barbers(client_id,barber_id)
 select distinct client_id,barber_id from public.service_payments where client_id is not null on conflict do nothing;
create trigger link_payment_client after insert or update of client_id,barber_id on public.service_payments
 for each row execute function kani_private.link_appointment_client();

create or replace function public.staff_save_service_payment(
 p_payment_id uuid default null, p_barber_id uuid default null,
 p_service_name text default null, p_service_other_detail text default null,
 p_service_price_ars integer default null, p_discount_kind text default 'FIXED',
 p_discount_value numeric default 0, p_final_amount_ars integer default null,
 p_payment_method text default 'Efectivo', p_payment_date date default null,
 p_payment_time time default null, p_appointment_id uuid default null,
 p_client_id uuid default null, p_client_name text default null, p_client_contact text default null
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public,extensions as $$
declare
 v_uid uuid := auth.uid(); v_operator boolean := public.is_operator();
 v_own uuid := public.current_staff_barber_id(); v_barber uuid;
 v_old public.service_payments; v_saved public.service_payments; v_apt public.appointments;
 v_service public.services; v_client public.clients; v_client_id uuid;
 v_name text; v_other text := nullif(trim(p_service_other_detail),'');
 v_price integer; v_discount integer; v_final integer; v_deposit integer := 0;
 v_kind text := coalesce(p_discount_kind,'FIXED'); v_discount_value numeric := coalesce(p_discount_value,0);
 v_actor_name text; v_appointment_id uuid;
begin
 if v_uid is null or (not v_operator and v_own is null) then
  raise exception using errcode='42501', message='STAFF_REQUIRED';
 end if;
 if p_payment_id is not null then
  select * into v_old from public.service_payments where id=p_payment_id for update;
  if not found or v_old.deleted_at is not null or (not v_operator and v_old.barber_id is distinct from v_own) then
   raise exception using errcode='42501',message='PAYMENT_NOT_ALLOWED';
  end if;
  if p_appointment_id is not null and p_appointment_id is distinct from v_old.appointment_id then
   raise exception using errcode='22023',message='PAYMENT_APPOINTMENT_IMMUTABLE';
  end if;
 end if;
 v_barber := coalesce(p_barber_id,v_old.barber_id,v_own);
 if (not v_operator and v_barber is distinct from v_own)
 or not exists(select 1 from public.barbers where id=v_barber and active) then
  raise exception using errcode='42501',message='BARBER_NOT_ALLOWED';
 end if;
 v_deposit := coalesce(v_old.online_deposit_amount_ars,0);
 v_appointment_id := coalesce(v_old.appointment_id,p_appointment_id);
 if v_appointment_id is not null then
  select * into v_apt from public.appointments where id=v_appointment_id for update;
  if not found or v_apt.barber_id is distinct from v_barber then
   raise exception using errcode='42501',message='APPOINTMENT_NOT_ALLOWED';
  end if;
  if p_payment_id is null and v_apt.status not in ('CONFIRMED','COMPLETED') then
   raise exception using errcode='22023',message='APPOINTMENT_NOT_COLLECTIBLE';
  end if;
  if p_payment_id is null and exists(select 1 from public.service_payments where appointment_id=v_appointment_id) then
   raise exception using errcode='23505',message='APPOINTMENT_ALREADY_LINKED';
  end if;
  if p_payment_id is null then
   if v_apt.deposit_paid and (v_apt.deposit_amount_ars is null or v_apt.deposit_amount_ars<0) then raise exception 'DEPOSIT_UNVERIFIABLE'; end if;
   v_deposit := case when v_apt.deposit_paid then v_apt.deposit_amount_ars else 0 end;
  end if;
 end if;
 v_name := case trim(p_service_name) when 'Corte de cabello' then 'Corte'
  when 'Corte + barba' then 'Corte y barba' when 'Otro' then 'Otros' else trim(p_service_name) end;
 if v_name='Anulado' then
  -- Neither unlinking nor claiming a different service can evade a deposit reservation.
  if coalesce(v_apt.deposit_paid,false) or coalesce(v_apt.deposit_amount_ars,0)>0
   or coalesce(v_old.online_deposit_paid,false) or coalesce(v_old.online_deposit_amount_ars,0)>0 then
   raise exception using errcode='22023',message='DEPOSIT_PAYMENT_CANNOT_BE_VOIDED';
  end if;
  v_price:=0; v_discount:=0; v_final:=0; v_discount_value:=0; v_kind:='FIXED';
 elsif v_name in ('Corte','Corte y barba','Barba','Otros') then
  if v_name='Otros' then
   if v_other is null or length(v_other)<2 or length(v_other)>120 then
    raise exception using errcode='22023',message='OTHER_SERVICE_DETAIL_REQUIRED';
   end if;
  else
   select * into v_service from public.services where active and
    (name=v_name or (v_name='Corte' and name='Corte de cabello') or (v_name='Corte y barba' and name='Corte + barba'))
    order by (name=v_name) desc limit 1;
   if not found then raise exception using errcode='22023',message='SERVICE_NOT_FOUND'; end if;
   v_other:=null;
  end if;
  v_price:=coalesce(p_service_price_ars,v_service.price_ars);
  if v_price is null or v_price<=0 or v_discount_value<0 or v_kind not in ('FIXED','PERCENT')
   or (v_kind='PERCENT' and v_discount_value>100) then
   raise exception using errcode='22023',message='INVALID_PAYMENT_AMOUNTS';
  end if;
  v_discount:=case when v_kind='PERCENT' then round(v_price*v_discount_value/100)::integer else round(v_discount_value)::integer end;
  if v_discount>v_price then raise exception using errcode='22023',message='INVALID_DISCOUNT'; end if;
  v_final:=coalesce(p_final_amount_ars,v_price-v_discount);
 else raise exception using errcode='22023',message='INVALID_SERVICE'; end if;
 if v_final<0 or v_final<v_deposit then
  raise exception using errcode='22023',message='TOTAL_BELOW_DEPOSIT';
 end if;
 if p_payment_method is null or p_payment_method not in ('Efectivo','Transferencia') then
  raise exception using errcode='22023',message='INVALID_PAYMENT_METHOD';
 end if;
 v_client_id:=coalesce(p_client_id,v_old.client_id,v_apt.client_id);
 if v_client_id is not null then
  select * into v_client from public.clients c where c.id=v_client_id and
   (v_operator or exists(select 1 from public.client_barbers cb where cb.client_id=c.id and cb.barber_id=v_own));
  if not found then raise exception using errcode='42501',message='CLIENT_NOT_ALLOWED'; end if;
 end if;
 -- Shared client identity is permanent; financial snapshots remain on the payment row.
 if length(trim(coalesce(p_client_name,'')))>=3 and length(regexp_replace(coalesce(p_client_contact,''),'[^0-9]','','g'))>=8 then
  select * into v_client from public.save_client(v_client_id,p_client_name,p_client_contact,v_client.email);
  v_client_id:=v_client.id;
 end if;
 select display_name into v_actor_name from public.staff_profiles where user_id=v_uid and active;
 if p_payment_id is null then
  insert into public.service_payments(barber_id,service_id,service_name,service_other_detail,service_price_ars,
   discount_ars,discount_kind,discount_value,final_amount_override_ars,final_amount_ars,
   payment_date,payment_time,payment_method,online_deposit_paid,online_deposit_amount_ars,collected_amount_ars,
   client_id,client_name,client_contact,appointment_id,service_origin,created_by_user_id,created_by_display_name,
   voided_at,voided_by_user_id)
  values(v_barber,v_service.id,v_name,v_other,v_price,v_discount,v_kind,v_discount_value,
   case when v_name='Anulado' then null else p_final_amount_ars end,v_final,
   coalesce(p_payment_date,(now() at time zone 'America/Argentina/Buenos_Aires')::date),
   coalesce(p_payment_time,(now() at time zone 'America/Argentina/Buenos_Aires')::time),p_payment_method,
   coalesce(v_apt.deposit_paid,false),v_deposit,v_final-v_deposit,
   v_client_id,coalesce(nullif(trim(p_client_name),''),v_client.name,v_apt.booking_client_name),
   coalesce(nullif(trim(p_client_contact),''),v_client.phone),
   v_appointment_id,case when v_appointment_id is null then 'walk_in' else 'appointment' end,v_uid,coalesce(v_actor_name,'Personal KANI'),
   case when v_name='Anulado' then now() end,case when v_name='Anulado' then v_uid end)
  returning * into v_saved;
 else
  update public.service_payments set barber_id=v_barber,service_id=v_service.id,service_name=v_name,
   service_other_detail=v_other,service_price_ars=v_price,discount_ars=v_discount,discount_kind=v_kind,
   discount_value=v_discount_value,final_amount_override_ars=case when v_name='Anulado' then null else p_final_amount_ars end,
   final_amount_ars=v_final,payment_method=p_payment_method,payment_date=coalesce(p_payment_date,v_old.payment_date),
   payment_time=coalesce(p_payment_time,v_old.payment_time),collected_amount_ars=v_final-v_deposit,
   online_deposit_paid=v_old.online_deposit_paid,
   online_deposit_amount_ars=v_deposit,client_id=v_client_id,
   client_name=coalesce(nullif(trim(p_client_name),''),v_client.name,v_old.client_name),
   client_contact=coalesce(nullif(trim(p_client_contact),''),v_client.phone,v_old.client_contact),updated_at=now(),
   voided_at=case when v_name='Anulado' then coalesce(v_old.voided_at,now()) else null end,
   voided_by_user_id=case when v_name='Anulado' then coalesce(v_old.voided_by_user_id,v_uid) else null end
  where id=p_payment_id returning * into v_saved;
 end if;
 -- No payment-provider calls, refunds, deposit edits or booking reassignment.
 if p_payment_id is null and v_appointment_id is not null and v_name<>'Anulado' then
  update public.appointments set balance_paid=true,status='COMPLETED',updated_at=now() where id=v_appointment_id;
 end if;
 return to_jsonb(v_saved);
end; $$;
revoke all on function public.staff_save_service_payment(uuid,uuid,text,text,integer,text,numeric,integer,text,date,time,uuid,uuid,text,text) from public,anon;
grant execute on function public.staff_save_service_payment(uuid,uuid,text,text,integer,text,numeric,integer,text,date,time,uuid,uuid,text,text) to authenticated;

-- Preserve the original RPC contract for existing admin screens.
create or replace function public.record_service_payment(
 p_barber_id uuid,p_service_name text,p_service_other_detail text default null,p_service_price_ars integer default null,
 p_discount_ars integer default 0,p_payment_date date default null,p_payment_time time default null,
 p_payment_method text default 'Efectivo',p_online_deposit_paid boolean default false,
 p_client_name text default null,p_client_contact text default null,p_appointment_id uuid default null,p_service_origin text default null
) returns table(payment_id uuid,barber_id uuid,service_name text,final_amount_ars integer,collected_amount_ars integer,
 payment_date date,payment_time time,appointment_id uuid,service_origin text)
language plpgsql security definer set search_path=pg_catalog,public as $$
declare v public.service_payments;
begin
 select * into v from jsonb_populate_record(null::public.service_payments, public.staff_save_service_payment(
  p_barber_id=>p_barber_id,p_service_name=>p_service_name,p_service_other_detail=>p_service_other_detail,
  p_service_price_ars=>p_service_price_ars,p_discount_value=>p_discount_ars,p_payment_date=>p_payment_date,
  p_payment_time=>p_payment_time,p_payment_method=>p_payment_method,p_client_name=>p_client_name,
  p_client_contact=>p_client_contact,p_appointment_id=>p_appointment_id));
 if p_online_deposit_paid and not v.online_deposit_paid then raise exception 'INVALID_ONLINE_DEPOSIT_CLAIM'; end if;
 return query select v.id,v.barber_id,v.service_name,v.final_amount_ars,v.collected_amount_ars,
  v.payment_date,v.payment_time,v.appointment_id,v.service_origin;
end; $$;

create or replace function public.soft_delete_service_payment(p_payment_id uuid)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if auth.uid() is null or not public.is_operator() then
  raise exception using errcode='42501',message='OPERATOR_REQUIRED';
 end if;
 update public.service_payments set deleted_at=now(),deleted_by_user_id=auth.uid(),
  deleted_by_display_name=(select display_name from public.staff_profiles where user_id=auth.uid()),updated_at=now()
 where id=p_payment_id and deleted_at is null;
 if not found then raise exception using errcode='P0002',message='PAYMENT_NOT_FOUND'; end if;
end; $$;
revoke all on function public.soft_delete_service_payment(uuid) from public,anon;
grant execute on function public.soft_delete_service_payment(uuid) to authenticated;

-- A read-only API for operations. It never calls the admin listing's repair behavior.
create function public.staff_list_benefit_codes() returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare result jsonb;
begin
 if auth.uid() is null or not public.is_operator() then
  raise exception using errcode='42501',message='OPERATOR_REQUIRED';
 end if;
 select coalesce(jsonb_agg(to_jsonb(b)||jsonb_build_object('usages',(
  select coalesce(jsonb_agg(jsonb_build_object('appointmentId',a.id,'requestNumber',a.request_number,
   'clientName',coalesce(a.booking_client_name,c.name),'bookingDate',a.booking_date,
   'appointmentStatus',a.status,'usedAt',a.created_at) order by a.created_at desc),'[]'::jsonb)
  from public.appointments a left join public.clients c on c.id=a.client_id where a.benefit_code_id=b.id
 )) order by b.created_at desc),'[]'::jsonb) into result from public.benefit_codes b;
 return result;
end; $$;
revoke all on function public.staff_list_benefit_codes() from public,anon;
grant execute on function public.staff_list_benefit_codes() to authenticated;

-- Client mutations are audited, while ordinary staff can never write the audit table.
drop trigger audit_clients on public.clients;
create trigger audit_clients after insert or update on public.clients
 for each row execute function kani_private.audit_staff_operation();
-- Audit snapshots include the stable identity, before/after amounts and actor for void/edit/delete.
CREATE OR REPLACE FUNCTION public.record_channel_dispatch_status(p_appointment_id uuid, p_notification_event_id uuid, p_channel text, p_provider text, p_recipient text, p_provider_message_id text, p_status text, p_error_code text DEFAULT NULL::text, p_error_description text DEFAULT NULL::text, p_increment_attempt boolean DEFAULT false, p_meta_message_id text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'extensions', 'public'
AS $function$
declare
  v_dispatch_id uuid;
  v_current_status text;
begin
  -- Validación estricta de autorización en el servidor
  if (select auth.role()) <> 'service_role' then
    if not (
      public.is_operator()
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

  if p_notification_event_id is not null and not exists (
    select 1 from public.appointment_notification_events where id=p_notification_event_id and appointment_id=p_appointment_id
  ) then raise exception using errcode='42501',message='NOTIFICATION_EVENT_NOT_ALLOWED'; end if;

  -- Bloqueo de fila para evitar condiciones de carrera concurrentes
  select id, status into v_dispatch_id, v_current_status
  from public.appointment_notification_dispatches
  where appointment_id = p_appointment_id and channel = p_channel
    and (p_notification_event_id is null or notification_event_id = p_notification_event_id)
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
$function$;


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
    AND b.active = true;

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


revoke all on function public.record_channel_dispatch_status(uuid,uuid,text,text,text,text,text,text,text,boolean,text) from public,anon;
grant execute on function public.record_channel_dispatch_status(uuid,uuid,text,text,text,text,text,text,text,boolean,text) to authenticated,service_role;
-- Internal calendar and benefit callbacks are executed by the existing trusted Worker.
-- Their previous definer bodies did not scope results to a staff member.
do $$
declare fn record;
begin
 for fn in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname in (
 'get_pending_calendar_sync_items','record_calendar_sync_success','record_calendar_sync_failure',
 'set_barber_google_calendar','admin_consume_benefit_code_for_attempt',
 'lock_benefit_code_attempt','release_benefit_code_attempt','confirm_zero_deposit_appointment'
 ) loop
  execute format('revoke all on function %s from public, anon, authenticated',fn.signature);
  execute format('grant execute on function %s to service_role',fn.signature);
 end loop;
 -- Operational RPCs remain available to verified staff; never rely on default PUBLIC execute.
 for fn in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname in (
 'create_availability_slots','update_availability_slot','create_manual_appointment',
 'update_manual_appointment','update_appointment_status','retry_appointment_notification',
 'get_online_deposit_movements','get_appointment_payment_details','delete_client',
 'record_service_payment','update_service_payment_client','soft_delete_service_payment','save_client',
 'admin_create_benefit_code','admin_disable_benefit_code','admin_list_benefit_codes','check_is_admin_user'
 ) loop
  execute format('revoke all on function %s from public, anon',fn.signature);
  execute format('grant execute on function %s to authenticated, service_role',fn.signature);
 end loop;
end; $$;

-- These two public helpers reveal only interval occupancy, never client or payment details.
-- Definer execution is required to evaluate busy/blocked intervals behind the public projection.
create or replace function public.is_public_slot_booked(p_barber_id uuid,p_slot_date date,p_start_time time,p_end_time time)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.appointments a
 where a.barber_id=p_barber_id and a.booking_date between p_slot_date-1 and p_slot_date
 and a.status<>'CANCELLED' and
 tsrange(a.booking_date+a.start_time,a.booking_date+a.end_time+
  case when a.end_time<=a.start_time then interval '1 day' else interval '0' end,'[)')
 && tsrange(p_slot_date+p_start_time,p_slot_date+p_end_time+
  case when p_end_time<=p_start_time then interval '1 day' else interval '0' end,'[)'));
$$;
create function public.is_public_slot_blocked(p_barber_id uuid,p_slot_date date,p_start_time time,p_end_time time)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.barber_availability_slots s
 where s.barber_id=p_barber_id and s.slot_date between p_slot_date-1 and p_slot_date
 and s.status='UNAVAILABLE' and
 tsrange(s.slot_date+s.start_time,s.slot_date+s.end_time+
  case when s.end_time<=s.start_time then interval '1 day' else interval '0' end,'[)')
 && tsrange(p_slot_date+p_start_time,p_slot_date+p_end_time+
  case when p_end_time<=p_start_time then interval '1 day' else interval '0' end,'[)'));
$$;
revoke all on function public.is_public_slot_booked(uuid,date,time,time) from public;
revoke all on function public.is_public_slot_blocked(uuid,date,time,time) from public;
grant execute on function public.is_public_slot_booked(uuid,date,time,time),public.is_public_slot_blocked(uuid,date,time,time) to anon,authenticated,service_role;

create or replace view public.available_barber_slots with(security_invoker=true) as
 select distinct on(s.barber_id,s.slot_date,segment.segment_start)
 s.id,s.barber_id,s.slot_date,segment.segment_start::time as start_time,
 (segment.segment_start+interval '5 minutes')::time as end_time,'AVAILABLE'::public.availability_status as status
 from public.barber_availability_slots s join public.barbers b on b.id=s.barber_id
 cross join lateral generate_series(s.slot_date+s.start_time,s.slot_date+s.end_time-interval '5 minutes',interval '5 minutes') segment(segment_start)
 where b.active and s.status='AVAILABLE' and s.start_time>=time '10:00' and s.end_time<=time '20:00'
 and s.end_time>s.start_time
 and not public.is_public_slot_booked(s.barber_id,s.slot_date,segment.segment_start::time,(segment.segment_start+interval '5 minutes')::time)
 and not public.is_public_slot_blocked(s.barber_id,s.slot_date,segment.segment_start::time,(segment.segment_start+interval '5 minutes')::time)
 order by s.barber_id,s.slot_date,segment.segment_start,s.id;
-- Replace broad grants (including inherited PUBLIC access) and any direct note grant.
revoke select on public.barber_availability_slots from public,anon;
revoke select(internal_note) on public.barber_availability_slots from public,anon;
grant select(id,barber_id,slot_date,start_time,end_time,status) on public.barber_availability_slots to anon;
do $$ begin
 if has_column_privilege('anon','public.barber_availability_slots','internal_note','SELECT') then
  raise exception 'Anonymous availability notes remain readable through another inherited grant';
 end if;
end; $$;
grant select(id,active) on public.barbers to anon;
grant select on public.available_barber_slots to anon,authenticated;

-- Creating an outbox claim is privileged: direct arbitrary appointment IDs must not mint capabilities.
create function public.staff_create_appointment_notification_event(p_appointment_id uuid,p_notification_type public.notification_type)
returns text language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_status public.appointment_status;
begin
 if auth.uid() is null then raise exception using errcode='42501',message='AUTH_REQUIRED'; end if;
 select status into v_status from public.appointments a where id=p_appointment_id
 and (public.is_operator() or a.barber_id=public.current_staff_barber_id());
 if not found then raise exception using errcode='42501',message='APPOINTMENT_NOT_ALLOWED'; end if;
 if p_notification_type is distinct from (case v_status
   when 'PENDING' then 'NEW_REQUEST'::public.notification_type
   when 'CONFIRMED' then 'CONFIRMED'::public.notification_type
   when 'CANCELLED' then 'CANCELLED'::public.notification_type else null end) then
  raise exception using errcode='22023',message='NOTIFICATION_STATUS_NOT_ALLOWED';
 end if;
 return public.create_appointment_notification_event(p_appointment_id,p_notification_type);
end; $$;
revoke all on function public.create_appointment_notification_event(uuid,public.notification_type) from public,anon,authenticated;
grant execute on function public.create_appointment_notification_event(uuid,public.notification_type) to service_role;
revoke all on function public.staff_create_appointment_notification_event(uuid,public.notification_type) from public,anon;
grant execute on function public.staff_create_appointment_notification_event(uuid,public.notification_type) to authenticated;

notify pgrst,'reload schema';
