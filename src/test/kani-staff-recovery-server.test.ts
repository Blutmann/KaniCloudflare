import { beforeEach, expect, it, vi } from "vitest";
import {
  handleStaffRecoveryRequest,
  handleStaffPasswordReset,
  dispatchStaffRecoveryEmails,
} from "../lib/kani-staff-recovery.server";
import { STAFF_RECOVERY_MESSAGE } from "../lib/kani-staff-recovery";
const token = "a".repeat(56),
  password = "controlled-password-only";
let db: any, client: any, deps: any;
const req = (body: unknown) =>
  new Request("https://www.kanibarber.com/api/staff/password-reset", {
    method: "POST",
    headers: {
      origin: "https://www.kanibarber.com",
      "content-type": "application/json",
      "cf-connecting-ip": "192.0.2.1",
    },
    body: JSON.stringify(body),
  });
beforeEach(() => {
  client = {
    auth: {
      verifyOtp: vi
        .fn()
        .mockResolvedValue({
          data: { user: { id: "controlled" }, session: { access_token: "controlled-session" } },
          error: null,
        }),
      updateUser: vi.fn().mockResolvedValue({ error: null }),
      signOut: vi.fn().mockResolvedValue({ error: null }),
      resetPasswordForEmail: vi.fn().mockResolvedValue({ error: null }),
    },
  };
  db = {
    rpc: vi
      .fn()
      .mockImplementation(async (name: string) => ({
        data:
          name === "consume_staff_recovery"
            ? "job"
            : name === "staff_recovery_identity"
              ? { id: "controlled", email: "controlled@example.invalid" }
              : [],
        error: null,
      })),
    auth: { admin: { signOut: vi.fn().mockResolvedValue({ error: null }) } },
  };
  deps = { db, auth: () => client, pepper: "test-pepper" };
});
it("fails closed without calling Auth when the shared limiter is unavailable", async () => {
  db.rpc.mockResolvedValue({ error: { message: "unavailable" } });
  expect(
    await (
      await handleStaffPasswordReset(
        req({ tokenHash: token, password, confirmation: password }),
        deps,
      )
    ).json(),
  ).toEqual({ ok: false, code: "TRY_LATER" });
  expect(client.auth.verifyOtp).not.toHaveBeenCalled();
});
it("does not fall back to another existing session when token verification fails", async () => {
  client.auth.verifyOtp.mockResolvedValue({
    data: { session: { access_token: "existing-session" } },
    error: { message: "expired" },
  });
  expect(
    await (
      await handleStaffPasswordReset(
        req({ tokenHash: token, password, confirmation: password }),
        deps,
      )
    ).json(),
  ).toEqual({ ok: false, code: "INVALID_LINK" });
  expect(client.auth.updateUser).not.toHaveBeenCalled();
});
it("clears the temporary recovery session if the eligibility lookup fails", async () => {
  db.rpc.mockImplementation(async (name: string) =>
    name === "consume_staff_recovery"
      ? { data: "job", error: null }
      : { data: null, error: { message: "unavailable" } },
  );
  expect(
    await (
      await handleStaffPasswordReset(
        req({ tokenHash: token, password, confirmation: password }),
        deps,
      )
    ).json(),
  ).toEqual({ ok: false, code: "INVALID_LINK" });
  expect(client.auth.updateUser).not.toHaveBeenCalled();
  expect(client.auth.signOut).toHaveBeenCalledWith({ scope: "local" });
});
it("explains provider password-policy rejection after consuming the link", async () => {
  client.auth.updateUser.mockResolvedValue({
    error: { message: "provider detail must stay private" },
  });
  expect(
    await (
      await handleStaffPasswordReset(
        req({ tokenHash: token, password, confirmation: password }),
        deps,
      )
    ).json(),
  ).toEqual({ ok: false, code: "PASSWORD_POLICY_NEW_LINK" });
  expect(client.auth.signOut).toHaveBeenCalledWith({ scope: "local" });
});
it("uses the provider admin fallback when global logout fails", async () => {
  client.auth.signOut.mockResolvedValue({ error: { message: "controlled failure" } });
  expect(
    await (
      await handleStaffPasswordReset(
        req({ tokenHash: token, password, confirmation: password }),
        deps,
      )
    ).json(),
  ).toEqual({ ok: true });
  expect(db.auth.admin.signOut).toHaveBeenCalledWith("controlled-session", "global");
});
it("reports a saved password honestly if both provider session-revocation attempts fail", async () => {
  client.auth.signOut.mockResolvedValue({ error: { message: "controlled failure" } });
  db.auth.admin.signOut.mockResolvedValue({ error: { message: "controlled failure" } });
  expect(
    await (
      await handleStaffPasswordReset(
        req({ tokenHash: token, password, confirmation: password }),
        deps,
      )
    ).json(),
  ).toEqual({ ok: false, passwordSaved: true, code: "SESSIONS_PENDING" });
});
it("bounds request bodies, never exposes provider details, and never stores raw tokens/passwords in rate metadata", async () => {
  const body = await (
    await handleStaffRecoveryRequest(req({ email: "x".repeat(13000) }), undefined, deps)
  ).json();
  expect(body).toEqual({ message: STAFF_RECOVERY_MESSAGE });
  expect(db.rpc).not.toHaveBeenCalled();
  await handleStaffPasswordReset(req({ tokenHash: token, password, confirmation: password }), deps);
  const guard = db.rpc.mock.calls.find((c: any[]) => c[0] === "consume_staff_recovery")[1];
  expect(guard.p_ip_key).toHaveLength(64);
  expect(guard.p_subject_key).toHaveLength(64);
  expect(guard.p_email).toBeNull();
  expect(JSON.stringify(guard).includes(token)).toBe(false);
  expect(JSON.stringify(guard).includes(password)).toBe(false);
});
it("records an ambiguous/provider failure without resending or logging recipient/provider secrets", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  db.rpc.mockImplementation(async (name: string) => ({
    data:
      name === "claim_staff_recoveries"
        ? [{ job_id: "job", recipient_email: "controlled@example.invalid" }]
        : name === "staff_recovery_identity"
          ? { id: "controlled", email: "controlled@example.invalid" }
          : null,
    error: null,
  }));
  client.auth.resetPasswordForEmail.mockRejectedValue(new Error("private-provider-detail"));
  expect(await dispatchStaffRecoveryEmails(deps)).toEqual({
    processed: 1,
    accepted: 0,
    suppressed: 0,
    failed: 1,
  });
  expect(client.auth.resetPasswordForEmail).toHaveBeenCalledTimes(1);
  expect(db.rpc).toHaveBeenCalledWith("finish_staff_recovery", { p_id: "job", p_status: "FAILED" });
  expect(JSON.stringify(warn.mock.calls).includes("private-provider-detail")).toBe(false);
  warn.mockRestore();
});
