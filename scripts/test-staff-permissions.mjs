import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";

const container = `kani-staff-test-${randomUUID().slice(0, 8)}`;
const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, { encoding: "utf8", ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed: ${result.stderr || result.stdout}`);
  return result.stdout.trim();
};
let created = false;
try {
  run("docker", [
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
  const python =
    process.env.KANI_TEST_PYTHON || (process.platform === "win32" ? "python" : "python3");
  const result = spawnSync(python, ["supabase/tests/staff-permissions.py"], {
    stdio: "inherit",
    env: { ...process.env, PYTHONUTF8: "1", KANI_TEST_CONTAINER: container },
  });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally {
  if (created) {
    const network = run("docker", [
      "inspect",
      "--format",
      "{{.HostConfig.NetworkMode}}",
      container,
    ]);
    if (network !== "none")
      throw new Error("Refusing cleanup: test container is no longer isolated");
    run("docker", ["rm", "-f", "-v", container]);
  }
}
