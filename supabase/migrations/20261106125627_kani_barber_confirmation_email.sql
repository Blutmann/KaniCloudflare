-- Independent durable recipient: never share the customer's dispatch or claim token.
set local lock_timeout='5s';
set local statement_timeout='60s';
lock table public.appointments in share row exclusive mode;

create table kani_private.barber_confirmation_email_jobs (
 id uuid primary key default gen_random_uuid(),
 appointment_id uuid unique references public.appointments(id) on delete cascade,
 barber_id uuid references public.barbers(id),
 is_test boolean not null default false,
 recipient_user_id uuid references auth.users(id) on delete set null,
 recipient_email text,
 payload jsonb,
 provider_request jsonb,
 status text not null default 'PENDING' check(status in
  ('PENDING','PROCESSING','FAILED','PROVIDER_ACCEPTED','DELIVERED','SKIPPED','NEEDS_REVIEW')),
 attempts integer not null default 0,
 available_at timestamptz not null default now(),
 lease_id uuid, lease_until timestamptz,
 first_attempt_at timestamptz,
 provider_message_id text unique,
 error_code text,
 diagnostic text,
 delivered_at timestamptz,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 check ((not is_test and appointment_id is not null and barber_id is not null)
  or (is_test and appointment_id is null and payload is not null and recipient_email is not null))
);
alter table kani_private.barber_confirmation_email_jobs enable row level security;
revoke all on kani_private.barber_confirmation_email_jobs from public,anon,authenticated;
grant all on kani_private.barber_confirmation_email_jobs to service_role;
create index barber_confirmation_email_due on kani_private.barber_confirmation_email_jobs(available_at)
 where status in ('PENDING','FAILED','PROCESSING');
create index barber_confirmation_email_barber on kani_private.barber_confirmation_email_jobs(barber_id);
create index barber_confirmation_email_user on kani_private.barber_confirmation_email_jobs(recipient_user_id);

-- A signed delivery callback can arrive before the send response is committed.
-- Store only provider IDs/statuses so that race cannot lose delivery evidence.
create table kani_private.barber_email_delivery_receipts (
 provider_message_id text primary key, status text not null
  check(status in ('DELIVERED','BOUNCED','COMPLAINED','DELIVERY_FAILED')),
 received_at timestamptz not null default now()
);
alter table kani_private.barber_email_delivery_receipts enable row level security;
revoke all on kani_private.barber_email_delivery_receipts from public,anon,authenticated;
grant all on kani_private.barber_email_delivery_receipts to service_role;

create function kani_private.enqueue_barber_confirmation_email() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.status='CONFIRMED' and (tg_op='INSERT' or old.status is distinct from new.status) then
  insert into kani_private.barber_confirmation_email_jobs(appointment_id,barber_id)
  values(new.id,new.barber_id) on conflict(appointment_id) do nothing;
 end if;
 return new;
end $$;
revoke all on function kani_private.enqueue_barber_confirmation_email() from public,anon,authenticated;
create trigger enqueue_barber_confirmation_email after insert or update of status on public.appointments
 for each row execute function kani_private.enqueue_barber_confirmation_email();
-- No historical backfill: deploying this feature must not email old appointments.

-- service_role intentionally has no broad SELECT on auth.users in this project.
-- A private, service-only lookup returns just the assigned active account's email.
create function kani_private.barber_confirmation_recipient(p_barber_id uuid)
returns table(user_id uuid,email text) language plpgsql stable security definer set search_path='' as $$
begin
 if current_setting('role',true) is distinct from 'service_role' then
  raise exception using errcode='42501',message='SERVICE_REQUIRED';
 end if;
 return query select u.id,lower(trim(u.email))::text from public.staff_profiles p
  join auth.users u on u.id=p.user_id join public.barbers b on b.id=p.barber_id
  where p.barber_id=p_barber_id and p.active and p.role='BARBER' and b.active
  and u.deleted_at is null and (u.banned_until is null or u.banned_until<now());
end $$;
revoke all on function kani_private.barber_confirmation_recipient(uuid) from public,anon,authenticated;
grant execute on function kani_private.barber_confirmation_recipient(uuid) to service_role;

create function public.claim_barber_confirmation_emails(p_limit integer default 10,p_appointment_id uuid default null)
returns setof jsonb language plpgsql security invoker set search_path='' as $$
declare j kani_private.barber_confirmation_email_jobs%rowtype; a public.appointments%rowtype;
 v_user uuid; v_email text; v_payload jsonb; v_lease uuid;
begin
 update kani_private.barber_confirmation_email_jobs set status='NEEDS_REVIEW',error_code=coalesce(error_code,'RETRY_LIMIT_REACHED'),
  lease_id=null,lease_until=null,updated_at=now()
 where status in ('PENDING','FAILED','PROCESSING') and attempts>=6 and (lease_until is null or lease_until<now());
 for j in select * from kani_private.barber_confirmation_email_jobs q
  where q.status in ('PENDING','FAILED','PROCESSING') and q.available_at<=now()
  and (q.lease_until is null or q.lease_until<now()) and q.attempts<6
  and (p_appointment_id is null or q.appointment_id=p_appointment_id)
  order by q.available_at,q.id limit greatest(1,least(coalesce(p_limit,10),25)) for update skip locked
 loop
  -- Resend deduplicates only for 24h. Never blindly resend after that window.
  if j.first_attempt_at is not null and j.first_attempt_at<now()-interval '20 hours' then
   update kani_private.barber_confirmation_email_jobs set status='NEEDS_REVIEW',
    error_code='IDEMPOTENCY_WINDOW_EXPIRED',lease_id=null,lease_until=null,updated_at=now() where id=j.id;
   continue;
  end if;
  if not j.is_test then
   select * into a from public.appointments where id=j.appointment_id;
   if a.status is distinct from 'CONFIRMED' or a.barber_id is distinct from j.barber_id then
    update kani_private.barber_confirmation_email_jobs set status='SKIPPED',error_code='APPOINTMENT_CHANGED',
     lease_id=null,lease_until=null,updated_at=now() where id=j.id;
    continue;
   end if;
   select r.user_id,r.email into v_user,v_email from kani_private.barber_confirmation_recipient(a.barber_id) r;
   if v_user is null or v_email is null or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    update kani_private.barber_confirmation_email_jobs set status='FAILED',error_code='BARBER_ACCOUNT_EMAIL_MISSING',
     attempts=attempts+1,available_at=now()+interval '5 minutes',lease_id=null,lease_until=null,updated_at=now() where id=j.id;
    continue;
   end if;
   if j.provider_request is not null and (j.recipient_user_id is distinct from v_user or j.recipient_email is distinct from v_email) then
    update kani_private.barber_confirmation_email_jobs set status='NEEDS_REVIEW',error_code='RECIPIENT_CHANGED',
     lease_id=null,lease_until=null,updated_at=now() where id=j.id;
    continue;
   end if;
   select jsonb_build_object('appointmentId',a.id,'clientName',coalesce(nullif(a.booking_client_name,''),c.name),
    'clientPhone',c.phone,'clientEmail',c.email,'barberName',b.name,
    'serviceName',coalesce(a.custom_service_name,s.name,'Servicio'),'bookingDate',a.booking_date,
    'startTime',a.start_time,'endTime',a.end_time,
    'serviceDurationMinutes',round(extract(epoch from (case when a.end_time>a.start_time then a.end_time-a.start_time
      else a.end_time-a.start_time+interval '24 hours' end))/60),
    'finalPriceArs',coalesce(p.final_amount_ars,a.benefit_final_price_ars,a.service_price_ars,s.price_ars,0),
    'depositPaidArs',coalesce(approved.paid,o.paid_amount_ars,case when a.deposit_paid then a.deposit_amount_ars else 0 end,0),
    'collectedArs',coalesce(p.collected_amount_ars,0),'benefitCode',a.benefit_code,'benefitType',a.benefit_type)
    into v_payload from public.clients c join public.barbers b on b.id=a.barber_id
    left join public.services s on s.id=a.service_id
    left join lateral (select x.amount_ars paid from public.payment_attempts x where x.appointment_id=a.id
     and x.state='APPROVED' and x.confirmation_status in ('CONFIRMED','ALREADY_CONFIRMED') order by x.created_at desc limit 1) approved on true
    left join public.appointment_payment_orders o on o.appointment_id=a.id and o.reconciliation_status='CONFIRMED'
    left join lateral (select x.final_amount_ars,x.collected_amount_ars from public.service_payments x
     where x.appointment_id=a.id and x.deleted_at is null and x.service_name<>'Anulado' order by x.created_at desc limit 1) p on true
    where c.id=a.client_id;
   if v_payload is null then raise exception 'BARBER_EMAIL_APPOINTMENT_DATA_MISSING'; end if;
  else
   v_user:=null;v_email:=j.recipient_email;v_payload:=j.payload;
  end if;
  v_lease:=gen_random_uuid();
  update kani_private.barber_confirmation_email_jobs set status='PROCESSING',attempts=attempts+1,
   lease_id=v_lease,lease_until=now()+interval '3 minutes',recipient_user_id=v_user,recipient_email=v_email,
   payload=case when provider_request is null then v_payload else payload end,updated_at=now() where id=j.id
   returning * into j;
  return next jsonb_build_object('job_id',j.id,'lease_id',v_lease,'recipient_email',j.recipient_email,
   'payload',j.payload,'provider_request',j.provider_request,'is_test',j.is_test);
 end loop;
end $$;

-- Freeze the exact request before calling Resend: retries use the same key AND body.
create function public.prepare_barber_confirmation_email(p_id uuid,p_lease uuid,p_request jsonb,p_diagnostic text default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_request jsonb;
begin
 update kani_private.barber_confirmation_email_jobs set provider_request=coalesce(provider_request,p_request),
  first_attempt_at=coalesce(first_attempt_at,now()),diagnostic=p_diagnostic,updated_at=now()
 where id=p_id and lease_id=p_lease and status='PROCESSING' and lease_until>now()
 returning provider_request into v_request;
 if v_request is null then raise exception 'BARBER_EMAIL_LEASE_LOST'; end if;
 return v_request;
end $$;

create function public.finish_barber_confirmation_email(p_id uuid,p_lease uuid,p_status text,p_message_id text default null,p_error text default null)
returns boolean language plpgsql security invoker set search_path='' as $$
declare v_receipt text;
begin
 if p_status not in ('PROVIDER_ACCEPTED','FAILED','NEEDS_REVIEW') then raise exception 'BARBER_EMAIL_STATUS_INVALID'; end if;
 if p_status='PROVIDER_ACCEPTED' and nullif(p_message_id,'') is null then raise exception 'BARBER_EMAIL_MESSAGE_ID_REQUIRED'; end if;
 select status into v_receipt from kani_private.barber_email_delivery_receipts where provider_message_id=p_message_id;
 update kani_private.barber_confirmation_email_jobs set status=case
  when p_status='PROVIDER_ACCEPTED' and v_receipt='DELIVERED' then 'DELIVERED'
  when p_status='PROVIDER_ACCEPTED' and v_receipt is not null then 'NEEDS_REVIEW'
  when p_status='FAILED' and attempts>=6 then 'NEEDS_REVIEW' else p_status end,
  provider_message_id=coalesce(p_message_id,provider_message_id),
  delivered_at=case when v_receipt='DELIVERED' then now() else delivered_at end,
  error_code=case when v_receipt is not null and v_receipt<>'DELIVERED' then v_receipt else p_error end,
  available_at=now()+make_interval(mins=>least(30,power(2,attempts)::integer)),
  lease_id=null,lease_until=null,updated_at=now() where id=p_id and lease_id=p_lease and status='PROCESSING';
 return found;
end $$;

create function public.record_barber_email_delivery(p_message_id text,p_status text) returns boolean
language plpgsql security invoker set search_path='' as $$
declare v_status text;
begin
 if p_status not in ('DELIVERED','BOUNCED','COMPLAINED','DELIVERY_FAILED') then raise exception 'BARBER_EMAIL_STATUS_INVALID'; end if;
 insert into kani_private.barber_email_delivery_receipts(provider_message_id,status) values(p_message_id,p_status)
 on conflict(provider_message_id) do update set status=excluded.status,received_at=now()
 where barber_email_delivery_receipts.status<>'COMPLAINED'
  and (barber_email_delivery_receipts.status<>'DELIVERED' or excluded.status='COMPLAINED');
 select status into v_status from kani_private.barber_email_delivery_receipts where provider_message_id=p_message_id;
 update kani_private.barber_confirmation_email_jobs set status=case when v_status='DELIVERED' then 'DELIVERED' else 'NEEDS_REVIEW' end,
  error_code=case when v_status='DELIVERED' then null else v_status end,
  delivered_at=case when v_status='DELIVERED' then coalesce(delivered_at,now()) else delivered_at end,updated_at=now()
 where provider_message_id=p_message_id and (status<>'DELIVERED' or v_status='COMPLAINED');
 return found;
end $$;

revoke all on function public.claim_barber_confirmation_emails(integer,uuid),
 public.prepare_barber_confirmation_email(uuid,uuid,jsonb,text),public.finish_barber_confirmation_email(uuid,uuid,text,text,text),
 public.record_barber_email_delivery(text,text) from public,anon,authenticated;
grant execute on function public.claim_barber_confirmation_emails(integer,uuid),
 public.prepare_barber_confirmation_email(uuid,uuid,jsonb,text),public.finish_barber_confirmation_email(uuid,uuid,text,text,text),
 public.record_barber_email_delivery(text,text) to service_role;
notify pgrst,'reload schema';
