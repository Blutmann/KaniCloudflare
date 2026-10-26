-- Run ONLY in iockpxtkflyjfagkvgnr. All fixtures and outbox rows are rolled back.
-- Synthetic database evidence, not a Payway or MP transaction. No email dispatcher is called.
begin;
do $$
declare
  b uuid:=gen_random_uuid(); s uuid:=gen_random_uuid(); cid uuid;
  d date:=current_date+3; k text:=replace(gen_random_uuid()::text,'-','');
  bn text; sn text; a uuid; a2 uuid; a3 uuid; a4 uuid;
  t uuid; t2 uuid; r jsonb; code text; dep numeric;
begin
  if extract(isodow from d)=7 then d:=d+1; end if;
  bn:='PAYWAY AUDIT '||k; sn:='PAYWAY AUDIT '||k;
  insert into public.barbers(id,name) values(b,bn);
  insert into public.services(id,name,price_ars,duration_minutes) values(s,sn,25000,45);
  insert into public.barber_transfer_details(barber_id,alias,cuit,holder_name,down_payment_ars,active)
    values(b,'audit.not.a.real.account','20000000001','Synthetic audit',3000,true);
  insert into public.barber_availability_slots(barber_id,slot_date,start_time,end_time,status)
    select b,d,make_time(hour,0,0),make_time(hour+1,0,0),'AVAILABLE' from generate_series(10,19) hour;
  t:=gen_random_uuid();
  r:=public.prepare_payway_attempt(t,'12345678',bn,sn,d,'10:00','Synthetic audit','+5491100000000',k||'@example.test','');
  a:=(r->>'appointment_id')::uuid;
  assert r->>'state'='CREATED','initial state';
  assert (r->>'amount_ars')::numeric=3000 and (r->>'amount_minor_units')::bigint=300000,'server amount must be configuration-derived';
  assert r->>'site_transaction_id'='KANI'||replace(t::text,'-',''),'commercial reference';
  r:=public.claim_payway_attempt(t,a); assert (r->>'acquired')::boolean,'first claim';
  r:=public.claim_payway_attempt(t,a); assert not (r->>'acquired')::boolean,'double click must not acquire twice';
  perform public.settle_payway_attempt(t,'REJECTED','AUDIT'||k,'rejected','fixture');
  t2:=gen_random_uuid(); r:=public.prepare_payway_attempt(t2,'12345678',bn,sn,d,'10:00','Synthetic audit','+5491100000000',k||'@example.test','',a);
  assert (select count(*) from public.payment_attempts where appointment_id=a)=2,'rejected attempts must retain history';
  perform public.claim_payway_attempt(t2,a); perform public.settle_payway_attempt(t2,'UNKNOWN');
  begin
    perform public.prepare_payway_attempt(gen_random_uuid(),'12345678',bn,sn,d,'10:00','Synthetic audit','+5491100000000',k||'@example.test','',a);
    raise exception 'UNKNOWN unexpectedly allowed another attempt';
  exception when others then if sqlerrm<>'PAYMENT_REVIEW_REQUIRED' then raise; end if; end;
  select result_code into code from public.confirm_payway_attempt(a,t2,'invalid',300000);
  assert code='PAYMENT_MISMATCH','UNKNOWN cannot confirm';
  assert (select status::text from public.appointments where id=a)='PENDING','UNKNOWN cannot cancel/confirm the appointment';
  begin
    insert into public.appointment_payment_orders(appointment_id) values(a);
    raise exception 'cross-provider race not blocked';
  exception when others then if sqlerrm<>'PAYMENT_PROVIDER_CONFLICT' then raise; end if; end;
  begin
    update public.payment_attempts set amount_ars=1,amount_minor_units=100 where id=t2;
    raise exception 'amount mutation accepted';
  exception when others then if sqlerrm<>'PAYMENT_ATTEMPT_IMMUTABLE' then raise; end if; end;

  t:=gen_random_uuid(); r:=public.prepare_payway_attempt(t,'12345678',bn,sn,d,'11:30','Synthetic audit','+5491100000000',k||'@example.test','');
  a2:=(r->>'appointment_id')::uuid;
  perform public.claim_payway_attempt(t,a2); perform public.settle_payway_attempt(t,'APPROVED','APPROVED'||k,'approved');
  select result_code into code from public.confirm_payway_attempt(a2,t,'APPROVED'||k,300000);
  assert code='CONFIRMED','approved confirmation';
  assert (select deposit_paid and deposit_amount_ars=3000 from public.appointments where id=a2),'paid flags';
  select result_code into code from public.confirm_payway_attempt(a2,t,'APPROVED'||k,300000);
  assert code='ALREADY_CONFIRMED','idempotent confirmation';
  assert (select count(*) from public.appointment_notification_events where appointment_id=a2 and notification_type='CONFIRMED')=1,'single outbox event';
  begin
    insert into public.payment_attempts(appointment_id,provider,site_transaction_id,amount_ars,amount_minor_units)
      values(a,'PAYWAY','KANI'||replace(t::text,'-',''),3000,300000);
    raise exception 'duplicate site_transaction_id accepted';
  exception when unique_violation then null; end;

  select client_id into cid from public.appointments where id=a;
  a3:=gen_random_uuid(); insert into public.appointments(id,client_id,barber_id,service_id,booking_date,start_time,end_time)
    values(a3,cid,b,s,d,'14:30','15:15');
  insert into public.appointment_payment_orders(appointment_id,order_id) values(a3,'MPAUDIT'||k);
  select result_code into code from public.confirm_appointment_from_payment(a3,'MPAUDIT'||k,1);
  assert code='PAYMENT_MISMATCH','MP amount check unchanged';
  select result_code into code from public.confirm_appointment_from_payment(a3,'MPAUDIT'||k,5000);
  assert code='CONFIRMED','MP existing confirmation contract';
  select result_code into code from public.confirm_appointment_from_payment(a3,'MPAUDIT'||k,5000);
  assert code='ALREADY_CONFIRMED','MP duplicate unchanged';
  begin
    insert into public.payment_attempts(appointment_id,provider,site_transaction_id,provider_transaction_id,amount_ars,amount_minor_units,state)
      values(a3,'PAYWAY','UNIQUE'||k,'APPROVED'||k,3000,300000,'REJECTED');
    raise exception 'duplicate provider_transaction_id accepted';
  exception when unique_violation then null; end;
  t2:=gen_random_uuid();
  insert into public.payment_attempts(id,appointment_id,provider,site_transaction_id,amount_ars,amount_minor_units)
    values(t2,a3,'PAYWAY','CANCEL'||k,3000,300000);
  update public.payment_attempts set state='CANCELLED' where id=t2;
  assert (select state from public.payment_attempts where id=t2)='CANCELLED','unsubmitted attempt can be cancelled';

  t:=gen_random_uuid(); r:=public.prepare_payway_attempt(t,'12345678',bn,sn,d,'16:00','Synthetic audit','+5491100000000',k||'@example.test','');
  a4:=(r->>'appointment_id')::uuid; perform public.claim_payway_attempt(t,a4);
  perform public.settle_payway_attempt(t,'APPROVED','LATE'||k,'approved');
  insert into public.appointments(client_id,barber_id,service_id,booking_date,start_time,end_time,status)
    values(cid,b,s,d,'16:00','16:45','CONFIRMED');
  select result_code into code from public.confirm_payway_attempt(a4,t,'LATE'||k,300000);
  assert code='SLOT_COLLISION_LATE_PAYMENT','late collision check';
  assert (select confirmation_status from public.payment_attempts where id=t)='PAID_LATE_REVIEW','late payment review';
  update public.appointments set status='CANCELLED' where id=a4;
  select result_code into code from public.confirm_payway_attempt(a4,t,'LATE'||k,300000);
  assert code='APPOINTMENT_CANCELLED','cancelled check';
  assert (select count(*) from public.payment_attempts where appointment_id=a)=2,'UNKNOWN history unchanged';
  assert not has_function_privilege('anon','public.claim_payway_attempt(uuid,uuid)','EXECUTE');
  assert not has_function_privilege('authenticated','public.settle_payway_attempt(uuid,text,text,text,text)','EXECUTE');
  assert not has_function_privilege('anon','public.confirm_payway_attempt(uuid,uuid,text,bigint)','EXECUTE');
  assert not has_table_privilege('anon','public.payment_attempts','INSERT');
  assert not has_table_privilege('authenticated','public.payment_attempts','UPDATE');
end; $$;
do $$ declare u uuid; begin
  select user_id into strict u from public.staff_profiles where role='ADMIN' and active limit 1;
  perform set_config('request.jwt.claim.sub',u::text,true);
end; $$;
set local role authenticated;
do $$ begin
  assert public.is_admin(),'existing ADMIN identity';
  assert (select count(*) from public.payment_attempts)>0,'ADMIN reads financial attempts';
end; $$;
reset role;
-- Test has no BARBER account. Change only the transaction-local profile fixture;
-- other sessions never observe it and ROLLBACK restores the original ADMIN.
update public.staff_profiles set role='BARBER',barber_id=(select barber_id from public.appointments limit 1)
  where user_id=current_setting('request.jwt.claim.sub')::uuid;
set local role authenticated;
do $$ begin
  assert not public.is_admin(),'transaction-local BARBER profile';
  assert (select count(*) from public.payment_attempts)=0,'non-admin must not read attempts';
end; $$;
reset role;
rollback;
select 'PAYMENT_ATTEMPTS_DATABASE_TESTS_PASSED_ALL_FIXTURES_ROLLED_BACK' as result;
