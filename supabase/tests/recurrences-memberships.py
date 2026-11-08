"""Real PostgreSQL 17 integration test suite for KANI Recurrences, Memberships and Discounts (20261108000100).
Runs inside the network-isolated disposable Docker PostgreSQL 17 container (`--network none`).
"""
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
import json

# 1. Execute the baseline staff permissions, payments and public-booking visibility suites first
exec(
    compile(
        (Path(__file__).parent / "public-booking-visibility.py").read_text(encoding="utf-8"),
        "public-booking-visibility.py",
        "exec",
    )
)

# 2. Apply recent migrations leading up to 20261108000100 and snapshot existing rows
for mig_name in [
    "20261106202436_kani_advance_collection_preserves_appointment.sql",
    "20261107190103_kani_admin_guard_null_denial.sql",
]:
    sql("BEGIN;\n" + (repo / "supabase/migrations" / mig_name).read_text(encoding="utf-8") + "\nCOMMIT;")

baseline_tables = [
    "staff_profiles",
    "barbers",
    "clients",
    "client_barbers",
    "service_payments",
    "payment_attempts",
    "appointment_payment_orders",
    "benefit_codes",
]

def snapshot_baseline():
    return {
        t: sql(
            "select coalesce(jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text),'[]')::text from public.%s r"
            % t
        )
        for t in baseline_tables
    }

before_20261108 = snapshot_baseline()
before_apt_count = sql("select count(*) from public.appointments")

# Apply 20261108000100_kani_recurrences_memberships_and_discounts.sql inside a single transaction
sql(
    "BEGIN;\n"
    + (
        repo
        / "supabase/migrations/20261108000100_kani_recurrences_memberships_and_discounts.sql"
    ).read_text(encoding="utf-8")
    + "\nCOMMIT;"
)

assert snapshot_baseline() == before_20261108, "Migration 20261108000100 modified existing rows!"
assert sql("select count(*) from public.appointments") == before_apt_count
print("1. Migration 20261108000100 applies cleanly on PostgreSQL 17 with zero destructive changes: PASS")

# Verify Franco remains hidden from public read_valid_availability_starts after 20261108000100
assert (
    last(
        sql(
            "set role anon;select count(*) from read_valid_availability_starts('%s',current_date,current_date+21)"
            % franco
        )
    )
    == "0"
)
print("2. Compatibility with 20261105072253 (Franco hidden from public availability): PASS")

# Create two extra test identities:
# - User 8: Disabled ADMIN (role='ADMIN', active=false)
# - User 9: Authenticated user WITHOUT profile in staff_profiles
sql(
    """
insert into auth.users values
  ('00000000-0000-0000-0000-000000000008'),
  ('00000000-0000-0000-0000-000000000009')
on conflict do nothing;
insert into public.staff_profiles(user_id, role, barber_id, display_name, active)
values ('00000000-0000-0000-0000-000000000008', 'ADMIN', null, 'Admin Deshabilitado', false)
on conflict (user_id) do update set role = 'ADMIN', active = false;
"""
)

# Verify check_is_admin_user() across all 6 identities (20261107190103 verification)
assert last(asuser(4, "select coalesce(public.check_is_admin_user()::text, 'NULL')")) == "true"  # Active ADMIN
assert last(asuser(8, "select coalesce(public.check_is_admin_user()::text, 'NULL')")) == "false"  # Disabled ADMIN
assert last(asuser(3, "select coalesce(public.check_is_admin_user()::text, 'NULL')")) == "false"  # MANAGER
assert last(asuser(1, "select coalesce(public.check_is_admin_user()::text, 'NULL')")) == "false"  # BARBER
assert last(asuser(9, "select coalesce(public.check_is_admin_user()::text, 'NULL')")) == "false"  # Unprofiled authenticated
assert last(sql("set role anon; select coalesce(public.check_is_admin_user()::text, 'NULL')")) == "false"  # Anon
print("3. Verification of check_is_admin_user() across all 6 identities (never returns NULL): PASS")

barber1 = "10000000-0000-0000-0000-000000000001"  # Lautaro (user 1)
barber2 = "10000000-0000-0000-0000-000000000002"  # Gonzalo (user 2)
service_corte = "20000000-0000-0000-0000-000000000001"
service_corte_barba = "20000000-0000-0000-0000-000000000002"
service_barba = "20000000-0000-0000-0000-000000000003"

# ==============================================================================
# SECTION 2 AUDIT: RECURRENCES (AVAILABILITY & MANUAL APPOINTMENTS)
# ==============================================================================

# 2A. Monthly recurrence on the 31st omits months with <31 days (no shift to 28/29/30)
dates_31 = sql(
    "select string_agg(d::text, ',' order by d) from public.generate_recurrence_dates('2026-01-31'::date, 'MONTHLY', 'AFTER_COUNT', null, 4, '2026-01-01'::date, '2026-12-31'::date, '{}'::date[]) d"
)
assert dates_31 == "2026-01-31,2026-03-31,2026-05-31,2026-07-31", f"Unexpected 31st dates: {dates_31}"
print("4. Monthly recurrence on day 31 strictly omits shorter months (Feb/Apr/Jun): PASS")

# 2B. Recurring availability rule creation, RBAC, and dynamic projection in read_valid_availability_starts
check_denied(
    2,
    f"select * from public.create_recurring_availability_rule('{barber1}', current_date + 3, '08:00', '09:30', 'WEEKLY', 'AFTER_COUNT', null, 4, 'Regla ajena')",
    "AVAILABILITY_NOT_ALLOWED",
)
check_denied(
    8,
    f"select * from public.create_recurring_availability_rule('{barber1}', current_date + 3, '08:00', '09:30', 'WEEKLY', 'AFTER_COUNT', null, 4, 'Admin inactivo')",
    "AVAILABILITY_NOT_ALLOWED",
)
check_denied(
    9,
    f"select * from public.create_recurring_availability_rule('{barber1}', current_date + 3, '08:00', '09:30', 'WEEKLY', 'AFTER_COUNT', null, 4, 'Sin perfil')",
    "AVAILABILITY_NOT_ALLOWED",
)
denied_sql(
    f"set role anon; select * from public.create_recurring_availability_rule('{barber1}', current_date + 3, '08:00', '09:30', 'WEEKLY', 'AFTER_COUNT', null, 4, 'Anon')",
    "permission denied",
)

avail_rule_id = last(
    asuser(
        1,
        f"select id from public.create_recurring_availability_rule('{barber1}', current_date + 4, '08:00', '09:30', 'WEEKLY', 'AFTER_COUNT', null, 4, 'Mañanas tempranas')",
    )
)
assert avail_rule_id
# Barber 2 cannot read or modify Barber 1's availability rule
assert last(asuser(2, f"select count(*) from public.recurring_availability_rules where id='{avail_rule_id}'")) == "0"
check_denied(
    2,
    f"select public.modify_recurring_availability_rule('{avail_rule_id}', 'SINGLE', current_date + 4, 'BLOCK', null, null, 'Intento ajeno')",
    "AVAILABILITY_NOT_ALLOWED",
)
# Manager (user 3) and Admin (user 4) can read it
assert last(asuser(3, f"select count(*) from public.recurring_availability_rules where id='{avail_rule_id}'")) == "1"
assert last(asuser(4, f"select count(*) from public.recurring_availability_rules where id='{avail_rule_id}'")) == "1"

# Verify dynamic projection in read_valid_availability_starts for current_date + 4 at 08:00
assert (
    last(
        sql(
            f"set role anon; select count(*) from public.read_valid_availability_starts('{barber1}', current_date + 4, current_date + 4) where start_time = '08:00:00'"
        )
    )
    == "1"
)
# Block single date (current_date + 4) and verify 08:00 disappears on current_date + 4 while remaining on current_date + 11
asuser(
    1,
    f"select public.modify_recurring_availability_rule('{avail_rule_id}', 'SINGLE', current_date + 4, 'BLOCK', null, null, 'Feriado puntual')",
)
assert (
    last(
        sql(
            f"set role anon; select count(*) from public.read_valid_availability_starts('{barber1}', current_date + 4, current_date + 4) where start_time = '08:00:00'"
        )
    )
    == "0"
)
assert (
    last(
        sql(
            f"set role anon; select count(*) from public.read_valid_availability_starts('{barber1}', current_date + 11, current_date + 11) where start_time = '08:00:00'"
        )
    )
    == "1"
)
print("5. Recurring availability rules, RBAC isolation, and SINGLE exception projection: PASS")

# 2C. Independence from the 21-day public limit:
# Public request_appointment > 21 days is rejected, while staff manual series generates up to 90 days
denied_sql(
    f"set role anon; select * from public.request_appointment('Lautaro', 'Corte de cabello', current_date + 25, '10:00', 'Cliente Web', '1155556666', 'web@example.invalid', null)",
    "BOOKING_DATE_OUT_OF_RANGE",
)

# Pre-create an existing confirmed appointment on current_date + 12 at 14:00 for Barber 1 to test conflict priority
conflict_apt_id = last(
    asuser(
        1,
        f"select appointment_id from public.create_manual_appointment(p_barber_id=>'{barber1}', p_service_id=>'{service_corte}', p_booking_date=>current_date + 12, p_start_time=>'14:00', p_client_name=>'Cliente Preexistente', p_client_phone=>'1144445555', p_client_email=>'pre@example.invalid')",
    )
)

# Create a weekly recurring manual series starting on current_date + 5 (so occurrences are +5, +12 [CONFLICT], +19, +26 [>21d], +33, +40)
series_res = json.loads(
    last(
        asuser(
            1,
            f"""select public.create_recurring_manual_series(
                p_barber_id => '{barber1}',
                p_service_id => '{service_corte}',
                p_service_price_ars => 25000,
                p_start_date => current_date + 5,
                p_start_time => '14:00',
                p_duration_minutes => 45,
                p_client_name => 'Cliente Serie Semanal',
                p_client_phone => '1177778888',
                p_client_email => 'serie@example.invalid',
                p_frequency_type => 'WEEKLY',
                p_end_type => 'AFTER_COUNT',
                p_max_occurrences => 6,
                p_pricing_mode => 'FIXED_PRICE',
                p_horizon_days => 90
            )""",
        )
    )
)
rule_id = series_res["ruleId"] if "ruleId" in series_res else series_res["rule_id"]
assert series_res["created_count"] == 5, f"Expected 5 created, got {series_res}"
assert series_res["omitted_count"] == 1, f"Expected 1 omitted conflict, got {series_res}"
assert series_res["omitted_conflicts"][0]["conflicting_appointment_id"] == conflict_apt_id

# Verify that an appointment was created at current_date + 26 and current_date + 40 (beyond the 21-day public limit!)
assert (
    last(
        asuser(
            1,
            f"select count(*) from public.appointments where recurring_rule_id = '{rule_id}' and booking_date > current_date + 21",
        )
    )
    == "3"
)

# Verify check_availability_block_conflicts detects the confirmed appointments in that range
assert (
    last(
        asuser(
            1,
            f"select count(*) from public.check_availability_block_conflicts('{barber1}', current_date + 5, current_date + 5, '14:00', '14:45')",
        )
    )
    == "1"
)

# 2D. Omitted date persistence: even if the conflicting appointment on current_date + 12 is cancelled,
# running sync_recurring_appointment_rules MUST NOT automatically recreate the omitted occurrence!
asuser(1, f"select * from public.update_appointment_status('{conflict_apt_id}', 'CANCELLED')")
sync_after_cancel = json.loads(
    last(
        asuser(
            1,
            f"select row_to_json(s) from public.sync_recurring_appointment_rules(90, '{rule_id}') s",
        )
    )
)
assert sync_after_cancel["generated_appointments"] == 0, "Omitted conflict date was erroneously recreated!"
assert (
    last(
        sql(
            f"select count(*) from public.appointments where recurring_rule_id = '{rule_id}' and booking_date = current_date + 12"
        )
    )
    == "0"
)
print("6. Recurring series creation, >21d independence, conflict priority, and omitted date persistence: PASS")

# 2E. Rolling 90-day window renewal:
# Create a NEVER-ending weekly rule with horizon 20 days (creates 3 occurrences: +5, +12, +19), then sync with horizon 40 days
rolling_res = json.loads(
    last(
        asuser(
            3,  # MANAGER creating recurring series
            f"""select public.create_recurring_manual_series(
                p_barber_id => '{barber2}',
                p_service_id => '{service_barba}',
                p_start_date => current_date + 5,
                p_start_time => '11:00',
                p_duration_minutes => 30,
                p_client_name => 'Cliente Ventana Movil',
                p_client_phone => '1188889999',
                p_frequency_type => 'WEEKLY',
                p_end_type => 'NEVER',
                p_pricing_mode => 'CURRENT_RATE',
                p_horizon_days => 20
            )""",
        )
    )
)
rolling_rule_id = rolling_res["rule_id"]
assert rolling_res["created_count"] == 3  # +5, +12, +19
# Calling sync again with same 20-day horizon is 100% idempotent (generates 0 duplicates)
sync_idem = json.loads(
    last(
        sql(
            f"set role service_role; select row_to_json(s) from public.sync_recurring_appointment_rules(20, '{rolling_rule_id}') s"
        )
    )
)
assert sync_idem["generated_appointments"] == 0
# Advancing horizon to 35 days generates exactly 2 new occurrences (+26, +33)
sync_advance = json.loads(
    last(
        sql(
            f"set role service_role; select row_to_json(s) from public.sync_recurring_appointment_rules(35, '{rolling_rule_id}') s"
        )
    )
)
assert sync_advance["generated_appointments"] == 2
print("7. Rolling 90-day window renewal and idempotency (zero duplicate appointments): PASS")

# 2F. Single, THIS_AND_FOLLOWING, ALL_FUTURE edits and preservation of appointments with payments
series_apts = json.loads(
    last(
        asuser(
            1,
            f"select jsonb_agg(jsonb_build_object('id', id, 'date', booking_date) order by booking_date) from public.appointments where recurring_rule_id = '{rule_id}'",
        )
    )
)
assert len(series_apts) == 5  # +5, +19, +26, +33, +40

# Edit SINGLE (occurrence 0 at +5) to 15:00
asuser(
    1,
    f"select public.modify_recurring_appointment_series('{series_apts[0]['id']}', 'SINGLE', 'UPDATE', '15:00', null, 26000, 'FIXED_PRICE', 'Cambio puntual')",
)
assert sql(f"select start_time::text from public.appointments where id='{series_apts[0]['id']}'") == "15:00:00"
assert sql(f"select start_time::text from public.appointments where id='{series_apts[1]['id']}'") == "14:00:00"

# Mark occurrence 3 (+33) as having a paid deposit so bulk series cancellation must preserve it!
sql(f"update public.appointments set deposit_paid = true, deposit_amount_ars = 5000 where id = '{series_apts[3]['id']}'")

# Cancel THIS_AND_FOLLOWING starting from occurrence 2 (+26):
# - Occurrence 0 (+5) and 1 (+19) must remain CONFIRMED
# - Occurrence 2 (+26) and 4 (+40) must become CANCELLED
# - Occurrence 3 (+33, paid deposit) must be PRESERVED as CONFIRMED!
cancel_series_res = json.loads(
    last(
        asuser(
            1,
            f"select public.modify_recurring_appointment_series('{series_apts[2]['id']}', 'THIS_AND_FOLLOWING', 'CANCEL')",
        )
    )
)
assert cancel_series_res["affected_count"] == 2
assert series_apts[3]["id"] in cancel_series_res["preserved_paid_appointment_ids"]
assert sql(f"select status::text from public.appointments where id='{series_apts[0]['id']}'") == "CONFIRMED"
assert sql(f"select status::text from public.appointments where id='{series_apts[1]['id']}'") == "CONFIRMED"
assert sql(f"select status::text from public.appointments where id='{series_apts[2]['id']}'") == "CANCELLED"
assert sql(f"select status::text from public.appointments where id='{series_apts[3]['id']}'") == "CONFIRMED"
assert sql(f"select status::text from public.appointments where id='{series_apts[4]['id']}'") == "CANCELLED"
print("8. Series edits (SINGLE / THIS_AND_FOLLOWING) and preservation of paid appointments: PASS")

# ==============================================================================
# SECTION 3 AUDIT: MEMBERSHIPS, DISCOUNTS & ALL KANI PAYMENT METHODS
# ==============================================================================

client_1 = sql(f"select client_id::text from public.appointments where id='{series_apts[0]['id']}'")
client_2 = sql(f"select client_id::text from public.recurring_appointment_rules where id='{rolling_rule_id}'")

# 3A. Create 4-service membership (10% discount) in PENDING_PAYMENT state
# 2 Corte (25000) + 2 Barba (10000) = Subtotal 70000 -> 10% discount (7000) -> Total 63000
m4 = json.loads(
    last(
        asuser(
            1,
            f"""select public.create_client_membership(
                p_client_id => '{client_1}',
                p_barber_id => '{barber1}',
                p_package_size => 4,
                p_items => '[{{"service_name":"Corte","quantity":2,"unit_price_ars":25000}},{{"service_name":"Barba","quantity":2,"unit_price_ars":10000}}]'::jsonb,
                p_payment_now => false,
                p_payment_method => 'Efectivo',
                p_expires_at => current_date + 60,
                p_notes => 'Membresía 4 prueba'
            )""",
        )
    )
)
m4_id = m4["id"]
assert m4["subtotal_ars"] == 70000
assert m4["discount_percent"] == 10
assert m4["discount_amount_ars"] == 7000
assert m4["total_price_ars"] == 63000
assert m4["status"] == "PENDING_PAYMENT"
assert m4["payment_id"] is None

# Consumption while PENDING_PAYMENT must be rejected!
check_denied(
    1,
    f"select public.consume_membership_session('{m4_id}', 'Corte', null, 'SERVICE_COMPLETED', '{barber1}', null)",
    "MEMBERSHIP_PENDING_PAYMENT",
)

# Register payment using 'Tarjeta — Payway' (verifying support for all KANI payment methods)
m4_paid = json.loads(
    last(
        asuser(
            1,
            f"select public.register_membership_payment('{m4_id}', 'Tarjeta — Payway', '{barber1}')",
        )
    )
)
assert m4_paid["status"] == "ACTIVE"
assert m4_paid["payment_method"] == "Tarjeta — Payway"
assert m4_paid["payment_id"] is not None

# Verify exactly 1 payment row was created in service_payments for 63000 ARS
assert (
    sql(
        f"select final_amount_ars::text || '|' || payment_method from public.service_payments where id='{m4_paid['payment_id']}'"
    )
    == "63000|Tarjeta — Payway"
)

# Test all remaining KANI payment methods on 10-service memberships (15% discount)
# 10 Corte (25000) = Subtotal 250000 -> 15% discount (37500) -> Total 212500
for idx, method in enumerate(
    [
        "Efectivo",
        "Transferencia",
        "Tarjeta de crédito",
        "Tarjeta de débito",
        "Payway",
        "Mercado Pago",
    ]
):
    m10 = json.loads(
        last(
            asuser(
                3,  # MANAGER
                f"""select public.create_client_membership(
                    p_client_id => '{client_2}',
                    p_barber_id => '{barber2}',
                    p_package_size => 10,
                    p_items => '[{{"service_name":"Corte","quantity":10,"unit_price_ars":25000}}]'::jsonb,
                    p_payment_now => true,
                    p_payment_method => '{method}',
                    p_expires_at => null,
                    p_notes => 'Test método {method}'
                )""",
            )
        )
    )
    assert m10["subtotal_ars"] == 250000
    assert m10["discount_percent"] == 15
    assert m10["discount_amount_ars"] == 37500
    assert m10["total_price_ars"] == 212500
    assert m10["status"] == "ACTIVE"
    assert m10["payment_method"] == method

print("9. 4-service (10%) and 10-service (15%) math, pending-payment block, and all 7 KANI payment methods: PASS")

# 3B. RBAC & RLS isolation across all 6 identities on memberships:
# Barber 2 MUST NOT read or mutate Barber 1's membership (m4_id), even if client_1 also has an appointment with Barber 2!
asuser(
    2,
    f"select appointment_id from public.create_manual_appointment(p_barber_id=>'{barber2}', p_service_id=>'{service_corte}', p_booking_date=>current_date + 14, p_start_time=>'16:00', p_client_name=>'Cliente Serie Semanal', p_client_phone=>'1177778888')",
)
assert last(asuser(2, f"select count(*) from public.client_memberships where id='{m4_id}'")) == "0"
assert last(asuser(2, f"select count(*) from public.client_membership_items where membership_id='{m4_id}'")) == "0"
check_denied(
    2,
    f"select public.consume_membership_session('{m4_id}', 'Corte', null, 'SERVICE_COMPLETED', '{barber2}', null)",
    "MEMBERSHIP_FORBIDDEN",
)
check_denied(
    2,
    f"select public.update_client_membership('{m4_id}', current_date + 90, false, null, 'Intento ajeno')",
    "MEMBERSHIP_FORBIDDEN",
)
# Disabled ADMIN (user 8), unprofiled authenticated user (user 9), and anon must all be denied
assert last(asuser(8, f"select count(*) from public.client_memberships where id='{m4_id}'")) == "0"
assert last(asuser(9, f"select count(*) from public.client_memberships where id='{m4_id}'")) == "0"
check_denied(
    8,
    f"select public.consume_membership_session('{m4_id}', 'Corte', null, 'SERVICE_COMPLETED', '{barber1}', null)",
    "MEMBERSHIP_FORBIDDEN",
)
check_denied(
    9,
    f"select public.consume_membership_session('{m4_id}', 'Corte', null, 'SERVICE_COMPLETED', '{barber1}', null)",
    "MEMBERSHIP_FORBIDDEN",
)
denied_sql("set role anon; select count(*) from public.client_memberships", "permission denied")
denied_sql(
    f"set role anon; select public.consume_membership_session('{m4_id}', 'Corte', null, 'SERVICE_COMPLETED', '{barber1}', null)",
    "permission denied",
)
print("10. Strict RBAC + RLS across all 6 identities (ADMIN, disabled ADMIN, MANAGER, BARBER, no-profile, anon): PASS")

# 3C. Single-client non-transferability, incompatible discount prevention, per-service quota, duplicate consumption & refund traceability
apt_other_client = last(
    asuser(
        1,
        f"select appointment_id from public.create_manual_appointment(p_barber_id=>'{barber1}', p_service_id=>'{service_corte}', p_booking_date=>current_date + 15, p_start_time=>'10:00', p_client_name=>'Otro Cliente Distinto', p_client_phone=>'1122223333')",
    )
)
check_denied(
    1,
    f"select public.consume_membership_session('{m4_id}', 'Corte', '{apt_other_client}', 'SERVICE_COMPLETED', '{barber1}', null)",
    "MEMBERSHIP_CLIENT_MISMATCH",
)

# Incompatible discount combination: an appointment with a benefit_code_id cannot consume a membership session
bcode_id = sql("select id::text from public.benefit_codes limit 1")
sql(f"update public.appointments set benefit_code_id = '{bcode_id}' where id = '{series_apts[1]['id']}'")
check_denied(
    1,
    f"select public.consume_membership_session('{m4_id}', 'Corte', '{series_apts[1]['id']}', 'SERVICE_COMPLETED', '{barber1}', null)",
    "INCOMPATIBLE_DISCOUNT_COMBINATION",
)
sql(f"update public.appointments set benefit_code_id = null where id = '{series_apts[1]['id']}'")

# Consume 1st 'Corte' linked to series_apts[0]['id']
payments_before_consume = sql("select count(*) from public.service_payments")
c1 = json.loads(
    last(
        asuser(
            1,
            f"select public.consume_membership_session('{m4_id}', 'Corte', '{series_apts[0]['id']}', 'SERVICE_COMPLETED', '{barber1}', 'Primer corte')",
        )
    )
)
assert c1["remaining_sessions"] == 3
assert sql("select count(*) from public.service_payments") == payments_before_consume, "Consuming a session must NOT duplicate service_payments!"

# Attempt to consume a second session on the SAME appointment (series_apts[0]['id']) -> rejected!
check_denied(
    1,
    f"select public.consume_membership_session('{m4_id}', 'Corte', '{series_apts[0]['id']}', 'SERVICE_COMPLETED', '{barber1}', 'Intento duplicado')",
    "APPOINTMENT_SESSION_ALREADY_CONSUMED",
)

# Consume 2nd 'Corte' (unlinked / direct) -> now 'Corte' quota (2/2) is exhausted, while 'Barba' still has 2/2
c2 = json.loads(
    last(
        asuser(
            1,
            f"select public.consume_membership_session('{m4_id}', 'Corte', null, 'SERVICE_COMPLETED', '{barber1}', 'Segundo corte')",
        )
    )
)
assert c2["remaining_sessions"] == 2

# Attempting to consume a 3rd 'Corte' MUST fail with MEMBERSHIP_ITEM_EXHAUSTED (must not silently consume 'Barba'!)
check_denied(
    1,
    f"select public.consume_membership_session('{m4_id}', 'Corte', null, 'SERVICE_COMPLETED', '{barber1}', 'Tercer corte excedido')",
    "MEMBERSHIP_ITEM_EXHAUSTED",
)

# Consume 'Barba' as NO_SHOW_DEDUCTION linked to series_apts[1]['id'] (verifies enum safety in real PostgreSQL!)
c3 = json.loads(
    last(
        asuser(
            1,
            f"select public.consume_membership_session('{m4_id}', 'Barba', '{series_apts[1]['id']}', 'NO_SHOW_DEDUCTION', '{barber1}', 'Inasistencia sin aviso')",
        )
    )
)
assert c3["remaining_sessions"] == 1
assert c3["consumption"]["consumption_type"] == "NO_SHOW_DEDUCTION"

# Refund c3 and verify remaining_sessions returns to 2 and consumption record is preserved with status='REFUNDED'
ref_res = json.loads(
    last(
        asuser(
            1,
            f"select public.refund_membership_session('{c3['consumption']['id']}', null, 'Justificó certificado médico')",
        )
    )
)
assert ref_res["remaining_sessions"] == 2
assert ref_res["consumption"]["status"] == "REFUNDED"
assert ref_res["consumption"]["refund_reason"] == "Justificó certificado médico"

# Update expiration and verify audit trail in client_membership_events
upd_res = json.loads(
    last(
        asuser(
            3,  # MANAGER updating expiration
            f"select public.update_client_membership('{m4_id}', current_date + 120, false, null, 'Extensión autorizada')",
        )
    )
)
assert (
    last(
        asuser(
            1,
            f"select count(*) from public.client_membership_events where membership_id='{m4_id}' and event_type='UPDATED'",
        )
    )
    == "1"
)
print("11. Per-service quota enforcement, non-duplication of revenue, NO_SHOW_DEDUCTION enum safety, and refund/expiration audit: PASS")

# ==============================================================================
# SECTION 6 AUDIT: REAL POSTGRESQL CONCURRENCY RACES
# ==============================================================================

# Race 1: Two concurrent threads attempting to consume the last remaining session of m4_id for the same appointment
# First consume 1 more 'Barba' so only 1 'Barba' session remains
asuser(
    1,
    f"select public.consume_membership_session('{m4_id}', 'Barba', null, 'SERVICE_COMPLETED', '{barber1}', 'Penúltima barba')",
)

def try_concurrent_consume(worker_idx):
    try:
        asuser(
            1,
            f"select public.consume_membership_session('{m4_id}', 'Barba', null, 'SERVICE_COMPLETED', '{barber1}', 'Concurrente {worker_idx}')",
        )
        return "OK"
    except RuntimeError as err:
        return str(err)

with ThreadPoolExecutor(max_workers=2) as pool:
    race_results = list(pool.map(try_concurrent_consume, [1, 2]))

assert race_results.count("OK") == 1, f"Expected exactly 1 winner in concurrent consumption race, got: {race_results}"
assert any("MEMBERSHIP_EXHAUSTED" in r or "MEMBERSHIP_ITEM_EXHAUSTED" in r for r in race_results)
assert sql(f"select status || '|' || consumed_sessions from public.client_memberships where id='{m4_id}'") == "EXHAUSTED|4"

# Race 2: Two concurrent threads running sync_recurring_appointment_rules on the same rule advancing horizon to 55 days
def try_concurrent_sync(_):
    res = json.loads(
        last(
            sql(
                f"set role service_role; select row_to_json(s) from public.sync_recurring_appointment_rules(55, '{rolling_rule_id}') s"
            )
        )
    )
    return res["generated_appointments"]

with ThreadPoolExecutor(max_workers=2) as pool:
    sync_counts = list(pool.map(try_concurrent_sync, [1, 2]))

# Total appointments for rolling_rule_id across the entire database must have zero duplicate dates
dup_dates = sql(
    f"select count(*) from (select booking_date from public.appointments where recurring_rule_id='{rolling_rule_id}' group by booking_date having count(*) > 1) d"
)
assert dup_dates == "0", f"Duplicate appointments generated on same date! {sync_counts}"
print("12. Concurrent PostgreSQL race conditions (membership last-session lock & advisory lock on recurring sync): PASS")
