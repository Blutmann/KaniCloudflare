import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ authenticate: vi.fn(), deposits: vi.fn() }));
vi.mock("@/lib/kani-staff-request.server", () => ({ authenticateStaffRequest: mocks.authenticate }));
vi.mock("@/lib/kani-online-deposits.server", () => ({ readOnlineDepositMovementsServer: mocks.deposits }));
import worker from "../server";

const request = (path: string) => new Request(`https://kani.test${path}`);
const routes = [
  "/api/admin/online-deposits", "/api/admin/payway-diagnostics",
  "/api/admin/recover-appointment-notification", "/api/admin/trigger-maintenance",
  "/api/admin/calendar-sync/process", "/api/admin/notification-audit",
  "/api/integrations/google-calendar/authorize", "/api/integrations/google-calendar/test-cycle",
];
beforeEach(() => {
  vi.clearAllMocks();
  mocks.authenticate.mockResolvedValue({ ok: false, status: 401, error: "AUTH_REQUIRED" });
  mocks.deposits.mockResolvedValue([]);
});
describe("Worker staff route boundaries", () => {
  it.each(routes)("rejects an anonymous request before privileged handlers: %s", async (path) => {
    const response = await worker.fetch(request(path), {}, {});
    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mocks.deposits).not.toHaveBeenCalled();
  });
  it.each(["BARBER", "MANAGER"])("denies diagnostics and maintenance to %s", async (role) => {
    mocks.authenticate.mockResolvedValue({ ok: true, token: "verified", profile: { role, barber_id: role === "BARBER" ? "own-barber" : null } });
    for (const path of routes.filter(path => path !== "/api/admin/online-deposits")) {
      const response = await worker.fetch(request(path), {}, {});
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: "ADMIN_REQUIRED" });
    }
  });
  it.each(["BARBER", "MANAGER", "ADMIN"])("passes only the verified identity to the deposit reader for %s", async (role) => {
    const profile = { role, barber_id: role === "BARBER" ? "own-barber" : null };
    mocks.authenticate.mockResolvedValue({ ok: true, token: "verified-session", profile });
    const response = await worker.fetch(request("/api/admin/online-deposits?barberId=other&role=ADMIN&token=forged"), {}, {});
    expect(response.status).toBe(200);
    expect(mocks.deposits).toHaveBeenCalledWith(expect.objectContaining({ barberId: "other" }), { profile, token: "verified-session" });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});
