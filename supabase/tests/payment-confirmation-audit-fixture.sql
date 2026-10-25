create role anon;
create role authenticated;
create role service_role;
create schema extensions;
create type public.appointment_status as enum ('PENDING','CONFIRMED','CANCELLED','COMPLETED');
create table public.appointments(id uuid primary key, barber_id uuid not null, booking_date date not null, start_time time not null, end_time time not null, status public.appointment_status not null, updated_at timestamptz default now());
create table public.audit_notifications(appointment_id uuid primary key, token text not null);
create function public.create_appointment_notification_event(uuid,text) returns text language plpgsql as $$
declare v_token text := gen_random_uuid()::text;
begin
 insert into public.audit_notifications values ($1,v_token) on conflict do nothing;
 if found then return v_token; end if; return null;
end; $$;
create function public.get_appointment_payment_details(uuid) returns text language sql as $$ select 'fixture'::text; $$;
create function public.confirm_appointment_from_payment(uuid,text,integer) returns table(appointment_status public.appointment_status,result_code text,notification_claim_token text) language sql as $$ select 'PENDING'::public.appointment_status, 'FIXTURE'::text, null::text; $$;
grant execute on function public.confirm_appointment_from_payment(uuid,text,integer) to anon, authenticated;
