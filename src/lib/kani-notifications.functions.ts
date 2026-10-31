import { createServerFn, createServerOnlyFn } from "@tanstack/react-start";
import { notificationSubject } from './kani-email-environment';
import { KANI_MAPS_URL, KANI_STANDARD_DEPOSIT_ARS } from './kani-constants';

import type { Database } from "@/integrations/supabase/types";

type NotificationType = Database["public"]["Enums"]["notification_type"];
type NotificationClaim = {
  notification_id: string;
  notification_type: NotificationType;
  recipient_email: string | null;
  recipient_phone?: string | null;
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
  recipientPhone?: string | null;
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
  .validator((data: { appointmentId: string; claimToken: string; clientPhone?: string }) => {
    if (!data?.appointmentId || !data?.claimToken) throw new Error("NOTIFICATION_INPUT_INVALID");
    return data;
  })
  .handler(async ({ data }): Promise<DispatchResult> => dispatchAppointmentNotification(data));

// Plain server dispatcher also works from the raw Worker webhook (no TanStack request context).
export const dispatchAppointmentNotification = createServerOnlyFn(async (data: { appointmentId: string; claimToken: string; clientPhone?: string | null }): Promise<DispatchResult> => {
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
      if (event.notification_type === "NEW_REQUEST") {
        console.log(`[KANI notification] Omitiendo email NEW_REQUEST para turno ${data.appointmentId} (flujo Mercado Pago).`);
        return { sent: false, status: "SKIPPED" };
      }
      if (event.dispatch_status === "ALREADY_SENT") return { sent: true, status: "ALREADY_SENT" };
      if (event.dispatch_status === "IN_PROGRESS") return { sent: false, status: "IN_PROGRESS" };
      const recipientPhone = event.recipient_phone ?? data.clientPhone ?? null;
      let emailSuccess = false;
      let emailMessageId: string | undefined;
      let emailError: string | undefined;
      let pontiunSuccess = false;
      let pontiunMessageId: string | undefined;
      let pontiunError: string | undefined;

      // 1. Despacho de WhatsApp vía Pontiun (prioritario para turnos CONFIRMED)
      if (event.notification_type === "CONFIRMED") {
        const hasRecipientPhoneKey = "recipient_phone" in event;
        const clientHasRegisteredPhone = Boolean(recipientPhone && recipientPhone.trim());
        let whatsappStatus = "SKIPPED";
        let whatsappErrorCode: string | null = null;
        let whatsappErrorDesc: string | null = null;
        let whatsappIncrement = false;

        if (clientHasRegisteredPhone) {
          try {
            const { sendPontiunAppointmentConfirmation } = await import("./kani-pontiun");
            const pontiunResult = await sendPontiunAppointmentConfirmation({
              appointmentId: data.appointmentId,
              clientName: event.client_name,
              clientPhone: recipientPhone,
              barberName: event.barber_name,
              serviceName: event.service_name,
              bookingDate: event.booking_date,
              startTime: event.start_time,
            });

            if (pontiunResult.success) {
              pontiunSuccess = true;
              pontiunMessageId = pontiunResult.messageId;
              whatsappStatus = "PROVIDER_ACCEPTED";
              whatsappIncrement = true;
              console.log(
                `[Pontiun WhatsApp] Confirmación enviada/aceptada para turno ${data.appointmentId} (id: ${pontiunResult.messageId})`,
              );
            } else if (pontiunResult.skipped) {
              whatsappStatus = "SKIPPED";
              whatsappErrorDesc = pontiunResult.error ?? "Envío omitido";
              console.info(
                `[Pontiun WhatsApp] Envío omitido de forma segura para turno ${data.appointmentId}: ${pontiunResult.error}`,
              );
            } else {
              pontiunError = pontiunResult.error;
              whatsappStatus = "FAILED";
              whatsappErrorDesc = pontiunResult.error ?? null;
              whatsappIncrement = true;
              if (pontiunResult.error?.includes("131042")) {
                whatsappErrorCode = "131042";
              } else if (pontiunResult.error?.includes("TEMPLATE_NOT_APPROVED")) {
                whatsappErrorCode = "TEMPLATE_NOT_APPROVED";
              } else {
                whatsappErrorCode = "PONTIUN_ERROR";
              }
              console.warn(
                `[Pontiun WhatsApp] No se pudo enviar confirmación para turno ${data.appointmentId}: ${pontiunResult.error}`,
              );
            }
          } catch (pontiunErr) {
            pontiunError = pontiunErr instanceof Error ? pontiunErr.message : String(pontiunErr);
            whatsappStatus = "FAILED";
            whatsappErrorCode = "PONTIUN_EXCEPTION";
            whatsappErrorDesc = pontiunError;
            whatsappIncrement = true;
            console.warn("[Pontiun WhatsApp] Error durante el despacho:", pontiunError);
          }
        } else if (!hasRecipientPhoneKey && !data.clientPhone) {
          // Error estructural: El RPC no proyectó la columna recipient_phone
          pontiunError = "RPC_STRUCTURAL_ERROR: la función claim_appointment_notification no devolvió la columna recipient_phone";
          whatsappStatus = "FAILED";
          whatsappErrorCode = "RPC_STRUCTURAL_ERROR";
          whatsappErrorDesc = pontiunError;
          console.error(
            `[Pontiun WhatsApp] ${pontiunError} para turno ${data.appointmentId}.`,
          );
        } else {
          // Omisión válida: El cliente genuinamente no registró teléfono
          whatsappStatus = "SKIPPED";
          whatsappErrorDesc = "Cliente sin teléfono registrado";
          console.info(
            `[Pontiun WhatsApp] Turno ${data.appointmentId} no posee teléfono registrado; WhatsApp omitido de forma válida.`,
          );
        }

        try {
          await supabase.rpc("record_channel_dispatch_status", {
            p_appointment_id: data.appointmentId,
            p_notification_event_id: event.notification_id,
            p_channel: "WHATSAPP",
            p_provider: "PONTIUN",
            p_recipient: recipientPhone,
            p_provider_message_id: pontiunMessageId ?? null,
            p_status: whatsappStatus,
            p_error_code: whatsappErrorCode,
            p_error_description: whatsappErrorDesc,
            p_increment_attempt: whatsappIncrement,
          });
        } catch (rpcErr) {
          console.warn("[KANI notification] Error registrando estado de canal WHATSAPP:", rpcErr);
        }
      }

      // 2. Despacho de Email vía Resend (aislado para no bloquear WhatsApp)
      let emailStatus = "SKIPPED";
      let emailErrorCode: string | null = null;
      let emailErrorDesc: string | null = null;
      let emailIncrement = false;

      if (event.recipient_email && event.recipient_email.trim()) {
        try {
          const apiKey = getRuntimeEnv("RESEND_API_KEY")?.trim();
          const fromEmail = getRuntimeEnv("RESEND_FROM_EMAIL")?.trim();
          if (apiKey && fromEmail) {
            const payload: NotificationPayload = {
              notificationId: event.notification_id,
              notificationType: event.notification_type,
              recipientEmail: event.recipient_email,
              recipientPhone,
              clientName: event.client_name,
              barberName: event.barber_name,
              serviceName: event.service_name,
              bookingDate: event.booking_date,
              startTime: event.start_time,
              endTime: event.end_time,
              clientNotes: event.client_notes,
              servicePriceArs: event.service_price_ars,
              serviceDurationMinutes: event.service_duration_minutes,
              downPaymentArs:
                event.down_payment_ars && event.down_payment_ars !== 10000
                  ? event.down_payment_ars
                  : KANI_STANDARD_DEPOSIT_ARS,
              transferAlias: event.transfer_alias,
              transferCuit: event.transfer_cuit,
              transferHolderName: event.transfer_holder_name,
            };
            const email = buildEmail(payload);
            const subject = notificationSubject(
              email.subject,
              getRuntimeEnv("KANI_ENVIRONMENT"),
              getRuntimeEnv("SUPABASE_URL") ?? getRuntimeEnv("VITE_SUPABASE_URL"),
            );
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
            if (response.ok && result?.id) {
              emailSuccess = true;
              emailMessageId = result.id;
              emailStatus = "SENT";
              emailIncrement = true;
              console.log(`[KANI notification] Email enviado exitosamente para turno ${data.appointmentId} (id: ${result.id})`);
            } else {
              emailError = `RESEND_${response.status}: ${result?.message ?? "SEND_FAILED"}`;
              emailStatus = "FAILED";
              emailErrorCode = `RESEND_${response.status}`;
              emailErrorDesc = result?.message ?? "SEND_FAILED";
              emailIncrement = true;
              console.warn(`[KANI notification] Resend HTTP ${response.status}: ${result?.message ?? "SEND_FAILED"}`);
            }
          } else {
            emailStatus = "SKIPPED";
            emailErrorDesc = "Credenciales de Resend no configuradas";
            console.info("[KANI notification] Credenciales de Resend no configuradas; omitiendo email.");
          }
        } catch (emailErr) {
          emailError = emailErr instanceof Error ? emailErr.message : String(emailErr);
          emailStatus = "FAILED";
          emailErrorCode = "RESEND_EXCEPTION";
          emailErrorDesc = emailError;
          emailIncrement = true;
          console.warn("[KANI notification] Error enviando email vía Resend:", emailErr);
        }
      } else {
        emailStatus = "SKIPPED";
        emailErrorDesc = "Cliente sin correo registrado";
        console.log(`[KANI notification] Turno ${data.appointmentId} no posee email registrado; email omitido.`);
      }

      try {
        await supabase.rpc("record_channel_dispatch_status", {
          p_appointment_id: data.appointmentId,
          p_notification_event_id: event.notification_id,
          p_channel: "EMAIL",
          p_provider: "RESEND",
          p_recipient: event.recipient_email,
          p_provider_message_id: emailMessageId ?? null,
          p_status: emailStatus,
          p_error_code: emailErrorCode,
          p_error_description: emailErrorDesc,
          p_increment_attempt: emailIncrement,
        });
      } catch (rpcErr) {
        console.warn("[KANI notification] Error registrando estado de canal EMAIL:", rpcErr);
      }

      const hasSuccess = Boolean(pontiunSuccess || emailSuccess);
      const hasErrors = Boolean(pontiunError || emailError);

      // Caso 1: Despacho completo exitoso (todos los canales aplicables tuvieron éxito, sin fallas)
      if (hasSuccess && !hasErrors) {
        const providerMessageId = [
          pontiunMessageId ? `pontiun:${pontiunMessageId}` : null,
          emailMessageId ? `resend:${emailMessageId}` : null,
        ]
          .filter(Boolean)
          .join("|");

        const { error: completeError } = await supabase.rpc("complete_appointment_notification", {
          p_notification_id: event.notification_id,
          p_claim_token: data.claimToken,
          p_provider_message_id: providerMessageId || "delivered",
        });
        if (completeError) throw completeError;
        return { sent: true, status: "SENT" };
      }

      // Caso 2: Falla parcial (un canal tuvo éxito pero otro falló)
      // Se registra FAILED con detalle explicativo para diagnóstico futuro, sin marcar erróneamente SENT.
      if (hasSuccess && hasErrors) {
        const partialParts = [
          pontiunError ? `WhatsApp falló (${pontiunError})` : (pontiunSuccess ? `WhatsApp enviado (pontiun:${pontiunMessageId})` : null),
          emailError ? `Email falló (${emailError})` : (emailSuccess ? `Email enviado (resend:${emailMessageId})` : null),
        ].filter(Boolean).join(" | ");

        const partialError = `PARTIAL_DISPATCH_FAILURE: ${partialParts}`;
        console.error(`[KANI notification] ${partialError}`);

        const { error: recordError } = await supabase.rpc("fail_appointment_notification", {
          p_notification_id: event.notification_id,
          p_claim_token: data.claimToken,
          p_error: partialError,
        });
        if (recordError) throw recordError;
        return { sent: false, status: "FAILED", errorCode: partialError };
      }

      // Caso 3: Falla total (ningún canal tuvo éxito y se registraron errores)
      if (hasErrors) {
        const errorParts = [
          pontiunError ? `WhatsApp: ${pontiunError}` : null,
          emailError ? `Email: ${emailError}` : null,
        ].filter(Boolean).join(" | ");

        const failureMessage = `NOTIFICATION_DISPATCH_FAILED: ${errorParts}`;
        console.error(`[KANI notification] ${failureMessage}`);

        const { error: recordError } = await supabase.rpc("fail_appointment_notification", {
          p_notification_id: event.notification_id,
          p_claim_token: data.claimToken,
          p_error: failureMessage,
        });
        if (recordError) throw recordError;
        return { sent: false, status: "FAILED", errorCode: failureMessage };
      }

      // Caso 4: Ambos canales fueron omitidos por falta de destinatario o configuración
      return { sent: false, status: "SKIPPED" };
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

export type ChannelDispatchRecord = {
  id: string;
  appointmentId: string;
  notificationEventId: string | null;
  channel: "WHATSAPP" | "EMAIL";
  provider: "PONTIUN" | "RESEND";
  recipient: string | null;
  providerMessageId: string | null;
  status: "PENDING" | "PROCESSING" | "PROVIDER_ACCEPTED" | "SENT" | "DELIVERED" | "READ" | "FAILED" | "SKIPPED" | "UNKNOWN";
  errorCode: string | null;
  errorDescription: string | null;
  attempts: number;
  requestedAt: string;
  deliveredAt: string | null;
  readAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type RetryChannelResult = {
  success: boolean;
  channel: "WHATSAPP" | "EMAIL";
  status: string;
  error?: string;
  blockedByAdminConfig?: boolean;
};

export async function fetchAppointmentNotificationDispatches(
  appointmentIds: string[],
): Promise<Record<string, { whatsapp?: ChannelDispatchRecord; email?: ChannelDispatchRecord }>> {
  if (!appointmentIds || !appointmentIds.length) return {};
  try {
    const supabase = await createRequestSupabaseClient();
    const { data, error } = await (supabase as any)
      .from("appointment_notification_dispatches")
      .select("*")
      .in("appointment_id", appointmentIds);
    if (error) {
      console.warn("[KANI notification] Error al consultar dispatches:", error);
      return {};
    }
    const result: Record<string, { whatsapp?: ChannelDispatchRecord; email?: ChannelDispatchRecord }> = {};
    for (const row of (data ?? [])) {
      if (!result[row.appointment_id]) {
        result[row.appointment_id] = {};
      }
      const record: ChannelDispatchRecord = {
        id: row.id,
        appointmentId: row.appointment_id,
        notificationEventId: row.notification_event_id,
        channel: row.channel,
        provider: row.provider,
        recipient: row.recipient,
        providerMessageId: row.provider_message_id,
        status: row.status,
        errorCode: row.error_code,
        errorDescription: row.error_description,
        attempts: row.attempts,
        requestedAt: row.requested_at,
        deliveredAt: row.delivered_at,
        readAt: row.read_at,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };
      if (row.channel === "WHATSAPP") {
        result[row.appointment_id].whatsapp = record;
      } else if (row.channel === "EMAIL") {
        result[row.appointment_id].email = record;
      }
    }
    return result;
  } catch (err) {
    console.warn("[KANI notification] Falló la consulta de dispatches:", err);
    return {};
  }
}

export async function retryNotificationChannel(input: {
  appointmentId: string;
  channel: "WHATSAPP" | "EMAIL";
}): Promise<RetryChannelResult> {
  const supabase = await createRequestSupabaseClient();

  // 1. Autorización de servidor: validar identidad del usuario autenticado si existe sesión
  const { data: { user } } = await supabase.auth.getUser();
  let staffProfile: { role: string; barber_id: string | null; active: boolean } | null = null;

  if (user) {
    const { data: profile } = await supabase
      .from("staff_profiles")
      .select("role, barber_id, active")
      .eq("user_id", user.id)
      .maybeSingle();
    staffProfile = profile as any;

    if (!staffProfile || !staffProfile.active || (staffProfile.role !== "ADMIN" && staffProfile.role !== "BARBER")) {
      return {
        success: false,
        channel: input.channel,
        status: "FAILED",
        error: "ACCESS_DENIED: No posee permisos de staff para reintentar notificaciones.",
      };
    }
  }

  // 2. Consultar estado previo del despacho
  const { data: dispatches } = await (supabase as any)
    .from("appointment_notification_dispatches")
    .select("*")
    .eq("appointment_id", input.appointmentId)
    .eq("channel", input.channel)
    .maybeSingle();

  // Validaciones rigurosas de estado para reintento seguro
  if (dispatches) {
    // A. El mensaje ya fue entregado o leído
    if (dispatches.status === "DELIVERED" || dispatches.status === "READ") {
      return {
        success: false,
        channel: input.channel,
        status: dispatches.status,
        error: "RETRY_NOT_ALLOWED: La notificación ya fue entregada al cliente.",
      };
    }

    // B. Existe una operación en curso
    if (dispatches.status === "PROCESSING") {
      return {
        success: false,
        channel: input.channel,
        status: "PROCESSING",
        error: "RETRY_NOT_ALLOWED: Existe una operación de notificación en curso para este canal.",
      };
    }

    // C. Riesgo de duplicar: el mensaje ya fue aceptado por el proveedor y se encuentra en tránsito
    if (dispatches.status === "PROVIDER_ACCEPTED" || dispatches.status === "SENT") {
      return {
        success: false,
        channel: input.channel,
        status: dispatches.status,
        error: "RETRY_NOT_ALLOWED: La notificación ya fue aceptada por el proveedor y se encuentra en tránsito.",
      };
    }

    // D. Bloqueo estricto si el error es 131042 (Meta currency billing issue)
    if (input.channel === "WHATSAPP" && dispatches.error_code === "131042") {
      return {
        success: false,
        channel: "WHATSAPP",
        status: "FAILED",
        blockedByAdminConfig: true,
        error:
          "ADMIN_CONFIGURATION_BLOCK: Meta rechazó el mensaje por un problema de facturación (código 131042: la moneda de la cuenta de WhatsApp Business no está configurada). Debe resolverse la configuración en Meta Business Suite antes de reintentar.",
      };
    }

    // E. La falla debe estar confirmada
    if (dispatches.status !== "FAILED") {
      return {
        success: false,
        channel: input.channel,
        status: dispatches.status,
        error: `RETRY_NOT_ALLOWED: El estado actual (${dispatches.status}) no presenta una falla confirmada elegible para reintento.`,
      };
    }
  }

  // 3. Obtener datos del turno y cliente
  const { data: aptData, error: aptError } = await supabase
    .from("appointments")
    .select(`
      id,
      booking_date,
      start_time,
      client_id,
      barber_id,
      clients (id, name, phone, email),
      barbers (id, name),
      services (id, name)
    `)
    .eq("id", input.appointmentId)
    .maybeSingle();

  if (aptError || !aptData) {
    return {
      success: false,
      channel: input.channel,
      status: "FAILED",
      error: "APPOINTMENT_NOT_FOUND",
    };
  }

  // Validación de asignación para barberos
  if (staffProfile && staffProfile.role === "BARBER" && aptData.barber_id !== staffProfile.barber_id) {
    return {
      success: false,
      channel: input.channel,
      status: "FAILED",
      error: "ACCESS_DENIED: Solo puede reintentar notificaciones de sus propios turnos asignados.",
    };
  }

  const client = (aptData as any).clients;
  const barber = (aptData as any).barbers;
  const service = (aptData as any).services;

  if (input.channel === "WHATSAPP") {
    if (!client?.phone || !client.phone.trim()) {
      return {
        success: false,
        channel: "WHATSAPP",
        status: "SKIPPED",
        error: "CLIENT_HAS_NO_PHONE",
      };
    }

    // Registrar estado PROCESSING atómicamente antes del envío
    try {
      await supabase.rpc("record_channel_dispatch_status", {
        p_appointment_id: input.appointmentId,
        p_notification_event_id: dispatches?.notification_event_id ?? null,
        p_channel: "WHATSAPP",
        p_provider: "PONTIUN",
        p_recipient: client.phone,
        p_provider_message_id: dispatches?.provider_message_id ?? null,
        p_status: "PROCESSING",
        p_increment_attempt: true,
      });
    } catch (procErr) {
      console.warn("[KANI notification] Advertencia registrando PROCESSING para WhatsApp:", procErr);
    }

    const { sendPontiunAppointmentConfirmation } = await import("./kani-pontiun");
    const pontiunResult = await sendPontiunAppointmentConfirmation({
      appointmentId: input.appointmentId,
      clientName: client.name || "Cliente",
      clientPhone: client.phone,
      barberName: barber?.name || "Lautaro",
      serviceName: service?.name || "Corte",
      bookingDate: aptData.booking_date,
      startTime: aptData.start_time,
    });

    const newStatus = pontiunResult.success
      ? "PROVIDER_ACCEPTED"
      : (pontiunResult.skipped ? "SKIPPED" : "FAILED");

    const errCode = pontiunResult.error?.includes("131042")
      ? "131042"
      : (pontiunResult.error ? "PONTIUN_RETRY_ERROR" : null);

    await supabase.rpc("record_channel_dispatch_status", {
      p_appointment_id: input.appointmentId,
      p_notification_event_id: dispatches?.notification_event_id ?? null,
      p_channel: "WHATSAPP",
      p_provider: "PONTIUN",
      p_recipient: client.phone,
      p_provider_message_id: pontiunResult.messageId ?? null,
      p_status: newStatus,
      p_error_code: errCode,
      p_error_description: pontiunResult.error ?? null,
      p_increment_attempt: false,
    });

    return {
      success: pontiunResult.success,
      channel: "WHATSAPP",
      status: newStatus,
      error: pontiunResult.error,
    };
  }

  if (input.channel === "EMAIL") {
    if (!client?.email || !client.email.trim()) {
      return {
        success: false,
        channel: "EMAIL",
        status: "SKIPPED",
        error: "CLIENT_HAS_NO_EMAIL",
      };
    }

    const apiKey = getRuntimeEnv("RESEND_API_KEY")?.trim();
    const fromEmail = getRuntimeEnv("RESEND_FROM_EMAIL")?.trim();
    if (!apiKey || !fromEmail) {
      return {
        success: false,
        channel: "EMAIL",
        status: "SKIPPED",
        error: "RESEND_CREDENTIALS_MISSING",
      };
    }

    // Registrar estado PROCESSING atómicamente antes del envío
    try {
      await supabase.rpc("record_channel_dispatch_status", {
        p_appointment_id: input.appointmentId,
        p_notification_event_id: dispatches?.notification_event_id ?? null,
        p_channel: "EMAIL",
        p_provider: "RESEND",
        p_recipient: client.email,
        p_provider_message_id: dispatches?.provider_message_id ?? null,
        p_status: "PROCESSING",
        p_increment_attempt: true,
      });
    } catch (procErr) {
      console.warn("[KANI notification] Advertencia registrando PROCESSING para Email:", procErr);
    }

    const payload: NotificationPayload = {
      notificationId: dispatches?.notification_event_id ?? input.appointmentId,
      notificationType: "CONFIRMED",
      recipientEmail: client.email,
      recipientPhone: client.phone,
      clientName: client.name || "Cliente",
      barberName: barber?.name || "Lautaro",
      serviceName: service?.name || "Corte",
      bookingDate: aptData.booking_date,
      startTime: aptData.start_time,
      endTime: aptData.start_time,
      clientNotes: null,
      servicePriceArs: null,
      serviceDurationMinutes: null,
      downPaymentArs: null,
      transferAlias: null,
      transferCuit: null,
      transferHolderName: null,
    };

    const email = buildEmail(payload);
    const subject = notificationSubject(
      email.subject,
      getRuntimeEnv("KANI_ENVIRONMENT"),
      getRuntimeEnv("SUPABASE_URL") ?? getRuntimeEnv("VITE_SUPABASE_URL"),
    );

    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": `${input.appointmentId}-retry-email-${Date.now()}`,
      },
      body: JSON.stringify({
        from: fromEmail,
        to: [client.email],
        subject,
        html: email.html,
        text: email.text,
      }),
    });

    const result = (await response.json().catch(() => null)) as { id?: string; message?: string } | null;
    const ok = response.ok && Boolean(result?.id);
    const newStatus = ok ? "SENT" : "FAILED";
    const errDesc = ok ? null : (result?.message ?? `RESEND_${response.status}`);

    await supabase.rpc("record_channel_dispatch_status", {
      p_appointment_id: input.appointmentId,
      p_notification_event_id: dispatches?.notification_event_id ?? null,
      p_channel: "EMAIL",
      p_provider: "RESEND",
      p_recipient: client.email,
      p_provider_message_id: result?.id ?? null,
      p_status: newStatus,
      p_error_code: ok ? null : `RESEND_${response.status}`,
      p_error_description: errDesc,
      p_increment_attempt: false,
    });

    return {
      success: ok,
      channel: "EMAIL",
      status: newStatus,
      error: errDesc ?? undefined,
    };
  }

  return { success: false, channel: input.channel, status: "FAILED", error: "UNKNOWN_CHANNEL" };
}

export const retryNotificationChannelServerFn = createServerFn({ method: "POST" })
  .validator((data: { appointmentId: string; channel: "WHATSAPP" | "EMAIL" }) => {
    if (!data?.appointmentId || !data?.channel) throw new Error("RETRY_INPUT_INVALID");
    return data;
  })
  .handler(async ({ data }): Promise<RetryChannelResult> => {
    const supabase = await createRequestSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return {
        success: false,
        channel: data.channel,
        status: "FAILED",
        error: "AUTH_REQUIRED: Debe iniciar sesión como personal autorizado para reintentar notificaciones.",
      };
    }
    return retryNotificationChannel(data);
  });

function getRuntimeEnv(name: string): string | undefined {
  // src/server.ts reads the Worker's runtime bindings before TanStack dispatches
  // the request and stores them in a shared, non-secret-accessible app runtime map.
  // Nitro stores Worker bindings in globalThis.__env__.
  // The process.env fallback remains for local development and compatible runtimes.
  const globalObj = globalThis as typeof globalThis & {
    __env__?: Record<string, unknown>;
    __KANI_RUNTIME_ENV?: Record<string, string>;
  };
  const runtimeValue =
    globalObj.__env__?.[name] ??
    globalObj.__KANI_RUNTIME_ENV?.[name] ??
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
  const { createClient } = await import("@supabase/supabase-js");
  let request: Request | undefined;
  try {
    const serverModule = await import("@tanstack/react-start/server");
    request = serverModule.getRequest();
  } catch { /* Raw Worker webhook has no TanStack request. */ }
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

const WEEKDAYS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const MONTHS = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"
];

export function formatSpanishDateNatural(isoDate: string): string {
  const [yearStr, monthStr, dayStr] = (isoDate || "").split("-");
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10);
  const day = parseInt(dayStr, 10);
  if (!year || !month || !day) return isoDate;

  const dateObj = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  const weekday = WEEKDAYS[dateObj.getUTCDay()];
  const monthName = MONTHS[dateObj.getUTCMonth()];
  return `${weekday} ${day} de ${monthName} de ${year}`;
}

export function buildConfirmedEmail(payload: NotificationPayload) {
  const spanishDate = formatSpanishDateNatural(payload.bookingDate);
  const cleanTime = (payload.startTime || "").slice(0, 5);
  const servicePrice = payload.servicePriceArs ?? 0;
  const downPayment = (payload.downPaymentArs && payload.downPaymentArs !== 10000) ? payload.downPaymentArs : KANI_STANDARD_DEPOSIT_ARS;
  const remainingPayment = Math.max(0, servicePrice - downPayment);

  const safe = {
    clientName: escapeHtml(payload.clientName),
    barberName: escapeHtml(payload.barberName),
    serviceName: escapeHtml(payload.serviceName),
    date: escapeHtml(spanishDate),
    time: escapeHtml(cleanTime),
    servicePrice: escapeHtml(`$${servicePrice.toLocaleString("es-AR")}`),
    downPayment: escapeHtml(`$${downPayment.toLocaleString("es-AR")}`),
    remainingPayment: escapeHtml(`$${remainingPayment.toLocaleString("es-AR")}`),
  };

  const subject = "Kani - Se confirmó tu turno";
  const mapsUrl = KANI_MAPS_URL;
  const whatsAppUrl = "https://wa.me/5491128436014";

  const html = `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${subject}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #FAF9F6; color: #252323; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; -webkit-font-smoothing: antialiased; line-height: 1.5;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: #FAF9F6; margin: 0; padding: 0; width: 100%;">
    <tr>
      <td align="center" style="padding: 32px 16px 48px;">
        <!-- Card Contenedora Principal -->
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width: 560px; background-color: #FFFFFF; border: 1px solid #E5E0D8; border-radius: 12px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.03);">
          
          <!-- Header / Marca Kani -->
          <tr>
            <td style="background-color: #FAF9F6; border-bottom: 1px solid #E5E0D8; padding: 20px 28px; text-align: center;">
              <span style="font-size: 13px; font-weight: 700; letter-spacing: 0.22em; text-transform: uppercase; color: #252323;">Kani Barber Studio</span>
            </td>
          </tr>

          <!-- Contenido Principal: Confirmación -->
          <tr>
            <td style="padding: 32px 28px 24px;">
              <h1 style="margin: 0 0 16px; font-size: 22px; font-weight: 700; color: #252323; line-height: 1.25;">
                Se confirmó tu turno
              </h1>
              <p style="margin: 0; font-size: 15px; line-height: 1.6; color: #252323;">
                Se confirmó tu turno el día <strong>${safe.date}</strong> a las <strong>${safe.time} hs</strong>, para un servicio de <strong>${safe.serviceName}</strong> con <strong>${safe.barberName}</strong>.
              </p>
            </td>
          </tr>

          <!-- Divisor -->
          <tr>
            <td style="padding: 0 28px;">
              <div style="height: 1px; background-color: #E5E0D8; line-height: 1px; font-size: 1px;">&nbsp;</div>
            </td>
          </tr>

          <!-- Resumen del pago -->
          <tr>
            <td style="padding: 24px 28px;">
              <h2 style="margin: 0 0 14px; font-size: 13px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: #5D5A54;">
                Resumen
              </h2>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: #FAF8F5; border: 1px solid #EBE7DF; border-radius: 8px; padding: 16px 20px;">
                <tr>
                  <td style="padding: 7px 0; font-size: 14px; color: #5D5A54;">Importe</td>
                  <td align="right" style="padding: 7px 0; font-size: 15px; font-weight: 600; color: #252323;">${safe.servicePrice}</td>
                </tr>
                <tr>
                  <td style="padding: 7px 0; border-top: 1px solid #ECE7DE; font-size: 14px; color: #5D5A54;">Seña abonada</td>
                  <td align="right" style="padding: 7px 0; border-top: 1px solid #ECE7DE; font-size: 15px; font-weight: 600; color: #2F6F43;">−${safe.downPayment}</td>
                </tr>
                <tr>
                  <td style="padding: 12px 0 6px; border-top: 2px solid #D8D3C9; font-size: 15px; font-weight: 700; color: #252323;">Saldo a pagar en el local</td>
                  <td align="right" style="padding: 12px 0 6px; border-top: 2px solid #D8D3C9; font-size: 18px; font-weight: 700; color: #762936;">${safe.remainingPayment}</td>
                </tr>
                <tr>
                  <td colspan="2" style="padding-top: 10px; font-size: 12px; line-height: 1.45; color: #71717A;">
                    Podés abonar el saldo en efectivo o por transferencia.
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Divisor -->
          <tr>
            <td style="padding: 0 28px;">
              <div style="height: 1px; background-color: #E5E0D8; line-height: 1px; font-size: 1px;">&nbsp;</div>
            </td>
          </tr>

          <!-- Sección: ¿Cómo llego? -->
          <tr>
            <td style="padding: 24px 28px;">
              <h2 style="margin: 0 0 14px; font-size: 13px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: #5D5A54;">
                ¿Cómo llego?
              </h2>
              <!-- Card de ubicación inspirada en Contacto -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: #FAF8F5; border: 1px solid #EBE7DF; border-radius: 8px;">
                <tr>
                  <td style="padding: 20px;">
                    <p style="margin: 0 0 4px; font-size: 15px; font-weight: 700; color: #252323;">
                      San Isidro Labrador 7
                    </p>
                    <p style="margin: 0 0 16px; font-size: 13px; color: #6B6862;">
                      Martinez, Provincia de Buenos Aires
                    </p>
                    <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td align="left">
                          <a href="${mapsUrl}" target="_blank" rel="noopener noreferrer" style="display: inline-block; background-color: #762936; color: #FFFFFF; font-size: 13px; font-weight: 600; text-decoration: none; padding: 10px 18px; border-radius: 6px; letter-spacing: 0.02em;">
                            Ver ubicación &rarr;
                          </a>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Contactar vía WhatsApp -->
          <tr>
            <td style="padding: 0 28px 28px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td align="center">
                    <a href="${whatsAppUrl}" target="_blank" rel="noopener noreferrer" style="display: block; width: 100%; box-sizing: border-box; text-align: center; background-color: #FFFFFF; color: #252323; border: 1px solid #D8D3C9; font-size: 13px; font-weight: 600; text-decoration: none; padding: 12px 18px; border-radius: 6px;">
                      Contactar vía WhatsApp
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Footer institucional -->
          <tr>
            <td style="background-color: #FAF9F6; border-top: 1px solid #EBE7DF; padding: 16px 28px; text-align: center;">
              <p style="margin: 0; font-size: 12px; color: #8D8883; line-height: 1.5;">
                © 2026 Kani Barber Studio · San Isidro Labrador 7, Martínez<br>
                Este correo fue enviado automáticamente para confirmar tu turno.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const text = `KANI BARBER STUDIO
Se confirmó tu turno

Se confirmó tu turno el día ${spanishDate} a las ${cleanTime} hs, para un servicio de ${payload.serviceName} con ${payload.barberName}.

--------------------------------------------------
RESUMEN DEL PAGO

Importe: ${safe.servicePrice}
Seña abonada: ${safe.downPayment}
Saldo a pagar en el local: ${safe.remainingPayment}

Podés abonar el saldo en efectivo o por transferencia.
--------------------------------------------------

¿CÓMO LLEGO?
San Isidro Labrador 7
Martinez, Provincia de Buenos Aires

Ver ubicación:
${mapsUrl}

--------------------------------------------------
CONTACTO
Contactar vía WhatsApp:
${whatsAppUrl}

© 2026 Kani Barber Studio
San Isidro Labrador 7, Martínez, Provincia de Buenos Aires`;

  return { subject, html, text };
}

function buildEmail(payload: NotificationPayload) {
  if (payload.notificationType === "CONFIRMED") {
    return buildConfirmedEmail(payload);
  }

  const date = new Date(`${payload.bookingDate}T12:00:00Z`).toLocaleDateString("es-AR", {
    timeZone: "America/Argentina/Buenos_Aires",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
  const time = `${payload.startTime.slice(0, 5)} a ${payload.endTime.slice(0, 5)} hs`;
  const isNewRequest = payload.notificationType === "NEW_REQUEST";
  if (isNewRequest) return buildNewRequestEmail(payload, date, time);

  const baseUrl = getRuntimeEnv('KANI_APP_URL')?.replace(/\/$/, '') || 'https://kanibarber.com';
  return buildCancelledEmail(payload, `${baseUrl}/reservar-turno`);
}

export function buildCancelledEmail(payload: NotificationPayload, bookingUrl: string) {
  const date = new Date(`${payload.bookingDate}T12:00:00Z`).toLocaleDateString('es-AR', { day: 'numeric', month: 'long' });
  const sentence = `Se canceló tu turno con ${payload.barberName} el día ${date} a las ${payload.startTime.slice(0, 5)} hs.`;
  return {
    subject: 'Se canceló tu turno en Kani Barber Studio',
    text: `${sentence}\n\nSolicitá un nuevo turno: ${bookingUrl}`,
    html: `<html lang="es"><body style="font-family:Arial,sans-serif;padding:24px"><p>${escapeHtml(sentence)}</p><a href="${escapeHtml(bookingUrl)}" style="display:inline-block;padding:12px 18px;background:#702B3A;color:#fff;border-radius:8px;text-decoration:none">Solicitá un nuevo turno</a></body></html>`,
  };
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
  const mapsUrl = KANI_MAPS_URL;
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
