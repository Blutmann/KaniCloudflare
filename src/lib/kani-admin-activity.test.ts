import { beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: mock }));
import {
  readNotificationInbox,
  readNotificationAppointment,
  setAdminActivityNotificationRead,
  markAllAdminActivityNotificationsRead,
  deleteAllAdminActivityNotificationsGlobal,
} from "./kani-admin-activity";
describe("Server-owned per-account notification state", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mock.rpc.mockResolvedValue({
      data: { items: [], unread_count: 0, through: 17, next_before: null },
      error: null,
    });
    localStorage.clear();
  });
  it("ignores old shared localStorage state and uses the server count", async () => {
    localStorage.setItem("kani_admin_activity_read_v1", JSON.stringify({ one: "2026-01-01" }));
    localStorage.setItem("kani_admin_activity_dismissed_v1", JSON.stringify(["one"]));
    mock.rpc.mockResolvedValue({
      data: { items: [{ id: "one", read_at: null }], unread_count: 120, through: 17 },
      error: null,
    });
    expect((await readNotificationInbox()).items[0].read_at).toBeNull();
    expect((await readNotificationInbox()).unread_count).toBe(120);
    expect(mock.from).not.toHaveBeenCalled();
  });
  it("uses a server-authorized current detail query", async () => {
    await readNotificationAppointment("one");
    expect(mock.rpc).toHaveBeenCalledWith("staff_notification_detail", {
      p_notification_id: "one",
    });
  });
  it.each([true, false])(
    "persists individual read=%s without a supplied user identity",
    async (read) => {
      await setAdminActivityNotificationRead("one", read ? "2026-01-01" : null);
      expect(mock.rpc).toHaveBeenCalledWith("staff_set_notification_reads", {
        p_read: read,
        p_ids: ["one"],
      });
      expect(mock.from).not.toHaveBeenCalled();
    },
  );
  it("bulk marking sends the captured high-water mark", async () => {
    await markAllAdminActivityNotificationsRead(17);
    expect(mock.rpc).toHaveBeenCalledWith("staff_set_notification_reads", {
      p_read: true,
      p_through: 17,
    });
  });
  it("deletion uses only the audited server RPC", async () => {
    await deleteAllAdminActivityNotificationsGlobal(["one"]);
    expect(mock.rpc).toHaveBeenCalledWith("staff_delete_notifications", { p_ids: ["one"] });
    expect(mock.from).not.toHaveBeenCalled();
  });
  it("propagates failures without marking the browser state or attempting alternate writes", async () => {
    mock.rpc.mockResolvedValue({ data: null, error: { message: "denied" } });
    await expect(setAdminActivityNotificationRead("one", "now")).rejects.toEqual({
      message: "denied",
    });
    expect(mock.rpc).toHaveBeenCalledTimes(1);
    expect(mock.from).not.toHaveBeenCalled();
    expect(localStorage.length).toBe(0);
  });
  it("does not silently substitute empty results for a failed feed", async () => {
    mock.rpc.mockResolvedValue({ error: { message: "unavailable" } });
    await expect(readNotificationInbox()).rejects.toEqual({ message: "unavailable" });
  });
});
