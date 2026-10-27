-- Test project only. Synthetic fixtures + outbox only; never dispatch notifications.
begin;
do $$
declare b uuid:=gen_random_uuid(); s uuid:=gen_random_uuid(); d date:=current_date+5;
  k text:=replace(gen_random_uuid()::text,'-',''); bn text; sn text; t uuid; a uuid; x uuid;
  r jsonb; code text; token text; admin_id uuid;
begin
  if extract(isodow from d)=7 then d:=d+1; end if;
  bn:='Lifecycle '||k; sn:=bn;
  insert into public.barbers(id,name) values(b,bn);
  insert into public.services(id,name,price_ars,duration_minutes) values(s,sn,25000,45);
  insert into public.barber_transfer_details(barber_id,alias,cuit,holder_name,down_payment_ars,active)
    values(b,'synthetic.test','20000000001','Synthetic',5000,true);
  insert into public.barber_availability_slots(barber_id,slot_date,start_time,end_time,status)
    values(b,d,'10:00','20:00','AVAILABLE');
  select user_id into admin_id from public.staff_profiles where role='ADMIN' and active limit 1;
  assert admin_id is not null,'test requires existing admin';
  perform set_config('request.jwt.claim.sub',admin_id::text,true);
  t:=gen_random_uuid();
  r:=public.prepare_payway_attempt(t,'12345678',bn,sn,d,'10:00','Synthetic','+5491100000000',k||'@example.test','');
  a:=(r->>'appointment_id')::uuid;
  begin
    perform public.update_appointment_status(a,'CONFIRMED');
    raise exception 'manual confirmation accepted';
  exception when sqlstate '22023' then null; end;
  begin
    update public.appointments set status='COMPLETED' where id=a;
    raise exception 'pending hold bypassed payment via accounting';
  exception when insufficient_privilege then null; end;
  assert (select status='PENDING' and not deposit_paid from public.appointments where id=a),'pending means unpaid';
  perform public.claim_payway_attempt(t,a);
  perform public.settle_payway_attempt(t,'APPROVED','APPROVED'||k,'approved',null);
  select result_code into code from public.confirm_payway_attempt(a,t,'APPROVED'||k,500000);
  assert code='CONFIRMED','verified payment must confirm';
  select result_code into code from public.confirm_payway_attempt(a,t,'APPROVED'||k,500000);
  assert code='ALREADY_CONFIRMED','duplicate must be idempotent';
  assert (select count(*)=1 from public.appointment_notification_events where appointment_id=a and notification_type='CONFIRMED'),'one confirmation email';
  select notification_claim_token into token from public.update_appointment_status(a,'CANCELLED');
  assert token is not null,'persisted cancellation produces outbox';
  assert (select status='CANCELLED' and deposit_paid and deposit_amount_ars=5000 and cancellation_reason='STAFF_CANCELLED' and cancelled_by=admin_id from public.appointments where id=a),'cancel preserves payment and audit';
  select notification_claim_token into token from public.update_appointment_status(a,'CANCELLED');
  assert token is null,'duplicate cancellation does not produce email';
  assert (select count(*)=1 from public.appointment_notification_events where appointment_id=a and notification_type='CANCELLED'),'one cancellation email';
  assert (select state='APPROVED' from public.payment_attempts where id=t),'no refund or payment mutation';

  t:=gen_random_uuid();
  r:=public.prepare_payway_attempt(t,'12345678',bn,sn,d,'11:30','Synthetic','+5491100000000',k||'@example.test','');
  a:=(r->>'appointment_id')::uuid;
  perform public.claim_payway_attempt(t,a);
  perform public.settle_payway_attempt(t,'REJECTED',null,'rejected',null);
  assert (select status='PENDING' from public.appointments where id=a),'rejection preserves temporary hold';
  x:=gen_random_uuid();
  r:=public.prepare_payway_attempt(x,'12345678',bn,sn,d,'11:30','Synthetic','+5491100000000',k||'@example.test','',a);
  assert (r->>'appointment_id')::uuid=a,'retry reuses appointment';
  update public.appointments set created_at=now()-interval '11 minutes' where id=a;
  perform public.expire_unpaid_appointments();
  assert (select status='CANCELLED' and cancellation_reason='PAYMENT_EXPIRED' from public.appointments where id=a),'unpaid expiry retains history';
  assert (select count(*)=2 from public.payment_attempts where appointment_id=a),'retains attempt history';
  -- The released interval may be reserved again by another request.
  select appointment_id into x from public.request_appointment(bn,sn,d,'11:30','Synthetic','+5491100000000',k||'@example.test','');
  assert x<>a,'expiry releases slot';

  t:=gen_random_uuid();
  r:=public.prepare_payway_attempt(t,'12345678',bn,sn,d,'13:00','Synthetic','+5491100000000',k||'@example.test','');
  a:=(r->>'appointment_id')::uuid;
  perform public.claim_payway_attempt(t,a);
  perform public.settle_payway_attempt(t,'UNKNOWN',null,null,null);
  update public.appointments set created_at=now()-interval '11 minutes' where id=a;
  perform public.expire_unpaid_appointments();
  assert (select status='PENDING' and not deposit_paid from public.appointments where id=a),'UNKNOWN remains reserved but unconfirmed';
  assert not exists(select 1 from public.appointment_notification_events where appointment_id=a and notification_type='CONFIRMED'),'UNKNOWN sends no confirmation';
  assert not has_function_privilege('authenticated','public.confirm_verified_appointment_payment(uuid,text,text,numeric)','EXECUTE'),'staff cannot falsify payment';
  assert not has_function_privilege('anon','public.expire_unpaid_appointments()','EXECUTE'),'expiration is private';
end $$;
rollback;
select 'LIFECYCLE_TESTS_PASSED_AND_ROLLED_BACK' as result;
