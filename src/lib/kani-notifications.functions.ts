import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";

import type { Database } from "@/integrations/supabase/types";

type NotificationType = Database["public"]["Enums"]["notification_type"];
type NotificationClaim = {
  notification_id: string;
  notification_type: NotificationType;
  recipient_email: string | null;
  client_name: string;
  barber_name: string;
  service_name: string;
  booking_date: string;
  start_time: string;
  end_time: string;
  client_notes: string | null;
  service_price_ars: number | null;
  service_duration_minutes: number | null;
  down_payment_ars: number | null;
  transfer_alias: string | null;
  transfer_cuit: string | null;
  transfer_holder_name: string | null;
  dispatch_status: string;
  attempt: number;
};
type NotificationPayload = {
  notificationId: string;
  notificationType: NotificationType;
  recipientEmail: string;
  clientName: string;
  barberName: string;
  serviceName: string;
  bookingDate: string;
  startTime: string;
  endTime: string;
  clientNotes: string | null;
  servicePriceArs: number | null;
  serviceDurationMinutes: number | null;
  downPaymentArs: number | null;
  transferAlias: string | null;
  transferCuit: string | null;
  transferHolderName: string | null;
};

type DispatchResult = {
  sent: boolean;
  status: "SENT" | "ALREADY_SENT" | "IN_PROGRESS" | "FAILED" | "SKIPPED";
  errorCode?: string;
};

export const sendAppointmentNotification = createServerFn({ method: "POST" })
  .validator((data: { appointmentId: string; claimToken: string }) => {
    if (!data?.appointmentId || !data?.claimToken) throw new Error("NOTIFICATION_INPUT_INVALID");
    return data;
  })
  .handler(async ({ data }): Promise<DispatchResult> => {
    let notificationId: string | undefined;
    try {
      const supabase = await createRequestSupabaseClient();
      const { data: claimed, error: claimError } = await supabase.rpc(
        "claim_appointment_notification",
        {
          p_appointment_id: data.appointmentId,
          p_claim_token: data.claimToken,
        },
      );
      if (claimError) throw claimError;

      const event = claimed?.[0] as NotificationClaim | undefined;
      if (!event) return { sent: false, status: "SKIPPED" };
      notificationId = event.notification_id;
      if (event.dispatch_status === "ALREADY_SENT") return { sent: true, status: "ALREADY_SENT" };
      if (event.dispatch_status === "IN_PROGRESS") return { sent: false, status: "IN_PROGRESS" };
      if (!event.recipient_email) throw new Error("NOTIFICATION_RECIPIENT_MISSING");

      // These values must be Worker runtime bindings, not VITE_* build variables.
      // Trim whitespace so an accidentally blank dashboard value is reported as missing.
      const apiKey = getRuntimeEnv("RESEND_API_KEY")?.trim();
      const fromEmail = getRuntimeEnv("RESEND_FROM_EMAIL")?.trim();
      if (!apiKey) throw new Error("RESEND_API_KEY_MISSING");
      if (!fromEmail) throw new Error("RESEND_FROM_EMAIL_MISSING");

      const payload: NotificationPayload = {
        notificationId: event.notification_id,
        notificationType: event.notification_type,
        recipientEmail: event.recipient_email,
        clientName: event.client_name,
        barberName: event.barber_name,
        serviceName: event.service_name,
        bookingDate: event.booking_date,
        startTime: event.start_time,
        endTime: event.end_time,
        clientNotes: event.client_notes,
        servicePriceArs: event.service_price_ars,
        serviceDurationMinutes: event.service_duration_minutes,
        downPaymentArs: event.down_payment_ars,
        transferAlias: event.transfer_alias,
        transferCuit: event.transfer_cuit,
        transferHolderName: event.transfer_holder_name,
      };
      const email = buildEmail(payload);
      const environment = (getRuntimeEnv("KANI_ENVIRONMENT") ?? "UNCONFIGURED").trim().toUpperCase();
      // Never let an unlabelled non-production deployment send a production-looking subject.
      const subject = environment === "PRODUCTION"
        ? email.subject
        : `[${environment}] ${email.subject}`;
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "Idempotency-Key": event.notification_id,
        },
        body: JSON.stringify({
          from: fromEmail,
          to: [event.recipient_email],
          subject,
          html: email.html,
          text: email.text,
        }),
      });
      const result = (await response.json().catch(() => null)) as {
        id?: string;
        message?: string;
      } | null;
      if (!response.ok) {
        throw new Error(`RESEND_${response.status}: ${result?.message ?? "SEND_FAILED"}`);
      }

      const { error: completeError } = await supabase.rpc("complete_appointment_notification", {
        p_notification_id: event.notification_id,
        p_claim_token: data.claimToken,
        p_provider_message_id: result?.id ?? "",
      });
      if (completeError) throw completeError;
      return { sent: true, status: "SENT" };
    } catch (error) {
      const safeMessage = safeErrorMessage(error);
      console.error(`[KANI notification] ${safeMessage}`);
      try {
        const supabase = await createRequestSupabaseClient();
        if (notificationId) {
          const { error: recordError } = await supabase.rpc("fail_appointment_notification", {
            p_notification_id: notificationId,
            p_claim_token: data.claimToken,
            p_error: safeMessage,
          });
          if (recordError) throw recordError;
        } else {
          // Persist failures before the claim increments attempts, using the one-time token.
          const { error: recordError } = await supabase.rpc("record_appointment_notification_dispatch_error", {
            p_appointment_id: data.appointmentId,
            p_claim_token: data.claimToken,
            p_error: safeMessage,
          });
          if (recordError) throw recordError;
        }
      } catch (recordError) {
        console.error(
          `[KANI notification] failed to record failure: ${safeErrorMessage(recordError)}`,
        );
      }
      // Client-side fallback persists a generic cause if this server function cannot write it.
      return { sent: false, status: "FAILED", errorCode: safeMessage };
    }
  });

function getRuntimeEnv(name: string): string | undefined {
  // src/server.ts reads the Worker's runtime bindings before TanStack dispatches
  // the request and stores them in a shared, non-secret-accessible app runtime map.
  // The process.env fallback remains for local development and compatible runtimes.
  const runtimeValues = (globalThis as typeof globalThis & {
    __KANI_RUNTIME_ENV?: Record<string, string>;
  }).__KANI_RUNTIME_ENV;
  const runtimeValue = runtimeValues?.[name] ??
    (typeof process !== "undefined" ? process.env[name] : undefined);

  // VITE_* values are public configuration and are also supplied to the Cloudflare
  // build. Use them as a fallback if the split TanStack server-function bundle cannot
  // see the Worker's runtime bindings. Never fall back to build-time values for secrets
  // such as RESEND_API_KEY.
  const buildValue = name === "VITE_SUPABASE_URL" || name === "VITE_SUPABASE_ANON_KEY" ||
    name === "VITE_SUPABASE_PUBLISHABLE_KEY" || name === "RESEND_FROM_EMAIL"
    ? import.meta.env[name]
    : undefined;
  const value = runtimeValue ?? buildValue;
  return typeof value === "string" && value.trim() ? value : undefined;
}

async function createRequestSupabaseClient() {
  const [{ createClient }, request] = await Promise.all([
    import("@supabase/supabase-js"),
    Promise.resolve(getRequest()),
  ]);
  const supabaseUrl = getRuntimeEnv("SUPABASE_URL") ?? getRuntimeEnv("VITE_SUPABASE_URL");
  const supabaseKey =
    getRuntimeEnv("SUPABASE_ANON_KEY") ??
    getRuntimeEnv("SUPABASE_PUBLISHABLE_KEY") ??
    getRuntimeEnv("VITE_SUPABASE_ANON_KEY") ??
    getRuntimeEnv("VITE_SUPABASE_PUBLISHABLE_KEY");
  if (!supabaseUrl || !supabaseKey) {
    // Record presence only; never include URLs, API keys, or other secret values.
    const missing: string[] = [];
    if (!supabaseUrl) missing.push("SUPABASE_URL_OR_VITE_SUPABASE_URL");
    if (!supabaseKey) missing.push("SUPABASE_ANON_OR_PUBLISHABLE_KEY");
    throw new Error(`SUPABASE_SERVER_CONFIGURATION_MISSING:${missing.join(",")}`);
  }

  const authorization = request?.headers.get("authorization");
  return createClient<Database>(supabaseUrl, supabaseKey, {
    global: {
      fetch: (input, init) => {
        const headers = new Headers(
          typeof Request !== "undefined" && input instanceof Request ? input.headers : undefined,
        );
        if (init?.headers)
          new Headers(init.headers).forEach((value, key) => headers.set(key, value));
        headers.set("apikey", supabaseKey);
        if (authorization) headers.set("Authorization", authorization);
        return fetch(input, { ...init, headers });
      },
    },
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
  });
}

function buildEmail(payload: NotificationPayload) {
  const date = new Date(`${payload.bookingDate}T12:00:00Z`).toLocaleDateString("es-AR", {
    timeZone: "America/Argentina/Buenos_Aires",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
  const time = `${payload.startTime.slice(0, 5)} a ${payload.endTime.slice(0, 5)} hs`;
  const isNewRequest = payload.notificationType === "NEW_REQUEST";
  if (isNewRequest) return buildNewRequestEmail(payload, date, time);

  const safe = {
    clientName: escapeHtml(payload.clientName),
    barberName: escapeHtml(payload.barberName),
    serviceName: escapeHtml(payload.serviceName),
    date: escapeHtml(date),
    time: escapeHtml(time),
  };
  const copy =
    payload.notificationType === "CONFIRMED"
      ? {
          subject: "Tu turno en Kani Barber Studio está confirmado",
          title: "Tu turno fue confirmado",
          intro: `${payload.barberName} confirmó tu turno. Te esperamos en Kani Barber Studio.`,
          status: "CONFIRMADO",
        }
      : {
          subject: "Actualización de tu turno en Kani Barber Studio",
          title: "Tu turno fue cancelado",
          intro: `${payload.barberName} canceló tu turno. Si querés, podés solicitar uno nuevo desde nuestra web.`,
          status: "CANCELADO",
        };
  const mapsUrl = "https://www.google.com/maps/place/KANI+BARBER+STUDIO/data=!4m2!3m1!1s0x0:0x48bcfe7b2ea7ba60";
  const subject = copy.subject;
  const html = `<!doctype html><html lang="es"><body style="margin:0;background:#f4f1eb;color:#1c1c1c;font-family:Arial,sans-serif"><div style="max-width:560px;margin:0 auto;padding:36px 20px"><div style="background:#161616;padding:22px 24px;color:#f4f1eb;letter-spacing:.18em;font-weight:700;font-size:18px">Kani Barber Studio</div><main style="background:#fff;padding:34px 24px"><p style="margin:0 0 12px;color:#a37b43;font-size:11px;letter-spacing:.16em;font-weight:700">${copy.status}</p><h1 style="margin:0;font-size:28px;line-height:1.1">${copy.title}</h1><p style="color:#6d6d6d;line-height:1.6;margin:18px 0 28px">Hola ${safe.clientName},<br>${escapeHtml(copy.intro)}</p><div style="border-top:1px solid #e5e0d8;border-bottom:1px solid #e5e0d8;padding:18px 0"><p style="margin:0 0 10px"><strong>Servicio:</strong> ${safe.serviceName}</p><p style="margin:0 0 10px"><strong>Barbero:</strong> ${safe.barberName}</p><p style="margin:0 0 10px"><strong>Fecha:</strong> ${safe.date}</p><p style="margin:0"><strong>Horario:</strong> ${safe.time}</p></div><p style="color:#6d6d6d;line-height:1.6;margin:26px 0 8px">San Isidro Labrador 7<br>Martínez, Provincia de Buenos Aires</p><p style="margin:0"><a href="${mapsUrl}" style="color:#9f173b;font-weight:700;text-decoration:underline">Ver ubicación en Google Maps</a></p></main><p style="color:#8b8b8b;font-size:12px;line-height:1.5;text-align:center;margin:18px 8px">Este mensaje fue enviado automáticamente por Kani Barber Studio.</p></div></body></html>`;
  const text = `${copy.title}\n\nHola ${payload.clientName},\n${copy.intro}\n\nServicio: ${payload.serviceName}\nBarbero: ${payload.barberName}\nFecha: ${date}\nHorario: ${time}\n\nKani Barber Studio\nSan Isidro Labrador 7, Martínez, Provincia de Buenos Aires\nVer ubicación en Google Maps: ${mapsUrl}`;
  return { subject, html, text };
}

export function buildNewRequestEmail(payload: NotificationPayload, date: string, time: string) {
  if (
    !payload.servicePriceArs ||
    !payload.serviceDurationMinutes ||
    !payload.downPaymentArs ||
    !payload.transferAlias ||
    !payload.transferCuit ||
    !payload.transferHolderName
  ) {
    throw new Error("TRANSFER_DETAILS_INCOMPLETE");
  }

  const remainingPayment = Math.max(0, payload.servicePriceArs - payload.downPaymentArs);
  const safe = {
    clientName: escapeHtml(payload.clientName),
    barberName: escapeHtml(payload.barberName),
    serviceName: escapeHtml(payload.serviceName),
    date: escapeHtml(date),
    time: escapeHtml(time),
    servicePrice: escapeHtml(formatArs(payload.servicePriceArs)),
    downPayment: escapeHtml(formatArs(payload.downPaymentArs)),
    remainingPayment: escapeHtml(formatArs(remainingPayment)),
    transferAlias: escapeHtml(payload.transferAlias),
    transferCuit: escapeHtml(payload.transferCuit),
    transferHolderName: escapeHtml(payload.transferHolderName),
  };
  const mapsUrl =
    "https://www.google.com/maps/place/KANI+BARBER+STUDIO/data=!4m2!3m1!1s0x0:0x48bcfe7b2ea7ba60";
  const subject = "Aboná la seña para confirmar tu turno en Kani Barber Studio";
  const title = "Aboná la seña para confirmar tu turno";
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#f3efe8;color:#1c1c1c;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.55"><div style="width:100%;padding:24px 12px;box-sizing:border-box"><div style="max-width:600px;margin:0 auto"><header style="background:#161616;padding:22px 24px;color:#f4f1eb;letter-spacing:.14em;font-size:16px;font-weight:700">Kani Barber Studio</header><main style="background:#fff;padding:30px 24px"><h1 style="margin:0;color:#161616;font-size:28px;line-height:1.15;font-weight:700">${title}</h1><p style="margin:18px 0 24px;color:#555;line-height:1.65">Hola ${safe.clientName}:<br><br>Para confirmar tu turno, transferí la seña con los siguientes datos.</p><section style="margin:0 0 26px;padding:18px 20px;background:#f3e7d3;border-left:4px solid #a37b43"><p style="margin:0 0 4px;color:#765529;font-size:12px;letter-spacing:.08em;text-transform:uppercase;font-weight:700">Seña a transferir</p><p style="margin:0;color:#161616;font-size:32px;line-height:1.1;font-weight:700">${safe.downPayment}</p></section><section style="margin:0 0 26px;padding:20px;background:#faf9f6;border:1px solid #e5e0d8"><h2 style="margin:0 0 16px;color:#161616;font-size:18px;line-height:1.25">Datos para la transferencia</h2><div style="border-top:1px solid #e5e0d8"><p style="margin:0;padding:10px 0;border-bottom:1px solid #e5e0d8"><strong style="display:inline-block;width:86px;color:#6d6d6d;font-size:12px">Titular</strong><span style="overflow-wrap:anywhere">${safe.transferHolderName}</span></p><p style="margin:0;padding:10px 0;border-bottom:1px solid #e5e0d8"><strong style="display:inline-block;width:86px;color:#6d6d6d;font-size:12px">Alias</strong><span style="overflow-wrap:anywhere;font-weight:700">${safe.transferAlias}</span></p><p style="margin:0;padding:10px 0 0"><strong style="display:inline-block;width:86px;color:#6d6d6d;font-size:12px">CUIT</strong><span style="overflow-wrap:anywhere">${safe.transferCuit}</span></p></div></section><section style="margin:0 0 26px;padding:0 0 22px;border-bottom:1px solid #e5e0d8"><h2 style="margin:0 0 16px;color:#161616;font-size:18px;line-height:1.25">Datos de tu turno</h2><p style="margin:0 0 9px"><strong style="color:#6d6d6d;font-size:12px">Servicio</strong><br>${safe.serviceName} · ${payload.serviceDurationMinutes} min</p><p style="margin:0 0 9px"><strong style="color:#6d6d6d;font-size:12px">Barbero</strong><br>${safe.barberName}</p><p style="margin:0 0 9px"><strong style="color:#6d6d6d;font-size:12px">Fecha</strong><br>${safe.date}</p><p style="margin:0 0 16px"><strong style="color:#6d6d6d;font-size:12px">Horario</strong><br>${safe.time}</p><p style="margin:0 0 7px"><strong>Precio total del servicio:</strong> ${safe.servicePrice}</p><p style="margin:0"><strong>Importe restante en el local:</strong> ${safe.remainingPayment}</p></section><section style="margin:0 0 24px"><p style="margin:0 0 10px"><strong>Kani Barber Studio</strong> · San Isidro Labrador 7, Martínez</p><a href="${mapsUrl}" style="display:inline-block;color:#9f173b;font-weight:700;text-decoration:underline;text-underline-offset:3px">Ver ubicación en Google Maps</a></section><section style="margin:0;padding:16px 18px;background:#f8f5ef;color:#555;border-left:3px solid #c9b28b"><strong style="color:#333">Importante:</strong> tu turno todavía no está confirmado. Una vez verificado el pago de la seña, el barbero deberá confirmar tu turno. Te enviaremos un email cuando esté confirmado.</section><p style="margin:24px 0 0;color:#555">¡Gracias por elegir Kani Barber Studio!</p></main><footer style="color:#8b8b8b;font-size:12px;line-height:1.5;text-align:center;padding:16px 8px">Mensaje automático de Kani Barber Studio.</footer></div></div></body></html>`;
  const text = `${title}\n\nHola ${payload.clientName}:\n\nPara confirmar tu turno, transferí la seña con los siguientes datos.\n\nSEÑA A TRANSFERIR\n${formatArs(payload.downPaymentArs)}\n\nDATOS PARA LA TRANSFERENCIA\nTitular: ${payload.transferHolderName}\nAlias: ${payload.transferAlias}\nCUIT: ${payload.transferCuit}\n\nDATOS DE TU TURNO\nServicio: ${payload.serviceName} · ${payload.serviceDurationMinutes} min\nBarbero: ${payload.barberName}\nFecha: ${date}\nHorario: ${time}\nPrecio total del servicio: ${formatArs(payload.servicePriceArs)}\nImporte restante en el local: ${formatArs(remainingPayment)}\n\nKani Barber Studio · San Isidro Labrador 7, Martínez\nVer ubicación en Google Maps: ${mapsUrl}\n\nImportante: tu turno todavía no está confirmado. Una vez verificado el pago de la seña, el barbero deberá confirmar tu turno. Te enviaremos un email cuando esté confirmado.\n\n¡Gracias por elegir Kani Barber Studio!\n\nMensaje automático de Kani Barber Studio.`;
  return { subject, html, text };
}

function formatArs(value: number) {
  return `$ ${value.toLocaleString("es-AR")}`;
}

function escapeHtml(value: string) {
  return value.replace(
    /[&<>'"]/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        "'": "&#39;",
        '"': "&quot;",
      })[character] ?? character,
  );
}

function safeErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/Bearer\s+[^\s]+/gi, "Bearer [redacted]").slice(0, 500);
}
