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
      if (url.pathname === "/estudio" || url.pathname === "/estudio/") {
        url.pathname = "/contacto";
        return Response.redirect(url.toString(), 301);
      }
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

      if (url.pathname === "/api/webhook/resend") {
        if (request.method !== "POST") {
          return new Response(JSON.stringify({ error: "METHOD_NOT_ALLOWED" }), { status: 405 });
        }
        try {
          const rawBody = await request.text();
          const svixId = request.headers.get("svix-id");
          const svixTimestamp = request.headers.get("svix-timestamp");
          const svixSignature = request.headers.get("svix-signature");

          const webhookSecret =
            process.env.RESEND_WEBHOOK_SECRET ??
            (globalThis as typeof globalThis & {
              __KANI_RUNTIME_ENV?: Record<string, string>;
            }).__KANI_RUNTIME_ENV?.RESEND_WEBHOOK_SECRET;

          if (!webhookSecret || !webhookSecret.trim()) {
            console.error("[Resend Webhook] Rechazado: RESEND_WEBHOOK_SECRET no configurado en el servidor.");
            return new Response(
              JSON.stringify({
                error: "WEBHOOK_SECRET_MISSING",
                message: "Webhook secret is not configured on the server",
              }),
              { status: 500, headers: { "content-type": "application/json" } }
            );
          }

          const { verifyResendWebhookSignature, isResendEventDuplicate } = await import(
            "./lib/kani-resend-webhook"
          );

          const verification = verifyResendWebhookSignature({
            rawBody,
            svixId,
            svixTimestamp,
            svixSignature,
            secret: webhookSecret,
          });

          if (!verification.valid) {
            console.warn("[Resend Webhook] Firma rechazada:", verification.reason);
            return new Response(
              JSON.stringify({
                error: "INVALID_SIGNATURE",
                reason: verification.reason,
              }),
              { status: 401, headers: { "content-type": "application/json" } }
            );
          }

          // Idempotencia: si ya procesamos este evento, responder 200 sin repetir mutaciones
          if (svixId && isResendEventDuplicate(svixId)) {
            console.log(`[Resend Webhook] Evento duplicado ignorado (idempotente): ${svixId}`);
            return new Response(
              JSON.stringify({ received: true, svixId, idempotentReplay: true }),
              { status: 200, headers: { "content-type": "application/json" } }
            );
          }

          const body = JSON.parse(rawBody) as any;
          const eventType = body?.type;
          const emailId = body?.data?.email_id || body?.data?.id;

          if (emailId && eventType) {
            const { createPaymentSupabaseClient } = await import("./lib/kani-payment-db.server");
            const db = await createPaymentSupabaseClient();

            if (eventType === "email.delivered") {
              await db
                .from("appointment_notification_dispatches")
                .update({
                  status: "DELIVERED",
                  updated_at: new Date().toISOString(),
                })
                .eq("provider_message_id", emailId);
              console.log(`[Resend Webhook] Email ${emailId} marcado como DELIVERED (entregado).`);
            } else if (eventType === "email.bounced") {
              await db
                .from("appointment_notification_dispatches")
                .update({
                  status: "FAILED",
                  error_code: "BOUNCED",
                  error_description: body?.data?.bounce?.message || "Email rebotado por el servidor de destino",
                  updated_at: new Date().toISOString(),
                })
                .eq("provider_message_id", emailId);
            } else if (eventType === "email.complained") {
              await db
                .from("appointment_notification_dispatches")
                .update({
                  status: "FAILED",
                  error_code: "COMPLAINED",
                  error_description: "Email marcado como spam por el destinatario",
                  updated_at: new Date().toISOString(),
                })
                .eq("provider_message_id", emailId);
            }
          }

          return new Response(JSON.stringify({ received: true }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        } catch (webhookErr) {
          const msg = webhookErr instanceof Error ? webhookErr.message : "BAD_REQUEST";
          return new Response(JSON.stringify({ error: msg }), { status: 400 });
        }
      }

      // Central gate also covers diagnostics and maintenance routes that use privileged clients.
      let verifiedStaff: Awaited<ReturnType<typeof import('./lib/kani-staff-request.server').authenticateStaffRequest>> | undefined;
      if (url.pathname.startsWith('/api/admin/') || (url.pathname.startsWith('/api/integrations/google-calendar/') && !url.pathname.endsWith('/callback'))) {
        const { authenticateStaffRequest } = await import('./lib/kani-staff-request.server');
        verifiedStaff = await authenticateStaffRequest(request);
        if (!verifiedStaff.ok) return Response.json({ error: verifiedStaff.error }, { status: verifiedStaff.status, headers: { 'cache-control': 'no-store' } });
        if (url.pathname !== '/api/admin/online-deposits' && verifiedStaff.profile.role !== 'ADMIN') {
          return Response.json({ error: 'ADMIN_REQUIRED' }, { status: 403, headers: { 'cache-control': 'no-store' } });
        }
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
          }, verifiedStaff?.ok ? { profile: verifiedStaff.profile, token: verifiedStaff.token } : null);

          return new Response(JSON.stringify(movements), {
            status: 200,
            headers: { "content-type": "application/json", "cache-control": "no-store" },
          });
        } catch (err) {
          return new Response(JSON.stringify({ error: err instanceof Error ? err.message : "Error" }), {
            status: 500,
            headers: { "content-type": "application/json" },
          });
        }
      }

      if (url.pathname === "/api/admin/payway-diagnostics") {
        try {
          const { getRecentPaywayDiagnostics, readPaywayConfig } = await import("./lib/kani-payway.server");
          const config = readPaywayConfig((k) => process.env[k]);

          let migrationApplied = false;
          let migrationError: string | null = null;
          let codesCount = 0;
          let sampleTest: unknown = null;
          let expansionApplied = false;
          let expansionError: string | null = null;
          let detailedCodes: any[] = [];
          let codeUsages: any[] = [];
          let recentBenefitAppointments: any[] = [];
          let recentServicePayments: any[] = [];
          let recentPaymentAttempts: any[] = [];
          let repairResult: any = null;
          let modalityValidationResult: any = null;
          let membershipsDiagnostics: any = null;

          try {
            const { createPaymentSupabaseClient } = await import("./lib/kani-payment-db.server");
            const db = await createPaymentSupabaseClient();
            const { data: codes, error } = await db
              .from('benefit_codes')
              .select('id, code, type, status, internal_note, created_at, updated_at, consumed_at, consumed_appointment_id, locked_at, locked_expires_at, locked_attempt_id')
              .order('created_at', { ascending: false });
            if (!error) {
              migrationApplied = true;
              codesCount = Array.isArray(codes) ? codes.length : 0;
            } else {
              migrationError = error.message;
            }

            const { validateBenefitCodeQuote } = await import("./lib/kani-benefit-codes.server");
            const probeCode = url.searchParams.get("probe_code") || "NON_EXISTENT_TEST_PROBE";
            sampleTest = await validateBenefitCodeQuote({
              code: probeCode,
              serviceName: "Corte",
              barberName: "Lautaro",
            });

            try {
              const { error: expErr } = await db.from('benefit_codes').select('usage_mode').limit(1);
              if (!expErr) {
                expansionApplied = true;
              } else {
                expansionError = expErr.message;
              }
            } catch (e: any) {
              expansionError = e.message;
            }

            // Fetch detailed codes and usages
            try {
              if (expansionApplied) {
                const { data: fullCodes } = await db.from('benefit_codes').select('*').order('created_at', { ascending: false });
                detailedCodes = fullCodes || [];
              } else {
                detailedCodes = codes || [];
              }
            } catch { /* best-effort */ }

            try {
              const { data: usages } = await db.from('benefit_code_usages').select('*').order('used_at', { ascending: false });
              codeUsages = usages || [];
            } catch { /* best-effort */ }

            try {
              const { data: bAppts } = await db
                .from('appointments')
                .select('id, request_number, client_id, booking_date, start_time, status, deposit_amount_ars, deposit_paid, benefit_code, benefit_type, benefit_original_price_ars, benefit_discount_amount_ars, benefit_final_price_ars, benefit_online_deposit_ars, benefit_in_person_balance_ars, created_at')
                .not('benefit_code', 'is', null)
                .order('created_at', { ascending: false })
                .limit(10);
              recentBenefitAppointments = bAppts || [];
            } catch { /* best-effort */ }

            try {
              const { data: sPays } = await db
                .from('service_payments')
                .select('id, barber_id, service_name, service_other_detail, service_price_ars, discount_ars, final_amount_ars, collected_amount_ars, payment_date, payment_time, payment_method, client_name, appointment_id, service_origin, created_at, deleted_at')
                .order('created_at', { ascending: false })
                .limit(10);
              recentServicePayments = sPays || [];
            } catch { /* best-effort */ }

            try {
              const { data: pAtts } = await db
                .from('payment_attempts')
                .select('id, appointment_id, provider, state, amount_ars, site_transaction_id, created_at, updated_at')
                .order('created_at', { ascending: false })
                .limit(5);
              recentPaymentAttempts = pAtts || [];
            } catch { /* best-effort */ }

            try {
              const { data: mems, error: memsErr } = await db
                .from('client_memberships')
                .select('*')
                .order('created_at', { ascending: false });
              const { data: memItems } = await db.from('client_membership_items').select('*');
              const { data: memCons } = await db.from('client_membership_consumptions').select('*');
              const { data: memEvents } = await db.from('client_membership_events').select('*');
              const { data: memClients } = await db
                .from('clients')
                .select('id, name, phone, email')
                .or('name.ilike.%Membresia%,name.ilike.%Prueba%');

              membershipsDiagnostics = {
                applied: !memsErr,
                error: memsErr ? memsErr.message : null,
                totalMemberships: mems?.length ?? 0,
                memberships: mems || [],
                items: memItems || [],
                consumptions: memCons || [],
                events: memEvents || [],
                matchingClients: memClients || [],
              };
            } catch (e: any) {
              membershipsDiagnostics = { applied: false, error: e?.message || String(e) };
            }

            const activateCodeParam = url.searchParams.get("activate_disabled_code")?.trim().toUpperCase();
            if (activateCodeParam) {
              const { data: targetRow } = await db
                .from('benefit_codes')
                .select('*')
                .eq('code', activateCodeParam)
                .maybeSingle();
              if (targetRow && targetRow.status === 'DISABLED' && !targetRow.consumed_at) {
                const { error: actErr } = await db
                  .from('benefit_codes')
                  .update({ status: 'ACTIVE', updated_at: new Date().toISOString() })
                  .eq('id', targetRow.id);
                repairResult = {
                  activatedCode: targetRow.code,
                  id: targetRow.id,
                  previousStatus: targetRow.status,
                  newStatus: actErr ? targetRow.status : 'ACTIVE',
                  error: actErr ? actErr.message : null,
                };
              } else if (targetRow) {
                repairResult = {
                  activatedCode: targetRow.code,
                  id: targetRow.id,
                  status: targetRow.status,
                  skippedReason: targetRow.status === 'CONSUMED' ? 'CANNOT_ACTIVATE_CONSUMED_SINGLE_USE' : 'ALREADY_ACTIVE_OR_NOT_DISABLED',
                };
              }
            }

            if (url.searchParams.get("repair_d100") === "true") {
              const {
                encodeInternalNoteWithMetadata,
                normalizeBenefitCodeRow,
                parseInternalNoteMetadata,
              } = await import("./lib/kani-benefit-codes.server");

              const { data: d100Before } = await db
                .from("benefit_codes")
                .select("*")
                .eq("id", "d5b18bd1-d3ca-4b0d-a826-fe92edf4c780")
                .eq("code", "KANI-O2Q1-FREE-D100")
                .maybeSingle();

              if (d100Before && d100Before.type === "PERCENT_10") {
                const { cleanNote } = parseInternalNoteMetadata(d100Before.internal_note);
                const preservedCleanNote = cleanNote || "Primeros 10 clientes :)";
                const nextInternalNote = encodeInternalNoteWithMetadata(preservedCleanNote, {
                  usageMode: "REUSABLE",
                  validityType: "NO_EXPIRATION",
                  validFrom: d100Before.created_at,
                  validUntil: null,
                  validityDurationValue: null,
                  validityDurationUnit: null,
                  timesUsed: 0,
                  deletedAt: null,
                });

                const { data: d100After, error: d100Err } = await db
                  .from("benefit_codes")
                  .update({
                    internal_note: nextInternalNote,
                    status: "ACTIVE",
                    updated_at: new Date().toISOString(),
                  })
                  .eq("id", d100Before.id)
                  .select("*")
                  .single();

                // Also ensure previously repaired reusable codes have embedded metadata persisted in DB
                const prevReusableCodes = [
                  "KANI-O2Q1-FREE-DD99",
                  "KANI-O2Q1-FREE-DD98",
                  "KANI-X9H5-FREE-8R1Z",
                ];
                for (const prevCode of prevReusableCodes) {
                  const { data: prevRow } = await db
                    .from("benefit_codes")
                    .select("*")
                    .eq("code", prevCode)
                    .maybeSingle();
                  if (prevRow) {
                    const parsedPrev = parseInternalNoteMetadata(prevRow.internal_note);
                    if (parsedPrev.meta?.usageMode !== "REUSABLE") {
                      const prevMetaNote = encodeInternalNoteWithMetadata(parsedPrev.cleanNote, {
                        ...(parsedPrev.meta || {}),
                        usageMode: "REUSABLE",
                        validityType: parsedPrev.meta?.validityType || "NO_EXPIRATION",
                        validFrom: parsedPrev.meta?.validFrom || prevRow.created_at,
                        validUntil: parsedPrev.meta?.validUntil ?? null,
                        timesUsed: parsedPrev.meta?.timesUsed ?? (prevRow.consumed_at ? 1 : 0),
                        deletedAt: parsedPrev.meta?.deletedAt ?? null,
                      });
                      await db
                        .from("benefit_codes")
                        .update({ internal_note: prevMetaNote, status: "ACTIVE" })
                        .eq("id", prevRow.id);
                    }
                  }
                }

                repairResult = {
                  repairedCode: "KANI-O2Q1-FREE-D100",
                  id: d100Before.id,
                  beforeRaw: d100Before,
                  afterRaw: d100After,
                  afterNormalized: d100After ? normalizeBenefitCodeRow(d100After) : null,
                  error: d100Err ? d100Err.message : null,
                };
              } else {
                repairResult = {
                  error: "TARGET_D100_NOT_FOUND_OR_TYPE_MISMATCH",
                  found: d100Before || null,
                };
              }
            }

            if (url.searchParams.get("run_modality_validation") === "true") {
              const {
                confirmZeroDepositBooking,
                encodeInternalNoteWithMetadata,
                normalizeBenefitCodeRow,
                validateBenefitCodeQuote,
              } = await import("./lib/kani-benefit-codes.server");

              const createdCodeIds: string[] = [];
              const createdAppointmentIds: string[] = [];
              const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
              const reusCode = `KANI-VREU-TEST-${suffix}`;
              const singCode = `KANI-VSIN-TEST-${suffix}`;
              const nowIso = new Date().toISOString();
              const testBookingDate = url.searchParams.get("val_date") || "2026-11-18";

              try {
                // 1. Create REUSABLE code and reload from DB
                const reusMetaNote = encodeInternalNoteWithMetadata("Validación real reutilizable", {
                  usageMode: "REUSABLE",
                  validityType: "NO_EXPIRATION",
                  validFrom: nowIso,
                  validUntil: null,
                  validityDurationValue: null,
                  validityDurationUnit: null,
                  timesUsed: 0,
                  deletedAt: null,
                });
                const { data: insertedReus, error: errReus } = await db
                  .from("benefit_codes")
                  .insert({
                    code: reusCode,
                    type: "FREE_SERVICE",
                    status: "ACTIVE",
                    internal_note: reusMetaNote,
                  })
                  .select("*")
                  .single();
                if (errReus || !insertedReus) {
                  throw new Error(`Err creating reusable test code: ${errReus?.message}`);
                }
                createdCodeIds.push(insertedReus.id);

                const { data: reloadedReusRaw } = await db
                  .from("benefit_codes")
                  .select("*")
                  .eq("id", insertedReus.id)
                  .single();
                const reloadedReusAfterCreate = normalizeBenefitCodeRow(reloadedReusRaw);

                // 2. Create SINGLE_USE code and reload from DB
                const singMetaNote = encodeInternalNoteWithMetadata("Validación real un solo uso", {
                  usageMode: "SINGLE_USE",
                  validityType: "NO_EXPIRATION",
                  validFrom: nowIso,
                  validUntil: null,
                  validityDurationValue: null,
                  validityDurationUnit: null,
                  timesUsed: 0,
                  deletedAt: null,
                });
                const { data: insertedSing, error: errSing } = await db
                  .from("benefit_codes")
                  .insert({
                    code: singCode,
                    type: "FREE_SERVICE",
                    status: "ACTIVE",
                    internal_note: singMetaNote,
                  })
                  .select("*")
                  .single();
                if (errSing || !insertedSing) {
                  throw new Error(`Err creating single-use test code: ${errSing?.message}`);
                }
                createdCodeIds.push(insertedSing.id);

                const { data: reloadedSingRaw } = await db
                  .from("benefit_codes")
                  .select("*")
                  .eq("id", insertedSing.id)
                  .single();
                const reloadedSingAfterCreate = normalizeBenefitCodeRow(reloadedSingRaw);

                // 3. Confirm 2 reservations with the REUSABLE code
                const reusBooking1 = await confirmZeroDepositBooking({
                  barberName: "Lautaro",
                  serviceName: "Corte",
                  bookingDate: testBookingDate,
                  startTime: "10:00",
                  clientName: "Test Reutilizable 1",
                  clientPhone: "+5491100001111",
                  clientEmail: "test-reus-1@kanibarber.com",
                  benefitCode: reusCode,
                  notes: "Validacion reutilizable reserva 1",
                  skipExternalSideEffects: true,
                });
                createdAppointmentIds.push(reusBooking1.appointmentId);

                const reusBooking2 = await confirmZeroDepositBooking({
                  barberName: "Lautaro",
                  serviceName: "Corte",
                  bookingDate: testBookingDate,
                  startTime: "11:00",
                  clientName: "Test Reutilizable 2",
                  clientPhone: "+5491100002222",
                  clientEmail: "test-reus-2@kanibarber.com",
                  benefitCode: reusCode,
                  notes: "Validacion reutilizable reserva 2",
                  skipExternalSideEffects: true,
                });
                createdAppointmentIds.push(reusBooking2.appointmentId);

                const { data: reusRowAfter2 } = await db
                  .from("benefit_codes")
                  .select("*")
                  .eq("id", insertedReus.id)
                  .single();
                const { data: reusAppts } = await db
                  .from("appointments")
                  .select("id, request_number, booking_date, start_time, status, created_at, benefit_code")
                  .eq("benefit_code", reusCode)
                  .order("created_at", { ascending: false });

                const mappedReusUsages = (reusAppts || []).map((a: any) => ({
                  id: `appt-${a.id}`,
                  appointmentId: a.id,
                  requestNumber: a.request_number,
                  bookingDate: a.booking_date,
                  bookingTime: String(a.start_time || "").slice(0, 5),
                  appointmentStatus: a.status,
                  usedAt: a.created_at,
                  isAppointmentCancelled: a.status === "CANCELLED",
                }));
                const normalizedReusAfter2 = normalizeBenefitCodeRow(reusRowAfter2, mappedReusUsages as any);
                const reusQuoteAfter2 = await validateBenefitCodeQuote({
                  code: reusCode,
                  serviceName: "Corte",
                  barberName: "Lautaro",
                });

                // 4. Confirm 1 reservation with SINGLE_USE code and verify 2nd is rejected
                const singBooking1 = await confirmZeroDepositBooking({
                  barberName: "Lautaro",
                  serviceName: "Corte",
                  bookingDate: testBookingDate,
                  startTime: "12:00",
                  clientName: "Test Unico 1",
                  clientPhone: "+5491100003333",
                  clientEmail: "test-sing-1@kanibarber.com",
                  benefitCode: singCode,
                  notes: "Validacion unico reserva 1",
                  skipExternalSideEffects: true,
                });
                createdAppointmentIds.push(singBooking1.appointmentId);

                const { data: singRowAfter1 } = await db
                  .from("benefit_codes")
                  .select("*")
                  .eq("id", insertedSing.id)
                  .single();
                const normalizedSingAfter1 = normalizeBenefitCodeRow(singRowAfter1);
                const singQuoteAfter1 = await validateBenefitCodeQuote({
                  code: singCode,
                  serviceName: "Corte",
                  barberName: "Lautaro",
                });

                let secondSingConfirmRejected = false;
                let secondSingConfirmError: string | null = null;
                try {
                  const singBooking2 = await confirmZeroDepositBooking({
                    barberName: "Lautaro",
                    serviceName: "Corte",
                    bookingDate: testBookingDate,
                    startTime: "13:00",
                    clientName: "Test Unico 2",
                    clientPhone: "+5491100004444",
                    clientEmail: "test-sing-2@kanibarber.com",
                    benefitCode: singCode,
                    notes: "Validacion unico reserva 2 (debe fallar)",
                    skipExternalSideEffects: true,
                  });
                  if (singBooking2?.appointmentId) {
                    createdAppointmentIds.push(singBooking2.appointmentId);
                  }
                } catch (err2: any) {
                  secondSingConfirmRejected = true;
                  secondSingConfirmError = err2 instanceof Error ? err2.message : String(err2);
                }

                modalityValidationResult = {
                  validation1_createReusableAndReload: {
                    code: reusCode,
                    id: insertedReus.id,
                    persistedInternalNote: reloadedReusRaw?.internal_note,
                    reloadedUsageMode: reloadedReusAfterCreate.usageMode,
                    reloadedStatus: reloadedReusAfterCreate.status,
                    reloadedCleanNote: reloadedReusAfterCreate.internalNote,
                    passed:
                      reloadedReusAfterCreate.usageMode === "REUSABLE" &&
                      reloadedReusAfterCreate.status === "ACTIVE",
                  },
                  validation2_createSingleUseAndReload: {
                    code: singCode,
                    id: insertedSing.id,
                    persistedInternalNote: reloadedSingRaw?.internal_note,
                    reloadedUsageMode: reloadedSingAfterCreate.usageMode,
                    reloadedStatus: reloadedSingAfterCreate.status,
                    reloadedCleanNote: reloadedSingAfterCreate.internalNote,
                    passed:
                      reloadedSingAfterCreate.usageMode === "SINGLE_USE" &&
                      reloadedSingAfterCreate.status === "ACTIVE",
                  },
                  validation3_reusableTwoBookings: {
                    booking1: {
                      appointmentId: reusBooking1.appointmentId,
                      requestNumber: reusBooking1.requestNumber,
                    },
                    booking2: {
                      appointmentId: reusBooking2.appointmentId,
                      requestNumber: reusBooking2.requestNumber,
                    },
                    statusAfter2Bookings: normalizedReusAfter2.status,
                    usageModeAfter2Bookings: normalizedReusAfter2.usageMode,
                    timesUsedAfter2Bookings: normalizedReusAfter2.timesUsed,
                    usagesCountAfter2Bookings: normalizedReusAfter2.usages?.length ?? 0,
                    subsequentQuoteValid: reusQuoteAfter2.valid,
                    passed:
                      normalizedReusAfter2.status === "ACTIVE" &&
                      normalizedReusAfter2.usageMode === "REUSABLE" &&
                      normalizedReusAfter2.timesUsed === 2 &&
                      (normalizedReusAfter2.usages?.length ?? 0) === 2 &&
                      reusQuoteAfter2.valid === true,
                  },
                  validation4_singleUseOneBookingAndSecondRejected: {
                    booking1: {
                      appointmentId: singBooking1.appointmentId,
                      requestNumber: singBooking1.requestNumber,
                    },
                    statusAfter1Booking: normalizedSingAfter1.status,
                    usageModeAfter1Booking: normalizedSingAfter1.usageMode,
                    timesUsedAfter1Booking: normalizedSingAfter1.timesUsed,
                    quoteAfter1BookingValid: singQuoteAfter1.valid,
                    quoteAfter1BookingMessage: singQuoteAfter1.message,
                    secondConfirmRejected: secondSingConfirmRejected,
                    secondConfirmError: secondSingConfirmError,
                    passed:
                      normalizedSingAfter1.status === "CONSUMED" &&
                      normalizedSingAfter1.usageMode === "SINGLE_USE" &&
                      singQuoteAfter1.valid === false &&
                      secondSingConfirmRejected === true,
                  },
                };
              } finally {
                if (createdAppointmentIds.length > 0) {
                  await db.from("calendar_sync_queue").delete().in("appointment_id", createdAppointmentIds);
                  await db.from("appointment_status_events").delete().in("appointment_id", createdAppointmentIds);
                  await db.from("benefit_codes").update({ consumed_appointment_id: null, consumed_client_id: null }).in("id", createdCodeIds);
                  await db.from("appointments").delete().in("id", createdAppointmentIds);
                }
                if (createdCodeIds.length > 0) {
                  await db.from("benefit_codes").delete().in("id", createdCodeIds);
                }
              }
            }

            // Refresh detailedCodes after any repairs/validations
            try {
              const { normalizeBenefitCodeRow } = await import("./lib/kani-benefit-codes.server");
              const { data: refreshedCodes } = await db
                .from("benefit_codes")
                .select("*")
                .order("created_at", { ascending: false });
              if (refreshedCodes) {
                detailedCodes = refreshedCodes.map((r: any) => ({
                  ...r,
                  normalizedUsageMode: normalizeBenefitCodeRow(r).usageMode,
                  normalizedCleanNote: normalizeBenefitCodeRow(r).internalNote,
                }));
              }
            } catch { /* best-effort */ }

            // Safe surgical repair of affected reusable code
            const shouldRepair = url.searchParams.get("repair_reusable_code") === "true";
            const targetCode = url.searchParams.get("target_code")?.trim().toUpperCase();
            const forceReusable = url.searchParams.get("force_reusable") === "true";

            if (shouldRepair || targetCode) {
              const query = db.from('benefit_codes').select('*');
              if (targetCode) {
                query.eq('code', targetCode);
              } else {
                query.eq('status', 'CONSUMED');
              }
              const { data: candidates } = await query;
              const repaired: any[] = [];

              if (Array.isArray(candidates)) {
                for (const candidate of candidates) {
                  // Only repair if it is explicitly REUSABLE, or if targeted with force_reusable=true
                  const isCandidateReusable = candidate.usage_mode === 'REUSABLE' || (forceReusable && candidate.code === targetCode);
                  if (isCandidateReusable && candidate.status === 'CONSUMED') {
                    const updatePayload: Record<string, any> = {
                      status: 'ACTIVE',
                      updated_at: new Date().toISOString(),
                    };
                    if (forceReusable && expansionApplied && candidate.usage_mode !== 'REUSABLE') {
                      updatePayload.usage_mode = 'REUSABLE';
                    }
                    const { error: updErr } = await db
                      .from('benefit_codes')
                      .update(updatePayload)
                      .eq('id', candidate.id);

                    if (!updErr) {
                      repaired.push({
                        id: candidate.id,
                        code: candidate.code,
                        previousStatus: candidate.status,
                        newStatus: 'ACTIVE',
                        timesUsed: candidate.times_used ?? 1,
                        preservedConsumedAppointmentId: candidate.consumed_appointment_id,
                        preservedConsumedAt: candidate.consumed_at,
                      });
                    } else {
                      repaired.push({
                        id: candidate.id,
                        code: candidate.code,
                        error: updErr.message,
                      });
                    }
                  }
                }
              }
              repairResult = {
                requestedTarget: targetCode || 'ALL_CONSUMED_REUSABLES',
                repairedCount: repaired.length,
                repaired,
              };
            }
          } catch (dbErr) {
            migrationError = dbErr instanceof Error ? dbErr.message : String(dbErr);
          }

          const siteId = process.env.PAYWAY_PRODUCTION_SITE_ID || process.env.PAYWAY_SITE_ID || '';
          return new Response(
            JSON.stringify({
              worker: "kanibarberstudio-cloudflare",
              domainsServed: ["kanibarber.com", "www.kanibarber.com"],
              payway: {
                configured: Boolean(config),
                environment: process.env.PAYWAY_ENVIRONMENT,
                productionEnabled: process.env.PAYWAY_PRODUCTION_ENABLED === 'true',
                sandboxEnabled: process.env.PAYWAY_SANDBOX_ENABLED === 'true',
                apiBaseUrl: process.env.PAYWAY_API_BASE_URL,
                hasPublicKey: Boolean(process.env.PAYWAY_PRODUCTION_PUBLIC_KEY || process.env.PAYWAY_PUBLIC_API_KEY || process.env.PAYWAY_PUBLIC_KEY),
                hasPrivateKey: Boolean(process.env.PAYWAY_PRODUCTION_PRIVATE_KEY || process.env.PAYWAY_PRIVATE_API_KEY || process.env.PAYWAY_PRIVATE_KEY),
                hasSiteId: Boolean(siteId),
                siteIdFormatValid: /^\d{1,20}$/.test(siteId),
                hasCheckoutSecret: (process.env.PAYWAY_CHECKOUT_SECRET?.length ?? 0) >= 32,
                paymentMethods: config?.methods || [],
              },
              benefitsMigration: {
                applied: migrationApplied,
                codesCount,
                sampleQuoteProbe: sampleTest,
                error: migrationError,
              },
              benefitsExpansionMigration: {
                applied: expansionApplied,
                error: expansionError,
              },
              allBenefitCodes: detailedCodes,
              recentBenefitAppointments,
              recentServicePayments,
              recentPaymentAttempts,
              codeUsages,
              repairResult,
              modalityValidationResult,
              membershipsDiagnostics,
              accountingInvariants: {
                freeBookingStatusRule: "Una reserva gratuita confirmada NO cuenta como servicio realizado hasta su cobro/cierre en el local.",
                cancellationPaymentsRule: "Una cancelación NO borra pagos anteriores; se conservan pagos recibidos y reintegros se registran explícitamente.",
              },
              diagnostics: getRecentPaywayDiagnostics(),
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

      if (url.pathname === "/api/admin/recover-appointment-notification") {
        try {
          // 1. Prohibir terminantemente la especificación de destinatarios arbitrarios
          if (
            url.searchParams.has("recipient") ||
            url.searchParams.has("email") ||
            url.searchParams.has("phone") ||
            url.searchParams.has("to")
          ) {
            return new Response(
              JSON.stringify({
                error: "ARBITRARY_RECIPIENT_FORBIDDEN",
                message: "No se permite elegir destinatarios arbitrarios. La recuperación utiliza exclusivamente el contacto registrado en el turno.",
              }),
              { status: 400, headers: { "content-type": "application/json" } }
            );
          }

          // 2. Validación estricta de autorización en el servidor (solo rol ADMIN mediante encabezado Bearer o Cookie)
          const authHeader = request.headers.get("authorization") || request.headers.get("Authorization");
          const cookieHeader = request.headers.get("cookie") || request.headers.get("Cookie");

          let token: string | null = null;
          if (authHeader?.startsWith("Bearer ")) {
            token = authHeader.slice(7).trim();
          } else if (cookieHeader) {
            const extractCookie = (c: string, name: string) => {
              const match = c.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
              return match ? decodeURIComponent(match[1]) : null;
            };
            const sbTokenCookie =
              extractCookie(cookieHeader, "sb-access-token") ||
              extractCookie(cookieHeader, "sb-iockpxtkflyjfagkvgnr-auth-token");
            if (sbTokenCookie) {
              try {
                const parsed = JSON.parse(sbTokenCookie);
                token = Array.isArray(parsed) ? parsed[0] : parsed?.access_token || sbTokenCookie;
              } catch {
                token = sbTokenCookie;
              }
            }
          }

          if (!token) {
            return new Response(
              JSON.stringify({
                error: "AUTH_REQUIRED",
                message: "Debe iniciar sesión como administrador para recuperar notificaciones. No se permiten tokens en la URL.",
              }),
              { status: 401, headers: { "content-type": "application/json" } }
            );
          }

          const { createPaymentSupabaseClient } = await import("./lib/kani-payment-db.server");
          const db = await createPaymentSupabaseClient();

          const { data: { user }, error: userError } = await db.auth.getUser(token);
          if (userError || !user) {
            return new Response(
              JSON.stringify({
                error: "SESSION_INVALID",
                message: "Sesión inválida o expirada. Por favor, vuelva a iniciar sesión.",
              }),
              { status: 401, headers: { "content-type": "application/json" } }
            );
          }

          const { data: profile, error: profileErr } = await db
            .from("staff_profiles")
            .select("role, active")
            .eq("user_id", user.id)
            .maybeSingle();

          if (profileErr || !profile || !profile.active || profile.role !== "ADMIN") {
            return new Response(
              JSON.stringify({
                error: "UNAUTHORIZED_ADMIN_ONLY",
                message: "Acceso denegado. Se requieren permisos de administrador.",
              }),
              { status: 403, headers: { "content-type": "application/json" } }
            );
          }

          const appointmentId = url.searchParams.get("appointmentId")?.trim();
          if (!appointmentId) {
            return new Response(JSON.stringify({ error: "APPOINTMENT_ID_REQUIRED" }), { status: 400 });
          }
          
          // 1. Verificar turno
          const { data: appt, error: apptErr } = await db.from('appointments').select('*').eq('id', appointmentId).maybeSingle();
          if (apptErr || !appt) {
            return new Response(JSON.stringify({ error: "APPOINTMENT_NOT_FOUND" }), { status: 404 });
          }

          // 2. Verificar estado de calendario (no duplicar si ya está SYNCED)
          const { data: calSync } = await db.from('appointment_calendar_sync').select('*').eq('appointment_id', appointmentId).maybeSingle();
          let calendarAction = "ALREADY_SYNCED";
          if (!calSync || calSync.sync_status !== 'SYNCED') {
            const { processCalendarSyncQueue } = await import("./lib/kani-google-calendar-sync");
            await processCalendarSyncQueue({ limit: 5 });
            calendarAction = "QUEUE_PROCESSED";
          }

          // 3. Obtener cliente para teléfono/email
          let clientPhone = null;
          if (appt.client_id) {
            const { data: client } = await db.from('clients').select('id, name, email, phone').eq('id', appt.client_id).maybeSingle();
            if (client?.phone) clientPhone = client.phone;
          }

          // 4. Generar o recuperar evento de notificación y despachar
          let claimTokenToUse: string | null = null;
          let recoveryAction = "NONE";
          const { data: rpcToken, error: tokenErr } = await db.rpc('create_appointment_notification_event', {
            p_appointment_id: appointmentId,
            p_notification_type: 'CONFIRMED'
          });
          claimTokenToUse = rpcToken;

          const { data: existingEvent } = await db
            .from('appointment_notification_events')
            .select('*')
            .eq('appointment_id', appointmentId)
            .eq('notification_type', 'CONFIRMED')
            .maybeSingle();

          if (!claimTokenToUse && existingEvent) {
            if (existingEvent.status !== 'SENT') {
              const rawToken = crypto.randomUUID();
              const tokenBuffer = new TextEncoder().encode(rawToken);
              const hashBuf = await crypto.subtle.digest('SHA-256', tokenBuffer);
              const tokenDigest = Array.from(new Uint8Array(hashBuf)).map(b => b.toString(16).padStart(2, '0')).join('');

              const { error: updErr } = await db
                .from('appointment_notification_events')
                .update({
                  claim_token_digest: tokenDigest,
                  status: 'PENDING',
                  attempts: 0,
                  updated_at: new Date().toISOString()
                })
                .eq('id', existingEvent.id);

              if (!updErr) {
                claimTokenToUse = rawToken;
                recoveryAction = "TOKEN_REISSUED";
              } else {
                recoveryAction = `UPDATE_FAILED: ${updErr.message}`;
              }
            } else {
              recoveryAction = "ALREADY_SENT";
            }
          } else if (claimTokenToUse) {
            recoveryAction = "EVENT_CREATED";
          }

          let dispatchRes = null;
          if (claimTokenToUse) {
            const { dispatchAppointmentNotification } = await import("./lib/kani-notifications.functions");
            dispatchRes = await dispatchAppointmentNotification({
              appointmentId,
              claimToken: claimTokenToUse,
              clientPhone,
            });
          }

          // 5. Consultar estado final de canales
          let finalChannels = null;
          try {
            const { data: channels } = await db.from('appointment_notification_dispatches')
              .select('*')
              .eq('appointment_id', appointmentId);
            finalChannels = channels;
          } catch { /* best effort */ }

          return new Response(
            JSON.stringify({
              success: true,
              appointmentId,
              status: appt.status,
              calendar: {
                action: calendarAction,
                record: calSync,
              },
              token: claimTokenToUse,
              recoveryAction,
              tokenError: tokenErr ? tokenErr.message : null,
              dispatchResult: dispatchRes,
              channels: finalChannels || [],
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


      if (url.pathname === "/api/admin/trigger-maintenance") {
        try {
          const { reconcilePendingPayments } = await import("./lib/kani-payment-maintenance.server");
          await reconcilePendingPayments();
          
          let notifResult = null;
          try {
            const { recoverPendingNotificationEvents } = await import("./lib/kani-notifications.functions");
            notifResult = await recoverPendingNotificationEvents({ limit: 10 });
          } catch (notifErr) {
            console.warn("[Maintenance Notification Recovery Warning]:", notifErr);
          }

          return new Response(
            JSON.stringify({
              success: true,
              notificationsRecovered: notifResult,
              executed_at: new Date().toISOString(),
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

      try {
        const { recoverPendingNotificationEvents } = await import("./lib/kani-notifications.functions");
        const notifResult = await recoverPendingNotificationEvents({ limit: 10 });
        if (notifResult && notifResult.processed > 0) {
          console.log("[Cron Scheduled Notification Recovery]:", JSON.stringify(notifResult));
        }
      } catch (err) {
        console.error("[Cron Scheduled Notification Recovery Error]:", err);
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
    "RESEND_WEBHOOK_SECRET",
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
    "PAYWAY_PUBLIC_KEY",
    "PAYWAY_PRIVATE_KEY",
    "PAYWAY_PRODUCTION_PUBLIC_KEY",
    "PAYWAY_PRODUCTION_PRIVATE_KEY",
    "PAYWAY_PRODUCTION_SITE_ID",
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
