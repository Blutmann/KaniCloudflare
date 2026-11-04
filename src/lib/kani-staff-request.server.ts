import { createRequestSupabaseClient } from "./kani-notifications.server";
import { validStaffScope } from "./kani-permissions";

export function requestStaffToken(request: Request): string | undefined {
  const header = request.headers.get("authorization");
  if (header?.startsWith("Bearer ")) return header.slice(7).trim() || undefined;
  const match = request.headers.get("cookie")?.match(/(?:^|;\s*)sb-access-token=([^;]+)/);
  try {
    return match?.[1] ? decodeURIComponent(match[1]) : undefined;
  } catch {
    return undefined;
  }
}

/** Always verify Auth and the persisted profile; never trust role claims or request IDs. */
export async function authenticateStaffRequest(request: Request, clientOverride?: any) {
  const token = requestStaffToken(request);
  if (!token) return { ok: false as const, status: 401, error: "AUTH_REQUIRED" };
  const db = clientOverride ?? (await createRequestSupabaseClient(token));
  const {
    data: { user },
    error,
  } = await db.auth.getUser(token);
  if (error || !user) return { ok: false as const, status: 401, error: "SESSION_INVALID" };
  const { data: profile, error: profileError } = await db
    .from("staff_profiles")
    .select("user_id,role,barber_id,active,display_name")
    .eq("user_id", user.id)
    .maybeSingle();
  if (profileError || !profile?.active || !validStaffScope(profile))
    return { ok: false as const, status: 403, error: "STAFF_REQUIRED" };
  return { ok: true as const, token, user, profile };
}
