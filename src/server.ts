import { env as cloudflareEnv } from "cloudflare:workers";
import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

// h3 swallows in-handler throws into a normal 500 Response with body
// { "unhandled": true, "message": "HTTPError" } — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!isH3SwallowedErrorBody(body)) return response;

  console.error(consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`));
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function isH3SwallowedErrorBody(body: string): boolean {
  try {
    const payload = JSON.parse(body) as { unhandled?: unknown; message?: unknown };
    return payload.unhandled === true && payload.message === "HTTPError";
  } catch {
    return false;
  }
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    try {
      // Mirror bindings before importing TanStack's server entry. Some server
      // bundles read process.env during module initialization, so setting it only
      // after import can leave server functions with an empty Supabase config.
      // Preview and production are separate Worker deployments, so values remain scoped.
      // Prefer the Workers runtime module bindings as a fallback: depending on the
      // Nitro/TanStack wrapper, the second fetch argument may not expose the raw
      // binding object to this entry point.
      mirrorRuntimeBindings(env);
      mirrorRuntimeBindings((globalThis as typeof globalThis & { __env__?: unknown }).__env__);
      mirrorRuntimeBindings((request as typeof request & { runtime?: { cloudflare?: { env?: unknown } } })?.runtime?.cloudflare?.env);
      mirrorRuntimeBindings(cloudflareEnv);

      const url = new URL(request.url);
      if (url.pathname === "/api/webhook/mercadopago") {
        const { handleMercadoPagoWebhook } = await import("./lib/kani-mercadopago-webhook.server");
        return await handleMercadoPagoWebhook(request);
      }

      if (url.pathname === "/api/webhook/whatsapp") {
        if (request.method === "GET") {
          const { handleWhatsAppWebhookVerification } = await import("./lib/kani-whatsapp");
          const verifyToken =
            process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN ??
            (globalThis as typeof globalThis & {
              __KANI_RUNTIME_ENV?: Record<string, string>;
            }).__KANI_RUNTIME_ENV?.WHATSAPP_WEBHOOK_VERIFY_TOKEN;
          const verifyResponse = handleWhatsAppWebhookVerification(url, verifyToken);
          if (verifyResponse) return verifyResponse;
          return new Response("Forbidden: Invalid verification token", { status: 403 });
        }
        if (request.method === "POST") {
          try {
            const body = await request.json();
            console.log("[WhatsApp Webhook Event]:", JSON.stringify(body));
            return new Response("EVENT_RECEIVED", { status: 200 });
          } catch {
            return new Response("BAD_REQUEST", { status: 400 });
          }
        }
      }

      if (url.pathname === "/api/webhook/pontiun") {
        const { handlePontiunWebhookRequest } = await import("./lib/kani-pontiun");
        return await handlePontiunWebhookRequest(request);
      }

      if (url.pathname === "/api/admin/status-audit") {
        try {
          const { createPaymentSupabaseClient } = await import("./lib/kani-payment-db.server");
          const client = await createPaymentSupabaseClient();

          const { data: appointments, error: apptErr } = await client
            .from("appointments")
            .select("*")
            .order("created_at", { ascending: false })
            .limit(10);

          if (apptErr) {
            return new Response(JSON.stringify({ error: apptErr.message }), {
              status: 500,
              headers: { "content-type": "application/json" },
            });
          }

          const { data: orders, error: ordersErr } = await client
            .from("appointment_payment_orders")
            .select("*")
            .order("created_at", { ascending: false })
            .limit(10);

          const { data: events, error: eventsErr } = await client
            .from("appointment_notification_events")
            .select("*")
            .order("created_at", { ascending: false })
            .limit(10);

          const rows = appointments || [];
          const completedCount = rows.filter((a) => a.status === "COMPLETED").length;
          const confirmedCount = rows.filter((a) => a.status === "CONFIRMED").length;
          const pendingCount = rows.filter((a) => a.status === "PENDING").length;
          const cancelledCount = rows.filter((a) => a.status === "CANCELLED").length;

          return new Response(
            JSON.stringify({
              counts: {
                total: rows.length,
                completed: completedCount,
                confirmed: confirmedCount,
                pending: pendingCount,
                cancelled: cancelledCount,
              },
              appointments,
              orders: orders || [],
              events: events || [],
              ordersError: ordersErr?.message,
              eventsError: eventsErr?.message,
            }),
            {
              status: 200,
              headers: { "content-type": "application/json" },
            }
          );
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return new Response(JSON.stringify({ error: message }), {
            status: 500,
            headers: { "content-type": "application/json" },
          });
        }
      }

      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      return await normalizeCatastrophicSsrResponse(response);
    } catch (error) {
      console.error(error);
      return new Response(renderErrorPage(), {
        status: 500,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
  },
};

function mirrorRuntimeBindings(bindings: unknown): void {
  if (typeof bindings !== "object" || bindings === null) return;
  const values = bindings as Record<string, unknown>;
  const names = [
    "SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "SUPABASE_ANON_KEY",
    "SUPABASE_PUBLISHABLE_KEY",
    "VITE_SUPABASE_URL",
    "VITE_SUPABASE_ANON_KEY",
    "VITE_SUPABASE_PUBLISHABLE_KEY",
    "RESEND_API_KEY",
    "RESEND_FROM_EMAIL",
    "KANI_ENVIRONMENT",
    "WHATSAPP_PHONE_NUMBER_ID",
    "WHATSAPP_ACCESS_TOKEN",
    "WHATSAPP_WEBHOOK_VERIFY_TOKEN",
    "WHATSAPP_TEMPLATE_NAME",
    "MERCADOPAGO_ACCESS_TOKEN",
    "MERCADOPAGO_PUBLIC_KEY",
    "MERCADOPAGO_WEBHOOK_SECRET",
    "MERCADOPAGO_NOTIFICATION_URL",
    "KANI_APP_URL",
    "PONTIUN_API_KEY",
    "PONTIUN_WHATSAPP_PHONE_NUMBER_ID",
    "PONTIUN_PHONE_NUMBER_ID",
    "PONTIUN_PAGE_ID",
    "PONTIUN_WHATSAPP_CONFIRMATION_TEMPLATE",
    "PONTIUN_WHATSAPP_TEMPLATE_LANGUAGE",
    "PONTIUN_WEBHOOK_SECRET",
    "PONTIUN_API_BASE_URL",
    "PAYWAY_SANDBOX_ENABLED",
    "PAYWAY_ENVIRONMENT",
    "PAYWAY_API_BASE_URL",
    "PAYWAY_PUBLIC_API_KEY",
    "PAYWAY_PRIVATE_API_KEY",
    "PAYWAY_SITE_ID",
    "PAYWAY_CHECKOUT_SECRET",
    "PAYWAY_PAYMENT_METHODS",
  ];
  const runtimeValues = (globalThis as typeof globalThis & {
    __KANI_RUNTIME_ENV?: Record<string, string>;
  }).__KANI_RUNTIME_ENV ?? {};
  try {
    for (const [k, v] of Object.entries(values)) {
      if (typeof v === "string" && v.trim()) {
        process.env[k] = v.trim();
        runtimeValues[k] = v.trim();
      }
    }
  } catch {
    // If values is not iterable via Object.entries
  }
  for (const name of names) {
    const value = values[name];
    if (typeof value === "string" && value.trim()) {
      process.env[name] = value.trim();
      runtimeValues[name] = value.trim();
    }
  }
  (globalThis as typeof globalThis & {
    __KANI_RUNTIME_ENV?: Record<string, string>;
  }).__KANI_RUNTIME_ENV = runtimeValues;
}
