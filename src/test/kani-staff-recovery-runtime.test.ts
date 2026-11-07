import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), client: vi.fn(), send: vi.fn() }));
vi.mock("../lib/kani-mercadopago.server", () => ({
  getRuntimeEnv: (name: string) =>
    (
      ({
        SUPABASE_URL: "https://controlled.supabase.co",
        SUPABASE_SERVICE_ROLE_KEY: "controlled-private-key",
      }) as Record<string, string>
    )[name],
}));
vi.mock("../lib/kani-payment-db.server", () => ({
  createPaymentSupabaseClient: async () => ({ rpc: mocks.rpc }),
}));
vi.mock("@supabase/supabase-js", () => ({ createClient: mocks.client }));
import { handleStaffRecoveryRequest } from "../lib/kani-staff-recovery.server";
const req = () =>
  new Request("https://www.kanibarber.com/api/staff/password-recovery", {
    method: "POST",
    headers: { origin: "https://www.kanibarber.com", "content-type": "application/json" },
    body: JSON.stringify({ email: "controlled@example.invalid" }),
  });
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("VITE_SUPABASE_ANON_KEY", "controlled-public-key");
  mocks.client.mockReturnValue({ auth: { resetPasswordForEmail: mocks.send } });
  mocks.send.mockResolvedValue({ error: null });
  mocks.rpc.mockImplementation(async (name: string) => ({
    data:
      name === "consume_staff_recovery"
        ? "job"
        : name === "claim_staff_recoveries"
          ? [{ job_id: "job", recipient_email: "controlled@example.invalid" }]
          : name === "staff_recovery_identity"
            ? { id: "controlled", email: "controlled@example.invalid" }
            : null,
    error: null,
  }));
});
afterEach(() => vi.unstubAllEnvs());
it("supports the actual production bindings: private runtime credentials and a public build-time key", async () => {
  const tasks: Promise<unknown>[] = [];
  await handleStaffRecoveryRequest(req(), { waitUntil: (p) => tasks.push(p) });
  await Promise.all(tasks);
  expect(mocks.send).toHaveBeenCalledOnce();
  expect(mocks.client).toHaveBeenCalledWith(
    "https://controlled.supabase.co",
    "controlled-public-key",
    expect.objectContaining({
      auth: expect.objectContaining({ persistSession: false, detectSessionInUrl: false }),
    }),
  );
});
it("fails closed if the public key is missing and never substitutes service_role into the recovery Auth client", async () => {
  vi.stubEnv("VITE_SUPABASE_ANON_KEY", "");
  const tasks: Promise<unknown>[] = [];
  await handleStaffRecoveryRequest(req(), { waitUntil: (p) => tasks.push(p) });
  await Promise.all(tasks);
  expect(mocks.client).not.toHaveBeenCalled();
  expect(mocks.rpc).not.toHaveBeenCalled();
});
