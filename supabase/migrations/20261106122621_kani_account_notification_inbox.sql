-- Keep the legacy event log and its unattributed read_at values for traceability.
-- Only canonical confirmed/cancelled events participate in the new inbox.
set local lock_timeout='5s';
set local statement_timeout='60s';
-- Finish pre-existing event writers before changing the trigger/feed contract.
-- Public availability/booking SELECTs remain available throughout.
lock table public.appointments,public.barber_availability_slots in share row exclusive mode;
alter table public.admin_activity_notifications
 add column event_key text,
 add column feed_sequence bigint generated always as identity,
 add column deleted_at timestamptz,
 add column deleted_by uuid references auth.users(id) on delete set null;

with eligible as (
 select n.id, n.event_type::text || ':' || n.appointment_id::text as event_key,
 row_number() over(partition by n.appointment_id,n.event_type order by n.created_at,n.id) as ordinal
 from public.admin_activity_notifications n
 where n.appointment_id is not null and (
  n.event_type='APPOINTMENT_CONFIRMED' or
  (n.event_type='APPOINTMENT_CANCELLED' and exists (
   select 1 from public.admin_activity_notifications confirmed
   where confirmed.appointment_id=n.appointment_id and confirmed.event_type='APPOINTMENT_CONFIRMED'
  ))
 )
)
update public.admin_activity_notifications n set event_key=e.event_key
from eligible e where e.id=n.id and e.ordinal=1;
create unique index notification_event_key_unique on public.admin_activity_notifications(event_key);
create index notification_inbox_sequence on public.admin_activity_notifications(feed_sequence desc)
 where event_key is not null and deleted_at is null;
create index notification_deleted_by on public.admin_activity_notifications(deleted_by) where deleted_by is not null;
create index notification_appointment_lookup on public.admin_activity_notifications(appointment_id);

create table if not exists public.admin_activity_user_state (
 notification_id uuid not null references public.admin_activity_notifications(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 read_at timestamptz,
 updated_at timestamptz not null default now(),
 primary key(notification_id,user_id)
);
create index if not exists notification_state_account on public.admin_activity_user_state(user_id,notification_id);
alter table public.admin_activity_user_state enable row level security;
alter table public.admin_activity_notifications enable row level security;

-- Replace all legacy notification policies, including shared-read updates.
do $$ declare p record; begin
 for p in select tablename,policyname from pg_policies
 where schemaname='public' and tablename in ('admin_activity_notifications','admin_activity_user_state')
 loop execute format('drop policy %I on public.%I',p.policyname,p.tablename); end loop;
end $$;
revoke all on public.admin_activity_notifications from public,anon,authenticated;
grant select on public.admin_activity_notifications to authenticated;
revoke all on public.admin_activity_user_state from public,anon,authenticated;
grant select,insert,update on public.admin_activity_user_state to authenticated;
create policy notification_visible_appointment on public.admin_activity_notifications for select to authenticated
 using ((select auth.uid()) is not null and event_key is not null and deleted_at is null
 and event_type in ('APPOINTMENT_CONFIRMED','APPOINTMENT_CANCELLED')
 and exists(select 1 from public.appointments a where a.id=appointment_id
 and ((select public.is_operator()) or a.barber_id=(select public.current_staff_barber_id()))));
create policy notification_account_select on public.admin_activity_user_state for select to authenticated
 using (user_id=(select auth.uid()) and exists(select 1 from public.admin_activity_notifications n where n.id=notification_id));
create policy notification_account_insert on public.admin_activity_user_state for insert to authenticated
 with check (user_id=(select auth.uid()) and exists(select 1 from public.admin_activity_notifications n where n.id=notification_id));
create policy notification_account_update on public.admin_activity_user_state for update to authenticated
 using (user_id=(select auth.uid()) and exists(select 1 from public.admin_activity_notifications n where n.id=notification_id))
 with check (user_id=(select auth.uid()) and exists(select 1 from public.admin_activity_notifications n where n.id=notification_id));

create or replace function public.log_admin_activity_appointment() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_type public.admin_activity_event_type; v_key text;
begin
 if new.status='CONFIRMED' then
  if tg_op='UPDATE' then if old.status=new.status then return new; end if; end if;
  v_type:='APPOINTMENT_CONFIRMED';
 elsif tg_op='UPDATE' then
  if new.status='CANCELLED' and old.status='CONFIRMED' then v_type:='APPOINTMENT_CANCELLED';
  else return new; end if;
 else return new; end if;
 v_key:=v_type::text || ':' || new.id::text;
 insert into public.admin_activity_notifications(event_type,event_key,actor_user_id,actor_display_name,
 barber_id,appointment_id,barber_name,client_name,event_date,event_time)
 select v_type,v_key,auth.uid(),coalesce(sp.display_name,'Kani Barber Studio'),new.barber_id,new.id,
 b.name,coalesce(nullif(new.booking_client_name,''),c.name),new.booking_date,new.start_time
 from public.barbers b join public.clients c on c.id=new.client_id
 left join public.staff_profiles sp on sp.user_id=auth.uid() and sp.active
 where b.id=new.barber_id
 on conflict(event_key) do nothing;
 return new;
end $$;
-- Leave the old trigger attached as a no-op. The independent availability audit remains active.
create or replace function public.log_admin_activity_availability() returns trigger
language plpgsql security invoker set search_path='' as $$ begin return new; end $$;
revoke all on function public.log_admin_activity_appointment() from public,anon,authenticated;
revoke all on function public.log_admin_activity_availability() from public,anon,authenticated;

create function public.staff_notification_inbox(p_before bigint default null) returns jsonb
language sql stable security invoker set search_path='' as $$
 with visible as materialized (
  select n.id,n.event_type,n.appointment_id,n.created_at,n.feed_sequence,
  coalesce(nullif(a.booking_client_name,''),c.name,n.client_name) client_name,b.name barber_name,
  a.booking_date event_date,a.start_time event_time,s.read_at
  from public.admin_activity_notifications n join public.appointments a on a.id=n.appointment_id
  join public.clients c on c.id=a.client_id join public.barbers b on b.id=a.barber_id
  left join public.admin_activity_user_state s on s.notification_id=n.id and s.user_id=(select auth.uid())
 ), page as (select * from visible where p_before is null or feed_sequence<p_before order by feed_sequence desc limit 50)
 select jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(p) order by feed_sequence desc) from page p),'[]'::jsonb),
 'unread_count',(select count(*) from visible where read_at is null),
 'through',coalesce((select max(feed_sequence) from visible),0),
 'next_before',case when (select count(*) from page)=50 then (select min(feed_sequence) from page) else null end)
$$;

create function public.staff_set_notification_reads(p_read boolean,p_ids uuid[] default null,p_through bigint default null)
returns void language plpgsql security invoker set search_path='' as $$
begin
 if auth.uid() is null or not (public.is_operator() or public.current_staff_barber_id() is not null)
 then raise exception using errcode='42501',message='AUTH_REQUIRED'; end if;
 if p_read is null or (p_ids is null and p_through is null) or coalesce(cardinality(p_ids),0)>1000
 then raise exception using errcode='22023',message='NOTIFICATION_SCOPE_REQUIRED'; end if;
 if p_ids is not null and exists(select 1 from unnest(p_ids) x(id)
 where not exists(select 1 from public.admin_activity_notifications n where n.id=x.id))
 then raise exception using errcode='42501',message='NOTIFICATION_NOT_ALLOWED'; end if;
 -- One statement and an explicit high-water mark: concurrent/new arrivals stay unread.
 insert into public.admin_activity_user_state(notification_id,user_id,read_at,updated_at)
 select n.id,auth.uid(),case when p_read then statement_timestamp() else null end,statement_timestamp()
 from public.admin_activity_notifications n
 where (p_ids is not null and n.id=any(p_ids)) or (p_ids is null and n.feed_sequence<=p_through)
 on conflict(notification_id,user_id) do update set read_at=excluded.read_at,updated_at=excluded.updated_at;
end $$;

create function kani_private.delete_inbox_notifications(p_ids uuid[]) returns void
language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not public.is_admin() then
  raise exception using errcode='42501',message='ADMIN_REQUIRED'; end if;
 if p_ids is null or cardinality(p_ids)>1000 then raise exception 'NOTIFICATION_SCOPE_REQUIRED'; end if;
 update public.admin_activity_notifications set deleted_at=statement_timestamp(),deleted_by=auth.uid()
 where id=any(p_ids) and event_key is not null and deleted_at is null;
end $$;
create function public.staff_delete_notifications(p_ids uuid[]) returns void
language sql security invoker set search_path='' as $$ select kani_private.delete_inbox_notifications(p_ids) $$;

-- A narrow, explicitly authorized snapshot also verifies provider deposits without exposing order records.
create function kani_private.notification_appointment_detail(p_notification_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare v_result jsonb;
begin
 if auth.uid() is null then raise exception using errcode='42501',message='AUTH_REQUIRED'; end if;
 select jsonb_build_object('appointment_id',a.id,'status',a.status,'client_name',coalesce(nullif(a.booking_client_name,''),c.name),
 'phone',c.phone,'email',c.email,'service',coalesce(a.custom_service_name,s.name,'Servicio'),
 'barber',b.name,'barber_id',a.barber_id,'date',a.booking_date,'time',a.start_time,'end_time',a.end_time,
 'final_price',coalesce(p.final_amount_ars,a.benefit_final_price_ars,a.service_price_ars,s.price_ars,0),
 'deposit_paid',coalesce(approved.paid,o.paid_amount_ars,case when a.deposit_paid then a.deposit_amount_ars else 0 end,0),
 'deposit_verifiable',case when coalesce(approved.paid,o.paid_amount_ars) is not null
  then a.deposit_paid and a.deposit_amount_ars is not null and a.deposit_amount_ars=coalesce(approved.paid,o.paid_amount_ars)
  else not a.deposit_paid or (a.deposit_amount_ars is not null and a.deposit_amount_ars>=0) end,
 'collected',coalesce(p.collected_amount_ars,0),
 'balance',greatest(0,coalesce(p.final_amount_ars,a.benefit_final_price_ars,a.service_price_ars,s.price_ars,0)
  -coalesce(approved.paid,o.paid_amount_ars,case when a.deposit_paid then a.deposit_amount_ars else 0 end,0)-coalesce(p.collected_amount_ars,0)),
 'benefit',a.benefit_code,'benefit_type',a.benefit_type,
 'has_payment',exists(select 1 from public.service_payments x where x.appointment_id=a.id)) into v_result
 from public.admin_activity_notifications n join public.appointments a on a.id=n.appointment_id
 join public.clients c on c.id=a.client_id join public.barbers b on b.id=a.barber_id
 left join public.services s on s.id=a.service_id
 left join lateral (select x.amount_ars paid from public.payment_attempts x
  where x.appointment_id=a.id and x.state='APPROVED' and x.confirmation_status in ('CONFIRMED','ALREADY_CONFIRMED')
  order by x.created_at desc limit 1) approved on true
 left join public.appointment_payment_orders o on o.appointment_id=a.id and o.reconciliation_status='CONFIRMED'
 left join lateral (select x.final_amount_ars,x.collected_amount_ars from public.service_payments x
  where x.appointment_id=a.id and x.deleted_at is null and x.service_name<>'Anulado'
  order by x.created_at desc limit 1) p on true
 where n.id=p_notification_id and n.event_key is not null and n.deleted_at is null
 and n.event_type in ('APPOINTMENT_CONFIRMED','APPOINTMENT_CANCELLED')
 and (public.is_operator() or a.barber_id=public.current_staff_barber_id());
 if v_result is null then raise exception using errcode='42501',message='NOTIFICATION_NOT_ALLOWED'; end if;
 return v_result;
end $$;
create function public.staff_notification_detail(p_notification_id uuid) returns jsonb
language sql stable security invoker set search_path='' as $$ select kani_private.notification_appointment_detail(p_notification_id) $$;

revoke all on function public.staff_notification_inbox(bigint),public.staff_set_notification_reads(boolean,uuid[],bigint),
 public.staff_delete_notifications(uuid[]),public.staff_notification_detail(uuid) from public,anon;
grant execute on function public.staff_notification_inbox(bigint),public.staff_set_notification_reads(boolean,uuid[],bigint),
 public.staff_delete_notifications(uuid[]),public.staff_notification_detail(uuid) to authenticated;
revoke all on function kani_private.delete_inbox_notifications(uuid[]),kani_private.notification_appointment_detail(uuid) from public,anon,authenticated;
grant usage on schema kani_private to authenticated;
grant execute on function kani_private.delete_inbox_notifications(uuid[]),kani_private.notification_appointment_detail(uuid) to authenticated;

-- Preserve global deletion evidence; an inbox delete never deletes the appointment or the event.
create trigger audit_notification_changes after insert or update on public.admin_activity_notifications
 for each row execute function kani_private.audit_staff_operation();

-- Disable any obsolete read/dismiss/delete APIs if present in an older installation.
do $$ declare f record; begin
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and (p.proname like '%staff_activity_notification%' or p.proname in
 ('admin_cleanup_availability_notifications','get_appointment_payment_details'))
 loop
  execute format('revoke execute on function %s from public,anon,authenticated',f.signature);
  -- The legacy payment detail helper is consumed only by the trusted payment Worker.
  -- Its old definer body did not scope authenticated barbers to their own appointment.
  if f.signature::text like '%get_appointment_payment_details%' then
   execute format('grant execute on function %s to service_role',f.signature);
  end if;
 end loop;
end $$;
notify pgrst,'reload schema';
