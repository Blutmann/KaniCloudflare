-- KANI Barber Studio — Identificador amigable y consecutivo de solicitud.
-- La secuencia no recicla números aunque una reserva se elimine.

create sequence if not exists public.appointment_request_number_seq;

alter table public.appointments
  add column if not exists request_number bigint;

with ordered_appointments as (
  select id,
         row_number() over (order by created_at asc, id asc)::bigint as assigned_number
  from public.appointments
  where request_number is null
)
update public.appointments a
set request_number = o.assigned_number
from ordered_appointments o
where a.id = o.id;

select setval(
  'public.appointment_request_number_seq'::regclass,
  greatest(coalesce((select max(request_number) from public.appointments), 0), 1),
  coalesce((select max(request_number) from public.appointments), 0) > 0
);

alter table public.appointments
  alter column request_number set default nextval('public.appointment_request_number_seq'::regclass),
  alter column request_number set not null;

alter table public.appointments
  add constraint appointments_request_number_range
  check (request_number between 1 and 999999);

create unique index if not exists appointments_request_number_uidx
  on public.appointments (request_number);

comment on column public.appointments.request_number is
  'Identificador público consecutivo de la solicitud. No se reutiliza.';

-- Wrapper de solo lectura adicional: conserva request_appointment intacta y
-- devuelve el número generado por el default de la tabla junto con su token.
create or replace function public.request_appointment_with_number(
  p_barber_name text,
  p_service_name text,
  p_booking_date date,
  p_start_time time,
  p_client_name text,
  p_client_phone text,
  p_client_email text,
  p_notes text default null
)
returns table (
  appointment_id uuid,
  appointment_status public.appointment_status,
  booking_date date,
  start_time time,
  end_time time,
  request_number bigint,
  notification_claim_token text
)
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
begin
  return query
  select r.appointment_id,
         r.appointment_status,
         r.booking_date,
         r.start_time,
         r.end_time,
         a.request_number,
         r.notification_claim_token
  from public.request_appointment(
    p_barber_name,
    p_service_name,
    p_booking_date,
    p_start_time,
    p_client_name,
    p_client_phone,
    p_client_email,
    p_notes
  ) r
  join public.appointments a on a.id = r.appointment_id;
end;
$$;

revoke execute on function public.request_appointment_with_number(text, text, date, time, text, text, text, text) from public;
grant execute on function public.request_appointment_with_number(text, text, date, time, text, text, text, text) to anon, authenticated;
