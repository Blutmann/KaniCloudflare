-- Recovery metadata contains no passwords, OTPs or session tokens. Only the Worker can use these RPCs.
create table kani_private.staff_recovery_requests (
 id uuid primary key default gen_random_uuid(), kind text not null check(kind in ('REQUEST','COMPLETE')),
 ip_key text not null check(ip_key ~ '^[0-9a-f]{64}$'), subject_key text not null check(subject_key ~ '^[0-9a-f]{64}$'),
 email text check(length(email)<=254), created_at timestamptz not null default clock_timestamp(),
 status text not null check(status in ('QUEUED','SENDING','ACCEPTED','SUPPRESSED','FAILED','ATTEMPT','NEEDS_REVIEW')),
 dispatched_at timestamptz
);
alter table kani_private.staff_recovery_requests enable row level security;
revoke all on kani_private.staff_recovery_requests from public,anon,authenticated,service_role;
create index staff_recovery_ip_idx on kani_private.staff_recovery_requests(kind,ip_key,created_at);
create index staff_recovery_subject_idx on kani_private.staff_recovery_requests(kind,subject_key,created_at);
create index staff_recovery_pending_idx on kani_private.staff_recovery_requests(created_at) where status='QUEUED';

create function kani_private.consume_staff_recovery(p_kind text,p_ip_key text,p_subject_key text,p_email text default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_now timestamptz:=clock_timestamp(); v_id uuid;
begin
 if current_setting('role',true)<>'service_role' then raise exception using errcode='42501',message='SERVICE_REQUIRED'; end if;
 if p_kind is null or p_kind not in ('REQUEST','COMPLETE') or p_ip_key !~ '^[0-9a-f]{64}$' or p_subject_key !~ '^[0-9a-f]{64}$'
  or p_ip_key is null or p_subject_key is null then raise exception 'INVALID_RECOVERY_REQUEST'; end if;
 if p_kind='REQUEST' and (p_email is null or length(p_email)>254 or p_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') then return null; end if;
 perform pg_advisory_xact_lock(hashtextextended('kani-recovery-ip:'||p_ip_key,0));
 perform pg_advisory_xact_lock(hashtextextended('kani-recovery-subject:'||p_subject_key,0));
 if (select count(*) from kani_private.staff_recovery_requests where kind=p_kind and ip_key=p_ip_key and created_at>v_now-interval '15 minutes')>=10
 or (select count(*) from kani_private.staff_recovery_requests where kind=p_kind and ip_key=p_ip_key and created_at>v_now-interval '24 hours')>=40 then return null; end if;
 if p_kind='REQUEST' and (
  exists(select 1 from kani_private.staff_recovery_requests where kind=p_kind and subject_key=p_subject_key and created_at>v_now-interval '60 seconds')
  or (select count(*) from kani_private.staff_recovery_requests where kind=p_kind and subject_key=p_subject_key and created_at>v_now-interval '1 hour')>=3
 ) then return null; end if;
 if p_kind='COMPLETE' and (select count(*) from kani_private.staff_recovery_requests where kind=p_kind and subject_key=p_subject_key and created_at>v_now-interval '15 minutes')>=5 then return null; end if;
 insert into kani_private.staff_recovery_requests(kind,ip_key,subject_key,email,status)
 values(p_kind,p_ip_key,p_subject_key,case when p_kind='REQUEST' then lower(trim(p_email)) else null end,
 case when p_kind='REQUEST' then 'QUEUED' else 'ATTEMPT' end) returning id into v_id;
 return v_id;
end $$;

create function kani_private.staff_recovery_identity(p_email text default null,p_user_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v jsonb;
begin
 if current_setting('role',true)<>'service_role' then raise exception using errcode='42501',message='SERVICE_REQUIRED'; end if;
 if (p_email is null)=(p_user_id is null) then return null; end if;
 select jsonb_build_object('id',u.id,'email',u.email) into v
 from auth.users u join public.staff_profiles p on p.user_id=u.id
 left join public.barbers b on b.id=p.barber_id
 where ((p_user_id is not null and u.id=p_user_id) or (p_email is not null and lower(u.email)=lower(trim(p_email))))
 and u.email_confirmed_at is not null and u.deleted_at is null and (u.banned_until is null or u.banned_until<=now())
 and p.active and ((p.role::text in ('ADMIN','MANAGER') and p.barber_id is null) or (p.role::text='BARBER' and b.active)) limit 1;
 return v;
end $$;

create function kani_private.claim_staff_recoveries(p_limit integer default 5)
returns table(job_id uuid,recipient_email text) language plpgsql security definer set search_path='' as $$
begin
 if current_setting('role',true)<>'service_role' then raise exception using errcode='42501',message='SERVICE_REQUIRED'; end if;
 delete from kani_private.staff_recovery_requests where created_at<now()-interval '48 hours';
 update kani_private.staff_recovery_requests set status='SUPPRESSED' where status='QUEUED' and created_at<now()-interval '10 minutes';
 -- Never retry an ambiguous SMTP send: a new user request creates a new link instead.
 update kani_private.staff_recovery_requests set status='NEEDS_REVIEW' where status='SENDING' and dispatched_at<now()-interval '10 minutes';
 return query with candidates as (
  select id from kani_private.staff_recovery_requests where kind='REQUEST' and status='QUEUED'
  order by created_at for update skip locked limit least(5,greatest(1,p_limit))
 ) update kani_private.staff_recovery_requests r set status='SENDING',dispatched_at=clock_timestamp()
 from candidates c where r.id=c.id returning r.id,r.email;
end $$;

create function kani_private.finish_staff_recovery(p_id uuid,p_status text) returns void
language plpgsql security definer set search_path='' as $$
begin
 if current_setting('role',true)<>'service_role' then raise exception using errcode='42501',message='SERVICE_REQUIRED'; end if;
 if p_status not in ('ACCEPTED','SUPPRESSED','FAILED') then raise exception 'INVALID_RECOVERY_STATUS'; end if;
 update kani_private.staff_recovery_requests set status=p_status where id=p_id and status='SENDING';
end $$;

create function public.consume_staff_recovery(p_kind text,p_ip_key text,p_subject_key text,p_email text default null)
returns uuid language sql security invoker set search_path='' as $$select kani_private.consume_staff_recovery(p_kind,p_ip_key,p_subject_key,p_email)$$;
create function public.staff_recovery_identity(p_email text default null,p_user_id uuid default null)
returns jsonb language sql stable security invoker set search_path='' as $$select kani_private.staff_recovery_identity(p_email,p_user_id)$$;
create function public.claim_staff_recoveries(p_limit integer default 5)
returns table(job_id uuid,recipient_email text) language sql security invoker set search_path='' as $$select * from kani_private.claim_staff_recoveries(p_limit)$$;
create function public.finish_staff_recovery(p_id uuid,p_status text)
returns void language sql security invoker set search_path='' as $$select kani_private.finish_staff_recovery(p_id,p_status)$$;

revoke all on function public.consume_staff_recovery(text,text,text,text),public.staff_recovery_identity(text,uuid),public.claim_staff_recoveries(integer),public.finish_staff_recovery(uuid,text),
 kani_private.consume_staff_recovery(text,text,text,text),kani_private.staff_recovery_identity(text,uuid),kani_private.claim_staff_recoveries(integer),kani_private.finish_staff_recovery(uuid,text)
 from public,anon,authenticated;
grant usage on schema kani_private to service_role;
grant execute on function public.consume_staff_recovery(text,text,text,text),public.staff_recovery_identity(text,uuid),public.claim_staff_recoveries(integer),public.finish_staff_recovery(uuid,text),
 kani_private.consume_staff_recovery(text,text,text,text),kani_private.staff_recovery_identity(text,uuid),kani_private.claim_staff_recoveries(integer),kani_private.finish_staff_recovery(uuid,text)
 to service_role;
