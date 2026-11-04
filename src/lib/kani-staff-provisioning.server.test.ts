import { describe, expect, it, vi } from "vitest";
import {
  planStaffInvitations,
  sendStaffInvitations,
  verifyInviteConfiguration,
  STAFF_INVITE_REDIRECT,
  type StaffInvite,
} from "./kani-staff-provisioning.server";

const roster = (): StaffInvite[] =>
  [1, 2, 3, 4, 5].map((n) => ({
    name: `Personal ${n}`,
    email: `staff${n}@example.invalid`,
    role: n === 5 ? "MANAGER" : "BARBER",
    barberId: n === 5 ? null : `10000000-0000-0000-0000-00000000000${n}`,
  }));
const mail = {
  site_url: "https://www.kanibarber.com",
  uri_allow_list: STAFF_INVITE_REDIRECT,
  smtp_host: "mail.example.invalid",
  smtp_user: "sender",
  smtp_admin_email: "sender@example.invalid",
  external_email_enabled: true,
};
function database(users: any[] = [], profiles: any[] = [], failedProfile = false) {
  const inserted: any[] = [];
  const db = {
    from: (table: string) => {
      const data =
        table === "barbers"
          ? roster()
              .filter((r) => r.barberId)
              .map((r) => ({ id: r.barberId, active: true }))
          : table === "staff_profiles"
            ? profiles
            : [];
      const query = {
        limit: async () => ({ data, error: null }),
        then: (resolve: any) => Promise.resolve({ data, error: null }).then(resolve),
      };
      return {
        select: () => query,
        insert: vi.fn(async (row: any) => {
          inserted.push(row);
          return { error: failedProfile ? new Error("retry") : null };
        }),
      };
    },
    auth: {
      admin: {
        listUsers: vi.fn(async () => ({ data: { users }, error: null })),
        inviteUserByEmail: vi.fn(async (email: string, _options?: unknown) => ({
          data: { user: { id: `20000000-0000-0000-0000-00000000000${email.match(/\d/)?.[0]}` } },
          error: null,
        })),
      },
    },
    inserted,
  };
  return db;
}
describe("five individual Auth invitations", () => {
  it("plans without creating accounts or sending mail", async () => {
    const db = database();
    expect(await planStaffInvitations(db, roster())).toHaveLength(5);
    expect(db.auth.admin.inviteUserByEmail).not.toHaveBeenCalled();
    expect(db.inserted).toEqual([]);
  });
  it("invites five users and links permanent Auth/barber IDs without passwords", async () => {
    const db = database();
    expect(
      (await sendStaffInvitations(db, roster(), mail)).every((r) => r.status === "INVITED"),
    ).toBe(true);
    expect(db.auth.admin.inviteUserByEmail).toHaveBeenCalledTimes(5);
    expect(db.auth.admin.inviteUserByEmail.mock.calls[0]?.[1]).toMatchObject({
      redirectTo: STAFF_INVITE_REDIRECT,
    });
    expect(db.inserted).toHaveLength(5);
    expect(db.inserted[0]).toMatchObject({
      user_id: "20000000-0000-0000-0000-000000000001",
      barber_id: roster()[0]?.barberId,
      role: "BARBER",
    });
    expect(db.inserted[4]).toMatchObject({ role: "MANAGER", barber_id: null });
    expect(JSON.stringify(db.inserted)).not.toContain("password");
  });
  it("preserves an existing account and avoids a duplicate invitation", async () => {
    const db = database(
      [{ id: "existing", email: "STAFF1@example.invalid" }],
      [{ user_id: "existing", role: "BARBER", barber_id: roster()[0]?.barberId }],
    );
    const result = await sendStaffInvitations(db, roster(), mail);
    expect(result[0]).toMatchObject({
      status: "EXISTING_IDENTITY_PRESERVED",
      userId: "existing",
      emailSent: false,
    });
    expect(db.auth.admin.inviteUserByEmail).toHaveBeenCalledTimes(4);
  });
  it("preserves ADMIN before any email or profile mutation", async () => {
    const db = database(
      [{ id: "admin", email: "staff1@example.invalid" }],
      [{ user_id: "admin", role: "ADMIN", barber_id: null }],
    );
    await expect(sendStaffInvitations(db, roster(), mail)).rejects.toThrow(/protected/);
    expect(db.auth.admin.inviteUserByEmail).not.toHaveBeenCalled();
    expect(db.inserted).toEqual([]);
  });
  it("rejects a different existing assignment rather than overwriting it", async () => {
    const db = database(
      [{ id: "existing", email: "staff1@example.invalid" }],
      [{ user_id: "existing", role: "BARBER", barber_id: roster()[1]?.barberId }],
    );
    await expect(sendStaffInvitations(db, roster(), mail)).rejects.toThrow(
      /different staff assignment/,
    );
  });
  it("reports profile recovery work without deleting an invited identity or resending blindly", async () => {
    const db = database([], [], true);
    const result = await sendStaffInvitations(db, roster(), mail);
    expect(result.every((r) => r.status === "PROFILE_PENDING" && r.emailSent)).toBe(true);
  });
  it.each([
    { ...mail, smtp_host: "" },
    { ...mail, uri_allow_list: "https://untrusted.example" },
    { ...mail, site_url: "http://localhost:3000" },
  ])("rejects unverified mail/redirect configuration", (config) => {
    expect(() => verifyInviteConfiguration(config)).toThrow();
  });
  it("rejects duplicate accounts before touching Auth", async () => {
    const rows = roster();
    rows[1]!.email = rows[0]!.email;
    const db = database();
    await expect(sendStaffInvitations(db, rows, mail)).rejects.toThrow(/Duplicate/);
    expect(db.auth.admin.listUsers).not.toHaveBeenCalled();
  });
});
