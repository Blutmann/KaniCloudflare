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

export function getCanonicalRedirectUrl(
  rawUrl: string,
  canonicalHost = "kanibarber.com",
): string | null {
  try {
    const url = new URL(rawUrl);
    // Both hosts belong to this application. A www-only Pages gateway can be
    // used while the registrar does not allow changing the apex nameservers.
    const hosts = ["kanibarber.com", "www.kanibarber.com"];
    const configuredHost = canonicalHost.trim().toLowerCase();
    const targetHost = hosts.includes(configuredHost) ? configuredHost : "kanibarber.com";
    if (hosts.includes(url.hostname.toLowerCase()) && url.hostname.toLowerCase() !== targetHost) {
      url.hostname = targetHost;
      url.port = "";
      url.protocol = "https:";
      return url.toString();
    }
    return null;
  } catch {
    return null;
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

      const canonicalRedirect = getCanonicalRedirectUrl(request.url, process.env.KANI_CANONICAL_HOST);
      if (canonicalRedirect) {
        return Response.redirect(canonicalRedirect, 301);
      }

      const url = new URL(request.url);
      if (url.pathname === "/googleb98699670c2c80a6.html") {
        return new Response("google-site-verification: googleb98699670c2c80a6.html", {
          status: 200,
          headers: {
            "content-type": "text/html; charset=utf-8",
            "cache-control": "public, max-age=3600",
          },
        });
      }

      if (url.pathname === "/api/calendar/turno.ics" || url.pathname === "/api/calendar/turno") {
        const { handleTurnoIcsRequest } = await import("./lib/kani-calendar-ics");
        return handleTurnoIcsRequest(request);
      }

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

      if (url.pathname.startsWith("/api/admin/calendar-sync/")) {
        const { authenticateAdminRequest } = await import("./lib/kani-google-calendar-oauth.server");
        const auth = await authenticateAdminRequest(request);
        if (!auth.authorized) {
          return new Response(
            JSON.stringify({
              error: auth.error || "AUTH_REQUIRED: Se requieren permisos de Administrador.",
            }),
            {
              status: 403,
              headers: { "content-type": "application/json" },
            }
          );
        }
      }

      if (url.pathname === "/api/admin/calendar-sync/status") {
        try {
          const { getGoogleCalendarAuthConfig } = await import("./lib/kani-google-calendar-auth");
          const config = getGoogleCalendarAuthConfig();
          return new Response(
            JSON.stringify({
              enabled: config.enabled,
              strategy: config.strategy,
              hasServiceAccountEmail: Boolean(config.serviceAccountEmail),
              hasServiceAccountPrivateKey: Boolean(config.serviceAccountPrivateKey),
              hasOAuthClientId: Boolean(config.clientId),
              hasOAuthClientSecret: Boolean(config.clientSecret),
              hasOAuthRefreshToken: Boolean(config.refreshToken),
              hasSupabaseServiceRoleKey: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
              environment: "Cloudflare Preview/Test",
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

      if (url.pathname === "/api/admin/calendar-sync/associate") {
        try {
          const { syncBarberCalendarAssociations, purgeStaleSyncItems } = await import("./lib/kani-google-calendar-sync");
          const assocResult = await syncBarberCalendarAssociations();
          const purgeResult = await purgeStaleSyncItems();
          return new Response(
            JSON.stringify({
              success: assocResult.success,
              associations: assocResult.associations,
              errors: assocResult.errors,
              purgedStaleItems: purgeResult.staleItemsCount,
            }),
            { status: 200, headers: { "content-type": "application/json" } }
          );
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return new Response(JSON.stringify({ error: message }), {
            status: 500,
            headers: { "content-type": "application/json" },
          });
        }
      }

      if (url.pathname === "/api/admin/calendar-sync/verify-all") {
        try {
          const { verifyAllBarberCalendars } = await import("./lib/kani-google-calendar-sync");
          const verifyResult = await verifyAllBarberCalendars();
          return new Response(JSON.stringify(verifyResult), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return new Response(JSON.stringify({ error: message }), {
            status: 500,
            headers: { "content-type": "application/json" },
          });
        }
      }

      if (url.pathname === "/api/admin/calendar-sync/process") {
        try {
          const { processCalendarSyncQueue } = await import("./lib/kani-google-calendar-sync");
          const { getGoogleCalendarAuthConfig } = await import("./lib/kani-google-calendar-auth");
          const config = getGoogleCalendarAuthConfig();
          const limit = Number(url.searchParams.get("limit") || 10);
          const requestedForce = url.searchParams.get("force") === "true";

          // Protección de ejecución manual: si la sincronización automática está deshabilitada,
          // no se permite saltarse la protección con un simple force=true.
          // Requiere obligatoriamente la cabecera de confirmación explícita del ADMIN.
          const adminManualConfirm = request.headers.get("x-admin-confirm-manual-sync") === "true";
          if (!config.enabled && requestedForce && !adminManualConfirm) {
            return new Response(
              JSON.stringify({
                error: "MANUAL_CONFIRMATION_REQUIRED",
                message:
                  "La sincronización automática está desactivada (GOOGLE_CALENDAR_SYNC_ENABLED=false). Para ejecutar el procesamiento manual se requiere confirmación explícita del administrador (cabecera x-admin-confirm-manual-sync: true).",
              }),
              {
                status: 403,
                headers: { "content-type": "application/json" },
              }
            );
          }

          const allowForce = requestedForce && (config.enabled || adminManualConfirm);
          const result = await processCalendarSyncQueue({ force: allowForce, limit });
          return new Response(JSON.stringify(result), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return new Response(JSON.stringify({ error: message }), {
            status: 500,
            headers: { "content-type": "application/json" },
          });
        }
      }

      if (url.pathname === "/api/admin/calendar-sync/audit") {
        try {
          const { runGoogleCalendarControlledAudit, resolveBarberCalendarId } = await import("./lib/kani-google-calendar-sync");
          const barber = url.searchParams.get("barber") || "Franco";
          let calendarId = url.searchParams.get("calendarId");
          if (!calendarId && barber) {
            calendarId = await resolveBarberCalendarId(barber);
          }
          if (!calendarId) {
            return new Response(JSON.stringify({
              error: "CALENDAR_ID_NOT_CONFIGURED",
              message: `No se encontró el ID de calendario para el barbero ${barber}. Verifique que la variable GOOGLE_CALENDAR_${barber.toUpperCase()}_ID esté configurada en Cloudflare.`
            }), {
              status: 400,
              headers: { "content-type": "application/json" },
            });
          }
          const result = await runGoogleCalendarControlledAudit(calendarId, undefined, barber);
          return new Response(JSON.stringify(result), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return new Response(JSON.stringify({ error: message }), {
            status: 500,
            headers: { "content-type": "application/json" },
          });
        }
      }

      if (url.pathname === "/api/integrations/google-calendar/authorize") {
        const { handleGoogleCalendarAuthorize } = await import("./lib/kani-google-calendar-oauth.server");
        return await handleGoogleCalendarAuthorize(request);
      }

      if (url.pathname === "/api/integrations/google-calendar/callback") {
        const { handleGoogleCalendarCallback } = await import("./lib/kani-google-calendar-oauth.server");
        return await handleGoogleCalendarCallback(request);
      }

      if (url.pathname === "/api/integrations/google-calendar/status") {
        const { handleGoogleCalendarIntegrationStatus } = await import("./lib/kani-google-calendar-oauth.server");
        return await handleGoogleCalendarIntegrationStatus(request);
      }

      if (url.pathname === "/api/integrations/google-calendar/test-cycle") {
        const { handleGoogleCalendarTestCycle } = await import("./lib/kani-google-calendar-oauth.server");
        return await handleGoogleCalendarTestCycle(request);
      }

      if (url.pathname === "/api/admin/notification-audit") {
        try {
          const { getPontiunRuntimeEnv } = await import("./lib/kani-pontiun");
          const pontiunKey = getPontiunRuntimeEnv("PONTIUN_API_KEY");
          const phoneId = getPontiunRuntimeEnv("PONTIUN_PHONE_NUMBER_ID");
          const tName = getPontiunRuntimeEnv("PONTIUN_TEMPLATE_NAME");
          const tLang = getPontiunRuntimeEnv("PONTIUN_TEMPLATE_LANGUAGE");
          const resendKey = process.env.RESEND_API_KEY;

          return new Response(
            JSON.stringify({
              pontiun: {
                hasApiKey: Boolean(pontiunKey),
                apiKeyPrefix: pontiunKey ? `${pontiunKey.slice(0, 4)}...${pontiunKey.slice(-4)}` : null,
                phoneNumberId: phoneId || null,
                templateName: tName || null,
                templateLanguage: tLang || null,
              },
              resend: {
                hasApiKey: Boolean(resendKey),
              },
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

      try {
        const { processCalendarSyncQueue } = await import("./lib/kani-google-calendar-sync");
        const syncResult = await processCalendarSyncQueue();
        if (syncResult && syncResult.processed > 0) {
          console.log("[Cron Scheduled Calendar Sync]:", JSON.stringify(syncResult));
        }
      } catch (err) {
        console.error("[Cron Scheduled Calendar Sync Error]:", err);
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
    "KANI_CANONICAL_HOST",
    "APP_URL",
    "PUBLIC_URL",
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
    "PAYWAY_PRODUCTION_ENABLED",
    "PAYWAY_ENVIRONMENT",
    "PAYWAY_API_BASE_URL",
    "PAYWAY_PUBLIC_API_KEY",
    "PAYWAY_PRIVATE_API_KEY",
    "PAYWAY_SITE_ID",
    "PAYWAY_CHECKOUT_SECRET",
    "PAYWAY_PAYMENT_METHODS",
    "GOOGLE_CLIENT_ID",
    "GOOGLE_CLIENT_SECRET",
    "GOOGLE_OAUTH_CLIENT_ID",
    "GOOGLE_OAUTH_CLIENT_SECRET",
    "VITE_GOOGLE_CLIENT_ID",
    "VITE_GOOGLE_CLIENT_SECRET",
    "GOOGLE_OAUTH_REDIRECT_URI",
    "GOOGLE_REFRESH_TOKEN",
    "GOOGLE_CALENDAR_SYNC_ENABLED",
    "GOOGLE_SERVICE_ACCOUNT_EMAIL",
    "GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY",
    "GOOGLE_CALENDAR_ID_LAUTARO",
    "GOOGLE_CALENDAR_ID_GONZALO",
    "GOOGLE_CALENDAR_ID_VALENTIN",
    "GOOGLE_CALENDAR_ID_FRANCO",
    "CALENDAR_ID_LAUTARO",
    "CALENDAR_ID_GONZALO",
    "CALENDAR_ID_VALENTIN",
    "CALENDAR_ID_FRANCO",
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
    const value = values[name] ?? values[name.toLowerCase()];
    if (typeof value === "string" && value.trim()) {
      process.env[name] = value.trim();
      runtimeValues[name] = value.trim();
      if (name === "GOOGLE_OAUTH_CLIENT_ID" || name === "VITE_GOOGLE_CLIENT_ID") {
        process.env["GOOGLE_CLIENT_ID"] = value.trim();
        runtimeValues["GOOGLE_CLIENT_ID"] = value.trim();
      }
      if (name === "GOOGLE_OAUTH_CLIENT_SECRET" || name === "VITE_GOOGLE_CLIENT_SECRET") {
        process.env["GOOGLE_CLIENT_SECRET"] = value.trim();
        runtimeValues["GOOGLE_CLIENT_SECRET"] = value.trim();
      }
    }
  }
  (globalThis as typeof globalThis & {
    __KANI_RUNTIME_ENV?: Record<string, string>;
  }).__KANI_RUNTIME_ENV = runtimeValues;
}
