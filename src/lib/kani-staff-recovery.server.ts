import { createClient } from "@supabase/supabase-js";
import {
  DEFAULT_SUPABASE_URL,
  DEFAULT_SUPABASE_PUBLIC_KEY,
  createSupabaseFetch,
} from "../integrations/supabase/public-config";
import { createPaymentSupabaseClient } from "./kani-payment-db.server";
import { getRuntimeEnv } from "./kani-mercadopago.server";
import {
  STAFF_RECOVERY_MESSAGE,
  STAFF_RECOVERY_URL,
  STAFF_RECOVERY_MIN_PASSWORD,
  isStaffRecoveryToken,
} from "./kani-staff-recovery";

type Dependencies = { db: any; auth: () => any; pepper: string };
type Context = { waitUntil?: (task: Promise<unknown>) => void };
const headers = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
};
const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers });
const generic = () => response({ message: STAFF_RECOVERY_MESSAGE });

async function dependencies(): Promise<Dependencies> {
  const url =
    getRuntimeEnv("SUPABASE_URL") ||
    getRuntimeEnv("VITE_SUPABASE_URL") ||
    import.meta.env["VITE_SUPABASE_URL"] ||
    DEFAULT_SUPABASE_URL;
  // This public key is already supplied at build time by the existing Vite integration.
  // Production does not bind it as a separate Worker variable. Never fall back to the service key here.
  const key =
    getRuntimeEnv("SUPABASE_ANON_KEY") ||
    getRuntimeEnv("SUPABASE_PUBLISHABLE_KEY") ||
    getRuntimeEnv("VITE_SUPABASE_ANON_KEY") ||
    getRuntimeEnv("VITE_SUPABASE_PUBLISHABLE_KEY") ||
    import.meta.env["VITE_SUPABASE_ANON_KEY"] ||
    import.meta.env["VITE_SUPABASE_PUBLISHABLE_KEY"] ||
    DEFAULT_SUPABASE_PUBLIC_KEY;
  const pepper = getRuntimeEnv("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key || !pepper) throw new Error("RECOVERY_CONFIGURATION_MISSING");
  return {
    db: await createPaymentSupabaseClient(),
    pepper,
    auth: () =>
      createClient(url, key, {
        global: { fetch: createSupabaseFetch(key) },
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      }),
  };
}
async function digest(value: string, pepper: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(pepper),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const result = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`kani-staff-recovery:${value}`),
  );
  return [...new Uint8Array(result)].map((x) => x.toString(16).padStart(2, "0")).join("");
}
async function readBody(request: Request): Promise<Record<string, unknown>> {
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    throw new Error("INVALID_BODY");
  const reader = request.body?.getReader();
  if (!reader) throw new Error("INVALID_BODY");
  let length = 0,
    text = "";
  const decoder = new TextDecoder();
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    length += part.value.byteLength;
    if (length > 12000) {
      await reader.cancel();
      throw new Error("INVALID_BODY");
    }
    text += decoder.decode(part.value, { stream: true });
  }
  const data = JSON.parse(text + decoder.decode());
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("INVALID_BODY");
  return data;
}
function allowed(request: Request) {
  return (
    request.method === "POST" && request.headers.get("origin") === "https://www.kanibarber.com"
  );
}
async function consume(
  deps: Dependencies,
  request: Request,
  kind: string,
  subject: string,
  email: string | null,
) {
  // Cloudflare overwrites this header at the edge. Never trust X-Forwarded-For or a body field.
  const ip = request.headers.get("cf-connecting-ip") || "unknown";
  const [ipKey, subjectKey] = await Promise.all([
    digest(`ip:${ip}`, deps.pepper),
    digest(`${kind}:${subject}`, deps.pepper),
  ]);
  const { data, error } = await deps.db.rpc("consume_staff_recovery", {
    p_kind: kind,
    p_ip_key: ipKey,
    p_subject_key: subjectKey,
    p_email: email,
  });
  if (error) throw new Error("RECOVERY_GUARD_UNAVAILABLE");
  return data as string | null;
}

export async function handleStaffRecoveryRequest(
  request: Request,
  context?: Context,
  depsOverride?: Dependencies,
) {
  if (!allowed(request)) return generic();
  try {
    const body = await readBody(request),
      email = typeof body["email"] === "string" ? body["email"].trim().toLowerCase() : "";
    if (body["website"] || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      return generic();
    const deps = depsOverride || (await dependencies());
    const id = await consume(deps, request, "REQUEST", email, email);
    // The public response waits only for the uniform enqueue, never an account lookup or SMTP send.
    // Without a request execution context, the existing one-minute cron processes the durable queue.
    if (id && context?.waitUntil) context.waitUntil(dispatchStaffRecoveryEmails(deps));
  } catch {
    /* Same response for invalid accounts, limits, unavailable providers and malformed inputs. */
  }
  return generic();
}

export async function dispatchStaffRecoveryEmails(depsOverride?: Dependencies) {
  const result = { processed: 0, accepted: 0, suppressed: 0, failed: 0 };
  try {
    const deps = depsOverride || (await dependencies());
    const { data: jobs, error } = await deps.db.rpc("claim_staff_recoveries", { p_limit: 5 });
    if (error) throw new Error("RECOVERY_QUEUE_UNAVAILABLE");
    for (const job of jobs || []) {
      result.processed++;
      let status = "FAILED";
      try {
        const { data: identity, error: lookupError } = await deps.db.rpc(
          "staff_recovery_identity",
          { p_email: job.recipient_email, p_user_id: null },
        );
        if (lookupError) throw new Error("RECOVERY_LOOKUP_FAILED");
        if (!identity?.id || !identity?.email) {
          status = "SUPPRESSED";
          result.suppressed++;
        } else {
          const { error: sendError } = await deps
            .auth()
            .auth.resetPasswordForEmail(identity.email, { redirectTo: STAFF_RECOVERY_URL });
          if (sendError) throw new Error("RECOVERY_SEND_FAILED");
          status = "ACCEPTED";
          result.accepted++;
        }
      } catch {
        result.failed++;
      }
      // A claimed send is not retried: the provider has no idempotency key for recovery mail.
      const { error: finishError } = await deps.db.rpc("finish_staff_recovery", {
        p_id: job.job_id,
        p_status: status,
      });
      if (finishError) console.warn("[Staff recovery] Dispatch receipt unavailable");
    }
  } catch {
    console.warn("[Staff recovery] Queue temporarily unavailable");
  }
  return result;
}

export async function handleStaffPasswordReset(request: Request, depsOverride?: Dependencies) {
  if (!allowed(request)) return response({ ok: false, code: "INVALID_LINK" });
  try {
    const body = await readBody(request);
    const token = typeof body["tokenHash"] === "string" ? body["tokenHash"] : "";
    const password = typeof body["password"] === "string" ? body["password"] : "";
    if (!isStaffRecoveryToken(token)) return response({ ok: false, code: "INVALID_LINK" });
    if (
      password.length < STAFF_RECOVERY_MIN_PASSWORD ||
      password.length > 1024 ||
      password !== body["confirmation"]
    )
      return response({ ok: false, code: "PASSWORD_POLICY" });
    const deps = depsOverride || (await dependencies());
    if (!(await consume(deps, request, "COMPLETE", token, null)))
      return response({ ok: false, code: "TRY_LATER" });
    // A dedicated, non-persistent Auth client can never fall back to a browser's existing staff session.
    const client = deps.auth();
    const { data: verified, error: verifyError } = await client.auth.verifyOtp({
      token_hash: token,
      type: "recovery",
    });
    if (verifyError || !verified?.user?.id || !verified?.session?.access_token)
      return response({ ok: false, code: "INVALID_LINK" });
    const { data: identity, error: lookupError } = await deps.db.rpc("staff_recovery_identity", {
      p_email: null,
      p_user_id: verified.user.id,
    });
    if (lookupError || identity?.id !== verified.user.id) {
      await client.auth.signOut({ scope: "local" });
      return response({ ok: false, code: "INVALID_LINK" });
    }
    const { error: updateError } = await client.auth.updateUser({ password });
    if (updateError) {
      await client.auth.signOut({ scope: "local" });
      return response({ ok: false, code: "PASSWORD_POLICY_NEW_LINK" });
    }
    const { error: signOutError } = await client.auth.signOut({ scope: "global" });
    if (signOutError) {
      const { error: adminError } = await deps.db.auth.admin.signOut(
        verified.session.access_token,
        "global",
      );
      if (adminError) return response({ ok: false, passwordSaved: true, code: "SESSIONS_PENDING" });
    }
    return response({ ok: true });
  } catch {
    return response({ ok: false, code: "TRY_LATER" });
  }
}
