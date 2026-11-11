import { createServerFn } from "@tanstack/react-start";
import { buildCancellationUrl } from "./kani-cancellation-token";
import { confirmationEmailLogo } from "./kani-confirmation-email-brand";
import {
  KANI_MAPS_URL,
  KANI_PUBLIC_WHATSAPP_URL,
  KANI_STUDIO_FULL_ADDRESS,
} from "./kani-constants";
import { notificationSubject } from "./kani-email-environment";
import { addCalendarDays, businessDateToday } from "./kani-mobile-appointments";
import { formatServiceNameForEmail } from "./kani-model";
import { getRuntimeEnv } from "./kani-notifications.server";

export interface GroupedSeriesAppointmentItem {
  id: string;
  bookingDate: string; // YYYY-MM-DD
  startTime: string; // HH:MM
  endTime?: string; // HH:MM
  serviceName: string;
  barberName: string;
  servicePriceArs?: number | null;
}

export interface GroupedSeriesEmailPayload {
  clientName: string;
  recipientEmail: string;
  barberName: string;
  serviceName: string;
  frequencyLabel: string;
  appointments: GroupedSeriesAppointmentItem[];
  membershipPlanName?: string | null;
  appUrl?: string;
}

export interface ReminderEmailPayload {
  appointmentId: string;
  clientName: string;
  recipientEmail: string;
  barberName: string;
  serviceName: string;
  bookingDate: string; // YYYY-MM-DD
  startTime: string; // HH:MM
  endTime?: string; // HH:MM
  appUrl?: string;
}

const WEEKDAY_NAMES_ES = [
  "Domingo",
  "Lunes",
  "Martes",
  "Miércoles",
  "Jueves",
  "Viernes",
  "Sábado",
];

function escapeHtml(value: string): string {
  return (value || "").replace(
    /[&<>'"]/g,
    (ch) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        "'": "&#39;",
        '"': "&quot;",
      })[ch] ?? ch,
  );
}

function maskEmail(email?: string | null): string {
  if (!email || !email.includes("@")) return "anonymized";
  const [local, domain] = email.split("@");
  const visible = local.length > 2 ? local.slice(0, 2) + "***" : "***";
  return `${visible}@${domain}`;
}

export function formatFriendlyDateEs(ymd: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec((ymd || "").trim());
  if (!match) return ymd;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const dt = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  const weekday = WEEKDAY_NAMES_ES[dt.getUTCDay()] || "";
  return `${weekday} ${String(day).padStart(2, "0")}/${String(month).padStart(2, "0")}/${year}`;
}

/**
 * Construye el correo agrupado de confirmación de turnos recurrentes (FASE 10):
 * Asunto oficial: «KANI Barber Studio — Tus próximos turnos»
 * Incluye la lista de fechas y horarios generados y el link individual de cancelación para cada ocurrencia.
 */
export function buildRecurringSeriesGroupedEmail(payload: GroupedSeriesEmailPayload): {
  subject: string;
  html: string;
  text: string;
} {
  const subject = "KANI Barber Studio — Tus próximos turnos";
  const logoUrl = confirmationEmailLogo(payload.appUrl);
  const safeClient = escapeHtml(payload.clientName || "Cliente");
  const safeBarber = escapeHtml(payload.barberName || "Kani Barber Studio");
  const safeService = escapeHtml(formatServiceNameForEmail(payload.serviceName || "Corte"));
  const safeFreq = escapeHtml(payload.frequencyLabel || "Recurrente");
  const safeMembership = payload.membershipPlanName ? escapeHtml(payload.membershipPlanName) : null;

  const sortedAppointments = [...payload.appointments].sort((a, b) =>
    `${a.bookingDate}T${a.startTime}`.localeCompare(`${b.bookingDate}T${b.startTime}`),
  );

  const rowsHtml = sortedAppointments
    .map((apt) => {
      const cancelUrl = buildCancellationUrl(apt.id, payload.appUrl);
      const dateStr = escapeHtml(formatFriendlyDateEs(apt.bookingDate));
      const timeStr = escapeHtml((apt.startTime || "").slice(0, 5));
      return `
        <tr>
          <td style="padding: 12px 14px; border-bottom: 1px solid #2A2A2A; font-family: 'Inter', Arial, sans-serif; font-size: 14px; color: #F5F5F5;">
            <strong>${dateStr}</strong> — ${timeStr} hs
          </td>
          <td align="right" style="padding: 12px 14px; border-bottom: 1px solid #2A2A2A; font-family: 'Inter', Arial, sans-serif; font-size: 13px;">
            <a href="${cancelUrl}" target="_blank" rel="noopener noreferrer" style="color: #E07A7A; text-decoration: underline; font-weight: 600;">
              Cancelar este turno
            </a>
          </td>
        </tr>`;
    })
    .join("");

  const rowsText = sortedAppointments
    .map((apt) => {
      const cancelUrl = buildCancellationUrl(apt.id, payload.appUrl);
      const dateStr = formatFriendlyDateEs(apt.bookingDate);
      const timeStr = (apt.startTime || "").slice(0, 5);
      return `• ${dateStr} — ${timeStr} hs\n  Cancelar este turno: ${cancelUrl}`;
    })
    .join("\n\n");

  const membershipHtml = safeMembership
    ? `<p style="margin: 12px 0 0; font-size: 13px; color: #C8A96B;"><strong>Cobertura:</strong> ${safeMembership}</p>`
    : "";

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${subject}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #0D0D0D; color: #F5F5F5; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: #0D0D0D; padding: 24px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width: 600px; background-color: #161616; border: 1px solid #2A2A2A; border-radius: 16px; overflow: hidden;">
          <tr>
            <td align="center" style="padding: 28px 24px 16px;">
              <img src="${logoUrl}" alt="Kani Barber Studio" width="84" style="display: block; width: 84px; height: auto; margin: 0 auto 16px;" />
              <span style="display: inline-block; padding: 5px 12px; border-radius: 999px; background-color: rgba(200, 169, 107, 0.16); color: #C8A96B; font-size: 11px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase;">
                Turnos programados
              </span>
              <h1 style="margin: 14px 0 8px; font-size: 24px; line-height: 1.25; color: #FFFFFF;">
                Tus próximos turnos en KANI Barber Studio
              </h1>
              <p style="margin: 0; font-size: 14px; line-height: 1.55; color: #B8B8B8;">
                Hola ${safeClient}, agendamos tu serie de turnos con <strong>${safeBarber}</strong> (${safeService} · ${safeFreq}).
              </p>
              ${membershipHtml}
            </td>
          </tr>
          <tr>
            <td style="padding: 16px 24px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: #1E1E1E; border: 1px solid #2E2E2E; border-radius: 12px; overflow: hidden;">
                <thead>
                  <tr style="background-color: #242424;">
                    <th align="left" style="padding: 10px 14px; font-size: 12px; text-transform: uppercase; letter-spacing: 0.06em; color: #A0A0A0;">Fecha y hora</th>
                    <th align="right" style="padding: 10px 14px; font-size: 12px; text-transform: uppercase; letter-spacing: 0.06em; color: #A0A0A0;">Gestión individual</th>
                  </tr>
                </thead>
                <tbody>
                  ${rowsHtml}
                </tbody>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding: 8px 24px 20px;">
              <div style="padding: 14px 16px; border-radius: 10px; background-color: rgba(200, 169, 107, 0.08); border-left: 3px solid #C8A96B; font-size: 13px; line-height: 1.5; color: #D4D4D4;">
                Se establece una tolerancia de 10 minutos a partir del horario reservado. Transcurrido ese plazo, el turno podrá ser cancelado para respetar la atención de los siguientes clientes.
              </div>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding: 8px 24px 28px; font-size: 12px; color: #8C8C8C;">
              <p style="margin: 0 0 6px; color: #F5F5F5; font-weight: 600;">Kani Barber Studio</p>
              <p style="margin: 0 0 10px;">${KANI_STUDIO_FULL_ADDRESS}</p>
              <a href="${KANI_MAPS_URL}" style="color: #C8A96B; text-decoration: underline; margin-right: 12px;">Cómo llegar</a>
              <a href="${KANI_PUBLIC_WHATSAPP_URL}" style="color: #C8A96B; text-decoration: underline;">Contactar por WhatsApp</a>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const text = `${subject}

Hola ${payload.clientName || "Cliente"}, agendamos tus próximos turnos en KANI Barber Studio:

Servicio: ${formatServiceNameForEmail(payload.serviceName || "Corte")}
Barbero: ${payload.barberName}
Frecuencia: ${payload.frequencyLabel}${payload.membershipPlanName ? `\nCobertura: ${payload.membershipPlanName}` : ""}

PRÓXIMAS FECHAS:
${rowsText}

IMPORTANTE:
Se establece una tolerancia de 10 minutos a partir del horario reservado. Transcurrido ese plazo, el turno podrá ser cancelado para respetar la atención de los siguientes clientes.

Dirección: ${KANI_STUDIO_FULL_ADDRESS}
Ubicación: ${KANI_MAPS_URL}
WhatsApp: ${KANI_PUBLIC_WHATSAPP_URL}`;

  return { subject, html, text };
}

/**
 * Construye el correo de recordatorio automático enviado el día anterior al turno (FASE 10).
 */
export function buildAppointmentReminderEmail(payload: ReminderEmailPayload): {
  subject: string;
  html: string;
  text: string;
} {
  const subject = "KANI Barber Studio — Recordatorio de tu turno de mañana";
  const logoUrl = confirmationEmailLogo(payload.appUrl);
  const cancelUrl = buildCancellationUrl(payload.appointmentId, payload.appUrl);
  const safeClient = escapeHtml(payload.clientName || "Cliente");
  const safeBarber = escapeHtml(payload.barberName || "Kani Barber Studio");
  const safeService = escapeHtml(formatServiceNameForEmail(payload.serviceName || "Corte"));
  const safeDate = escapeHtml(formatFriendlyDateEs(payload.bookingDate));
  const safeTime = escapeHtml((payload.startTime || "").slice(0, 5));

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${subject}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #0D0D0D; color: #F5F5F5; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: #0D0D0D; padding: 24px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width: 600px; background-color: #161616; border: 1px solid #2A2A2A; border-radius: 16px; overflow: hidden;">
          <tr>
            <td align="center" style="padding: 28px 24px 16px;">
              <img src="${logoUrl}" alt="Kani Barber Studio" width="84" style="display: block; width: 84px; height: auto; margin: 0 auto 16px;" />
              <span style="display: inline-block; padding: 5px 12px; border-radius: 999px; background-color: rgba(200, 169, 107, 0.16); color: #C8A96B; font-size: 11px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase;">
                Recordatorio de turno
              </span>
              <h1 style="margin: 14px 0 8px; font-size: 24px; line-height: 1.25; color: #FFFFFF;">
                ¡Te esperamos mañana en KANI!
              </h1>
              <p style="margin: 0; font-size: 14px; line-height: 1.55; color: #B8B8B8;">
                Hola ${safeClient}, te recordamos los datos de tu turno reservado para mañana:
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding: 16px 24px;">
              <div style="background-color: #1E1E1E; border: 1px solid #2E2E2E; border-radius: 12px; padding: 18px;">
                <p style="margin: 0 0 8px; font-size: 15px; color: #FFFFFF;"><strong>Fecha:</strong> ${safeDate}</p>
                <p style="margin: 0 0 8px; font-size: 15px; color: #FFFFFF;"><strong>Hora:</strong> ${safeTime} hs</p>
                <p style="margin: 0 0 8px; font-size: 15px; color: #FFFFFF;"><strong>Servicio:</strong> ${safeService}</p>
                <p style="margin: 0; font-size: 15px; color: #FFFFFF;"><strong>Barbero:</strong> ${safeBarber}</p>
              </div>
            </td>
          </tr>
          <tr>
            <td style="padding: 4px 24px 20px;">
              <div style="padding: 14px 16px; border-radius: 10px; background-color: rgba(200, 169, 107, 0.08); border-left: 3px solid #C8A96B; font-size: 13px; line-height: 1.5; color: #D4D4D4;">
                Se establece una tolerancia de 10 minutos a partir del horario reservado. Transcurrido ese plazo, el turno podrá ser cancelado para respetar la atención de los siguientes clientes.
              </div>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding: 0 24px 24px;">
              <a href="${cancelUrl}" target="_blank" rel="noopener noreferrer" style="display: inline-block; padding: 11px 18px; border-radius: 8px; border: 1px solid #6E3434; color: #F29B9B; text-decoration: none; font-size: 13px; font-weight: 600;">
                ¿No podés asistir? Cancelar turno
              </a>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding: 8px 24px 28px; font-size: 12px; color: #8C8C8C;">
              <p style="margin: 0 0 6px; color: #F5F5F5; font-weight: 600;">Kani Barber Studio</p>
              <p style="margin: 0;">${KANI_STUDIO_FULL_ADDRESS}</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const text = `${subject}

Hola ${payload.clientName || "Cliente"}, te recordamos los datos de tu turno de mañana en KANI Barber Studio:

Fecha: ${formatFriendlyDateEs(payload.bookingDate)}
Hora: ${(payload.startTime || "").slice(0, 5)} hs
Servicio: ${formatServiceNameForEmail(payload.serviceName || "Corte")}
Barbero: ${payload.barberName}

Se establece una tolerancia de 10 minutos a partir del horario reservado. Transcurrido ese plazo, el turno podrá ser cancelado para respetar la atención de los siguientes clientes.

Cancelar turno: ${cancelUrl}
Dirección: ${KANI_STUDIO_FULL_ADDRESS}`;

  return { subject, html, text };
}

export async function sendRecurringSeriesGroupedEmailOnServer(
  payload: GroupedSeriesEmailPayload & { ruleId?: string },
): Promise<{ sent: boolean; messageId?: string; skippedReason?: string }> {
  if (!payload.recipientEmail || !payload.recipientEmail.includes("@")) {
    return { sent: false, skippedReason: "NO_RECIPIENT_EMAIL" };
  }
  if (!payload.appointments || payload.appointments.length === 0) {
    return { sent: false, skippedReason: "NO_APPOINTMENTS_TO_NOTIFY" };
  }

  const apiKey = getRuntimeEnv("RESEND_API_KEY")?.trim();
  const fromEmail = getRuntimeEnv("RESEND_FROM_EMAIL")?.trim();
  if (!apiKey || !fromEmail) {
    return { sent: false, skippedReason: "RESEND_NOT_CONFIGURED" };
  }

  let db: any = null;
  const ids = payload.appointments.map((a) => a.id);
  const leaseCutoff = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const claimTimestamp = new Date().toISOString();

  // Reclamo atómico previo al envío con lease de 10 min para impedir duplicados concurrentes y evitar bloqueos permanentes
  try {
    const { createPaymentSupabaseClient } = await import("./kani-payment-db.server");
    db = await createPaymentSupabaseClient();
    const { data: claimedRows, error: claimErr } = await db
      .from("appointments")
      .update({ grouped_notification_claim_at: claimTimestamp })
      .in("id", ids)
      .is("grouped_notification_sent_at", null)
      .or(`grouped_notification_claim_at.is.null,grouped_notification_claim_at.lt.${leaseCutoff}`)
      .select("id");

    if (!claimErr && Array.isArray(claimedRows) && claimedRows.length === 0) {
      return { sent: false, skippedReason: "ALREADY_NOTIFIED_OR_CLAIMED" };
    }
  } catch {
    // Si estamos en entorno de test sin DB real, continuamos hacia Resend
  }

  const email = buildRecurringSeriesGroupedEmail(payload);
  const subject = notificationSubject(
    email.subject,
    getRuntimeEnv("KANI_ENVIRONMENT"),
    getRuntimeEnv("SUPABASE_URL") ?? getRuntimeEnv("VITE_SUPABASE_URL"),
  );

  const idempotencyKey = `recurring-series-${payload.ruleId || "manual"}-${payload.appointments[0]!.id}-${payload.appointments.length}`;

  let response: Response;
  try {
    response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify({
        from: fromEmail,
        to: [payload.recipientEmail.trim()],
        subject,
        html: email.html,
        text: email.text,
      }),
    });
  } catch (err) {
    if (db) {
      await db
        .from("appointments")
        .update({ grouped_notification_claim_at: null })
        .in("id", ids)
        .eq("grouped_notification_claim_at", claimTimestamp)
        .catch(() => null);
    }
    console.warn(`[KANI grouped email] Error al despachar a ${maskEmail(payload.recipientEmail)}:`, err instanceof Error ? err.message : "NETWORK_ERROR");
    return { sent: false, skippedReason: err instanceof Error ? err.message : "NETWORK_ERROR" };
  }

  const result = (await response.json().catch(() => null)) as { id?: string; message?: string } | null;
  if (!response.ok || !result?.id) {
    if (db) {
      await db
        .from("appointments")
        .update({ grouped_notification_claim_at: null })
        .in("id", ids)
        .eq("grouped_notification_claim_at", claimTimestamp)
        .catch(() => null);
    }
    console.warn(`[KANI grouped email] Error HTTP (${response.status}) de Resend para ${maskEmail(payload.recipientEmail)}`);
    return { sent: false, skippedReason: result?.message || `HTTP_${response.status}` };
  }

  if (db) {
    await db
      .from("appointments")
      .update({
        grouped_notification_sent_at: new Date().toISOString(),
        grouped_notification_claim_at: null,
      })
      .in("id", ids)
      .catch(() => null);
  }

  return { sent: true, messageId: result.id };
}

export const sendRecurringSeriesGroupedEmailServerFn = createServerFn({ method: "POST" })
  .validator((data: GroupedSeriesEmailPayload & { ruleId?: string }) => data)
  .handler(async ({ data }) => sendRecurringSeriesGroupedEmailOnServer(data));

/**
 * Tarea programada (cron):
 * 1. Sincroniza la ventana móvil de 90 días para todas las reglas activas de turnos recurrentes
 *    y envía confirmación agrupada para las nuevas ocurrencias generadas.
 * 2. Envía el recordatorio automático el día anterior a cada turno confirmado (sin duplicar ni enviar a cancelados).
 */
export async function runScheduledRecurrencesAndReminders(): Promise<{
  syncedRules: number;
  generatedOccurrences: number;
  groupedEmailsSent: number;
  remindersSent: number;
}> {
  let syncedRules = 0;
  let generatedOccurrences = 0;
  let groupedEmailsSent = 0;
  let remindersSent = 0;

  try {
    const { createPaymentSupabaseClient } = await import("./kani-payment-db.server");
    const db = await createPaymentSupabaseClient();

    // 1. Sincronizar ventana móvil de 90 días
    const { data: syncRows, error: syncErr } = await (db as any).rpc(
      "sync_recurring_appointment_rules",
      { p_horizon_days: 90, p_rule_id: null },
    );

    if (!syncErr && Array.isArray(syncRows)) {
      syncedRules = syncRows.length;
      for (const row of syncRows) {
        const count = Number(row.generated_appointments ?? 0);
        generatedOccurrences += count;
        const createdIds = (row.created_appointment_ids ?? []) as string[];
        if (count > 0 && createdIds.length > 0) {
          const { data: apts } = await (db as any)
            .from("appointments")
            .select("id, booking_date, start_time, end_time, service_price_ars, client_id, barber_id, service_id, custom_service_name, grouped_notification_sent_at")
            .in("id", createdIds)
            .is("grouped_notification_sent_at", null);

          if (apts && apts.length > 0) {
            const first = apts[0];
            const [{ data: client }, { data: barber }, { data: service }] = await Promise.all([
              db.from("clients").select("name, email").eq("id", first.client_id).maybeSingle(),
              db.from("barbers").select("name").eq("id", first.barber_id).maybeSingle(),
              first.service_id
                ? db.from("services").select("name").eq("id", first.service_id).maybeSingle()
                : Promise.resolve({ data: null }),
            ]);

            if (client?.email) {
              const serviceName = first.custom_service_name || service?.name || "Corte";
              const barberName = barber?.name || "Kani Barber Studio";
              const res = await sendRecurringSeriesGroupedEmailOnServer({
                ruleId: row.rule_id,
                clientName: client.name || "Cliente",
                recipientEmail: client.email,
                barberName,
                serviceName,
                frequencyLabel: "Renovación automática de agenda (ventana de 90 días)",
                appointments: apts.map((a: any) => ({
                  id: a.id,
                  bookingDate: a.booking_date,
                  startTime: (a.start_time || "").slice(0, 5),
                  endTime: (a.end_time || "").slice(0, 5),
                  serviceName,
                  barberName,
                  servicePriceArs: a.service_price_ars,
                })),
              });
              if (res.sent) groupedEmailsSent++;
            }
          }
        }
      }
    }

    // 2. Despachar recordatorios del día anterior (mañana en America/Argentina/Buenos_Aires)
    const today = businessDateToday();
    const tomorrow = addCalendarDays(today, 1);
    const reminderLeaseCutoff = new Date(Date.now() - 10 * 60 * 1000).toISOString();

    const { data: tomorrowAppointments } = await (db as any)
      .from("appointments")
      .select("id, client_id, barber_id, service_id, custom_service_name, booking_date, start_time, end_time, status, reminder_sent_at, reminder_claim_at, booking_client_name")
      .eq("booking_date", tomorrow)
      .eq("status", "CONFIRMED")
      .is("reminder_sent_at", null)
      .or(`reminder_claim_at.is.null,reminder_claim_at.lt.${reminderLeaseCutoff}`)
      .limit(50);

    const apiKey = getRuntimeEnv("RESEND_API_KEY")?.trim();
    const fromEmail = getRuntimeEnv("RESEND_FROM_EMAIL")?.trim();

    if (tomorrowAppointments && tomorrowAppointments.length > 0 && apiKey && fromEmail) {
      for (const apt of tomorrowAppointments) {
        if (apt.status !== "CONFIRMED" || apt.reminder_sent_at) continue;

        const [{ data: client }, { data: barber }, { data: service }] = await Promise.all([
          db.from("clients").select("name, email").eq("id", apt.client_id).maybeSingle(),
          db.from("barbers").select("name").eq("id", apt.barber_id).maybeSingle(),
          apt.service_id
            ? db.from("services").select("name").eq("id", apt.service_id).maybeSingle()
            : Promise.resolve({ data: null }),
        ]);

        if (!client?.email || !client.email.includes("@")) continue;

        // Reclamo atómico con lease de 10 min para evitar duplicados concurrentes y bloqueos permanentes tras crash
        const claimTimestamp = new Date().toISOString();
        const { data: claimedRows, error: claimErr } = await (db as any)
          .from("appointments")
          .update({ reminder_claim_at: claimTimestamp })
          .eq("id", apt.id)
          .eq("status", "CONFIRMED")
          .is("reminder_sent_at", null)
          .or(`reminder_claim_at.is.null,reminder_claim_at.lt.${reminderLeaseCutoff}`)
          .select("id");

        if (!claimErr && Array.isArray(claimedRows) && claimedRows.length === 0) {
          continue;
        }

        const reminder = buildAppointmentReminderEmail({
          appointmentId: apt.id,
          clientName: apt.booking_client_name || client.name || "Cliente",
          recipientEmail: client.email,
          barberName: barber?.name || "Kani Barber Studio",
          serviceName: apt.custom_service_name || service?.name || "Corte",
          bookingDate: apt.booking_date,
          startTime: (apt.start_time || "").slice(0, 5),
          endTime: (apt.end_time || "").slice(0, 5),
        });

        const subject = notificationSubject(
          reminder.subject,
          getRuntimeEnv("KANI_ENVIRONMENT"),
          getRuntimeEnv("SUPABASE_URL") ?? getRuntimeEnv("VITE_SUPABASE_URL"),
        );

        try {
          const response = await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
              "Idempotency-Key": `reminder-${apt.id}-${apt.booking_date}`,
            },
            body: JSON.stringify({
              from: fromEmail,
              to: [client.email.trim()],
              subject,
              html: reminder.html,
              text: reminder.text,
            }),
          });

          if (response.ok) {
            await (db as any)
              .from("appointments")
              .update({
                reminder_sent_at: new Date().toISOString(),
                reminder_claim_at: null,
              })
              .eq("id", apt.id);
            remindersSent++;
          } else {
            // Revertir marca de reclamo para permitir reintento en la próxima ejecución del cron
            await (db as any)
              .from("appointments")
              .update({ reminder_claim_at: null })
              .eq("id", apt.id)
              .eq("reminder_claim_at", claimTimestamp);
            console.warn(`[KANI reminder] Error HTTP (${response.status}) de Resend para cliente ${maskEmail(client.email)}`);
          }
        } catch (dispatchErr) {
          await (db as any)
            .from("appointments")
            .update({ reminder_claim_at: null })
            .eq("id", apt.id)
            .eq("reminder_claim_at", claimTimestamp);
          console.warn(`[KANI reminder] Error de red hacia Resend para cliente ${maskEmail(client.email)}:`, dispatchErr instanceof Error ? dispatchErr.message : "NETWORK_ERROR");
        }
      }
    }
  } catch (err) {
    console.warn("[KANI recurrences cron] Error en tarea programada:", err instanceof Error ? err.message : "UNKNOWN_ERROR");
  }

  return { syncedRules, generatedOccurrences, groupedEmailsSent, remindersSent };
}
