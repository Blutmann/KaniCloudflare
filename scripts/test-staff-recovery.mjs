// Real Auth + SMTP tests: ephemeral private network, loopback ports, synthetic identities only.
import { spawnSync } from "node:child_process";
import { randomBytes, randomUUID, createHmac } from "node:crypto";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
const prefix = `kani-recovery-${randomUUID().slice(0, 8)}`,
  network = prefix + "-net",
  owned = [];
const secret = randomBytes(40).toString("hex");
const run = (args, input) => {
  const r = spawnSync("docker", args, { encoding: "utf8", input });
  if (r.status !== 0) {
    const databaseError = args.includes("psql")
      ? (r.stderr || "").split("\n").find((line) => /ERROR:|FATAL:/.test(line))
      : "";
    throw new Error(
      `Docker test operation failed (${args[0]})${databaseError ? ": " + databaseError : ""}`,
    );
  }
  return r.stdout.trim();
};
const jwt = (role) => {
  const payload = [
    { alg: "HS256", typ: "JWT" },
    { role, iss: "supabase", aud: "authenticated", exp: Math.floor(Date.now() / 1000) + 3600 },
  ]
    .map((x) => Buffer.from(JSON.stringify(x)).toString("base64url"))
    .join(".");
  return payload + "." + createHmac("sha256", secret).update(payload).digest("base64url");
};
const start = (name, args) => {
  run(["run", "-d", "--name", name, "--network", network, ...args]);
  owned.push(name);
};
const port = (name, internal) =>
  JSON.parse(run(["inspect", name]))[0].NetworkSettings.Ports[internal + "/tcp"][0].HostPort;
let created = false;
try {
  run(["network", "create", "--internal", network]);
  created = true;
  start(prefix + "-db", [
    "--network-alias",
    "db",
    "--tmpfs",
    "/var/lib/postgresql/data:rw,size=256m",
    "-e",
    "POSTGRES_HOST_AUTH_METHOD=trust",
    "postgres:17",
  ]);
  let databaseReady = false;
  // The entrypoint's temporary initdb server accepts Unix sockets before final startup.
  // Wait for TCP so bootstrap SQL cannot race its shutdown on a fresh CI runner.
  for (let i = 0; i < 60; i++) {
    if (
      spawnSync(
        "docker",
        ["exec", prefix + "-db", "pg_isready", "-h", "127.0.0.1", "-U", "postgres"],
        {
          stdio: "ignore",
        },
      ).status === 0
    ) {
      databaseReady = true;
      break;
    }
    await delay(500);
  }
  if (!databaseReady) throw new Error("Isolated PostgreSQL did not finish initialization");
  run(
    ["exec", "-i", prefix + "-db", "psql", "-U", "postgres", "-v", "ON_ERROR_STOP=1"],
    `create schema auth; create schema kani_private; create role anon; create role authenticated; create role service_role bypassrls;
 create table public.barbers(id uuid primary key,active boolean not null);
 create table public.staff_profiles(user_id uuid primary key,role text not null,barber_id uuid,active boolean not null);
 alter role postgres set search_path=auth,public;`,
  );
  start(prefix + "-mail", ["--network-alias", "mail", "axllent/mailpit:v1.33.0"]);
  start(prefix + "-template", [
    "--network-alias",
    "template",
    "--mount",
    `type=bind,source=${resolve("supabase/templates")},target=/www,readonly`,
    "busybox:1.37.0",
    "httpd",
    "-f",
    "-p",
    "8080",
    "-h",
    "/www",
  ]);
  const vars = {
    GOTRUE_API_HOST: "0.0.0.0",
    PORT: "9999",
    API_EXTERNAL_URL: "https://www.kanibarber.com",
    GOTRUE_SITE_URL: "https://www.kanibarber.com",
    GOTRUE_URI_ALLOW_LIST: "https://www.kanibarber.com/restablecer-contrasena",
    GOTRUE_DB_DRIVER: "postgres",
    GOTRUE_DB_DATABASE_URL: "postgres://postgres@db:5432/postgres?sslmode=disable",
    GOTRUE_DB_NAMESPACE: "auth",
    GOTRUE_JWT_SECRET: secret,
    GOTRUE_JWT_ADMIN_ROLES: "service_role",
    GOTRUE_JWT_AUD: "authenticated",
    GOTRUE_JWT_DEFAULT_GROUP_NAME: "authenticated",
    GOTRUE_SMTP_HOST: "mail",
    GOTRUE_SMTP_PORT: "1025",
    GOTRUE_SMTP_ADMIN_EMAIL: "noresponder@kanibarber.com",
    GOTRUE_SMTP_SENDER_NAME: "Kani Barber Studio",
    GOTRUE_MAILER_AUTOCONFIRM: "false",
    GOTRUE_MAILER_OTP_EXP: "3600",
    GOTRUE_MAILER_TEMPLATES_RECOVERY: "http://template:8080/staff-recovery.html",
    GOTRUE_MAILER_SUBJECTS_RECOVERY: "[KANI] Restablecé tu contraseña",
    GOTRUE_PASSWORD_MIN_LENGTH: "12",
    GOTRUE_SMTP_MAX_FREQUENCY: "1s",
    GOTRUE_RATE_LIMIT_EMAIL_SENT: "1000",
  };
  start(prefix + "-auth", [
    "--network-alias",
    "auth",
    ...Object.entries(vars).flatMap(([k, v]) => ["-e", `${k}=${v}`]),
    "supabase/gotrue:v2.197.0",
  ]);
  await delay(500);
  const state = JSON.parse(run(["inspect", prefix + "-auth"]))[0].State;
  if (!state.Running) {
    const log = run(["logs", prefix + "-auth"]);
    console.error(
      log.replaceAll(secret, "[redacted]").replace(/postgres:\/\/[^\s"]+/g, "[database]"),
    );
    throw new Error("Isolated Auth exited during startup");
  }
  // Docker Desktop does not publish ports on internal networks. A credential-free TCP relay
  // exposes only loopback HTTP; Auth, Postgres and SMTP remain on the internal network.
  const relay = prefix + "-relay";
  run([
    "run",
    "-d",
    "--name",
    relay,
    "--network",
    "bridge",
    "-p",
    "127.0.0.1::9999",
    "-p",
    "127.0.0.1::8025",
    "busybox:1.37.0",
    "sh",
    "-c",
    "nc -ll -p 9999 -e nc auth 9999 & nc -ll -p 8025 -e nc mail 8025 & wait",
  ]);
  owned.push(relay);
  run(["network", "connect", network, relay]);
  const authUrl = "http://127.0.0.1:" + port(relay, 9999),
    mailUrl = "http://127.0.0.1:" + port(relay, 8025);
  let ready = false;
  for (let i = 0; i < 90; i++) {
    try {
      if ((await fetch(authUrl + "/health")).ok) {
        ready = true;
        break;
      }
    } catch {}
    await delay(500);
  }
  if (!ready) throw new Error("Isolated Auth did not start");
  const result = spawnSync(
    process.execPath,
    ["node_modules/vitest/vitest.mjs", "run", "--config", "vitest.recovery.config.ts"],
    {
      stdio: "inherit",
      env: {
        ...process.env,
        KANI_RECOVERY_TEST_CONTAINER: prefix + "-db",
        KANI_RECOVERY_TEST_AUTH: authUrl,
        KANI_RECOVERY_TEST_MAIL: mailUrl,
        KANI_RECOVERY_TEST_SERVICE: jwt("service_role"),
        KANI_RECOVERY_TEST_ANON: jwt("anon"),
      },
    },
  );
  process.exitCode = result.status ?? 1;
} finally {
  for (const name of owned.reverse()) {
    const actual = JSON.parse(run(["inspect", name]))[0];
    if (!actual.NetworkSettings.Networks[network])
      throw new Error("Refusing cleanup of unrelated container");
    run(["rm", "-f", "-v", name]);
  }
  if (created) run(["network", "rm", network]);
}
