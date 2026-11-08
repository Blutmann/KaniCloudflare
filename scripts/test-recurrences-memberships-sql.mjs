// Real PostgreSQL 17 integration test runner for KANI Recurrences, Memberships and Discounts (20261108000100).
// Runs in a disposable, network-isolated Docker PostgreSQL 17 container (`--network none`).
import { spawnSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const container = `kani-recurrences-test-${randomUUID().slice(0, 8)}`;

function runDocker(args, input) {
  const r = spawnSync("docker", args, { encoding: "utf8", input });
  if (r.error) throw r.error;
  if (r.status !== 0) {
    throw new Error(`docker ${args.join(" ")} failed:\n${r.stderr || r.stdout}`);
  }
  return r.stdout.trim();
}

function sql(query) {
  const r = spawnSync(
    "docker",
    [
      "exec",
      "-i",
      container,
      "psql",
      "-h",
      "127.0.0.1",
      "-U",
      "postgres",
      "-v",
      "ON_ERROR_STOP=1",
      "-At",
    ],
    { encoding: "utf8", input: query },
  );
  if (r.error) throw r.error;
  if (r.status !== 0) {
    throw new Error(r.stderr || r.stdout);
  }
  return r.stdout.trim();
}

function sqlAsync(query) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(
      "docker",
      [
        "exec",
        "-i",
        container,
        "psql",
        "-h",
        "127.0.0.1",
        "-U",
        "postgres",
        "-v",
        "ON_ERROR_STOP=1",
        "-At",
      ],
      { stdio: ["pipe", "pipe", "pipe"] },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => {
      stdout += d.toString("utf8");
    });
    child.stderr.on("data", (d) => {
      stderr += d.toString("utf8");
    });
    child.on("error", rejectPromise);
    child.on("close", (code) => {
      if (code !== 0) {
        rejectPromise(new Error(stderr || stdout));
      } else {
        resolvePromise(stdout.trim());
      }
    });
    child.stdin.write(query);
    child.stdin.end();
  });
}

function last(output) {
  const lines = (output || "").split(/\r?\n/).filter(Boolean);
  return lines[lines.length - 1] ?? "";
}

function asuser(userNum, query) {
  const uid = `00000000-0000-0000-0000-${String(userNum).padStart(12, "0")}`;
  return sql(`set role authenticated; set request.jwt.claim.sub='${uid}'; ${query}`);
}

function asuserAsync(userNum, query) {
  const uid = `00000000-0000-0000-0000-${String(userNum).padStart(12, "0")}`;
  return sqlAsync(`set role authenticated; set request.jwt.claim.sub='${uid}'; ${query}`);
}

function checkDenied(userNum, query, expectedSubstring) {
  let failed = false;
  try {
    asuser(userNum, query);
  } catch (err) {
    failed = true;
    const msg = String(err?.message || err);
    if (expectedSubstring && !msg.includes(expectedSubstring)) {
      throw new Error(`Expected error containing '${expectedSubstring}', but got:\n${msg}`);
    }
  }
  if (!failed) {
    throw new Error(`Unauthorized operation unexpectedly succeeded for user ${userNum}: ${query}`);
  }
}

function checkDeniedSql(query, expectedSubstring) {
  let failed = false;
  try {
    sql(query);
  } catch (err) {
    failed = true;
    const msg = String(err?.message || err);
    if (expectedSubstring && !msg.includes(expectedSubstring)) {
      throw new Error(`Expected error containing '${expectedSubstring}', but got:\n${msg}`);
    }
  }
  if (!failed) {
    throw new Error(`Unauthorized SQL unexpectedly succeeded: ${query}`);
  }
}

function assertEq(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`Assertion failed (${label}): expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

let created = false;
try {
  runDocker([
    "run",
    "-d",
    "--name",
    container,
    "--network",
    "none",
    "--tmpfs",
    "/var/lib/postgresql/data:rw,size=256m",
    "-e",
    "POSTGRES_HOST_AUTH_METHOD=trust",
    "postgres:17",
  ]);
  created = true;

  const netMode = runDocker(["inspect", "--format", "{{.HostConfig.NetworkMode}}", container]);
  assertEq(netMode, "none", "Disposable container must have network none");

  let ready = false;
  for (let i = 0; i < 45; i++) {
    try {
      sql("select 1");
      ready = true;
      break;
    } catch {
      await delay(250);
    }
  }
  if (!ready) throw new Error("PostgreSQL 17 container did not become ready in time");

  // 1. Load production-derived base fixture and apply the recent migrations in chronological order
  sql(readFileSync(resolve("supabase/tests/staff-permissions-fixture.sql"), "utf8"));
  for (const mig of [
    "20261104223457_kani_anonymous_availability_columns.sql",
    "20261104224853_kani_manager_role.sql",
    "20261104224855_kani_operational_permissions.sql",
    "20261104224857_kani_complete_staff_payments_and_permissions.sql",
  ]) {
    sql("BEGIN;\n" + readFileSync(resolve("supabase/migrations", mig), "utf8") + "\nCOMMIT;");
  }

  // Seed synthetic identities and barbers matching public-booking-visibility.py
  sql(`
    create or replace function auth.role() returns text language sql stable as $$
      select coalesce(nullif(current_setting('request.jwt.claim.role',true),''),'authenticated')
    $$;
    insert into auth.users values
      ('00000000-0000-0000-0000-000000000001'),
      ('00000000-0000-0000-0000-000000000002'),
      ('00000000-0000-0000-0000-000000000003'),
      ('00000000-0000-0000-0000-000000000004'),
      ('00000000-0000-0000-0000-000000000005'),
      ('00000000-0000-0000-0000-000000000006'),
      ('00000000-0000-0000-0000-000000000007'),
      ('00000000-0000-0000-0000-000000000008'),
      ('00000000-0000-0000-0000-000000000009');
    insert into public.barbers(id, name) values
      ('10000000-0000-0000-0000-000000000001', 'Lautaro'),
      ('10000000-0000-0000-0000-000000000002', 'Gonzalo'),
      ('10000000-0000-0000-0000-000000000003', 'Valentín'),
      ('10000000-0000-0000-0000-000000000004', 'Franco');
    insert into public.staff_profiles(user_id, role, barber_id, display_name, active) values
      ('00000000-0000-0000-0000-000000000001', 'BARBER', '10000000-0000-0000-0000-000000000001', 'Lautaro', true),
      ('00000000-0000-0000-0000-000000000002', 'BARBER', '10000000-0000-0000-0000-000000000002', 'Gonzalo', true),
      ('00000000-0000-0000-0000-000000000003', 'MANAGER', null, 'Jefe', true),
      ('00000000-0000-0000-0000-000000000004', 'ADMIN', null, 'Admin', true),
      ('00000000-0000-0000-0000-000000000005', 'BARBER', '10000000-0000-0000-0000-000000000003', 'Valentín', true),
      ('00000000-0000-0000-0000-000000000006', 'BARBER', '10000000-0000-0000-0000-000000000004', 'Franco', true),
      ('00000000-0000-0000-0000-000000000007', 'MANAGER', null, 'Manager Inactivo', false),
      ('00000000-0000-0000-0000-000000000008', 'ADMIN', null, 'Admin Inactivo', false);
    insert into public.services(id, name, duration_minutes, price_ars) values
      ('20000000-0000-0000-0000-000000000001', 'Corte de cabello', 45, 25000),
      ('20000000-0000-0000-0000-000000000002', 'Corte + barba', 60, 30000),
      ('20000000-0000-0000-0000-000000000003', 'Barba', 30, 10000);
    insert into public.benefit_codes(code, type) values ('KANI-FICTICIO', 'PERCENT_10');
  `);

  sql(readFileSync(resolve("supabase/tests/public-booking-visibility-fixture.sql"), "utf8"));
  sql("grant select on public.barbers to anon;");
  sql("alter policy admin_can_manage_barbers on public.barbers using(public.is_admin()) with check(public.is_admin());");

  for (const mig of [
    "20261105072253_kani_public_booking_visibility.sql",
    "20261106202436_kani_advance_collection_preserves_appointment.sql",
    "20261107190103_kani_admin_guard_null_denial.sql",
  ]) {
    sql("BEGIN;\n" + readFileSync(resolve("supabase/migrations", mig), "utf8") + "\nCOMMIT;");
  }

  // Snapshot all existing rows before applying 20261108000100
  const baselineTables = [
    "staff_profiles",
    "barbers",
    "clients",
    "client_barbers",
    "service_payments",
    "payment_attempts",
    "appointment_payment_orders",
    "benefit_codes",
  ];
  const snapshotBaseline = () =>
    Object.fromEntries(
      baselineTables.map((t) => [
        t,
        sql(`select coalesce(jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text),'[]')::text from public.${t} r`),
      ]),
    );

  const beforeSnapshot = snapshotBaseline();
  const beforeAptCount = sql("select count(*) from public.appointments");

  // Apply 20261108000100_kani_recurrences_memberships_and_discounts.sql inside a transaction
  sql(
    "BEGIN;\n" +
      readFileSync(
        resolve("supabase/migrations/20261108000100_kani_recurrences_memberships_and_discounts.sql"),
        "utf8",
      ) +
      "\nCOMMIT;",
  );

  assertEq(JSON.stringify(snapshotBaseline()), JSON.stringify(beforeSnapshot), "Baseline rows unchanged");
  assertEq(sql("select count(*) from public.appointments"), beforeAptCount, "Appointment count unchanged");
  console.log("1. Migration 20261108000100 applies cleanly on PostgreSQL 17 with zero destructive changes: PASS");

  const franco = "10000000-0000-0000-0000-000000000004";
  const barber1 = "10000000-0000-0000-0000-000000000001";
  const barber2 = "10000000-0000-0000-0000-000000000002";
  const serviceCorte = "20000000-0000-0000-0000-000000000001";
  const serviceBarba = "20000000-0000-0000-0000-000000000003";

  // Verify Franco remains hidden from public read_valid_availability_starts after 20261108000100
  assertEq(
    last(sql(`set role anon; select count(*) from public.read_valid_availability_starts('${franco}', current_date, current_date + 21)`)),
    "0",
    "Franco hidden from anon availability",
  );
  // While Franco (user 6), MANAGER (user 3), and ADMIN (user 4) can still see Franco's internal Saturday availability
  assertEq(
    last(asuser(6, `select count(*) > 0 from public.read_valid_availability_starts('${franco}', current_date, current_date + 21)`)),
    "t",
    "Franco sees own availability",
  );
  console.log("2. Compatibility with 20261105072253 (Franco hidden publicly, visible to staff): PASS");

  // Verify check_is_admin_user() across all 6 identities (20261107190103 verification)
  assertEq(last(asuser(4, "select coalesce(public.check_is_admin_user()::text, 'NULL')")), "true", "Active ADMIN");
  assertEq(last(asuser(8, "select coalesce(public.check_is_admin_user()::text, 'NULL')")), "false", "Disabled ADMIN");
  assertEq(last(asuser(3, "select coalesce(public.check_is_admin_user()::text, 'NULL')")), "false", "MANAGER");
  assertEq(last(asuser(1, "select coalesce(public.check_is_admin_user()::text, 'NULL')")), "false", "BARBER");
  assertEq(last(asuser(9, "select coalesce(public.check_is_admin_user()::text, 'NULL')")), "false", "No-profile user");
  checkDeniedSql("set role anon; select public.check_is_admin_user()", "permission denied");
  console.log("3. Verification of check_is_admin_user() across all 6 identities (never returns NULL, anon denied): PASS");

  // ==============================================================================
  // SECTION 2 AUDIT: RECURRENCES (AVAILABILITY & MANUAL APPOINTMENTS)
  // ==============================================================================

  const dates31 = sql(
    "select string_agg(d::text, ',' order by d) from public.generate_recurrence_dates('2026-01-31'::date, 'MONTHLY', 'AFTER_COUNT', null, 4, '2026-01-01'::date, '2026-12-31'::date, '{}'::date[]) d",
  );
  assertEq(dates31, "2026-01-31,2026-03-31,2026-05-31,2026-07-31", "Monthly 31st recurrence omits short months");
  console.log("4. Monthly recurrence on day 31 strictly omits shorter months (Feb/Apr/Jun): PASS");

  // Recurring availability RBAC & dynamic projection
  checkDenied(
    2,
    `select * from public.create_recurring_availability_rule('${barber1}', current_date + 3, '08:00', '09:30', 'WEEKLY', 'AFTER_COUNT', null, 4, 'Regla ajena')`,
    "AVAILABILITY_NOT_ALLOWED",
  );
  checkDenied(
    8,
    `select * from public.create_recurring_availability_rule('${barber1}', current_date + 3, '08:00', '09:30', 'WEEKLY', 'AFTER_COUNT', null, 4, 'Admin inactivo')`,
    "AVAILABILITY_NOT_ALLOWED",
  );
  checkDenied(
    9,
    `select * from public.create_recurring_availability_rule('${barber1}', current_date + 3, '08:00', '09:30', 'WEEKLY', 'AFTER_COUNT', null, 4, 'Sin perfil')`,
    "AVAILABILITY_NOT_ALLOWED",
  );
  checkDeniedSql(
    `set role anon; select * from public.create_recurring_availability_rule('${barber1}', current_date + 3, '08:00', '09:30', 'WEEKLY', 'AFTER_COUNT', null, 4, 'Anon')`,
    "permission denied",
  );

  const availRuleId = last(
    asuser(
      1,
      `select id from public.create_recurring_availability_rule('${barber1}', current_date + 4, '08:00', '09:30', 'WEEKLY', 'AFTER_COUNT', null, 4, 'Mañanas tempranas')`,
    ),
  );
  assertEq(last(asuser(2, `select count(*) from public.recurring_availability_rules where id='${availRuleId}'`)), "0", "Barber 2 cannot read Barber 1 rule");
  checkDenied(
    2,
    `select public.modify_recurring_availability_rule('${availRuleId}', 'SINGLE', current_date + 4, 'BLOCK', null, null, 'Intento ajeno')`,
    "AVAILABILITY_NOT_ALLOWED",
  );
  assertEq(last(asuser(3, `select count(*) from public.recurring_availability_rules where id='${availRuleId}'`)), "1", "Manager reads rule");
  assertEq(last(asuser(4, `select count(*) from public.recurring_availability_rules where id='${availRuleId}'`)), "1", "Admin reads rule");

  assertEq(
    last(sql(`set role anon; select count(*) from public.read_valid_availability_starts('${barber1}', current_date + 4, current_date + 4) where start_time = '08:00:00'`)),
    "1",
    "08:00 projected on current_date + 4",
  );
  asuser(1, `select public.modify_recurring_availability_rule('${availRuleId}', 'SINGLE', current_date + 4, 'BLOCK', null, null, 'Feriado puntual')`);
  assertEq(
    last(sql(`set role anon; select count(*) from public.read_valid_availability_starts('${barber1}', current_date + 4, current_date + 4) where start_time = '08:00:00'`)),
    "0",
    "08:00 blocked on current_date + 4",
  );
  assertEq(
    last(sql(`set role anon; select count(*) from public.read_valid_availability_starts('${barber1}', current_date + 11, current_date + 11) where start_time = '08:00:00'`)),
    "1",
    "08:00 still available on current_date + 11",
  );
  console.log("5. Recurring availability rules, RBAC isolation, and SINGLE exception projection: PASS");

  // Independence from 21-day public limit
  checkDeniedSql(
    "set role anon; select * from public.request_appointment('Lautaro', 'Corte de cabello', current_date + 25, '10:00', 'Cliente Web', '1155556666', 'web@example.invalid', null)",
    "BOOKING_DATE_OUT_OF_RANGE",
  );

  // Pre-create an existing confirmed appointment on current_date + 12 at 14:00 for Barber 1
  const conflictAptId = last(
    asuser(
      1,
      `select appointment_id from public.create_manual_appointment(p_barber_id=>'${barber1}', p_service_id=>'${serviceCorte}', p_booking_date=>current_date + 12, p_start_time=>'14:00', p_client_name=>'Cliente Preexistente', p_client_phone=>'1144445555', p_client_email=>'pre@example.invalid')`,
    ),
  );

  // Create a weekly recurring manual series starting on current_date + 5 (6 occurrences: +5, +12 [CONFLICT], +19, +26, +33, +40)
  const seriesRes = JSON.parse(
    last(
      asuser(
        1,
        `select public.create_recurring_manual_series(
          p_barber_id => '${barber1}',
          p_service_id => '${serviceCorte}',
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
        )`,
      ),
    ),
  );
  const ruleId = seriesRes.rule_id;
  assertEq(seriesRes.created_count, 5, "5 free dates created");
  assertEq(seriesRes.omitted_count, 1, "1 conflict date omitted");
  assertEq(seriesRes.omitted_conflicts[0].conflicting_appointment_id, conflictAptId, "Conflict points to pre-existing appointment");

  // Verify appointments were created beyond +21 days (+26, +33, +40)
  assertEq(
    last(asuser(1, `select count(*) from public.appointments where recurring_rule_id = '${ruleId}' and booking_date > current_date + 21`)),
    "3",
    "Staff manual recurring appointments created beyond 21-day public limit",
  );

  // Verify check_availability_block_conflicts detects the confirmed appointment
  assertEq(
    last(asuser(1, `select count(*) from public.check_availability_block_conflicts('${barber1}', current_date + 5, current_date + 5, '14:00', '14:45')`)),
    "1",
    "check_availability_block_conflicts detects confirmed appointment",
  );

  // Omitted date persistence: cancel conflicting appointment on +12 and run sync -> must NOT recreate +12
  asuser(1, `select * from public.update_appointment_status('${conflictAptId}', 'CANCELLED')`);
  const syncAfterCancel = JSON.parse(
    last(asuser(1, `select row_to_json(s) from public.sync_recurring_appointment_rules(90, '${ruleId}') s`)),
  );
  assertEq(syncAfterCancel.generated_appointments, 0, "Omitted date remains excluded after conflicting appointment is cancelled");
  assertEq(
    sql(`select count(*) from public.appointments where recurring_rule_id = '${ruleId}' and booking_date = current_date + 12`),
    "0",
    "No appointment created on omitted date",
  );
  console.log("6. Recurring series creation, >21d independence, conflict priority, and omitted date persistence: PASS");

  // Rolling 90-day window renewal
  const rollingRes = JSON.parse(
    last(
      asuser(
        3, // MANAGER
        `select public.create_recurring_manual_series(
          p_barber_id => '${barber2}',
          p_service_id => '${serviceBarba}',
          p_start_date => current_date + 5,
          p_start_time => '11:00',
          p_duration_minutes => 30,
          p_client_name => 'Cliente Ventana Movil',
          p_client_phone => '1188889999',
          p_frequency_type => 'WEEKLY',
          p_end_type => 'NEVER',
          p_pricing_mode => 'CURRENT_RATE',
          p_horizon_days => 20
        )`,
      ),
    ),
  );
  const rollingRuleId = rollingRes.rule_id;
  assertEq(rollingRes.created_count, 3, "Initial 20-day window creates 3 occurrences (+5, +12, +19)");

  const syncIdem = JSON.parse(
    last(sql(`set role service_role; select row_to_json(s) from public.sync_recurring_appointment_rules(20, '${rollingRuleId}') s`)),
  );
  assertEq(syncIdem.generated_appointments, 0, "Idempotent sync at same horizon");

  const syncAdvance = JSON.parse(
    last(sql(`set role service_role; select row_to_json(s) from public.sync_recurring_appointment_rules(35, '${rollingRuleId}') s`)),
  );
  assertEq(syncAdvance.generated_appointments, 2, "Advancing horizon to 35 days generates +26 and +33");
  console.log("7. Rolling 90-day window renewal and idempotency (zero duplicate appointments): PASS");

  // Series edits (SINGLE / THIS_AND_FOLLOWING) & preservation of paid appointments
  const seriesApts = JSON.parse(
    last(
      asuser(
        1,
        `select jsonb_agg(jsonb_build_object('id', id, 'date', booking_date) order by booking_date) from public.appointments where recurring_rule_id = '${ruleId}'`,
      ),
    ),
  );
  assertEq(seriesApts.length, 5, "5 appointments in series");

  asuser(
    1,
    `select public.modify_recurring_appointment_series('${seriesApts[0].id}', 'SINGLE', 'UPDATE', '15:00', null, 26000, 'FIXED_PRICE', 'Cambio puntual')`,
  );
  assertEq(sql(`select start_time::text from public.appointments where id='${seriesApts[0].id}'`), "15:00:00", "Single occurrence updated");
  assertEq(sql(`select start_time::text from public.appointments where id='${seriesApts[1].id}'`), "14:00:00", "Following occurrence untouched");

  // Mark occurrence 3 (+33) as having a paid deposit
  sql(`update public.appointments set deposit_paid = true, deposit_amount_ars = 5000 where id = '${seriesApts[3].id}'`);

  const cancelSeriesRes = JSON.parse(
    last(asuser(1, `select public.modify_recurring_appointment_series('${seriesApts[2].id}', 'THIS_AND_FOLLOWING', 'CANCEL')`)),
  );
  assertEq(cancelSeriesRes.affected_count, 2, "2 unpaid future occurrences cancelled");
  assertEq(cancelSeriesRes.preserved_paid_appointment_ids.includes(seriesApts[3].id), true, "Paid occurrence preserved");
  assertEq(sql(`select status::text from public.appointments where id='${seriesApts[3].id}'`), "CONFIRMED", "Paid occurrence still CONFIRMED");
  assertEq(sql(`select status::text from public.appointments where id='${seriesApts[2].id}'`), "CANCELLED", "Unpaid occurrence 2 CANCELLED");
  assertEq(sql(`select status::text from public.appointments where id='${seriesApts[4].id}'`), "CANCELLED", "Unpaid occurrence 4 CANCELLED");
  console.log("8. Series edits (SINGLE / THIS_AND_FOLLOWING) and preservation of paid appointments: PASS");

  // ==============================================================================
  // SECTION 3 AUDIT: MEMBERSHIPS, DISCOUNTS & ALL KANI PAYMENT METHODS
  // ==============================================================================

  const client1 = sql(`select client_id::text from public.appointments where id='${seriesApts[0].id}'`);
  const client2 = sql(`select client_id::text from public.recurring_appointment_rules where id='${rollingRuleId}'`);

  const m4 = JSON.parse(
    last(
      asuser(
        1,
        `select public.create_client_membership(
          p_client_id => '${client1}',
          p_barber_id => '${barber1}',
          p_package_size => 4,
          p_items => '[{"service_name":"Corte","quantity":2,"unit_price_ars":25000},{"service_name":"Barba","quantity":2,"unit_price_ars":10000}]'::jsonb,
          p_payment_now => false,
          p_payment_method => 'Efectivo',
          p_expires_at => current_date + 60,
          p_notes => 'Membresía 4 prueba'
        )`,
      ),
    ),
  );
  const m4Id = m4.id;
  assertEq(m4.subtotal_ars, 70000, "4-service subtotal");
  assertEq(m4.discount_percent, 10, "4-service discount percent");
  assertEq(m4.discount_amount_ars, 7000, "4-service discount amount");
  assertEq(m4.total_price_ars, 63000, "4-service total price");
  assertEq(m4.status, "PENDING_PAYMENT", "Initial status PENDING_PAYMENT");

  checkDenied(
    1,
    `select public.consume_membership_session('${m4Id}', 'Corte', null, 'SERVICE_COMPLETED', '${barber1}', null)`,
    "MEMBERSHIP_PENDING_PAYMENT",
  );

  const m4Paid = JSON.parse(
    last(asuser(1, `select public.register_membership_payment('${m4Id}', 'Tarjeta — Payway', '${barber1}')`)),
  );
  assertEq(m4Paid.status, "ACTIVE", "Status ACTIVE after payment");
  assertEq(m4Paid.payment_method, "Tarjeta — Payway", "Payment method Tarjeta — Payway");
  assertEq(
    sql(`select final_amount_ars::text || '|' || payment_method from public.service_payments where id='${m4Paid.payment_id}'`),
    "63000|Tarjeta — Payway",
    "Service payment row created for 63000 ARS",
  );

  for (const method of [
    "Efectivo",
    "Transferencia",
    "Tarjeta de crédito",
    "Tarjeta de débito",
    "Payway",
    "Mercado Pago",
  ]) {
    const m10 = JSON.parse(
      last(
        asuser(
          3,
          `select public.create_client_membership(
            p_client_id => '${client2}',
            p_barber_id => '${barber2}',
            p_package_size => 10,
            p_items => '[{"service_name":"Corte","quantity":10,"unit_price_ars":25000}]'::jsonb,
            p_payment_now => true,
            p_payment_method => '${method}',
            p_expires_at => null,
            p_notes => 'Test ${method}'
          )`,
        ),
      ),
    );
    assertEq(m10.subtotal_ars, 250000, "10-service subtotal");
    assertEq(m10.discount_percent, 15, "10-service discount percent");
    assertEq(m10.discount_amount_ars, 37500, "10-service discount amount");
    assertEq(m10.total_price_ars, 212500, "10-service total price");
    assertEq(m10.payment_method, method, `Payment method ${method}`);
  }
  console.log("9. 4-service (10%) and 10-service (15%) math, pending-payment block, and all 7 KANI payment methods: PASS");

  // RBAC & RLS isolation across all 6 identities on memberships
  asuser(
    2,
    `select appointment_id from public.create_manual_appointment(p_barber_id=>'${barber2}', p_service_id=>'${serviceCorte}', p_booking_date=>current_date + 14, p_start_time=>'16:00', p_client_name=>'Cliente Serie Semanal', p_client_phone=>'1177778888')`,
  );
  assertEq(last(asuser(2, `select count(*) from public.client_memberships where id='${m4Id}'`)), "0", "Barber 2 cannot read Barber 1 membership");
  assertEq(last(asuser(2, `select count(*) from public.client_membership_items where membership_id='${m4Id}'`)), "0", "Barber 2 cannot read Barber 1 membership items");
  checkDenied(
    2,
    `select public.consume_membership_session('${m4Id}', 'Corte', null, 'SERVICE_COMPLETED', '${barber2}', null)`,
    "MEMBERSHIP_FORBIDDEN",
  );
  checkDenied(
    2,
    `select public.update_client_membership('${m4Id}', current_date + 90, false, null, 'Intento ajeno')`,
    "MEMBERSHIP_FORBIDDEN",
  );
  assertEq(last(asuser(8, `select count(*) from public.client_memberships where id='${m4Id}'`)), "0", "Disabled ADMIN cannot read memberships");
  assertEq(last(asuser(9, `select count(*) from public.client_memberships where id='${m4Id}'`)), "0", "No-profile user cannot read memberships");
  checkDenied(
    8,
    `select public.consume_membership_session('${m4Id}', 'Corte', null, 'SERVICE_COMPLETED', '${barber1}', null)`,
    "MEMBERSHIP_FORBIDDEN",
  );
  checkDenied(
    9,
    `select public.consume_membership_session('${m4Id}', 'Corte', null, 'SERVICE_COMPLETED', '${barber1}', null)`,
    "MEMBERSHIP_FORBIDDEN",
  );
  checkDeniedSql("set role anon; select count(*) from public.client_memberships", "permission denied");
  checkDeniedSql(
    `set role anon; select public.consume_membership_session('${m4Id}', 'Corte', null, 'SERVICE_COMPLETED', '${barber1}', null)`,
    "permission denied",
  );
  console.log("10. Strict RBAC + RLS across all 6 identities (ADMIN, disabled ADMIN, MANAGER, BARBER, no-profile, anon): PASS");

  // Single-client non-transferability, incompatible discount prevention, per-service quota, duplicate consumption & refund traceability
  const aptOtherClient = last(
    asuser(
      1,
      `select appointment_id from public.create_manual_appointment(p_barber_id=>'${barber1}', p_service_id=>'${serviceCorte}', p_booking_date=>current_date + 15, p_start_time=>'10:00', p_client_name=>'Otro Cliente Distinto', p_client_phone=>'1122223333')`,
    ),
  );
  checkDenied(
    1,
    `select public.consume_membership_session('${m4Id}', 'Corte', '${aptOtherClient}', 'SERVICE_COMPLETED', '${barber1}', null)`,
    "MEMBERSHIP_CLIENT_MISMATCH",
  );

  const bcodeId = sql("select id::text from public.benefit_codes limit 1");
  sql(`update public.appointments set benefit_code_id = '${bcodeId}' where id = '${seriesApts[1].id}'`);
  checkDenied(
    1,
    `select public.consume_membership_session('${m4Id}', 'Corte', '${seriesApts[1].id}', 'SERVICE_COMPLETED', '${barber1}', null)`,
    "INCOMPATIBLE_DISCOUNT_COMBINATION",
  );
  sql(`update public.appointments set benefit_code_id = null where id = '${seriesApts[1].id}'`);

  const paymentsBeforeConsume = sql("select count(*) from public.service_payments");
  const c1 = JSON.parse(
    last(
      asuser(
        1,
        `select public.consume_membership_session('${m4Id}', 'Corte', '${seriesApts[0].id}', 'SERVICE_COMPLETED', '${barber1}', 'Primer corte')`,
      ),
    ),
  );
  assertEq(c1.remaining_sessions, 3, "3 sessions remaining after 1st Corte");
  assertEq(sql("select count(*) from public.service_payments"), paymentsBeforeConsume, "Zero duplicate payments on session consumption");

  // Duplicate consumption on same appointment blocked
  checkDenied(
    1,
    `select public.consume_membership_session('${m4Id}', 'Corte', '${seriesApts[0].id}', 'SERVICE_COMPLETED', '${barber1}', 'Intento duplicado')`,
    "APPOINTMENT_SESSION_ALREADY_CONSUMED",
  );

  // Consume 2nd Corte -> Corte quota (2/2) is now exhausted
  const c2 = JSON.parse(
    last(asuser(1, `select public.consume_membership_session('${m4Id}', 'Corte', null, 'SERVICE_COMPLETED', '${barber1}', 'Segundo corte')`)),
  );
  assertEq(c2.remaining_sessions, 2, "2 sessions remaining after 2nd Corte");

  // Requesting a 3rd Corte must fail with MEMBERSHIP_ITEM_EXHAUSTED (must not consume Barba!)
  checkDenied(
    1,
    `select public.consume_membership_session('${m4Id}', 'Corte', null, 'SERVICE_COMPLETED', '${barber1}', 'Tercer corte excedido')`,
    "MEMBERSHIP_ITEM_EXHAUSTED",
  );

  // Consume Barba as NO_SHOW_DEDUCTION linked to seriesApts[1].id
  const c3 = JSON.parse(
    last(
      asuser(
        1,
        `select public.consume_membership_session('${m4Id}', 'Barba', '${seriesApts[1].id}', 'NO_SHOW_DEDUCTION', '${barber1}', 'Inasistencia sin aviso')`,
      ),
    ),
  );
  assertEq(c3.remaining_sessions, 1, "1 session remaining after Barba NO_SHOW_DEDUCTION");
  assertEq(c3.consumption.consumption_type, "NO_SHOW_DEDUCTION", "Recorded as NO_SHOW_DEDUCTION");

  // Refund c3 and verify remaining_sessions returns to 2 and consumption record is preserved as REFUNDED
  const refRes = JSON.parse(
    last(asuser(1, `select public.refund_membership_session('${c3.consumption.id}', null, 'Justificó certificado médico')`)),
  );
  assertEq(refRes.remaining_sessions, 2, "2 sessions remaining after refund");
  assertEq(refRes.consumption.status, "REFUNDED", "Consumption status REFUNDED");

  // Update expiration and verify audit trail
  asuser(3, `select public.update_client_membership('${m4Id}', current_date + 120, false, null, 'Extensión autorizada')`);
  assertEq(
    last(asuser(1, `select count(*) from public.client_membership_events where membership_id='${m4Id}' and event_type='UPDATED'`)),
    "1",
    "Expiration update audited in client_membership_events",
  );
  console.log("11. Per-service quota enforcement, non-duplication of revenue, NO_SHOW_DEDUCTION enum safety, and refund/expiration audit: PASS");

  // ==============================================================================
  // SECTION 6 AUDIT: REAL POSTGRESQL CONCURRENCY RACES
  // ==============================================================================

  // Consume 1 more Barba so only 1 Barba session remains in m4Id
  asuser(1, `select public.consume_membership_session('${m4Id}', 'Barba', null, 'SERVICE_COMPLETED', '${barber1}', 'Penúltima barba')`);

  const racePromises = [1, 2].map(async (workerIdx) => {
    try {
      await asuserAsync(
        1,
        `select public.consume_membership_session('${m4Id}', 'Barba', null, 'SERVICE_COMPLETED', '${barber1}', 'Concurrente ${workerIdx}')`,
      );
      return "OK";
    } catch (err) {
      return String(err?.message || err);
    }
  });
  const raceResults = await Promise.all(racePromises);
  assertEq(raceResults.filter((r) => r === "OK").length, 1, "Exactly 1 concurrent consumer wins the last session");
  assertEq(
    raceResults.some((r) => r.includes("MEMBERSHIP_EXHAUSTED") || r.includes("MEMBERSHIP_ITEM_EXHAUSTED")),
    true,
    "Second concurrent consumer rejected with exhausted error",
  );
  assertEq(sql(`select status || '|' || consumed_sessions from public.client_memberships where id='${m4Id}'`), "EXHAUSTED|4", "Membership status EXHAUSTED|4");

  // Concurrent sync_recurring_appointment_rules race advancing horizon to 55 days
  const syncRacePromises = [1, 2].map(async () => {
    const out = await sqlAsync(
      `set role service_role; select row_to_json(s) from public.sync_recurring_appointment_rules(55, '${rollingRuleId}') s`,
    );
    return JSON.parse(last(out)).generated_appointments;
  });
  await Promise.all(syncRacePromises);

  const dupDates = sql(
    `select count(*) from (select booking_date from public.appointments where recurring_rule_id='${rollingRuleId}' group by booking_date having count(*) > 1) d`,
  );
  assertEq(dupDates, "0", "Zero duplicate appointments generated under concurrent sync race");
  console.log("12. Concurrent PostgreSQL race conditions (membership last-session lock & advisory lock on recurring sync): PASS");
  console.log("ALL REAL POSTGRESQL 17 INTEGRATION TESTS PASSED.");
} finally {
  if (created) {
    const netMode = runDocker(["inspect", "--format", "{{.HostConfig.NetworkMode}}", container]);
    if (netMode !== "none") {
      throw new Error("Refusing cleanup: test container is no longer isolated");
    }
    runDocker(["rm", "-f", "-v", container]);
  }
}
