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
        if (request.method === "POST") {
          try {
            const { verifyMercadoPagoWebhookSignature, getMercadoPagoOrder, isOrderFullyApproved } =
              await import("./lib/kani-mercadopago");
            const webhookSecret =
              (globalThis as typeof globalThis & { __env__?: Record<string, string> }).__env__?.MERCADOPAGO_WEBHOOK_SECRET ??
              process.env.MERCADOPAGO_WEBHOOK_SECRET ??
              (globalThis as typeof globalThis & {
                __KANI_RUNTIME_ENV?: Record<string, string>;
              }).__KANI_RUNTIME_ENV?.MERCADOPAGO_WEBHOOK_SECRET;

            const xSignature = request.headers.get("x-signature");
            const xRequestId = request.headers.get("x-request-id");
            let dataId = url.searchParams.get("data.id") ?? url.searchParams.get("id");

            if (!dataId) {
              try {
                const bodyJson = (await request.clone().json()) as { data?: { id?: string }; id?: string } | null;
                dataId = bodyJson?.data?.id ?? bodyJson?.id ?? null;
              } catch {
                // Non-JSON body
              }
            }

            // Si está configurado el secreto, verificar firma HMAC-SHA256 obligatoriamente
            if (webhookSecret && webhookSecret.trim()) {
              const isValidSignature = verifyMercadoPagoWebhookSignature({
                xSignature,
                xRequestId,
                dataId,
                secret: webhookSecret,
              });
              if (!isValidSignature) {
                console.warn("[Mercado Pago Webhook] Firma inválida rechazada");
                return new Response("Invalid signature", { status: 401 });
              }
            } else {
              console.warn("[Mercado Pago Webhook] MERCADOPAGO_WEBHOOK_SECRET no configurado, omitiendo validación de firma");
            }

            // Consultar el estado real de la orden en la API si dataId existe
            const accessToken =
              (globalThis as typeof globalThis & { __env__?: Record<string, string> }).__env__?.MERCADOPAGO_ACCESS_TOKEN ??
              process.env.MERCADOPAGO_ACCESS_TOKEN ??
              (globalThis as typeof globalThis & {
                __KANI_RUNTIME_ENV?: Record<string, string>;
              }).__KANI_RUNTIME_ENV?.MERCADOPAGO_ACCESS_TOKEN;

            if (dataId && accessToken) {
              const orderResult = await getMercadoPagoOrder({
                orderId: dataId,
                accessToken,
              });

              if (orderResult.success && orderResult.order) {
                const order = orderResult.order;
                const appointmentId = order.external_reference;

                if (appointmentId && isOrderFullyApproved(order)) {
                  console.log(`[Mercado Pago Webhook] Orden ${order.id} aprobada para turno ${appointmentId}. Confirmando...`);
                  const { confirmAppointmentPayment } = await import("./lib/kani-mercadopago");
                  const confirmation = await confirmAppointmentPayment({
                    appointmentId,
                    orderId: String(order.id),
                    totalAmount: order.total_amount ? Number(order.total_amount) : undefined,
                  });
                  console.log(`[Mercado Pago Webhook] Resultado de confirmación para ${appointmentId}:`, confirmation.resultCode);
                }
              }
            }

            return new Response("OK", { status: 200 });
          } catch (err) {
            console.error("[Mercado Pago Webhook Error]:", err);
            return new Response("Internal Server Error", { status: 500 });
          }
        }
        return new Response("Method Not Allowed", { status: 405 });
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

      if (url.pathname === "/api/admin/status-audit") {
        try {
          const { supabase } = await import("./integrations/supabase/client");

          // Get counts of appointments by status
          const { data: allAppointments, error: fetchErr } = await supabase
            .from("appointments")
            .select("id, status, booking_date, start_time");

          if (fetchErr) {
            return new Response(JSON.stringify({ error: fetchErr.message }), {
              status: 500,
              headers: { "content-type": "application/json" },
            });
          }

          const rows = allAppointments || [];
          const completedCount = rows.filter((a) => a.status === "COMPLETED").length;
          const confirmedCount = rows.filter((a) => a.status === "CONFIRMED").length;
          const pendingCount = rows.filter((a) => a.status === "PENDING").length;
          const cancelledCount = rows.filter((a) => a.status === "CANCELLED").length;

          let migrated = 0;
          if (url.searchParams.get("action") === "migrate" && completedCount > 0) {
            const { data: updated, error: updateErr } = await client
              .from("appointments")
              .update({ status: "CONFIRMED" })
              .eq("status", "COMPLETED")
              .select("id");

            if (updateErr) {
              return new Response(JSON.stringify({ error: updateErr.message }), {
                status: 500,
                headers: { "content-type": "application/json" },
              });
            }
            migrated = updated?.length ?? 0;
          }

          return new Response(
            JSON.stringify({
              total: rows.length,
              completed: completedCount,
              confirmed: confirmedCount,
              pending: pendingCount,
              cancelled: cancelledCount,
              migrated,
            }),
            {
              status: 200,
              headers: { "content-type": "application/json" },
            }
          );
        } catch (err: unknown) {
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
