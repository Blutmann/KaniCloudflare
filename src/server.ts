import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";

async function getCloudflareEnv(): Promise<unknown> {
  try {
    // cloudflare:workers is a Cloudflare Workers runtime built-in
    const specifier = "cloudflare:workers";
    const mod = (await import(/* @vite-ignore */ specifier)) as { env?: unknown };
    return mod.env;
  } catch {
    return undefined;
  }
}

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
      mirrorRuntimeBindings(await getCloudflareEnv());

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

      if (url.pathname === "/api/admin/online-deposits") {
        try {
          const barberId = url.searchParams.get("barberId") || undefined;
          const date = url.searchParams.get("date") || undefined;
          const startDate = url.searchParams.get("startDate") || undefined;
          const endDate = url.searchParams.get("endDate") || undefined;
          const serviceName = url.searchParams.get("serviceName") || undefined;

          const { readOnlineDepositMovementsServer } = await import("./lib/kani-online-deposits.server");
          const movements = await readOnlineDepositMovementsServer({
            barberId,
            date,
            startDate,
            endDate,
            serviceName,
          });

          return new Response(JSON.stringify(movements), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        } catch (err) {
          return new Response(JSON.stringify({ error: err instanceof Error ? err.message : "Error" }), {
            status: 500,
            headers: { "content-type": "application/json" },
          });
        }
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

          const { data: attempts, error: attemptsErr } = await client
            .from("payment_attempts")
            .select("id, appointment_id, site_transaction_id, provider_transaction_id, amount_ars, state, provider_status, provider_code, created_at, updated_at")
            .order("created_at", { ascending: false })
            .limit(10);

          const { data: rpcMovements, error: rpcMovementsErr } = await (client as any)
            .rpc("get_online_deposit_movements", {});

          const { data: apptsWithDeposit, error: apptsWithDepositErr } = await client
            .from("appointments")
            .select("id, barber_id, service_id, client_id, booking_client_name, deposit_paid, deposit_amount_ars, booking_date, start_time, created_at, status")
            .eq("deposit_paid", true)
            .limit(10);

          const { data: approvedAttempts, error: approvedAttemptsErr } = await client
            .from("payment_attempts")
            .select("*")
            .eq("state", "APPROVED")
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
              attempts: attempts || [],
              rpcMovements: rpcMovements || [],
              rpcMovementsError: rpcMovementsErr ? { message: rpcMovementsErr.message, code: rpcMovementsErr.code } : null,
              apptsWithDeposit: apptsWithDeposit || [],
              apptsWithDepositError: apptsWithDepositErr?.message,
              approvedAttempts: approvedAttempts || [],
              approvedAttemptsError: approvedAttemptsErr?.message,
              ordersError: ordersErr?.message,
              eventsError: eventsErr?.message,
              attemptsError: attemptsErr?.message,
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

      if (url.pathname === "/api/admin/payway-diagnostics") {
        try {
          const { getRecentPaywayDiagnostics } = await import("./lib/kani-payway.server");
          return new Response(
            JSON.stringify({ diagnostics: getRecentPaywayDiagnostics() }),
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

      if (url.pathname === "/api/admin/trigger-maintenance") {
        try {
          const { reconcilePendingPayments } = await import("./lib/kani-payment-maintenance.server");
          await reconcilePendingPayments();
          return new Response(
            JSON.stringify({ success: true, executed_at: new Date().toISOString() }),
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

      if (url.pathname === "/api/admin/payway-verification") {
        try {
          const { createPaymentSupabaseClient } = await import("./lib/kani-payment-db.server");
          const { readPaywayConfig } = await import("./lib/kani-payway.server");
          const { getRuntimeEnv } = await import("./lib/kani-mercadopago.server");

          const client = await createPaymentSupabaseClient();
          const paywayConfig = readPaywayConfig(getRuntimeEnv);

          // 1. Supabase live migration verification probe
          let migrationStatus: { applied: boolean; detail: string; error?: string };
          const testAttemptId = crypto.randomUUID();
          let probeApptId: string | null = null;
          try {
            const { data: barber } = await client.from("barbers").select("id").eq("active", true).limit(1).single();
            const { data: service } = await client.from("services").select("id").eq("active", true).limit(1).single();
            const { data: clientUser } = await client.from("clients").select("id").limit(1).single();

            const { data: apptObj, error: apptErr } = await client.from("appointments").insert({
              barber_id: barber?.id,
              service_id: service?.id,
              client_id: clientUser?.id,
              booking_date: "2026-11-10",
              start_time: "10:00:00",
              end_time: "10:45:00",
              status: "PENDING",
              notes: "__MIGRATION_AUDIT_PROBE__"
            }).select("id").single();

            if (apptErr || !apptObj) {
              migrationStatus = { applied: false, detail: "Could not create probe appointment: " + (apptErr?.message ?? "empty") };
            } else {
              probeApptId = apptObj.id;
              const { error: insErr } = await client.from("payment_attempts").insert({
                id: testAttemptId,
                appointment_id: probeApptId,
                provider: "PAYWAY",
                site_transaction_id: "KANI" + testAttemptId.replace(/-/g, "").slice(0, 32),
                amount_ars: 5000,
                amount_minor_units: 500000,
                currency: "ARS",
                state: "PROCESSING"
              });

              if (insErr) {
                migrationStatus = { applied: false, detail: "Could not insert PROCESSING attempt: " + insErr.message };
              } else {
                const { error: unkErr } = await client.from("payment_attempts").update({ state: "UNKNOWN" }).eq("id", testAttemptId);
                if (unkErr) {
                  migrationStatus = { applied: false, detail: "Could not transition to UNKNOWN: " + unkErr.message };
                } else {
                  const { error: settleErr } = await (client as any).rpc("settle_payway_attempt", {
                    p_attempt_id: testAttemptId,
                    p_state: "REJECTED",
                    p_provider_id: null,
                    p_provider_status: "rejected",
                    p_provider_code: "probe_audit"
                  });

                  if (!settleErr) {
                    migrationStatus = {
                      applied: true,
                      detail: "settle_payway_attempt successfully transitioned UNKNOWN to REJECTED. Both guard_payment_attempt_transition and settle_payway_attempt are active in Supabase!"
                    };
                  } else {
                    migrationStatus = {
                      applied: false,
                      detail: "settle_payway_attempt failed: " + settleErr.message,
                      error: settleErr.message
                    };
                  }
                }
              }
            }
          } catch (probeErr) {
            migrationStatus = {
              applied: false,
              detail: "Exception during migration audit probe: " + (probeErr instanceof Error ? probeErr.message : String(probeErr))
            };
          } finally {
            try {
              await client.from("payment_attempts").delete().eq("id", testAttemptId);
              if (probeApptId) {
                await client.from("appointments").delete().eq("id", probeApptId);
              }
            } catch {}
          }

          // 2. Real Payway sandbox API request probe
          let paywaySandboxProbe: {
            success: boolean;
            realRequestExecuted: boolean;
            endpointQueried?: string;
            httpStatus?: number;
            responseHeaders?: Record<string, string>;
            responseBody?: unknown;
            error?: string;
          };

          if (paywayConfig) {
            try {
              const siteTx = "KANIed619d348de44b2aa2aa70fbacd5ab58";
              const targetUrl = `${paywayConfig.apiBaseUrl}/payments?siteOperationId=${encodeURIComponent(siteTx)}`;
              const resp = await fetch(targetUrl, {
                method: "GET",
                headers: { apikey: paywayConfig.privateKey, "Cache-Control": "no-cache" }
              });
              const json = await resp.json().catch(() => null);
              const headersObj: Record<string, string> = {};
              resp.headers.forEach((v, k) => { headersObj[k] = v; });

              paywaySandboxProbe = {
                success: resp.ok,
                realRequestExecuted: true,
                endpointQueried: targetUrl,
                httpStatus: resp.status,
                responseHeaders: headersObj,
                responseBody: json
              };
            } catch (pErr) {
              paywaySandboxProbe = {
                success: false,
                realRequestExecuted: true,
                error: pErr instanceof Error ? pErr.message : String(pErr)
              };
            }
          } else {
            paywaySandboxProbe = {
              success: false,
              realRequestExecuted: false,
              error: "PAYWAY_CONFIG_MISSING"
            };
          }

          return new Response(
            JSON.stringify({
              migrationStatus,
              paywaySandboxProbe,
              timestamp: new Date().toISOString()
            }),
            {
              status: 200,
              headers: { "content-type": "application/json" }
            }
          );
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return new Response(JSON.stringify({ error: message }), {
            status: 500,
            headers: { "content-type": "application/json" }
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
  async scheduled(event: unknown, env: unknown, ctx: unknown) {
    mirrorRuntimeBindings(env);
    mirrorRuntimeBindings((globalThis as typeof globalThis & { __env__?: unknown }).__env__);
    mirrorRuntimeBindings(await getCloudflareEnv());

    const run = async () => {
      try {
        const { reconcilePendingPayments } = await import("./lib/kani-payment-maintenance.server");
        await reconcilePendingPayments();
      } catch (err) {
        console.error("[Cron Scheduled Maintenance Error]:", err);
      }
    };

    const task = run();
    if (ctx && typeof (ctx as { waitUntil?: (p: Promise<unknown>) => void }).waitUntil === "function") {
      (ctx as { waitUntil: (p: Promise<unknown>) => void }).waitUntil(task);
    }
    await task;
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
    "PONTIUN_WABA_ID",
    "PONTIUN_PAGE_ID",
    "PONTIUN_TEMPLATE_NAME",
    "PONTIUN_TEMPLATE_LANGUAGE",
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
