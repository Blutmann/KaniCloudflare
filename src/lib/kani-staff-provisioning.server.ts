// Trusted operator code. Never import this module or privileged credentials into browser code.
export type StaffInvite = {
  name: string;
  email: string;
  role: "BARBER" | "MANAGER";
  barberId: string | null;
};
export const STAFF_INVITE_REDIRECT = "https://www.kanibarber.com/activar-cuenta";

export function validateStaffRoster(rows: StaffInvite[]) {
  if (
    rows.length !== 5 ||
    rows.filter((r) => r.role === "BARBER").length !== 4 ||
    rows.filter((r) => r.role === "MANAGER").length !== 1
  )
    throw new Error("Expected four BARBER accounts and one MANAGER");
  const emails = new Set<string>();
  const barbers = new Set<string>();
  for (const row of rows) {
    if (!row.name?.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email ?? ""))
      throw new Error("Invalid roster entry");
    const email = row.email.trim().toLowerCase();
    if (emails.has(email)) throw new Error("Duplicate roster email");
    emails.add(email);
    if (row.role === "BARBER") {
      if (!row.barberId || !/^[0-9a-f-]{36}$/i.test(row.barberId) || barbers.has(row.barberId))
        throw new Error("A unique permanent barber ID is required");
      barbers.add(row.barberId);
    } else if (row.role !== "MANAGER" || row.barberId !== null)
      throw new Error("Invalid staff role or manager scope");
  }
}

export function verifyInviteConfiguration(config: Record<string, unknown>) {
  const siteUrl = String(config["site_url"] ?? "").replace(/\/$/, "");
  const redirects = String(config["uri_allow_list"] ?? "")
    .split(",")
    .map((v) => v.trim());
  if (siteUrl !== "https://www.kanibarber.com" || !redirects.includes(STAFF_INVITE_REDIRECT))
    throw new Error("Auth must use the canonical Site URL and explicitly allow the activation URL");
  if (
    !config["smtp_host"] ||
    !config["smtp_user"] ||
    !config["smtp_admin_email"] ||
    config["external_email_enabled"] === false
  )
    throw new Error("Verified custom SMTP is required before sending five invitations");
}

export async function planStaffInvitations(db: any, rows: StaffInvite[]) {
  validateStaffRoster(rows);
  const { data: barbers, error: barberError } = await db.from("barbers").select("id,active");
  if (barberError) throw new Error("Cannot verify existing barbers");
  for (const row of rows)
    if (row.role === "BARBER" && !barbers.some((b: any) => b.id === row.barberId && b.active))
      throw new Error("Roster refers to an unavailable barber");
  // A read-only capability check before any Auth email is sent.
  const schema = await db
    .from("service_payments")
    .select("discount_kind,final_amount_override_ars,voided_at")
    .limit(0);
  const relations = await db.from("client_barbers").select("client_id").limit(0);
  if (schema.error || relations.error)
    throw new Error("Complete and verify the staff migrations before provisioning");
  const users: any[] = [];
  for (let page = 1; page <= 100; page++) {
    const result = await db.auth.admin.listUsers({ page, perPage: 1000 });
    if (result.error) throw new Error("Cannot inspect Auth accounts");
    users.push(...result.data.users);
    if (result.data.users.length < 1000) break;
    if (page === 100) throw new Error("Auth inventory exceeded verification limit");
  }
  const { data: profiles, error } = await db
    .from("staff_profiles")
    .select("user_id,role,barber_id");
  if (error) throw new Error("Cannot inspect existing profiles");
  return rows.map((row) => {
    const user = users.find(
      (u) => u.email?.trim().toLowerCase() === row.email.trim().toLowerCase(),
    );
    const profile = profiles.find((p: any) => p.user_id === user?.id);
    if (
      profile &&
      (profile.role === "ADMIN" || profile.role !== row.role || profile.barber_id !== row.barberId)
    )
      throw new Error("An existing identity has a protected or different staff assignment");
    return { row, userId: user?.id as string | undefined, profileExists: Boolean(profile) };
  });
}

export async function sendStaffInvitations(
  db: any,
  rows: StaffInvite[],
  config: Record<string, unknown>,
) {
  verifyInviteConfiguration(config);
  const plan = await planStaffInvitations(db, rows);
  const outcomes: Array<{ name: string; status: string; emailSent: boolean; userId?: string }> = [];
  for (const item of plan) {
    let userId = item.userId;
    let emailSent = false;
    if (!userId) {
      const { data, error } = await db.auth.admin.inviteUserByEmail(
        item.row.email.trim().toLowerCase(),
        { redirectTo: STAFF_INVITE_REDIRECT, data: { display_name: item.row.name } },
      );
      if (error || !data.user?.id) {
        outcomes.push({ name: item.row.name, status: "INVITATION_FAILED", emailSent: false });
        continue;
      }
      userId = data.user.id;
      emailSent = true;
    }
    if (!item.profileExists) {
      const { error } = await db
        .from("staff_profiles")
        .insert({
          user_id: userId,
          role: item.row.role,
          barber_id: item.row.barberId,
          display_name: item.row.name,
          active: true,
        });
      if (error) {
        outcomes.push({
          name: item.row.name,
          status: "PROFILE_PENDING",
          emailSent,
          ...(userId ? { userId } : {}),
        });
        continue;
      }
    }
    outcomes.push({
      name: item.row.name,
      status: emailSent ? "INVITED" : "EXISTING_IDENTITY_PRESERVED",
      emailSent,
      ...(userId ? { userId } : {}),
    });
  }
  return outcomes;
}
