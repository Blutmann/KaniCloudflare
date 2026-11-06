-- No historical row changes and no provider calls.
create or replace function kani_private.save_service_payment(
 p_payment_id uuid default null, p_barber_id uuid default null,
 p_service_name text default null, p_service_other_detail text default null,
 p_service_price_ars integer default null, p_discount_kind text default 'FIXED',
 p_discount_value numeric default 0, p_final_amount_ars integer default null,
 p_payment_method text default 'Efectivo', p_payment_date date default null,
 p_payment_time time default null, p_appointment_id uuid default null,
 p_client_id uuid default null, p_client_name text default null, p_client_contact text default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
 v_uid uuid := auth.uid(); v_operator boolean := public.is_operator();
 v_own uuid := public.current_staff_barber_id(); v_barber uuid;
 v_old public.service_payments; v_saved public.service_payments; v_apt public.appointments;
 v_service public.services; v_client public.clients; v_client_id uuid;
 v_name text; v_other text := nullif(trim(p_service_other_detail),'');
 v_price integer; v_discount integer; v_final integer; v_deposit integer := 0;
 v_kind text := coalesce(p_discount_kind,'FIXED'); v_discount_value numeric := coalesce(p_discount_value,0);
 v_actor_name text; v_appointment_id uuid; v_expected_final integer;
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
  if p_payment_id is null and v_apt.balance_paid then raise exception using errcode='22023',message='NO_PENDING_BALANCE'; end if;
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
 -- A receipt settles a real balance; it is not proof that the service was performed.
 if p_payment_id is null and v_appointment_id is not null and v_name<>'Anulado' then
  v_expected_final:=coalesce(v_apt.benefit_final_price_ars,v_apt.service_price_ars,
   (select s.price_ars from public.services s where s.id=v_apt.service_id));
  if v_expected_final is null then raise exception using errcode='22023',message='APPOINTMENT_PRICE_UNVERIFIABLE'; end if;
  if v_final>v_expected_final then raise exception using errcode='22023',message='PAYMENT_EXCEEDS_BALANCE'; end if;
  if v_expected_final<=v_deposit or v_final<=v_deposit then
   raise exception using errcode='22023',message='NO_PENDING_BALANCE';
  end if;
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
   case when v_appointment_id is not null then (statement_timestamp() at time zone 'America/Argentina/Buenos_Aires')::date else coalesce(p_payment_date,(now() at time zone 'America/Argentina/Buenos_Aires')::date) end,
   case when v_appointment_id is not null then (statement_timestamp() at time zone 'America/Argentina/Buenos_Aires')::time else coalesce(p_payment_time,(now() at time zone 'America/Argentina/Buenos_Aires')::time) end,p_payment_method,
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
  update public.appointments set balance_paid=true,updated_at=now() where id=v_appointment_id;
 end if;
 return to_jsonb(v_saved);
end; $$;

create or replace function public.staff_save_service_payment(
 p_payment_id uuid default null, p_barber_id uuid default null,
 p_service_name text default null, p_service_other_detail text default null,
 p_service_price_ars integer default null, p_discount_kind text default 'FIXED',
 p_discount_value numeric default 0, p_final_amount_ars integer default null,
 p_payment_method text default 'Efectivo', p_payment_date date default null,
 p_payment_time time default null, p_appointment_id uuid default null,
 p_client_id uuid default null, p_client_name text default null, p_client_contact text default null
) returns jsonb language sql security invoker set search_path='' as $$
 select kani_private.save_service_payment(p_payment_id,p_barber_id,p_service_name,p_service_other_detail,p_service_price_ars,p_discount_kind,p_discount_value,p_final_amount_ars,p_payment_method,p_payment_date,p_payment_time,p_appointment_id,p_client_id,p_client_name,p_client_contact);
$$;
revoke all on function kani_private.save_service_payment(uuid,uuid,text,text,integer,text,numeric,integer,text,date,time,uuid,uuid,text,text) from public,anon;
grant execute on function kani_private.save_service_payment(uuid,uuid,text,text,integer,text,numeric,integer,text,date,time,uuid,uuid,text,text) to authenticated;
revoke all on function public.staff_save_service_payment(uuid,uuid,text,text,integer,text,numeric,integer,text,date,time,uuid,uuid,text,text) from public,anon;
grant execute on function public.staff_save_service_payment(uuid,uuid,text,text,integer,text,numeric,integer,text,date,time,uuid,uuid,text,text) to authenticated;
