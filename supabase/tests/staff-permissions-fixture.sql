-- Synthetic production-derived schema; contains no production rows.
create role anon;create role authenticated;create role service_role bypassrls;
create schema auth;create schema extensions;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
grant usage on schema auth to authenticated,anon,service_role;
create type public."staff_role" as enum('BARBER','ADMIN');
create type public."appointment_status" as enum('PENDING','CONFIRMED','CANCELLED','COMPLETED');
create type public."availability_status" as enum('AVAILABLE','UNAVAILABLE');
create type public."notification_type" as enum('NEW_REQUEST','CONFIRMED','CANCELLED');
create type public."notification_delivery_status" as enum('PENDING','SENDING','SENT','FAILED');
create type public."admin_activity_event_type" as enum('AVAILABILITY_UNAVAILABLE','AVAILABILITY_AVAILABLE','APPOINTMENT_REQUESTED','APPOINTMENT_CONFIRMED','APPOINTMENT_CANCELLED');
create sequence public."appointment_request_number_seq";
create table public."staff_profiles"(user_id uuid not null,role staff_role not null,barber_id uuid,display_name text not null,active boolean not null default true,created_at timestamp with time zone not null default now(),updated_at timestamp with time zone not null default now());
create table public."services"(id uuid not null default gen_random_uuid(),name text not null,duration_minutes integer not null,price_ars integer not null,active boolean not null default true,created_at timestamp with time zone not null default now(),updated_at timestamp with time zone not null default now());
create table public."barbers"(id uuid not null default gen_random_uuid(),name text not null,active boolean not null default true,created_at timestamp with time zone not null default now(),instagram text,display_order integer default 0);
create table public."clients"(id uuid not null default gen_random_uuid(),name text not null,phone text not null,email text,created_at timestamp with time zone not null default now(),updated_at timestamp with time zone not null default now(),deleted_at timestamp with time zone);
create table public."admin_activity_notifications"(id uuid not null default gen_random_uuid(),event_type admin_activity_event_type not null,actor_user_id uuid,actor_display_name text not null,barber_id uuid,appointment_id uuid,availability_slot_id uuid,barber_name text not null,client_name text,event_date date not null,event_time time without time zone,created_at timestamp with time zone not null default now(),read_at timestamp with time zone);
create table public."barber_transfer_details"(barber_id uuid not null,alias text not null,cuit text not null,holder_name text not null,down_payment_ars integer not null default 10000,active boolean not null default true,created_at timestamp with time zone not null default now(),updated_at timestamp with time zone not null default now());
create table public."maintenance_operations"(id uuid not null default gen_random_uuid(),actor_user_id uuid,selected_statuses appointment_status[] not null,status text not null,appointments_deleted integer not null default 0,notification_events_deleted integer not null default 0,admin_notifications_deleted integer not null default 0,error_code text,started_at timestamp with time zone not null default now(),completed_at timestamp with time zone);
create table public."appointment_notification_events"(id uuid not null default gen_random_uuid(),appointment_id uuid not null,notification_type notification_type not null,recipient_email text,client_name text not null,barber_name text not null,service_name text not null,booking_date date not null,start_time time without time zone not null,end_time time without time zone not null,claim_token_digest text not null,status notification_delivery_status not null default 'PENDING'::notification_delivery_status,attempts integer not null default 0,provider_message_id text,last_error text,sent_at timestamp with time zone,created_at timestamp with time zone not null default now(),updated_at timestamp with time zone not null default now(),client_notes text,service_price_ars integer,service_duration_minutes integer,down_payment_ars integer,transfer_alias text,transfer_cuit text,transfer_holder_name text,recipient_phone text);
create table public."maintenance_availability_operations"(id uuid not null default gen_random_uuid(),actor_user_id uuid,status text not null,notifications_deleted integer not null default 0,error_code text,started_at timestamp with time zone not null default now(),completed_at timestamp with time zone);
create table public."service_payments"(id uuid not null default gen_random_uuid(),barber_id uuid not null,service_id uuid,service_name text not null,service_other_detail text,service_price_ars integer not null,discount_ars integer not null default 0,final_amount_ars integer not null,payment_date date not null default (timezone('America/Argentina/Buenos_Aires'::text, clock_timestamp()))::date,payment_time time without time zone not null default (timezone('America/Argentina/Buenos_Aires'::text, clock_timestamp()))::time without time zone,payment_method text not null,online_deposit_paid boolean not null default false,online_deposit_amount_ars integer not null default 0,collected_amount_ars integer not null,client_name text,client_contact text,appointment_id uuid,created_by_user_id uuid,created_by_display_name text not null,created_at timestamp with time zone not null default now(),updated_at timestamp with time zone not null default now(),service_origin text not null default 'walk_in'::text,deleted_at timestamp with time zone,deleted_by_user_id uuid,deleted_by_display_name text);
create table public."appointment_payment_orders"(appointment_id uuid not null,idempotency_key uuid not null default gen_random_uuid(),order_id text,expected_amount_ars integer not null default 5000,paid_amount_ars integer,reconciliation_status text not null default 'PENDING'::text,created_at timestamp with time zone not null default now(),updated_at timestamp with time zone not null default now());
create table public."payment_attempts"(id uuid not null default gen_random_uuid(),appointment_id uuid not null,provider text not null,site_transaction_id text not null,provider_transaction_id text,provider_site_id text,amount_ars numeric(12,2) not null,amount_minor_units bigint not null,currency text not null default 'ARS'::text,state text not null default 'CREATED'::text,provider_status text,provider_code text,confirmation_status text not null default 'NOT_CONFIRMED'::text,created_at timestamp with time zone not null default now(),updated_at timestamp with time zone not null default now(),processing_started_at timestamp with time zone,expires_at timestamp with time zone not null default (now() + '00:10:00'::interval));
create table public."barber_availability_slots"(id uuid not null default gen_random_uuid(),barber_id uuid not null,slot_date date not null,start_time time without time zone not null,end_time time without time zone not null,status availability_status not null default 'AVAILABLE'::availability_status,internal_note text,created_at timestamp with time zone not null default now(),updated_at timestamp with time zone not null default now(),updated_by uuid);
create table public."appointment_notification_dispatches"(id uuid not null default gen_random_uuid(),appointment_id uuid not null,notification_event_id uuid,channel text not null,provider text not null,recipient text,provider_message_id text,status text not null,error_code text,error_description text,attempts integer not null default 0,requested_at timestamp with time zone not null default now(),delivered_at timestamp with time zone,read_at timestamp with time zone,created_at timestamp with time zone not null default now(),updated_at timestamp with time zone not null default now(),meta_message_id text);
create table public."barber_service_prices"(id uuid not null default gen_random_uuid(),barber_id uuid not null,service_id uuid not null,price_ars integer not null,active boolean not null default true,created_at timestamp with time zone not null default now(),updated_at timestamp with time zone not null default now());
create table public."barber_google_calendars"(barber_id uuid not null,calendar_id text,calendar_name text,sync_enabled boolean not null default true,created_at timestamp with time zone not null default clock_timestamp(),updated_at timestamp with time zone not null default clock_timestamp());
create table public."appointments"(id uuid not null default gen_random_uuid(),client_id uuid not null,barber_id uuid not null,service_id uuid,booking_date date not null,start_time time without time zone not null,end_time time without time zone not null,status appointment_status not null default 'PENDING'::appointment_status,notes text,created_at timestamp with time zone not null default now(),updated_at timestamp with time zone not null default now(),request_number bigint not null default nextval('appointment_request_number_seq'::regclass),deposit_paid boolean not null default false,deposit_amount_ars integer,cancellation_reason text,cancelled_at timestamp with time zone,cancelled_by uuid,is_manual boolean not null default false,origin text not null default 'PUBLIC_WEB'::text,custom_service_name text,service_price_ars integer,created_by_user_id uuid,created_by_display_name text,recurring_rule_id uuid,deposit_required boolean not null default true,balance_paid boolean not null default false,booking_client_name text,benefit_code_id uuid,benefit_code text,benefit_type text,benefit_original_price_ars integer,benefit_discount_amount_ars integer,benefit_final_price_ars integer,benefit_online_deposit_ars integer,benefit_in_person_balance_ars integer);
create table public."google_calendar_oauth_tokens"(id text not null default 'primary'::text,refresh_token text not null,access_token text,expires_at timestamp with time zone,scope text,created_at timestamp with time zone not null default clock_timestamp(),updated_at timestamp with time zone not null default clock_timestamp());
create table public."appointment_calendar_sync"(id uuid not null default gen_random_uuid(),appointment_id uuid not null,barber_id uuid not null,calendar_id text,google_event_id text,previous_calendar_id text,previous_google_event_id text,sync_action text not null default 'UPSERT'::text,sync_status text not null default 'PENDING'::text,attempts integer not null default 0,max_attempts integer not null default 5,last_attempt_at timestamp with time zone,last_error text,payload_checksum text,synced_at timestamp with time zone,created_at timestamp with time zone not null default clock_timestamp(),updated_at timestamp with time zone not null default clock_timestamp(),claimed_by text,claimed_at timestamp with time zone,claim_expires_at timestamp with time zone,version integer not null default 1);
create table public."benefit_codes"(id uuid not null default gen_random_uuid(),code text not null,type text not null,internal_note text,status text not null default 'ACTIVE'::text,created_by_user_id uuid,created_by_display_name text,created_at timestamp with time zone not null default now(),updated_at timestamp with time zone not null default now(),consumed_at timestamp with time zone,consumed_appointment_id uuid,consumed_client_id uuid,locked_at timestamp with time zone,locked_expires_at timestamp with time zone,locked_attempt_id text,original_price_ars integer,discount_amount_ars integer,final_price_ars integer,online_deposit_ars integer,in_person_balance_ars integer);
alter table public."staff_profiles" add constraint "barber_profile_requires_barber" CHECK ((((role = 'BARBER'::staff_role) AND (barber_id IS NOT NULL)) OR ((role = 'ADMIN'::staff_role) AND (barber_id IS NULL))));
alter table public."staff_profiles" add constraint "staff_profiles_display_name_check" CHECK ((length(TRIM(BOTH FROM display_name)) > 0));
alter table public."staff_profiles" add constraint "staff_profiles_pkey" PRIMARY KEY (user_id);
alter table public."services" add constraint "services_duration_minutes_check" CHECK ((duration_minutes > 0));
alter table public."services" add constraint "services_name_check" CHECK ((length(TRIM(BOTH FROM name)) > 0));
alter table public."services" add constraint "services_name_key" UNIQUE (name);
alter table public."services" add constraint "services_pkey" PRIMARY KEY (id);
alter table public."services" add constraint "services_price_ars_check" CHECK ((price_ars >= 0));
alter table public."barbers" add constraint "barbers_name_check" CHECK ((length(TRIM(BOTH FROM name)) > 0));
alter table public."barbers" add constraint "barbers_name_key" UNIQUE (name);
alter table public."barbers" add constraint "barbers_pkey" PRIMARY KEY (id);
alter table public."clients" add constraint "clients_email_check" CHECK (((email IS NULL) OR (POSITION(('@'::text) IN (email)) > 1)));
alter table public."clients" add constraint "clients_name_check" CHECK ((length(TRIM(BOTH FROM name)) >= 3));
alter table public."clients" add constraint "clients_phone_check" CHECK ((length(TRIM(BOTH FROM phone)) >= 8));
alter table public."clients" add constraint "clients_pkey" PRIMARY KEY (id);
alter table public."admin_activity_notifications" add constraint "admin_activity_notifications_actor_display_name_check" CHECK ((length(TRIM(BOTH FROM actor_display_name)) > 0));
alter table public."admin_activity_notifications" add constraint "admin_activity_notifications_barber_name_check" CHECK ((length(TRIM(BOTH FROM barber_name)) > 0));
alter table public."admin_activity_notifications" add constraint "admin_activity_notifications_pkey" PRIMARY KEY (id);
alter table public."barber_transfer_details" add constraint "barber_transfer_details_alias_check" CHECK ((length(TRIM(BOTH FROM alias)) >= 3));
alter table public."barber_transfer_details" add constraint "barber_transfer_details_cuit_check" CHECK ((length(TRIM(BOTH FROM cuit)) >= 8));
alter table public."barber_transfer_details" add constraint "barber_transfer_details_down_payment_ars_check" CHECK ((down_payment_ars > 0));
alter table public."barber_transfer_details" add constraint "barber_transfer_details_holder_name_check" CHECK ((length(TRIM(BOTH FROM holder_name)) >= 3));
alter table public."barber_transfer_details" add constraint "barber_transfer_details_pkey" PRIMARY KEY (barber_id);
alter table public."maintenance_operations" add constraint "maintenance_operations_admin_notifications_deleted_check" CHECK ((admin_notifications_deleted >= 0));
alter table public."maintenance_operations" add constraint "maintenance_operations_appointments_deleted_check" CHECK ((appointments_deleted >= 0));
alter table public."maintenance_operations" add constraint "maintenance_operations_notification_events_deleted_check" CHECK ((notification_events_deleted >= 0));
alter table public."maintenance_operations" add constraint "maintenance_operations_pkey" PRIMARY KEY (id);
alter table public."maintenance_operations" add constraint "maintenance_operations_selected_statuses_check" CHECK (((cardinality(selected_statuses) > 0) AND (selected_statuses <@ ARRAY['PENDING'::appointment_status, 'CONFIRMED'::appointment_status, 'COMPLETED'::appointment_status, 'CANCELLED'::appointment_status])));
alter table public."maintenance_operations" add constraint "maintenance_operations_status_check" CHECK ((status = ANY (ARRAY['RUNNING'::text, 'SUCCEEDED'::text, 'FAILED'::text])));
alter table public."appointment_notification_events" add constraint "appointment_notification_even_appointment_id_notification_t_key" UNIQUE (appointment_id, notification_type);
alter table public."appointment_notification_events" add constraint "appointment_notification_events_attempts_check" CHECK ((attempts >= 0));
alter table public."appointment_notification_events" add constraint "appointment_notification_events_down_payment_check" CHECK (((down_payment_ars IS NULL) OR (down_payment_ars > 0)));
alter table public."appointment_notification_events" add constraint "appointment_notification_events_pkey" PRIMARY KEY (id);
alter table public."appointment_notification_events" add constraint "appointment_notification_events_recipient_email_check" CHECK (((recipient_email IS NULL) OR (POSITION(('@'::text) IN (recipient_email)) > 1)));
alter table public."appointment_notification_events" add constraint "appointment_notification_events_service_duration_check" CHECK (((service_duration_minutes IS NULL) OR (service_duration_minutes > 0)));
alter table public."appointment_notification_events" add constraint "appointment_notification_events_service_price_check" CHECK (((service_price_ars IS NULL) OR (service_price_ars >= 0)));
alter table public."maintenance_availability_operations" add constraint "maintenance_availability_operations_notifications_deleted_check" CHECK ((notifications_deleted >= 0));
alter table public."maintenance_availability_operations" add constraint "maintenance_availability_operations_pkey" PRIMARY KEY (id);
alter table public."maintenance_availability_operations" add constraint "maintenance_availability_operations_status_check" CHECK ((status = ANY (ARRAY['RUNNING'::text, 'SUCCEEDED'::text, 'FAILED'::text])));
alter table public."service_payments" add constraint "service_other_requires_detail" CHECK (((service_name <> 'Otros'::text) OR ((service_other_detail IS NOT NULL) AND (length(TRIM(BOTH FROM service_other_detail)) > 0))));
alter table public."service_payments" add constraint "service_payments_appointment_id_key" UNIQUE (appointment_id);
alter table public."service_payments" add constraint "service_payments_check" CHECK (((discount_ars >= 0) AND (discount_ars <= service_price_ars)));
alter table public."service_payments" add constraint "service_payments_check1" CHECK ((final_amount_ars = (service_price_ars - discount_ars)));
alter table public."service_payments" add constraint "service_payments_collected_amount_ars_check" CHECK ((collected_amount_ars >= 0));
alter table public."service_payments" add constraint "service_payments_online_deposit_amount_ars_check" CHECK ((online_deposit_amount_ars >= 0));
alter table public."service_payments" add constraint "service_payments_origin_appointment_consistency" CHECK ((((service_origin = 'appointment'::text) AND (appointment_id IS NOT NULL)) OR ((service_origin = 'walk_in'::text) AND (appointment_id IS NULL)) OR (service_origin = 'legacy'::text)));
alter table public."service_payments" add constraint "service_payments_origin_check" CHECK ((service_origin = ANY (ARRAY['appointment'::text, 'walk_in'::text, 'legacy'::text])));
alter table public."service_payments" add constraint "service_payments_payment_method_check" CHECK ((payment_method = ANY (ARRAY['Efectivo'::text, 'Transferencia'::text])));
alter table public."service_payments" add constraint "service_payments_pkey" PRIMARY KEY (id);
alter table public."service_payments" add constraint "service_payments_service_name_check" CHECK ((service_name = ANY (ARRAY['Corte'::text, 'Corte y barba'::text, 'Corte + barba'::text, 'Barba'::text, 'Otros'::text])));
alter table public."service_payments" add constraint "service_payments_service_price_ars_check" CHECK ((service_price_ars > 0));
alter table public."appointment_payment_orders" add constraint "appointment_payment_orders_expected_amount_ars_check" CHECK ((expected_amount_ars = 5000));
alter table public."appointment_payment_orders" add constraint "appointment_payment_orders_idempotency_key_key" UNIQUE (idempotency_key);
alter table public."appointment_payment_orders" add constraint "appointment_payment_orders_order_id_key" UNIQUE (order_id);
alter table public."appointment_payment_orders" add constraint "appointment_payment_orders_pkey" PRIMARY KEY (appointment_id);
alter table public."payment_attempts" add constraint "payment_attempts_amount_ars_check" CHECK ((amount_ars > (0)::numeric));
alter table public."payment_attempts" add constraint "payment_attempts_check" CHECK (((amount_minor_units > 0) AND ((amount_minor_units)::numeric = (amount_ars * (100)::numeric))));
alter table public."payment_attempts" add constraint "payment_attempts_check1" CHECK (((state <> 'APPROVED'::text) OR (provider_transaction_id IS NOT NULL)));
alter table public."payment_attempts" add constraint "payment_attempts_confirmation_status_check" CHECK ((confirmation_status = ANY (ARRAY['NOT_CONFIRMED'::text, 'CONFIRMED'::text, 'ALREADY_CONFIRMED'::text, 'PAID_CANCELLED_REVIEW'::text, 'PAID_LATE_REVIEW'::text])));
alter table public."payment_attempts" add constraint "payment_attempts_currency_check" CHECK ((currency = 'ARS'::text));
alter table public."payment_attempts" add constraint "payment_attempts_pkey" PRIMARY KEY (id);
alter table public."payment_attempts" add constraint "payment_attempts_provider_check" CHECK ((provider = ANY (ARRAY['PAYWAY'::text, 'MERCADO_PAGO'::text])));
alter table public."payment_attempts" add constraint "payment_attempts_provider_code_check" CHECK ((provider_code ~ '^[A-Za-z0-9_-]{1,40}$'::text));
alter table public."payment_attempts" add constraint "payment_attempts_provider_provider_transaction_id_key" UNIQUE (provider, provider_transaction_id);
alter table public."payment_attempts" add constraint "payment_attempts_provider_site_id_check" CHECK ((provider_site_id ~ '^[0-9]{1,20}$'::text));
alter table public."payment_attempts" add constraint "payment_attempts_provider_site_transaction_id_key" UNIQUE (provider, site_transaction_id);
alter table public."payment_attempts" add constraint "payment_attempts_provider_status_check" CHECK ((provider_status ~ '^[A-Za-z0-9_-]{1,40}$'::text));
alter table public."payment_attempts" add constraint "payment_attempts_provider_transaction_id_check" CHECK ((provider_transaction_id ~ '^[A-Za-z0-9_-]{1,100}$'::text));
alter table public."payment_attempts" add constraint "payment_attempts_site_transaction_id_check" CHECK ((site_transaction_id ~ '^[A-Za-z0-9]{1,39}$'::text));
alter table public."payment_attempts" add constraint "payment_attempts_state_check" CHECK ((state = ANY (ARRAY['CREATED'::text, 'PROCESSING'::text, 'APPROVED'::text, 'REJECTED'::text, 'UNKNOWN'::text, 'CANCELLED'::text])));
alter table public."barber_availability_slots" add constraint "availability_end_granularity" CHECK (((EXTRACT(second FROM end_time) = (0)::numeric) AND ((((EXTRACT(minute FROM end_time))::integer % 5) = 0) OR (end_time = '00:00:00'::time without time zone))));
alter table public."barber_availability_slots" add constraint "availability_interval_valid" CHECK (((end_time > start_time) OR (end_time = '00:00:00'::time without time zone)));
alter table public."barber_availability_slots" add constraint "availability_minimum_interval" CHECK ((((end_time > start_time) AND ((end_time - start_time) >= '00:05:00'::interval)) OR ((end_time = '00:00:00'::time without time zone) AND (start_time <= '23:55:00'::time without time zone))));
alter table public."barber_availability_slots" add constraint "availability_start_granularity" CHECK (((EXTRACT(second FROM start_time) = (0)::numeric) AND (((EXTRACT(minute FROM start_time))::integer % 5) = 0)));
alter table public."barber_availability_slots" add constraint "barber_availability_slots_barber_id_slot_date_start_time_key" UNIQUE (barber_id, slot_date, start_time);
alter table public."barber_availability_slots" add constraint "barber_availability_slots_pkey" PRIMARY KEY (id);
alter table public."appointment_notification_dispatches" add constraint "appointment_notification_dispatches_channel_check" CHECK ((channel = ANY (ARRAY['WHATSAPP'::text, 'EMAIL'::text])));
alter table public."appointment_notification_dispatches" add constraint "appointment_notification_dispatches_event_channel_key" UNIQUE (notification_event_id, channel);
alter table public."appointment_notification_dispatches" add constraint "appointment_notification_dispatches_pkey" PRIMARY KEY (id);
alter table public."appointment_notification_dispatches" add constraint "appointment_notification_dispatches_provider_check" CHECK ((provider = ANY (ARRAY['PONTIUN'::text, 'RESEND'::text])));
alter table public."appointment_notification_dispatches" add constraint "appointment_notification_dispatches_status_check" CHECK ((status = ANY (ARRAY['PENDING'::text, 'PROCESSING'::text, 'PROVIDER_ACCEPTED'::text, 'SENT'::text, 'DELIVERED'::text, 'READ'::text, 'FAILED'::text, 'SKIPPED'::text, 'UNKNOWN'::text])));
alter table public."barber_service_prices" add constraint "barber_service_prices_pkey" PRIMARY KEY (id);
alter table public."barber_service_prices" add constraint "barber_service_prices_price_ars_check" CHECK ((price_ars >= 0));
alter table public."barber_service_prices" add constraint "uq_barber_service_price" UNIQUE (barber_id, service_id);
alter table public."barber_google_calendars" add constraint "barber_google_calendars_pkey" PRIMARY KEY (barber_id);
alter table public."appointments" add constraint "appointment_inside_business_hours" CHECK (((COALESCE(is_manual, false) = true) OR ((start_time >= '10:00:00'::time without time zone) AND (end_time <= '20:00:00'::time without time zone))));
alter table public."appointments" add constraint "appointment_interval_valid" CHECK ((end_time > start_time));
alter table public."appointments" add constraint "appointments_benefit_type_check" CHECK (((benefit_type IS NULL) OR (benefit_type = ANY (ARRAY['NO_DEPOSIT'::text, 'FREE_SERVICE'::text, 'PERCENT_10'::text, 'PERCENT_50'::text]))));
alter table public."appointments" add constraint "appointments_pkey" PRIMARY KEY (id);
alter table public."appointments" add constraint "appointments_request_number_range" CHECK (((request_number >= 1) AND (request_number <= 999999)));
alter table public."appointments" add constraint "appointments_service_check" CHECK (((service_id IS NOT NULL) OR (custom_service_name IS NOT NULL)));
alter table public."google_calendar_oauth_tokens" add constraint "google_calendar_oauth_tokens_pkey" PRIMARY KEY (id);
alter table public."appointment_calendar_sync" add constraint "appointment_calendar_sync_pkey" PRIMARY KEY (id);
alter table public."appointment_calendar_sync" add constraint "appointment_calendar_sync_sync_action_check" CHECK ((sync_action = ANY (ARRAY['UPSERT'::text, 'DELETE'::text])));
alter table public."appointment_calendar_sync" add constraint "appointment_calendar_sync_sync_status_check" CHECK ((sync_status = ANY (ARRAY['PENDING'::text, 'PROCESSING'::text, 'SYNCED'::text, 'FAILED'::text, 'SKIPPED'::text])));
alter table public."appointment_calendar_sync" add constraint "uq_appointment_calendar_sync_appointment" UNIQUE (appointment_id);
alter table public."benefit_codes" add constraint "benefit_codes_code_check" CHECK ((code ~ '^[A-Z0-9-]{4,32}$'::text));
alter table public."benefit_codes" add constraint "benefit_codes_code_key" UNIQUE (code);
alter table public."benefit_codes" add constraint "benefit_codes_pkey" PRIMARY KEY (id);
alter table public."benefit_codes" add constraint "benefit_codes_status_check" CHECK ((status = ANY (ARRAY['ACTIVE'::text, 'LOCKED'::text, 'CONSUMED'::text, 'DISABLED'::text])));
alter table public."benefit_codes" add constraint "benefit_codes_type_check" CHECK ((type = ANY (ARRAY['NO_DEPOSIT'::text, 'FREE_SERVICE'::text, 'PERCENT_10'::text, 'PERCENT_50'::text])));
alter table public."staff_profiles" add constraint "staff_profiles_barber_id_fkey" FOREIGN KEY (barber_id) REFERENCES barbers(id) ON DELETE RESTRICT;
alter table public."staff_profiles" add constraint "staff_profiles_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public."admin_activity_notifications" add constraint "admin_activity_notifications_actor_user_id_fkey" FOREIGN KEY (actor_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
alter table public."admin_activity_notifications" add constraint "admin_activity_notifications_appointment_id_fkey" FOREIGN KEY (appointment_id) REFERENCES appointments(id) ON DELETE SET NULL;
alter table public."admin_activity_notifications" add constraint "admin_activity_notifications_availability_slot_id_fkey" FOREIGN KEY (availability_slot_id) REFERENCES barber_availability_slots(id) ON DELETE SET NULL;
alter table public."admin_activity_notifications" add constraint "admin_activity_notifications_barber_id_fkey" FOREIGN KEY (barber_id) REFERENCES barbers(id) ON DELETE SET NULL;
alter table public."barber_transfer_details" add constraint "barber_transfer_details_barber_id_fkey" FOREIGN KEY (barber_id) REFERENCES barbers(id) ON DELETE CASCADE;
alter table public."maintenance_operations" add constraint "maintenance_operations_actor_user_id_fkey" FOREIGN KEY (actor_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
alter table public."appointment_notification_events" add constraint "appointment_notification_events_appointment_id_fkey" FOREIGN KEY (appointment_id) REFERENCES appointments(id) ON DELETE CASCADE;
alter table public."maintenance_availability_operations" add constraint "maintenance_availability_operations_actor_user_id_fkey" FOREIGN KEY (actor_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
alter table public."service_payments" add constraint "service_payments_appointment_id_fkey" FOREIGN KEY (appointment_id) REFERENCES appointments(id) ON DELETE SET NULL;
alter table public."service_payments" add constraint "service_payments_barber_id_fkey" FOREIGN KEY (barber_id) REFERENCES barbers(id) ON DELETE RESTRICT;
alter table public."service_payments" add constraint "service_payments_created_by_user_id_fkey" FOREIGN KEY (created_by_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
alter table public."service_payments" add constraint "service_payments_deleted_by_user_id_fkey" FOREIGN KEY (deleted_by_user_id) REFERENCES auth.users(id);
alter table public."service_payments" add constraint "service_payments_service_id_fkey" FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE SET NULL;
alter table public."appointment_payment_orders" add constraint "appointment_payment_orders_appointment_id_fkey" FOREIGN KEY (appointment_id) REFERENCES appointments(id);
alter table public."payment_attempts" add constraint "payment_attempts_appointment_id_fkey" FOREIGN KEY (appointment_id) REFERENCES appointments(id) ON DELETE RESTRICT;
alter table public."barber_availability_slots" add constraint "barber_availability_slots_barber_id_fkey" FOREIGN KEY (barber_id) REFERENCES barbers(id) ON DELETE CASCADE;
alter table public."barber_availability_slots" add constraint "barber_availability_slots_updated_by_fkey" FOREIGN KEY (updated_by) REFERENCES auth.users(id) ON DELETE SET NULL;
alter table public."appointment_notification_dispatches" add constraint "appointment_notification_dispatches_appointment_id_fkey" FOREIGN KEY (appointment_id) REFERENCES appointments(id) ON DELETE CASCADE;
alter table public."appointment_notification_dispatches" add constraint "appointment_notification_dispatches_notification_event_id_fkey" FOREIGN KEY (notification_event_id) REFERENCES appointment_notification_events(id) ON DELETE CASCADE;
alter table public."barber_service_prices" add constraint "barber_service_prices_barber_id_fkey" FOREIGN KEY (barber_id) REFERENCES barbers(id) ON DELETE CASCADE;
alter table public."barber_service_prices" add constraint "barber_service_prices_service_id_fkey" FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE CASCADE;
alter table public."barber_google_calendars" add constraint "barber_google_calendars_barber_id_fkey" FOREIGN KEY (barber_id) REFERENCES barbers(id) ON DELETE CASCADE;
alter table public."appointments" add constraint "appointments_barber_id_fkey" FOREIGN KEY (barber_id) REFERENCES barbers(id) ON DELETE RESTRICT;
alter table public."appointments" add constraint "appointments_benefit_code_id_fkey" FOREIGN KEY (benefit_code_id) REFERENCES benefit_codes(id) ON DELETE SET NULL;
alter table public."appointments" add constraint "appointments_client_id_fkey" FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE RESTRICT;
alter table public."appointments" add constraint "appointments_service_id_fkey" FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE RESTRICT;
alter table public."appointment_calendar_sync" add constraint "appointment_calendar_sync_appointment_id_fkey" FOREIGN KEY (appointment_id) REFERENCES appointments(id) ON DELETE CASCADE;
alter table public."appointment_calendar_sync" add constraint "appointment_calendar_sync_barber_id_fkey" FOREIGN KEY (barber_id) REFERENCES barbers(id);
alter table public."benefit_codes" add constraint "benefit_codes_consumed_appointment_id_fkey" FOREIGN KEY (consumed_appointment_id) REFERENCES appointments(id) ON DELETE SET NULL;
alter table public."benefit_codes" add constraint "benefit_codes_consumed_client_id_fkey" FOREIGN KEY (consumed_client_id) REFERENCES clients(id) ON DELETE SET NULL;
alter table public."benefit_codes" add constraint "benefit_codes_created_by_user_id_fkey" FOREIGN KEY (created_by_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
grant usage on schema public to authenticated,anon,service_role;grant all on all tables in schema public to authenticated,service_role;
CREATE OR REPLACE FUNCTION public.is_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (
    select 1
    from public.staff_profiles
    where user_id = (select auth.uid())
      and role = 'ADMIN'
      and active = true
  );
$function$

;
CREATE OR REPLACE FUNCTION public.current_staff_barber_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select barber_id
  from public.staff_profiles
  where user_id = (select auth.uid())
    and role = 'BARBER'
    and active = true;
$function$

;
CREATE OR REPLACE FUNCTION public.check_is_admin_user()
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
DECLARE
  v_role text;
  v_jwt_claim text;
BEGIN
  -- 1. Usuario autenticado con token de sesión
  IF auth.uid() IS NOT NULL THEN
    SELECT role INTO v_role
    FROM public.staff_profiles
    WHERE user_id = auth.uid() AND active = true;
    RETURN (v_role = 'ADMIN');
  END IF;

  -- 2. Llamadas internas desde servidor de Antigravity validadas
  BEGIN
    v_jwt_claim := current_setting('request.jwt.claim.role', true);
    IF v_jwt_claim = 'service_role' THEN
      RETURN true;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    -- In case setting is not present
  END;

  RETURN false;
END;
$function$

;
alter table public."barbers" enable row level security;
create policy "staff_can_read_barbers" on public."barbers" for SELECT to authenticated using (false);
alter table public."barbers" enable row level security;
create policy "admin_can_manage_barbers" on public."barbers" for ALL to authenticated using (false) with check(false);
alter table public."staff_profiles" enable row level security;
create policy "staff_can_read_own_profile" on public."staff_profiles" for SELECT to authenticated using (false);
alter table public."staff_profiles" enable row level security;
create policy "admin_can_manage_staff_profiles" on public."staff_profiles" for ALL to authenticated using (false) with check(false);
alter table public."services" enable row level security;
create policy "admin_can_manage_services" on public."services" for ALL to authenticated using (false) with check(false);
alter table public."appointments" enable row level security;
create policy "barber_can_read_own_appointments" on public."appointments" for SELECT to authenticated using (false);
alter table public."barber_availability_slots" enable row level security;
create policy "staff_can_read_own_availability" on public."barber_availability_slots" for SELECT to authenticated using (false);
alter table public."admin_activity_notifications" enable row level security;
create policy "admin_can_read_activity_notifications" on public."admin_activity_notifications" for SELECT to authenticated using (false);
alter table public."admin_activity_notifications" enable row level security;
create policy "admin_can_update_activity_read_state" on public."admin_activity_notifications" for UPDATE to authenticated using (false) with check(false);
alter table public."barber_transfer_details" enable row level security;
create policy "barber_transfer_details_admin_select" on public."barber_transfer_details" for SELECT to authenticated using (false);
alter table public."barber_transfer_details" enable row level security;
create policy "barber_transfer_details_admin_insert" on public."barber_transfer_details" for INSERT to authenticated with check(false);
alter table public."barber_transfer_details" enable row level security;
create policy "barber_transfer_details_admin_update" on public."barber_transfer_details" for UPDATE to authenticated using (false) with check(false);
alter table public."barber_transfer_details" enable row level security;
create policy "barber_transfer_details_admin_delete" on public."barber_transfer_details" for DELETE to authenticated using (false);
alter table public."maintenance_operations" enable row level security;
create policy "maintenance_operations_admin_read" on public."maintenance_operations" for SELECT to authenticated using (false);
alter table public."maintenance_availability_operations" enable row level security;
create policy "maintenance_availability_operations_admin_read" on public."maintenance_availability_operations" for SELECT to authenticated using (false);
alter table public."service_payments" enable row level security;
create policy "service_payments_select" on public."service_payments" for SELECT to authenticated using (false);
alter table public."service_payments" enable row level security;
create policy "service_payments_delete" on public."service_payments" for DELETE to authenticated using (false);
alter table public."service_payments" enable row level security;
create policy "service_payments_insert" on public."service_payments" for INSERT to authenticated with check(false);
alter table public."service_payments" enable row level security;
create policy "service_payments_update" on public."service_payments" for UPDATE to authenticated using (false) with check(false);
alter table public."appointment_payment_orders" enable row level security;
create policy "authenticated_staff_read_payment_orders" on public."appointment_payment_orders" for SELECT to authenticated using (false);
alter table public."clients" enable row level security;
create policy "staff_can_read_clients" on public."clients" for SELECT to authenticated using (false);
alter table public."clients" enable row level security;
create policy "staff_can_insert_clients" on public."clients" for INSERT to authenticated with check(false);
alter table public."payment_attempts" enable row level security;
create policy "payment_attempts_staff_read" on public."payment_attempts" for SELECT to authenticated using (false);
alter table public."appointment_notification_dispatches" enable row level security;
create policy "staff_can_read_notification_dispatches" on public."appointment_notification_dispatches" for SELECT to authenticated using (false);
alter table public."clients" enable row level security;
create policy "staff_can_update_clients" on public."clients" for UPDATE to authenticated using (false) with check(false);
alter table public."clients" enable row level security;
create policy "admin_can_delete_clients" on public."clients" for DELETE to authenticated using (false);
alter table public."barber_service_prices" enable row level security;
create policy "barber_service_prices_admin_manage" on public."barber_service_prices" for ALL to authenticated using (false) with check(false);
