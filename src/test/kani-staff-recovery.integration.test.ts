// Run only via scripts/test-staff-recovery.mjs: no production credentials or mail recipients.
import { beforeAll, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { execFileSync, execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFileSync, readdirSync } from "node:fs";
import { randomUUID, createHash } from "node:crypto";
import {
  handleStaffRecoveryRequest,
  handleStaffPasswordReset,
  dispatchStaffRecoveryEmails,
} from "../lib/kani-staff-recovery.server";
import { STAFF_RECOVERY_MESSAGE, STAFF_RECOVERY_URL } from "../lib/kani-staff-recovery";
const env = process.env,
  container = env["KANI_RECOVERY_TEST_CONTAINER"]!,
  authUrl = env["KANI_RECOVERY_TEST_AUTH"]!,
  mailUrl = env["KANI_RECOVERY_TEST_MAIL"]!;
const quote = (s: unknown) => (s === null ? "null" : "'" + String(s).replaceAll("'", "''") + "'");
const sql = (q: string) =>
  execFileSync(
    "docker",
    ["exec", "-i", container, "psql", "-U", "postgres", "-v", "ON_ERROR_STOP=1", "-Atq"],
    { input: q, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
  ).trim();
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const users: Record<string, any> = {},
  snapshots: Record<string, string> = {};
let sequence = 0;
const request = (path: string, body: unknown, origin = "https://www.kanibarber.com") =>
  new Request("https://www.kanibarber.com/api/staff/" + path, {
    method: "POST",
    headers: {
      origin,
      "content-type": "application/json",
      "cf-connecting-ip": `192.0.2.${++sequence}`,
    },
    body: JSON.stringify(body),
  });
const sqlExpression = (name: string, args: Record<string, unknown>) =>
  `public.${name}(${Object.entries(args)
    .map(([k, v]) => `${k}=>${quote(v)}`)
    .join(",")})`;
const db = {
  rpc: async (name: string, args: Record<string, unknown>) => {
    try {
      const expr = sqlExpression(name, args),
        q =
          name === "claim_staff_recoveries"
            ? `select coalesce(jsonb_agg(t),'[]'::jsonb) from ${expr} t`
            : `select coalesce(to_jsonb(${expr}),'null'::jsonb)`;
      return { data: JSON.parse(sql("set role service_role;" + q)), error: null };
    } catch {
      return { data: null, error: { message: "TEST_DATABASE_DENIED" } };
    }
  },
  auth: {
    admin: {
      signOut: async (token: string, scope: string) => {
        const r = await fetch(authUrl + "/logout?scope=" + scope, {
          method: "POST",
          headers: { Authorization: "Bearer " + token },
        });
        return { error: r.ok ? null : { message: "TEST_LOGOUT_FAILED" } };
      },
    },
  },
};
const auth = () =>
  createClient(authUrl, env["KANI_RECOVERY_TEST_ANON"]!, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: {
      fetch: ((input: any, init: any) => {
        const u = new URL(typeof input === "string" ? input : input.url);
        u.pathname = u.pathname.replace(/^\/auth\/v1/, "");
        return fetch(u, init);
      }) as typeof fetch,
    },
  });
const deps = { db, auth, pepper: "isolated-recovery-test-pepper-only" };
async function provider(path: string, body?: unknown, method = "POST") {
  const r = await fetch(authUrl + path, {
    method,
    headers: {
      Authorization: "Bearer " + env["KANI_RECOVERY_TEST_SERVICE"],
      "content-type": "application/json",
    },
    body: body === undefined ? null : JSON.stringify(body),
  });
  if (!r.ok) throw new Error("Isolated Auth admin operation failed: " + r.status);
  return r.json();
}
async function messages() {
  return (await (await fetch(mailUrl + "/api/v1/messages")).json()).messages as any[];
}
async function tokenFor(email: string) {
  let found: any;
  for (let i = 0; i < 40; i++) {
    found = (await messages()).find((m) => m.To.some((t: any) => t.Address === email));
    if (found) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  expect(Boolean(found), "Recovery message captured by isolated SMTP").toBe(true);
  const message = await (await fetch(mailUrl + "/api/v1/message/" + found.ID)).json();
  expect(found.Subject).toBe("[KANI] Restablecé tu contraseña");
  const match = message.HTML.match(
    /https:\/\/www\.kanibarber\.com\/restablecer-contrasena#token_hash=([a-f0-9]{56})&(?:amp;)?type=recovery/,
  );
  expect(Boolean(match), "Fixed HTTPS recovery URL with a token fragment").toBe(true);
  expect(message.HTML.includes("Si no solicitaste este cambio, podés ignorar este correo.")).toBe(
    true,
  );
  return match![1] as string;
}
async function freshToken(user: any) {
  const data = await provider("/admin/generate_link", {
    type: "recovery",
    email: user.email,
    redirect_to: STAFF_RECOVERY_URL,
  });
  expect(Boolean(data.hashed_token)).toBe(true);
  return data.hashed_token as string;
}
async function complete(token: string, password: string, confirmation = password) {
  return (
    await handleStaffPasswordReset(
      request("password-reset", { tokenHash: token, password, confirmation }),
      deps,
    )
  ).json();
}
async function enqueue(email: string) {
  const tasks: Promise<unknown>[] = [];
  const reply = await handleStaffRecoveryRequest(
    request("password-recovery", { email, redirectTo: "https://untrusted.invalid" }),
    { waitUntil: (p) => tasks.push(p) },
    deps,
  );
  const body = await reply.json();
  await Promise.all(tasks);
  return { reply, body };
}
const password = () => randomUUID() + "-test-only";
describe.skipIf(!container)("Staff recovery with real isolated Auth, PostgreSQL and SMTP", () => {
  beforeAll(async () => {
    const migration = readdirSync("supabase/migrations").find((n) =>
      n.endsWith("_kani_staff_password_recovery.sql"),
    )!;
    sql(readFileSync("supabase/migrations/" + migration, "utf8"));
    for (const [label, role, active] of [
      ["barber", "BARBER", true],
      ["manager", "MANAGER", true],
      ["admin", "ADMIN", true],
      ["client", null, true],
      ["disabled", "BARBER", false],
      ["barberDisabled", "BARBER", true],
      ["orphan", "BARBER", true],
      ["invalidScope", "MANAGER", true],
      ["unconfirmed", "MANAGER", true],
      ["banned", "ADMIN", true],
      ["deleted", "MANAGER", true],
    ] as const) {
      const initial = password(),
        email = label.toLowerCase() + "@recovery.example.invalid";
      const user = await provider("/admin/users", {
        email,
        password: initial,
        email_confirm: label !== "unconfirmed",
      });
      users[label] = { ...user, initial, email };
      const barber = randomUUID();
      sql(`insert into public.barbers values(${quote(barber)},${label !== "barberDisabled"});`);
      if (role)
        sql(
          `insert into public.staff_profiles values(${quote(user.id)},${quote(role)},${(role === "BARBER" && label !== "orphan") || label === "invalidScope" ? quote(barber) : "null"},${active});`,
        );
      if (label === "banned")
        sql(`update auth.users set banned_until=now()+interval '1 day' where id=${quote(user.id)}`);
      if (label === "deleted")
        sql(`update auth.users set deleted_at=now() where id=${quote(user.id)}`);
      snapshots[label] = sql(
        `select row_to_json(p) from public.staff_profiles p where user_id=${quote(user.id)}`,
      );
    }
  });
  for (const role of ["barber", "manager", "admin"])
    it(`sends exactly one branded recovery message to active ${role}`, async () => {
      const u = users[role],
        before = (await messages()).length;
      const { reply, body } = await enqueue(u.email.toUpperCase());
      expect(reply.status).toBe(200);
      expect(reply.headers.get("cache-control")).toBe("no-store");
      expect(body).toEqual({ message: STAFF_RECOVERY_MESSAGE });
      await tokenFor(u.email);
      expect((await messages()).length).toBe(before + 1);
      expect((await dispatchStaffRecoveryEmails(deps)).processed).toBe(0);
      await enqueue(u.email);
      expect((await messages()).length).toBe(before + 1);
    });
  for (const label of [
    "client",
    "disabled",
    "barberDisabled",
    "orphan",
    "invalidScope",
    "unconfirmed",
    "banned",
    "deleted",
    "missing",
  ])
    it(`suppresses ${label} with the identical public response`, async () => {
      const before = (await messages()).length,
        { body } = await enqueue(users[label]?.email ?? "missing@recovery.example.invalid");
      expect(body).toEqual({ message: STAFF_RECOVERY_MESSAGE });
      expect((await messages()).length).toBe(before);
    });
  it("uses provider single-use verification, changes password, revokes old refresh sessions and preserves roles/associations", async () => {
    for (const role of ["barber", "manager", "admin"]) {
      const u = users[role],
        oldSession = auth(),
        old = await oldSession.auth.signInWithPassword({ email: u.email, password: u.initial });
      expect(Boolean(old.data.session)).toBe(true);
      const refresh = old.data.session!.refresh_token;
      const token = await tokenFor(u.email),
        next = password();
      expect(await complete(token, next)).toEqual({ ok: true });
      expect(await complete(token, password())).toEqual({ ok: false, code: "INVALID_LINK" });
      expect(
        Boolean(
          (await auth().auth.signInWithPassword({ email: u.email, password: u.initial })).error,
        ),
      ).toBe(true);
      expect(
        Boolean(
          (await auth().auth.signInWithPassword({ email: u.email, password: next })).data.session,
        ),
      ).toBe(true);
      expect(Boolean((await auth().auth.refreshSession({ refresh_token: refresh })).error)).toBe(
        true,
      );
      expect(
        sql(`select row_to_json(p) from public.staff_profiles p where user_id=${quote(u.id)}`),
      ).toBe(snapshots[role]);
    }
  });
  it("rejects an expired recovery token", async () => {
    const u = users["manager"],
      token = await freshToken(u);
    sql(`update auth.users set recovery_sent_at=now()-interval '2 hours' where id=${quote(u.id)}`);
    expect(await complete(token, password())).toEqual({ ok: false, code: "INVALID_LINK" });
  });
  it("checks password confirmation before consuming the provider link", async () => {
    const token = await freshToken(users["admin"]);
    expect(await complete(token, "short")).toEqual({ ok: false, code: "PASSWORD_POLICY" });
    expect(await complete(token, password(), password())).toEqual({
      ok: false,
      code: "PASSWORD_POLICY",
    });
    expect(await complete(token, password())).toEqual({ ok: true });
  });
  it("rechecks eligibility after the link was issued; disabled staff cannot change a password or become active", async () => {
    const u = users["barber"],
      token = await freshToken(u);
    sql(`update public.staff_profiles set active=false where user_id=${quote(u.id)}`);
    expect(await complete(token, password())).toEqual({ ok: false, code: "INVALID_LINK" });
    expect(sql(`select active from public.staff_profiles where user_id=${quote(u.id)}`)).toBe("f");
    sql(`update public.staff_profiles set active=true where user_id=${quote(u.id)}`);
  });
  it("ignores malformed, honeypot and cross-origin requests without sending or enqueueing", async () => {
    const before = sql("select count(*) from kani_private.staff_recovery_requests");
    for (const r of [
      request("password-recovery", { email: users["admin"].email }, "https://untrusted.invalid"),
      request("password-recovery", { email: "invalid" }),
      request("password-recovery", { email: users["admin"].email, website: "filled" }),
    ]) {
      expect(await (await handleStaffRecoveryRequest(r, undefined, deps)).json()).toEqual({
        message: STAFF_RECOVERY_MESSAGE,
      });
    }
    expect(sql("select count(*) from kani_private.staff_recovery_requests")).toBe(before);
  });
  it("does not require SMTP or an account lookup in the request response; scheduled dispatch can finish later", async () => {
    const email = "deferred@recovery.example.invalid";
    const reply = await handleStaffRecoveryRequest(
      request("password-recovery", { email }),
      undefined,
      deps,
    );
    expect(await reply.json()).toEqual({ message: STAFF_RECOVERY_MESSAGE });
    expect(
      sql(`select status from kani_private.staff_recovery_requests where email=${quote(email)}`),
    ).toBe("QUEUED");
    await dispatchStaffRecoveryEmails(deps);
    expect(
      sql(`select status from kani_private.staff_recovery_requests where email=${quote(email)}`),
    ).toBe("SUPPRESSED");
  });
  it("enforces IP, email and token limits atomically, independent of account existence", async () => {
    const ip = hash(randomUUID());
    for (let i = 0; i < 11; i++) {
      const r = await db.rpc("consume_staff_recovery", {
        p_kind: "REQUEST",
        p_ip_key: ip,
        p_subject_key: hash("ip-" + i),
        p_email: "limit" + i + "@recovery.example.invalid",
      });
      expect(Boolean(r.data)).toBe(i < 10);
    }
    const subject = hash(randomUUID()),
      consume = () =>
        db.rpc("consume_staff_recovery", {
          p_kind: "REQUEST",
          p_ip_key: hash(randomUUID()),
          p_subject_key: subject,
          p_email: "email-limit@recovery.example.invalid",
        });
    expect(Boolean((await consume()).data)).toBe(true);
    expect((await consume()).data).toBeNull();
    for (let i = 0; i < 2; i++) {
      sql(
        `update kani_private.staff_recovery_requests set created_at=created_at-interval '61 seconds' where subject_key=${quote(subject)}`,
      );
      expect(Boolean((await consume()).data)).toBe(true);
    }
    sql(
      `update kani_private.staff_recovery_requests set created_at=created_at-interval '61 seconds' where subject_key=${quote(subject)}`,
    );
    expect((await consume()).data).toBeNull();
    const token = hash(randomUUID());
    for (let i = 0; i < 6; i++)
      expect(
        Boolean(
          (
            await db.rpc("consume_staff_recovery", {
              p_kind: "COMPLETE",
              p_ip_key: hash(randomUUID()),
              p_subject_key: token,
              p_email: null,
            })
          ).data,
        ),
      ).toBe(i < 5);
    const simultaneous = hash(randomUUID()),
      args = {
        p_kind: "REQUEST",
        p_ip_key: hash(randomUUID()),
        p_subject_key: simultaneous,
        p_email: "race@recovery.example.invalid",
      };
    const jobs = await Promise.all(
      Array.from({ length: 5 }, () =>
        promisify(execFile)(
          "docker",
          [
            "exec",
            "-i",
            container,
            "psql",
            "-U",
            "postgres",
            "-Atq",
            "-c",
            "set role service_role;select " + sqlExpression("consume_staff_recovery", args),
          ],
          { encoding: "utf8" },
        ),
      ),
    );
    expect(jobs.filter((r) => r.stdout.trim()).length).toBe(1);
    const dailyIp = hash(randomUUID());
    sql(`insert into kani_private.staff_recovery_requests(kind,ip_key,subject_key,status,created_at)
      select 'COMPLETE',${quote(dailyIp)},${quote(hash(randomUUID()))},'ATTEMPT',now()-interval '2 hours' from generate_series(1,40)`);
    expect(
      (
        await db.rpc("consume_staff_recovery", {
          p_kind: "COMPLETE",
          p_ip_key: dailyIp,
          p_subject_key: hash(randomUUID()),
          p_email: null,
        })
      ).data,
    ).toBeNull();
  });
  it("never reclaims an ambiguous send; expires pending jobs and retains no secrets or old email records", async () => {
    sql(
      "update kani_private.staff_recovery_requests set status='SUPPRESSED' where status='QUEUED'",
    );
    const expiredEmail = "expired-queue@recovery.example.invalid";
    sql(`insert into kani_private.staff_recovery_requests(kind,ip_key,subject_key,email,status,created_at)
      values('REQUEST',${quote(hash(randomUUID()))},${quote(hash(randomUUID()))},${quote(expiredEmail)},'QUEUED',now()-interval '11 minutes')`);
    await db.rpc("claim_staff_recoveries", { p_limit: 5 });
    expect(
      sql(
        `select status from kani_private.staff_recovery_requests where email=${quote(expiredEmail)}`,
      ),
    ).toBe("SUPPRESSED");
    const email = "claim@recovery.example.invalid";
    await db.rpc("consume_staff_recovery", {
      p_kind: "REQUEST",
      p_ip_key: hash(randomUUID()),
      p_subject_key: hash(randomUUID()),
      p_email: email,
    });
    const first = await db.rpc("claim_staff_recoveries", { p_limit: 5 }),
      second = await db.rpc("claim_staff_recoveries", { p_limit: 5 });
    expect(first.data.length).toBe(1);
    expect(second.data.length).toBe(0);
    sql(
      `update kani_private.staff_recovery_requests set dispatched_at=now()-interval '11 minutes' where email=${quote(email)}`,
    );
    expect((await db.rpc("claim_staff_recoveries", { p_limit: 5 })).data.length).toBe(0);
    expect(
      sql(`select status from kani_private.staff_recovery_requests where email=${quote(email)}`),
    ).toBe("NEEDS_REVIEW");
    sql(
      `update kani_private.staff_recovery_requests set created_at=now()-interval '49 hours' where email=${quote(email)}`,
    );
    await db.rpc("claim_staff_recoveries", { p_limit: 5 });
    expect(
      sql(`select count(*) from kani_private.staff_recovery_requests where email=${quote(email)}`),
    ).toBe("0");
    expect(
      sql(
        "select count(*) from information_schema.columns where table_schema='kani_private' and table_name='staff_recovery_requests' and column_name ~ '(password|token|session)'",
      ),
    ).toBe("0");
  });
  it("denies RPCs and private data to PUBLIC/anon/authenticated and raw table access to service_role", () => {
    for (const role of ["anon", "authenticated"])
      for (const q of [
        "select public.staff_recovery_identity('admin@recovery.example.invalid',null)",
        "select * from public.claim_staff_recoveries(5)",
        "select * from kani_private.staff_recovery_requests",
      ])
        expect(() => sql(`set role ${role};${q}`)).toThrow();
    expect(() =>
      sql("set role service_role;select * from kani_private.staff_recovery_requests"),
    ).toThrow();
    expect(
      sql(
        "select count(*) from pg_proc p, lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where p.proname in ('consume_staff_recovery','staff_recovery_identity','claim_staff_recoveries','finish_staff_recovery') and a.grantee=0",
      ),
    ).toBe("0");
  });
});
