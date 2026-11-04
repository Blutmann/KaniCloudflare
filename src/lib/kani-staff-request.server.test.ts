import { describe, expect, it, vi } from "vitest";
vi.mock("./kani-notifications.server", () => ({ createRequestSupabaseClient: vi.fn() }));
import { authenticateStaffRequest, requestStaffToken } from "./kani-staff-request.server";

function database(role: string, barber: string | null, active = true, validToken = true) {
  const eq = vi.fn();
  const query = {
    select: () => query,
    eq: (...args: unknown[]) => {
      eq(...args);
      return query;
    },
    maybeSingle: async () => ({ data: { role, barber_id: barber, active }, error: null }),
  };
  return {
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: validToken ? { id: "verified-user" } : null },
        error: validToken ? null : new Error("expired"),
      })),
    },
    from: () => query,
    eq,
  };
}
describe("Worker request authorization", () => {
  it("requires credentials before contacting data services", async () => {
    expect(
      await authenticateStaffRequest(new Request("https://kani.test/api/admin/payway-diagnostics")),
    ).toMatchObject({ ok: false, status: 401 });
  });
  it("ignores tokens and asserted roles in URLs", async () => {
    expect(
      await authenticateStaffRequest(
        new Request("https://kani.test/api/admin/online-deposits?token=anything&role=ADMIN"),
      ),
    ).toMatchObject({ ok: false, status: 401 });
  });
  it.each([
    ["BARBER", "barber-1"],
    ["MANAGER", null],
    ["ADMIN", null],
  ] as const)("uses the verified identity for %s", async (role, barber) => {
    const db = database(role, barber);
    const result = await authenticateStaffRequest(
      new Request("https://kani.test/api/admin/online-deposits", {
        headers: { authorization: "Bearer session" },
      }),
      db,
    );
    expect(result).toMatchObject({ ok: true, profile: { role, barber_id: barber } });
    expect(db.auth.getUser).toHaveBeenCalledWith("session");
    expect(db.eq).toHaveBeenCalledWith("user_id", "verified-user");
  });
  it.each([
    ["BARBER", null, true],
    ["MANAGER", "barber-1", true],
    ["ADMIN", null, false],
    ["OWNER", null, true],
  ] as const)("rejects malformed or inactive profiles", async (role, barber, active) => {
    expect(
      await authenticateStaffRequest(
        new Request("https://kani.test/api/admin/online-deposits", {
          headers: { authorization: "Bearer session" },
        }),
        database(role, barber, active),
      ),
    ).toMatchObject({ ok: false, status: 403 });
  });
  it("rejects expired sessions", async () => {
    expect(
      await authenticateStaffRequest(
        new Request("https://kani.test/api/admin/online-deposits", {
          headers: { authorization: "Bearer expired" },
        }),
        database("ADMIN", null, true, false),
      ),
    ).toMatchObject({ ok: false, status: 401 });
  });
  it("handles malformed cookies without accepting credentials", () => {
    expect(
      requestStaffToken(
        new Request("https://kani.test/", { headers: { cookie: "sb-access-token=%XX" } }),
      ),
    ).toBeUndefined();
  });
});
