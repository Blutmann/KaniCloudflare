import { createServerFn, createServerOnlyFn } from "@tanstack/react-start";
import { notificationSubject } from './kani-email-environment';
import { KANI_MAPS_URL, KANI_STANDARD_DEPOSIT_ARS, KANI_PUBLIC_WHATSAPP_URL, KANI_STUDIO_FULL_ADDRESS } from './kani-constants';
import { buildTurnoIcsUrl } from './kani-calendar-ics';
import { buildCancellationUrl } from './kani-cancellation-token';
import { isAppointmentPast } from './kani-mobile-appointments';

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
  appointmentId?: string;
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
  benefitCode?: string | null;
  benefitType?: 'NO_DEPOSIT' | 'FREE_SERVICE' | 'PERCENT_10' | 'PERCENT_50' | null;
  benefitOriginalPriceArs?: number | null;
  benefitDiscountAmountArs?: number | null;
  benefitFinalPriceArs?: number | null;
  benefitOnlineDepositArs?: number | null;
  benefitInPersonBalanceArs?: number | null;
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
            let apptBenefit: any = null;
            try {
              const { data: bData } = await db
                .from('appointments')
                .select('benefit_code, benefit_type, benefit_original_price_ars, benefit_discount_amount_ars, benefit_final_price_ars, benefit_online_deposit_ars, benefit_in_person_balance_ars')
                .eq('id', data.appointmentId)
                .maybeSingle();
              apptBenefit = bData;
            } catch { /* best effort */ }

            const payload: NotificationPayload = {
              notificationId: event.notification_id,
              appointmentId: data.appointmentId,
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
              benefitCode: apptBenefit?.benefit_code ?? (event as any).benefit_code ?? null,
              benefitType: apptBenefit?.benefit_type ?? (event as any).benefit_type ?? null,
              benefitOriginalPriceArs: apptBenefit?.benefit_original_price_ars ?? null,
              benefitDiscountAmountArs: apptBenefit?.benefit_discount_amount_ars ?? null,
              benefitFinalPriceArs: apptBenefit?.benefit_final_price_ars ?? null,
              benefitOnlineDepositArs: apptBenefit?.benefit_online_deposit_ars ?? null,
              benefitInPersonBalanceArs: apptBenefit?.benefit_in_person_balance_ars ?? null,
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
  providerMessageId?: string | null;
  message?: string;
  dispatch?: NotificationChannelDispatch | null;
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

// Candado en memoria para evitar ejecuciones concurrentes / doble clic en el mismo turno y canal
const activeChannelRetries = new Set<string>();

export async function retryNotificationChannel(input: {
  appointmentId: string;
  channel: "WHATSAPP" | "EMAIL";
  token?: string;
}): Promise<RetryChannelResult> {
  const lockKey = `${input.appointmentId}:${input.channel}`;
  if (activeChannelRetries.has(lockKey)) {
    return {
      success: false,
      channel: input.channel,
      status: "PROCESSING",
      error: "RETRY_NOT_ALLOWED: Existe una operación de notificación en curso para este canal.",
    };
  }

  activeChannelRetries.add(lockKey);
  try {
    const supabase = await createRequestSupabaseClient(input.token);

    // 1. Autorización de servidor: validar identidad del usuario autenticado si existe sesión
    const { data: { user }, error: userError } = await supabase.auth.getUser(input.token);
    if (userError || !user) {
      const isExpired = userError?.message?.toLowerCase().includes("expired") || (userError as any)?.status === 401;
      return {
        success: false,
        channel: input.channel,
        status: "FAILED",
        error: isExpired
          ? "SESSION_EXPIRED: Su sesión ha expirado. Por favor, vuelva a iniciar sesión."
          : "AUTH_REQUIRED: Debe iniciar sesión como personal autorizado para reintentar notificaciones.",
      };
    }

    let staffProfile: { role: string; barber_id: string | null; active: boolean } | null = null;

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

    // 2. Consultar estado previo del despacho para este turno y canal
    const { data: dispatches } = await (supabase as any)
      .from("appointment_notification_dispatches")
      .select("*")
      .eq("appointment_id", input.appointmentId)
      .eq("channel", input.channel)
      .maybeSingle();

    // Validaciones rápidas de estado para reintento seguro
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

      // C. Bloqueo estricto si el error es 131042 (Meta currency billing issue)
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

      // D. Si ya fue aceptado o enviado por el proveedor:
      // Comprobar si pertenece al mismo evento o si el turno cambió a CANCELLED
      if (dispatches.status === "PROVIDER_ACCEPTED" || dispatches.status === "SENT") {
        // Consultar turno para verificar si el estado actual es diferente (ej: CANCELLED tras previa confirmación)
        const { data: quickApt } = await supabase
          .from("appointments")
          .select("status")
          .eq("id", input.appointmentId)
          .maybeSingle();

        const isCancelledNow = quickApt?.status === "CANCELLED";
        let isDifferentEvent = false;

        if (isCancelledNow && dispatches.notification_event_id) {
          const { data: eventData } = await (supabase as any)
            .from("appointment_notification_events")
            .select("notification_type")
            .eq("id", dispatches.notification_event_id)
            .maybeSingle();
          if (eventData && eventData.notification_type !== "CANCELLED") {
            isDifferentEvent = true;
          }
        }

        if (!isDifferentEvent) {
          return {
            success: false,
            channel: input.channel,
            status: dispatches.status,
            error: "RETRY_NOT_ALLOWED: La notificación ya fue aceptada por el proveedor y se encuentra en tránsito.",
          };
        }
      }
    }

    // 3. Obtener datos completos del turno, barbero, servicio y cliente
    const { data: aptData, error: aptError } = await supabase
      .from("appointments")
      .select(`
        id,
        booking_date,
        start_time,
        end_time,
        status,
        notes,
        service_price_ars,
        custom_service_name,
        deposit_amount_ars,
        client_id,
        barber_id,
        service_id,
        clients (id, name, phone, email),
        barbers (id, name),
        services (id, name, price_ars, duration_minutes)
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

    // Validación de asignación para barberos (solo sus propios turnos)
    if (staffProfile && staffProfile.role === "BARBER" && aptData.barber_id !== staffProfile.barber_id) {
      return {
        success: false,
        channel: input.channel,
        status: "FAILED",
        error: "ACCESS_DENIED: Solo puede reintentar notificaciones de sus propios turnos asignados.",
      };
    }

    // 4. Determinar el tipo de notificación según el estado actual del turno
    const currentAptStatus = (aptData as any).status || "CONFIRMED";
    let targetNotificationType: "CONFIRMED" | "CANCELLED";

    if (currentAptStatus === "CONFIRMED") {
      targetNotificationType = "CONFIRMED";
      // Turnos pasados: no enviar confirmaciones obsoletas a menos que lo autorice un administrador explícitamente
      if (input.channel === "EMAIL" && aptData.booking_date && isAppointmentPast(aptData.booking_date, aptData.start_time) && staffProfile?.role !== "ADMIN") {
        return {
          success: false,
          channel: input.channel,
          status: "SKIPPED",
          error: "PAST_APPOINTMENT_CONFIRMATION_BLOCKED: El turno corresponde a una fecha u horario pasado. Por política de calidad, solo un administrador puede autorizar notificaciones retrospectivas.",
        };
      }
    } else if (currentAptStatus === "CANCELLED") {
      targetNotificationType = "CANCELLED";
    } else if (currentAptStatus === "PENDING") {
      return {
        success: false,
        channel: input.channel,
        status: "SKIPPED",
        error: "STATUS_NOT_COMPATIBLE: El turno se encuentra en estado 'Pendiente' (sin confirmar). No corresponde enviar confirmación ni cancelación.",
      };
    } else if (currentAptStatus === "COMPLETED") {
      return {
        success: false,
        channel: input.channel,
        status: "SKIPPED",
        error: "STATUS_NOT_COMPATIBLE: El turno ya fue realizado ('Ejecutado'). No corresponde enviar notificaciones.",
      };
    } else if (currentAptStatus === "NO_SHOW") {
      return {
        success: false,
        channel: input.channel,
        status: "SKIPPED",
        error: "STATUS_NOT_COMPATIBLE: El turno fue registrado como 'Inasistencia'. No corresponde enviar notificaciones.",
      };
    } else {
      return {
        success: false,
        channel: input.channel,
        status: "SKIPPED",
        error: `STATUS_NOT_COMPATIBLE: El estado del turno (${currentAptStatus}) no admite el envío de esta notificación.`,
      };
    }

    let relevantDispatch = dispatches;
    if (dispatches?.notification_event_id) {
      const { data: eventData } = await (supabase as any)
        .from("appointment_notification_events")
        .select("id, notification_type")
        .eq("id", dispatches.notification_event_id)
        .maybeSingle();
      if (eventData && eventData.notification_type !== targetNotificationType) {
        relevantDispatch = null;
      }
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
          p_notification_event_id: relevantDispatch?.notification_event_id ?? null,
          p_channel: "WHATSAPP",
          p_provider: "PONTIUN",
          p_recipient: client.phone,
          p_provider_message_id: relevantDispatch?.provider_message_id ?? null,
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
        serviceName: (aptData as any).custom_service_name || service?.name || "Corte",
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
        p_notification_event_id: relevantDispatch?.notification_event_id ?? null,
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
        providerMessageId: pontiunResult.messageId ?? null,
        message: pontiunResult.success
          ? `Mensaje aceptado por Pontiun (ID: ${pontiunResult.messageId || "OK"}).`
          : pontiunResult.error,
      };
    }

    if (input.channel === "EMAIL") {
      if (!client?.email || !client.email.trim()) {
        return {
          success: false,
          channel: "EMAIL",
          status: "SKIPPED",
          error: "CLIENT_HAS_NO_EMAIL: El cliente no posee una dirección de correo electrónico registrada.",
        };
      }

      const apiKey = getRuntimeEnv("RESEND_API_KEY")?.trim();
      const fromEmail = getRuntimeEnv("RESEND_FROM_EMAIL")?.trim();
      if (!apiKey || !fromEmail) {
        return {
          success: false,
          channel: "EMAIL",
          status: "SKIPPED",
          error: "RESEND_CREDENTIALS_MISSING: No están configuradas las credenciales de Resend en el entorno.",
        };
      }

      // Registrar estado PROCESSING atómicamente antes del envío
      try {
        await supabase.rpc("record_channel_dispatch_status", {
          p_appointment_id: input.appointmentId,
          p_notification_event_id: relevantDispatch?.notification_event_id ?? null,
          p_channel: "EMAIL",
          p_provider: "RESEND",
          p_recipient: client.email.trim(),
          p_provider_message_id: relevantDispatch?.provider_message_id ?? null,
          p_status: "PROCESSING",
          p_increment_attempt: true,
        });
      } catch (procErr) {
        console.warn("[KANI notification] Advertencia registrando PROCESSING para Email:", procErr);
      }

      const serviceName = (aptData as any).custom_service_name || service?.name || "Corte";
      const servicePriceArs = (aptData as any).service_price_ars ?? service?.price_ars ?? 0;
      const serviceDurationMinutes = service?.duration_minutes ?? 45;
      const downPaymentArs = (aptData as any).deposit_amount_ars ?? KANI_STANDARD_DEPOSIT_ARS;

      const payload: NotificationPayload = {
        notificationId: relevantDispatch?.notification_event_id ?? input.appointmentId,
        appointmentId: input.appointmentId,
        notificationType: targetNotificationType,
        recipientEmail: client.email.trim(),
        recipientPhone: client.phone ?? null,
        clientName: client.name || "Cliente",
        barberName: barber?.name || "Lautaro",
        serviceName,
        bookingDate: aptData.booking_date,
        startTime: aptData.start_time,
        endTime: (aptData as any).end_time || aptData.start_time,
        clientNotes: (aptData as any).notes || null,
        servicePriceArs,
        serviceDurationMinutes,
        downPaymentArs,
        transferAlias: null,
        transferCuit: null,
        transferHolderName: null,
        benefitCode: (aptData as any).benefit_code ?? null,
        benefitType: (aptData as any).benefit_type ?? null,
        benefitOriginalPriceArs: (aptData as any).benefit_original_price_ars ?? null,
        benefitDiscountAmountArs: (aptData as any).benefit_discount_amount_ars ?? null,
        benefitFinalPriceArs: (aptData as any).benefit_final_price_ars ?? null,
        benefitOnlineDepositArs: (aptData as any).benefit_online_deposit_ars ?? null,
        benefitInPersonBalanceArs: (aptData as any).benefit_in_person_balance_ars ?? null,
      };

      const email = buildEmail(payload);
      const subject = notificationSubject(
        email.subject,
        getRuntimeEnv("KANI_ENVIRONMENT"),
        getRuntimeEnv("SUPABASE_URL") ?? getRuntimeEnv("VITE_SUPABASE_URL"),
      );

      const attemptNumber = (relevantDispatch?.attempts ?? 0) + 1;
      const idempotencyKey = `kani-email-${input.appointmentId}-${targetNotificationType.toLowerCase()}-${attemptNumber}`;

      let response: Response | undefined;
      let result: { id?: string; message?: string } | null = null;
      let networkError: string | null = null;

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
            to: [client.email.trim()],
            subject,
            html: email.html,
            text: email.text,
          }),
        });
        result = (await response.json().catch(() => null)) as { id?: string; message?: string } | null;
      } catch (fetchErr) {
        networkError = fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
      }

      const ok = !networkError && Boolean(response?.ok) && Boolean(result?.id);
      const newStatus = ok ? "SENT" : "FAILED";
      const rawError = networkError ? `NETWORK_ERROR: ${networkError}` : (result?.message ?? `RESEND_${response?.status}`);
      // Sanitizar claves API de cualquier mensaje de error
      const sanitizedError = rawError ? rawError.replace(/re_[a-zA-Z0-9_\-]+/g, "[REDACTED_API_KEY]") : null;
      const errorCode = ok ? null : (networkError ? "NETWORK_ERROR" : `RESEND_${response?.status}`);
      const errDesc = ok ? null : sanitizedError;

      try {
        await supabase.rpc("record_channel_dispatch_status", {
          p_appointment_id: input.appointmentId,
          p_notification_event_id: relevantDispatch?.notification_event_id ?? null,
          p_channel: "EMAIL",
          p_provider: "RESEND",
          p_recipient: client.email.trim(),
          p_provider_message_id: result?.id ?? null,
          p_status: newStatus,
          p_error_code: errorCode,
          p_error_description: errDesc,
          p_increment_attempt: false,
        });
      } catch (rpcErr) {
        console.warn("[KANI notification] Error registrando estado final de canal EMAIL:", rpcErr);
      }

      const nowIso = new Date().toISOString();
      return {
        success: ok,
        channel: "EMAIL",
        status: newStatus,
        error: errDesc ?? undefined,
        providerMessageId: result?.id ?? null,
        message: ok
          ? `Correo aceptado por el proveedor Resend (ID: ${result?.id}). Estado: En tránsito.`
          : `Error al enviar correo: ${errDesc}`,
        dispatch: {
          id: relevantDispatch?.id ?? "generated-dispatch-id",
          appointmentId: input.appointmentId,
          channel: "EMAIL",
          provider: "RESEND",
          recipient: client.email.trim(),
          providerMessageId: result?.id ?? null,
          status: newStatus,
          errorCode,
          errorDescription: errDesc,
          attempts: attemptNumber,
          requestedAt: relevantDispatch?.requested_at || nowIso,
          updatedAt: nowIso,
          createdAt: relevantDispatch?.created_at || nowIso,
        },
      };
    }

    return { success: false, channel: input.channel, status: "FAILED", error: "UNKNOWN_CHANNEL" };
  } finally {
    activeChannelRetries.delete(lockKey);
  }
}

export const retryNotificationChannelServerFn = createServerFn({ method: "POST" })
  .validator((data: { appointmentId: string; channel: "WHATSAPP" | "EMAIL"; token?: string }) => {
    if (!data?.appointmentId || !data?.channel) throw new Error("RETRY_INPUT_INVALID");
    return data;
  })
  .handler(async ({ data }): Promise<RetryChannelResult> => {
    let token = data.token?.trim();
    if (!token) {
      try {
        const { getRequestAuthToken } = await import("./kani-notifications.server");
        token = getRequestAuthToken();
      } catch { /* ignored */ }
    }

    if (!token) {
      return {
        success: false,
        channel: data.channel,
        status: "FAILED",
        error: "AUTH_REQUIRED: Debe iniciar sesión como personal autorizado para reintentar notificaciones.",
      };
    }

    const supabase = await createRequestSupabaseClient(token);
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);
    if (userError || !user) {
      const isExpired = userError?.message?.toLowerCase().includes("expired") || (userError as any)?.status === 401;
      return {
        success: false,
        channel: data.channel,
        status: "FAILED",
        error: isExpired
          ? "SESSION_EXPIRED: Su sesión ha expirado. Por favor, vuelva a iniciar sesión."
          : "AUTH_REQUIRED: Debe iniciar sesión como personal autorizado para reintentar notificaciones.",
      };
    }
    return retryNotificationChannel({ appointmentId: data.appointmentId, channel: data.channel, token });
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

async function createRequestSupabaseClient(explicitAuthToken?: string) {
  const { createRequestSupabaseClient: createClient } = await import("./kani-notifications.server");
  return createClient(explicitAuthToken);
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

export function formatSpanishDateCompact(isoDate: string): string {
  if (!isoDate || typeof isoDate !== 'string') return '';
  const [year, month, day] = isoDate.split('-').map((v) => parseInt(v, 10));
  if (!year || !month || !day) return isoDate;

  const dateObj = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  const weekday = WEEKDAYS[dateObj.getUTCDay()];
  const capitalizedWeekday = weekday ? weekday.charAt(0).toUpperCase() + weekday.slice(1) : '';
  const monthName = MONTHS[dateObj.getUTCMonth()];
  return `${capitalizedWeekday} ${day} de ${monthName}`;
}

export function buildGoogleCalendarUrl(payload: {
  bookingDate: string;
  startTime: string;
  endTime?: string | null;
  serviceDurationMinutes?: number | null;
  serviceName: string;
  barberName: string;
}): string {
  const dateStr = (payload.bookingDate || '').trim();
  const startTimeStr = (payload.startTime || '').trim().slice(0, 5);
  if (!dateStr || !startTimeStr) return 'https://calendar.google.com';

  const [year, month, day] = dateStr.split('-').map((v) => parseInt(v, 10));
  const [startHour, startMin] = startTimeStr.split(':').map((v) => parseInt(v, 10));

  let endHour: number;
  let endMin: number;
  if (payload.endTime && payload.endTime.trim()) {
    const [eH, eM] = payload.endTime.trim().slice(0, 5).split(':').map((v) => parseInt(v, 10));
    endHour = eH;
    endMin = eM;
  } else {
    const duration = payload.serviceDurationMinutes || 45;
    const totalMin = startHour * 60 + startMin + duration;
    endHour = Math.floor(totalMin / 60) % 24;
    endMin = totalMin % 60;
  }

  // Argentina está en UTC-3 sin horario de verano. Hora local + 3 = UTC.
  const startUtcDate = new Date(Date.UTC(year, month - 1, day, startHour + 3, startMin, 0));
  const dayOffset = startHour * 60 + startMin + (payload.serviceDurationMinutes || 45) >= 24 * 60 ? 1 : 0;
  const endUtcDate = new Date(Date.UTC(year, month - 1, day + dayOffset, endHour + 3, endMin, 0));

  const formatUtc = (d: Date) =>
    d.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';

  const dates = `${formatUtc(startUtcDate)}/${formatUtc(endUtcDate)}`;
  const title = `${payload.serviceName} — Kani Barber Studio`;
  const details = `Turno con ${payload.barberName} para ${payload.serviceName} en Kani Barber Studio.`;
  const location = KANI_STUDIO_FULL_ADDRESS;

  return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(title)}&dates=${dates}&details=${encodeURIComponent(details)}&location=${encodeURIComponent(location)}`;
}

export function buildConfirmedEmail(payload: NotificationPayload) {
  const spanishDate = formatSpanishDateNatural(payload.bookingDate);
  const capitalizedDate = spanishDate ? spanishDate.charAt(0).toUpperCase() + spanishDate.slice(1) : '';
  const compactDate = formatSpanishDateCompact(payload.bookingDate);
  const cleanTime = (payload.startTime || "").slice(0, 5);

  const isNoDeposit = payload.benefitType === 'NO_DEPOSIT';
  const isFreeService = payload.benefitType === 'FREE_SERVICE';
  const isPercent10 = payload.benefitType === 'PERCENT_10';
  const isPercent50 = payload.benefitType === 'PERCENT_50';

  const originalPrice = payload.benefitOriginalPriceArs ?? payload.servicePriceArs ?? 0;
  const discountAmount = payload.benefitDiscountAmountArs ?? (isFreeService ? originalPrice : 0);
  const finalPrice = payload.benefitFinalPriceArs ?? (isFreeService ? 0 : isNoDeposit ? originalPrice : Math.max(0, originalPrice - discountAmount));
  const downPayment = isFreeService || isNoDeposit
    ? 0
    : (payload.benefitOnlineDepositArs ?? ((payload.downPaymentArs && payload.downPaymentArs !== 10000) ? payload.downPaymentArs : KANI_STANDARD_DEPOSIT_ARS));
  const remainingPayment = payload.benefitInPersonBalanceArs ?? (isFreeService ? 0 : Math.max(0, finalPrice - downPayment));

  const safe = {
    clientName: escapeHtml(payload.clientName),
    barberName: escapeHtml(payload.barberName),
    serviceName: escapeHtml(payload.serviceName),
    date: escapeHtml(spanishDate),
    capitalizedDate: escapeHtml(capitalizedDate),
    compactDate: escapeHtml(compactDate),
    time: escapeHtml(cleanTime),
    servicePrice: escapeHtml('$' + originalPrice.toLocaleString("es-AR")),
    originalPrice: escapeHtml('$' + originalPrice.toLocaleString("es-AR")),
    discount: escapeHtml('$' + discountAmount.toLocaleString("es-AR")),
    finalPrice: escapeHtml('$' + finalPrice.toLocaleString("es-AR")),
    downPayment: escapeHtml('$' + downPayment.toLocaleString("es-AR")),
    remainingPayment: escapeHtml('$' + remainingPayment.toLocaleString("es-AR")),
  };

  const subject = payload.clientName && payload.clientName.trim()
    ? `[KANI] ${payload.clientName.trim()}, tu turno está confirmado`
    : "[KANI] Tu turno está confirmado";

  const preheaderText = `${compactDate} a las ${cleanTime} hs · ${payload.serviceName} con ${payload.barberName}`;

  const mapsUrl = KANI_MAPS_URL;
  const whatsAppUrl = KANI_PUBLIC_WHATSAPP_URL;
  const instagramUrl = "https://www.instagram.com/kanibarberstudio/";

  const appUrl = (
    getRuntimeEnv('KANI_APP_URL') ||
    getRuntimeEnv('APP_URL') ||
    'https://www.kanibarber.com'
  ).replace(/\/$/, '');
  const logoUrl = `${appUrl}/kani-email-logo.png`;

  const calendarUrl = buildTurnoIcsUrl({
    id: payload.notificationId || `${payload.bookingDate}-${cleanTime}`,
    bookingDate: payload.bookingDate,
    startTime: payload.startTime,
    endTime: payload.endTime,
    serviceDurationMinutes: payload.serviceDurationMinutes,
    serviceName: payload.serviceName,
    barberName: payload.barberName,
  }, appUrl);

  const appointmentId = payload.appointmentId || payload.notificationId || `${payload.bookingDate}-${cleanTime}`;
  const cancellationUrl = buildCancellationUrl(appointmentId, appUrl);

  const html = `<!doctype html>
<html lang="es" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <meta name="format-detection" content="telephone=no, address=no, email=no, date=no, url=no">
  <meta name="color-scheme" content="dark only">
  <meta name="supported-color-schemes" content="dark only">
  <title>${escapeHtml(subject)}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=DM+Serif+Display&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <!--[if mso]>
  <noscript>
    <xml>
      <o:OfficeDocumentSettings>
        <o:PixelsPerInch>96</o:PixelsPerInch>
      </o:OfficeDocumentSettings>
    </xml>
  </noscript>
  <![endif]-->
  <style type="text/css">
    body, table, td, a { -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
    table, td { mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
    img { -ms-interpolation-mode: bicubic; border: 0; outline: none; text-decoration: none; }
    a[x-apple-data-detectors] {
      color: inherit !important;
      text-decoration: none !important;
      font-size: inherit !important;
      font-family: inherit !important;
      font-weight: inherit !important;
      line-height: inherit !important;
    }
    @media only screen and (max-width: 599px) {
      .outer-wrapper-td {
        padding: 0 0 32px 0 !important;
      }
      .email-container {
        width: 100% !important;
        max-width: 100% !important;
        border-radius: 0px !important;
        border-left: none !important;
        border-right: none !important;
      }
      .content-padding {
        padding-left: 20px !important;
        padding-right: 20px !important;
      }
      .title-h1 {
        font-size: 30px !important;
        line-height: 1.15 !important;
      }
      .dark-card-inner {
        padding: 20px !important;
      }
      .dark-card-block {
        display: block !important;
        max-width: 100% !important;
        width: 100% !important;
      }
      .loc-btn-col {
        display: block !important;
        width: 100% !important;
        padding-left: 0 !important;
        padding-right: 0 !important;
      }
      .loc-btn-col-right {
        margin-top: 10px !important;
      }
      .balance-label-td {
        display: block !important;
        width: 100% !important;
        text-align: left !important;
      }
      .balance-amount-td {
        display: block !important;
        width: 100% !important;
        text-align: left !important;
        margin-top: 4px !important;
      }
    }
    @media only screen and (min-width: 600px) {
      .content-padding {
        padding-left: 48px !important;
        padding-right: 48px !important;
      }
      .mobile-dark-card {
        display: none !important;
        max-height: 0px !important;
        overflow: hidden !important;
        mso-hide: all !important;
      }
      .desktop-dark-card {
        display: block !important;
        max-height: none !important;
        overflow: visible !important;
      }
    }
  </style>
</head>
<body style="margin: 0; padding: 0; background-color: #000000; color: #F5F5F5; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; -webkit-font-smoothing: antialiased; line-height: 1.5;">

  <!-- Preheader invisible para clientes de correo -->
  <div style="display: none; font-size: 1px; color: #000000; line-height: 1px; max-height: 0px; max-width: 0px; opacity: 0; overflow: hidden; mso-hide: all;">
    ${escapeHtml(preheaderText)}&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;
  </div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: #000000; margin: 0; padding: 0; width: 100%;">
    <tr>
      <td align="center" class="outer-wrapper-td" style="padding: 24px 12px 48px; background-color: #000000;">
        <!--[if (gte mso 9)|(IE)]>
        <table role="presentation" width="600" align="center" cellpadding="0" cellspacing="0" border="0">
        <tr>
        <td>
        <![endif]-->

        <!-- Contenedor principal de la tarjeta -->
        <table role="presentation" class="email-container" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width: 600px; margin: 0 auto; background-color: #000000; border-radius: 16px; overflow: hidden; border: 1px solid #383838;">
          
          <!-- Bloque de Encabezado con Fondo Negro Puro (#000000) -->
          <tr>
            <td align="center" bgcolor="#000000" style="background-color: #000000; padding: 32px 24px 24px; text-align: center;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin: 0 auto;">
                <tr>
                  <td align="center">
                    <img src="${logoUrl}" alt="Kani Barber Studio" width="180" style="display: block; width: 180px; max-width: 100%; height: auto; border: 0; margin: 0 auto; font-family: 'DM Serif Display', Georgia, serif; font-size: 22px; font-weight: 700; color: #B99A5B; text-align: center;" />
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Filete divisor sutil de 1px entre el encabezado y el cuerpo -->
          <tr>
            <td align="center" bgcolor="#383838" style="background-color: #383838; height: 1px; line-height: 1px; font-size: 1px; padding: 0;">
              <div style="height: 1px; line-height: 1px; font-size: 1px;">&nbsp;</div>
            </td>
          </tr>

          <!-- Título y Saludo -->
          <tr>
            <td class="content-padding" style="padding: 28px 24px 0; text-align: left;">
              <h1 class="title-h1" style="margin: 0 0 10px; font-family: 'DM Serif Display', Georgia, 'Times New Roman', serif; font-size: 34px; line-height: 1.15; font-weight: 400; color: #F5F5F5; letter-spacing: -0.01em;">
                Se confirmó tu turno
              </h1>
              <p style="margin: 0; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 16px; line-height: 1.5; color: #C7C7C7;">
                Hola <strong style="color: #F5F5F5; font-weight: 600;">${safe.clientName}</strong>, te esperamos en Kani.
              </p>
            </td>
          </tr>

          <!-- Tarjeta Oscura del Turno (#000000) -->
          <tr>
            <td class="content-padding" style="padding: 24px 24px 0;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#000000" style="background-color: #000000; border-radius: 14px; border: 1px solid #383838; overflow: hidden; width: 100%; table-layout: fixed;">
                <tr>
                  <td class="dark-card-inner" style="padding: 22px;">
                    
                    <!-- Tarjeta Modo Móvil (Vertical por defecto) -->
                    <div class="mobile-dark-card">
                      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width: 100%;">
                        <tr>
                          <td style="padding-bottom: 16px;">
                            <div style="font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 12px; font-weight: 600; color: #C7C7C7; letter-spacing: 0.12em; text-transform: uppercase; margin-bottom: 6px;">
                              FECHA
                            </div>
                            <div style="font-family: 'DM Serif Display', Georgia, 'Times New Roman', serif; font-size: 22px; line-height: 28px; font-weight: 400; color: #F5F5F5; word-break: break-word; overflow-wrap: break-word;">
                              ${safe.compactDate}
                            </div>
                          </td>
                        </tr>
                        <tr>
                          <td style="padding-bottom: 18px;">
                            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width: 100%;">
                              <tr>
                                <td valign="bottom" style="padding: 0;">
                                  <div style="font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 12px; font-weight: 600; color: #C7C7C7; letter-spacing: 0.12em; text-transform: uppercase; margin-bottom: 6px;">
                                    HORA
                                  </div>
                                  <div style="font-family: 'DM Serif Display', Georgia, 'Times New Roman', serif; font-size: 22px; line-height: 28px; font-weight: 400; color: #F5F5F5;">
                                    ${safe.time} hs
                                  </div>
                                </td>
                                <td align="right" valign="bottom" style="padding: 0; text-align: right; line-height: 1; font-family: sans-serif; font-size: 48px; color: rgba(118, 41, 54, 0.45); user-select: none; pointer-events: none;">
                                  &#34809;
                                </td>
                              </tr>
                            </table>
                          </td>
                        </tr>
                        <tr>
                          <td style="padding-bottom: 18px;">
                            <div style="height: 1px; background-color: #383838; line-height: 1px; font-size: 1px;">&nbsp;</div>
                          </td>
                        </tr>
                        <tr>
                          <td style="padding-bottom: 16px;">
                            <div style="font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 12px; font-weight: 600; color: #C7C7C7; letter-spacing: 0.12em; text-transform: uppercase; margin-bottom: 6px;">
                              SERVICIO
                            </div>
                            <div style="font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 16px; line-height: 1.35; font-weight: 500; color: #F5F5F5; word-break: break-word;">
                              ${safe.serviceName}
                            </div>
                          </td>
                        </tr>
                        <tr>
                          <td style="padding-bottom: 22px;">
                            <div style="font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 12px; font-weight: 600; color: #C7C7C7; letter-spacing: 0.12em; text-transform: uppercase; margin-bottom: 6px;">
                              BARBERO
                            </div>
                            <div style="font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 16px; line-height: 1.35; font-weight: 500; color: #F5F5F5; word-break: break-word;">
                              ${safe.barberName}
                            </div>
                          </td>
                        </tr>
                        <tr>
                          <td style="padding: 0;">
                            <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width: 100%;">
                              <tr>
                                <td align="center" bgcolor="#B99A5B" style="border-radius: 8px; background-color: #B99A5B;">
                                  <a href="${calendarUrl}" target="_blank" rel="noopener noreferrer" style="display: block; padding: 13px 20px; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 15px; font-weight: 600; color: #000000; text-decoration: none; text-align: center; line-height: 1.2; min-height: 44px; box-sizing: border-box;">
                                    Agregar al calendario
                                  </a>
                                </td>
                              </tr>
                              <tr>
                                <td style="height: 10px; line-height: 10px; font-size: 1px;">&nbsp;</td>
                              </tr>
                              <tr>
                                <td align="center" bgcolor="#762936" style="border-radius: 8px; background-color: #762936;">
                                  <a href="${cancellationUrl}" target="_blank" rel="noopener noreferrer" style="display: block; padding: 13px 20px; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 15px; font-weight: 600; color: #FFFFFF; text-decoration: none; text-align: center; line-height: 1.2; min-height: 44px; box-sizing: border-box;">
                                    Cancelar turno
                                  </a>
                                </td>
                              </tr>
                            </table>
                          </td>
                        </tr>
                      </table>
                    </div>

                    <!-- Tarjeta Modo Escritorio (2 Columnas) -->
                    <!--[if (gte mso 9)|(IE)]>
                    <div class="desktop-dark-card" style="display: block !important;">
                    <![endif]-->
                    <!--[if !mso]><!-->
                    <div class="desktop-dark-card" style="display: none; max-height: 0px; overflow: hidden; mso-hide: all;">
                    <!--<![endif]-->
                      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width: 100%;">
                        <tr>
                          <td width="50%" valign="top" style="padding-right: 14px;">
                            <div style="font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 12px; font-weight: 600; color: #C7C7C7; letter-spacing: 0.12em; text-transform: uppercase; margin-bottom: 6px;">
                              FECHA
                            </div>
                            <div style="font-family: 'DM Serif Display', Georgia, 'Times New Roman', serif; font-size: 22px; line-height: 28px; font-weight: 400; color: #F5F5F5; margin-bottom: 18px; word-break: break-word; overflow-wrap: break-word;">
                              ${safe.compactDate}
                            </div>
                            <div style="font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 12px; font-weight: 600; color: #C7C7C7; letter-spacing: 0.12em; text-transform: uppercase; margin-bottom: 6px;">
                              HORA
                            </div>
                            <div style="font-family: 'DM Serif Display', Georgia, 'Times New Roman', serif; font-size: 22px; line-height: 28px; font-weight: 400; color: #F5F5F5;">
                              ${safe.time} hs
                            </div>
                          </td>
                          <td width="50%" valign="top" style="padding-left: 14px;">
                            <div style="font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 12px; font-weight: 600; color: #C7C7C7; letter-spacing: 0.12em; text-transform: uppercase; margin-bottom: 6px;">
                              SERVICIO
                            </div>
                            <div style="font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 16px; line-height: 1.35; font-weight: 500; color: #F5F5F5; margin-bottom: 18px; word-break: break-word;">
                              ${safe.serviceName}
                            </div>
                            <div style="font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 12px; font-weight: 600; color: #C7C7C7; letter-spacing: 0.12em; text-transform: uppercase; margin-bottom: 6px;">
                              BARBERO
                            </div>
                            <div style="font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 16px; line-height: 1.35; font-weight: 500; color: #F5F5F5; word-break: break-word;">
                              ${safe.barberName}
                            </div>
                            <div style="text-align: right; line-height: 0; height: 0; overflow: visible; font-family: sans-serif; font-size: 48px; color: rgba(118, 41, 54, 0.45); user-select: none; pointer-events: none;">
                              &#34809;
                            </div>
                          </td>
                        </tr>
                        <tr>
                          <td colspan="2" style="padding-top: 22px;">
                            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width: 100%;">
                              <tr>
                                <td width="50%" valign="top" style="padding-right: 6px;">
                                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                                    <tr>
                                      <td align="center" bgcolor="#B99A5B" style="border-radius: 8px; background-color: #B99A5B;">
                                        <a href="${calendarUrl}" target="_blank" rel="noopener noreferrer" style="display: block; padding: 13px 14px; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 14px; font-weight: 600; color: #000000; text-decoration: none; text-align: center; line-height: 1.2; min-height: 44px; box-sizing: border-box;">
                                          Agregar al calendario
                                        </a>
                                      </td>
                                    </tr>
                                  </table>
                                </td>
                                <td width="50%" valign="top" style="padding-left: 6px;">
                                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                                    <tr>
                                      <td align="center" bgcolor="#762936" style="border-radius: 8px; background-color: #762936;">
                                        <a href="${cancellationUrl}" target="_blank" rel="noopener noreferrer" style="display: block; padding: 13px 14px; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 14px; font-weight: 600; color: #FFFFFF; text-decoration: none; text-align: center; line-height: 1.2; min-height: 44px; box-sizing: border-box;">
                                          Cancelar turno
                                        </a>
                                      </td>
                                    </tr>
                                  </table>
                                </td>
                              </tr>
                            </table>
                          </td>
                        </tr>
                      </table>
                    </div>

                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Sección RESUMEN -->
          <tr>
            <td class="content-padding" style="padding: 28px 24px 0;">
              <div style="margin-bottom: 10px; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 13px; font-weight: 700; color: #D4D4D4; letter-spacing: 0.12em; text-transform: uppercase;">
                RESUMEN
              </div>
              
              <!-- Tarjeta oscura de Resumen (#000000) -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#000000" style="background-color: #000000; border: 1px solid #383838; border-radius: 14px; overflow: hidden; width: 100%; table-layout: fixed;">
                <tr>
                  <td style="padding: 20px;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width: 100%; table-layout: fixed;">
${isNoDeposit ? `
                      <!-- Reserva sin seña -->
                      <tr>
                        <td style="padding: 6px 0; font-family: 'Inter', sans-serif; font-size: 15px; color: #C7C7C7; width: 55%;">Total del servicio</td>
                        <td align="right" style="padding: 6px 0; font-family: 'Inter', sans-serif; font-size: 16px; font-weight: 500; color: #F5F5F5; width: 45%; text-align: right;">${safe.finalPrice}</td>
                      </tr>
                      <tr>
                        <td style="padding: 6px 0; font-family: 'Inter', sans-serif; font-size: 15px; color: #C7C7C7; width: 55%;">Beneficio</td>
                        <td align="right" style="padding: 6px 0; font-family: 'Inter', sans-serif; font-size: 15px; font-weight: 600; color: #B99A5B; width: 45%; text-align: right;">Reserva sin seña</td>
                      </tr>
                      <tr>
                        <td colspan="2" style="padding: 10px 0 6px;"><div style="height: 1px; background-color: #383838; line-height: 1px; font-size: 1px;">&nbsp;</div></td>
                      </tr>
                      <tr>
                        <td colspan="2" style="padding-top: 6px; padding-bottom: 12px;">
                          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width: 100%;">
                            <tr>
                              <td valign="baseline" class="balance-label-td"><span style="font-family: 'Inter', sans-serif; font-size: 15px; font-weight: 600; color: #F5F5F5;">Saldo a pagar en el local</span></td>
                              <td align="right" valign="baseline" class="balance-amount-td"><span style="font-family: 'DM Serif Display', serif; font-size: 28px; line-height: 1.15; font-weight: 400; color: #F5F5F5;">${safe.remainingPayment}</span></td>
                            </tr>
                          </table>
                        </td>
                      </tr>
                      <tr>
                        <td colspan="2" style="padding-top: 12px; border-top: 1px dashed #383838;">
                          <p style="margin: 0; font-family: 'Inter', sans-serif; font-size: 13px; line-height: 1.45; color: #C7C7C7;">
                            Reserva sin seña. Abonás el total de ${safe.remainingPayment} en el local.
                          </p>
                        </td>
                      </tr>
` : isFreeService ? `
                      <!-- Servicio gratuito 100% -->
                      <tr>
                        <td style="padding: 6px 0; font-family: 'Inter', sans-serif; font-size: 15px; color: #C7C7C7; width: 55%;">Beneficio</td>
                        <td align="right" style="padding: 6px 0; font-family: 'Inter', sans-serif; font-size: 15px; font-weight: 600; color: #B99A5B; width: 45%; text-align: right;">Servicio 100% bonificado</td>
                      </tr>
                      <tr>
                        <td colspan="2" style="padding: 10px 0 6px;"><div style="height: 1px; background-color: #383838; line-height: 1px; font-size: 1px;">&nbsp;</div></td>
                      </tr>
                      <tr>
                        <td colspan="2" style="padding-top: 6px; padding-bottom: 12px;">
                          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width: 100%;">
                            <tr>
                              <td valign="baseline" class="balance-label-td"><span style="font-family: 'Inter', sans-serif; font-size: 15px; font-weight: 600; color: #F5F5F5;">Total a abonar</span></td>
                              <td align="right" valign="baseline" class="balance-amount-td"><span style="font-family: 'DM Serif Display', serif; font-size: 28px; line-height: 1.15; font-weight: 400; color: #F5F5F5;">$0</span></td>
                            </tr>
                          </table>
                        </td>
                      </tr>
                      <tr>
                        <td colspan="2" style="padding-top: 12px; border-top: 1px dashed #383838;">
                          <p style="margin: 0; font-family: 'Inter', sans-serif; font-size: 13px; line-height: 1.45; color: #C7C7C7;">
                            Servicio bonificado al 100 %. Total a pagar: $0.
                          </p>
                        </td>
                      </tr>
` : isPercent10 || isPercent50 ? `
                      <!-- Descuento porcentual -->
                      <tr>
                        <td style="padding: 6px 0; font-family: 'Inter', sans-serif; font-size: 15px; color: #C7C7C7; width: 55%;">Precio original</td>
                        <td align="right" style="padding: 6px 0; font-family: 'Inter', sans-serif; font-size: 16px; font-weight: 500; color: #F5F5F5; width: 45%; text-align: right;">${safe.originalPrice}</td>
                      </tr>
                      <tr>
                        <td style="padding: 6px 0; font-family: 'Inter', sans-serif; font-size: 15px; color: #C7C7C7; width: 55%;">Descuento (${isPercent10 ? '10%' : '50%'})</td>
                        <td align="right" style="padding: 6px 0; font-family: 'Inter', sans-serif; font-size: 16px; font-weight: 600; color: #B99A5B; width: 45%; text-align: right;">−${safe.discount}</td>
                      </tr>
                      <tr>
                        <td style="padding: 6px 0; font-family: 'Inter', sans-serif; font-size: 15px; color: #C7C7C7; width: 55%;">Total final</td>
                        <td align="right" style="padding: 6px 0; font-family: 'Inter', sans-serif; font-size: 16px; font-weight: 600; color: #F5F5F5; width: 45%; text-align: right;">${safe.finalPrice}</td>
                      </tr>
                      <tr>
                        <td style="padding: 6px 0; font-family: 'Inter', sans-serif; font-size: 15px; color: #C7C7C7; width: 55%;">Seña abonada</td>
                        <td align="right" style="padding: 6px 0; font-family: 'Inter', sans-serif; font-size: 16px; font-weight: 600; color: #E06D80; width: 45%; text-align: right;">−${safe.downPayment}</td>
                      </tr>
                      <tr>
                        <td colspan="2" style="padding: 10px 0 6px;"><div style="height: 1px; background-color: #383838; line-height: 1px; font-size: 1px;">&nbsp;</div></td>
                      </tr>
                      <tr>
                        <td colspan="2" style="padding-top: 6px; padding-bottom: 12px;">
                          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width: 100%;">
                            <tr>
                              <td valign="baseline" class="balance-label-td"><span style="font-family: 'Inter', sans-serif; font-size: 15px; font-weight: 600; color: #F5F5F5;">Saldo en el local</span></td>
                              <td align="right" valign="baseline" class="balance-amount-td"><span style="font-family: 'DM Serif Display', serif; font-size: 28px; line-height: 1.15; font-weight: 400; color: #F5F5F5;">${safe.remainingPayment}</span></td>
                            </tr>
                          </table>
                        </td>
                      </tr>
                      <tr>
                        <td colspan="2" style="padding-top: 12px; border-top: 1px dashed #383838;">
                          <p style="margin: 0; font-family: 'Inter', sans-serif; font-size: 13px; line-height: 1.45; color: #C7C7C7;">
                            Podés abonar el saldo en efectivo o por transferencia.
                          </p>
                        </td>
                      </tr>
` : `
                      <!-- Fila Importe Estándar -->
                      <tr>
                        <td style="padding: 6px 0; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 15px; color: #C7C7C7; width: 55%;">Importe</td>
                        <td align="right" style="padding: 6px 0; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 16px; font-weight: 500; color: #F5F5F5; width: 45%; text-align: right;">${safe.servicePrice}</td>
                      </tr>
                      <!-- Fila Seña abonada -->
                      <tr>
                        <td style="padding: 6px 0; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 15px; color: #C7C7C7; width: 55%;">Seña abonada</td>
                        <td align="right" style="padding: 6px 0; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 16px; font-weight: 600; color: #E06D80; width: 45%; text-align: right;">−${safe.downPayment}</td>
                      </tr>
                      <!-- Divisor interno -->
                      <tr>
                        <td colspan="2" style="padding: 10px 0 6px;"><div style="height: 1px; background-color: #383838; line-height: 1px; font-size: 1px;">&nbsp;</div></td>
                      </tr>
                      <!-- Fila Saldo en el local -->
                      <tr>
                        <td colspan="2" style="padding-top: 6px; padding-bottom: 12px;">
                          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width: 100%;">
                            <tr>
                              <td valign="baseline" class="balance-label-td"><span style="font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 15px; font-weight: 600; color: #F5F5F5;">Saldo en el local</span></td>
                              <td align="right" valign="baseline" class="balance-amount-td"><span style="font-family: 'DM Serif Display', Georgia, 'Times New Roman', serif; font-size: 28px; line-height: 1.15; font-weight: 400; color: #F5F5F5;">${safe.remainingPayment}</span></td>
                            </tr>
                          </table>
                        </td>
                      </tr>
                      <!-- Aclaración de medios de pago -->
                      <tr>
                        <td colspan="2" style="padding-top: 12px; border-top: 1px dashed #383838;">
                          <p style="margin: 0; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 13px; line-height: 1.45; color: #C7C7C7;">
                            Podés abonar el saldo en efectivo o por transferencia.
                          </p>
                        </td>
                      </tr>
`}
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Sección CÓMO LLEGAR -->
          <tr>
            <td class="content-padding" style="padding: 28px 24px 0;">
              <div style="margin-bottom: 10px; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 13px; font-weight: 700; color: #D4D4D4; letter-spacing: 0.12em; text-transform: uppercase;">
                CÓMO LLEGAR
              </div>
              
              <!-- Tarjeta oscura de Ubicación (#000000) -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#000000" style="background-color: #000000; border: 1px solid #383838; border-radius: 14px; overflow: hidden; width: 100%; table-layout: fixed;">
                <tr>
                  <td style="padding: 20px;">
                    <!-- Dirección con ícono dorado -->
                    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-bottom: 18px;">
                      <tr>
                        <td valign="top" style="padding-right: 8px; padding-top: 1px;">
                          <!-- Ícono de ubicación dorado #B99A5B -->
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#B99A5B" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display: block;">
                            <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/>
                            <circle cx="12" cy="10" r="3"/>
                          </svg>
                        </td>
                        <td valign="top">
                          <div style="font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 16px; font-weight: 600; color: #F5F5F5; line-height: 1.3;">
                            San Isidro Labrador 7
                          </div>
                          <div style="font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 14px; color: #C7C7C7; margin-top: 2px;">
                            Martínez, Buenos Aires
                          </div>
                        </td>
                      </tr>
                    </table>

                    <!-- Botones de Acción (2 columnas en escritorio, apiladas en móvil) -->
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <!-- Botón Primario: Ver en Google Maps (Fondo dorado sólido #B99A5B, texto negro #000000) -->
                        <td width="50%" valign="top" class="loc-btn-col" style="padding-right: 6px;">
                          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                            <tr>
                              <td align="center" bgcolor="#B99A5B" style="border-radius: 10px; background-color: #B99A5B;">
                                <a href="${mapsUrl}" target="_blank" rel="noopener noreferrer" style="display: block; padding: 13px 16px; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 15px; font-weight: 600; color: #000000; text-decoration: none; text-align: center; line-height: 1.2; min-height: 44px; box-sizing: border-box;">
                                  Ver en Google Maps
                                </a>
                              </td>
                            </tr>
                          </table>
                        </td>

                        <!-- Botón Secundario: Contactar por WhatsApp (Fondo verde oscuro #128C4A, texto blanco) -->
                        <td width="50%" valign="top" class="loc-btn-col loc-btn-col-right" style="padding-left: 6px;">
                          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                            <tr>
                              <td align="center" bgcolor="#128C4A" style="border-radius: 10px; background-color: #128C4A;">
                                <a href="${whatsAppUrl}" target="_blank" rel="noopener noreferrer" style="display: block; padding: 13px 16px; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 15px; font-weight: 600; color: #FFFFFF; text-decoration: none; text-align: center; line-height: 1.2; min-height: 44px; box-sizing: border-box;">
                                  Contactar por WhatsApp
                                </a>
                              </td>
                            </tr>
                          </table>
                        </td>
                      </tr>
                    </table>

                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Sección PUNTUALIDAD -->
          <tr>
            <td class="content-padding" style="padding: 28px 24px 0;">
              <div style="margin-bottom: 10px; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 13px; font-weight: 700; color: #D4D4D4; letter-spacing: 0.12em; text-transform: uppercase;">
                PUNTUALIDAD
              </div>
              
              <!-- Tarjeta oscura de Puntualidad (#000000) -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#000000" style="background-color: #000000; border: 1px solid #383838; border-radius: 14px; overflow: hidden; width: 100%; table-layout: fixed;">
                <tr>
                  <td style="padding: 18px 20px;">
                    <p style="margin: 0; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 14px; line-height: 1.55; color: #F5F5F5;">
                      Se establece una tolerancia de 15 minutos a partir del horario reservado. Transcurrido ese plazo, el turno podrá ser cancelado para respetar la atención de los siguientes clientes.
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Divisor y Pie de Página Institucional -->
          <tr>
            <td class="content-padding" style="padding: 32px 24px 36px; text-align: center;">
              <div style="height: 1px; width: 100%; background-color: #383838; line-height: 1px; font-size: 1px; margin-bottom: 20px;">&nbsp;</div>
              
              <!-- Ícono y enlace de Instagram -->
              <table role="presentation" align="center" cellpadding="0" cellspacing="0" border="0" style="margin: 0 auto 14px;">
                <tr>
                  <td align="center">
                    <a href="${instagramUrl}" target="_blank" rel="noopener noreferrer" style="display: inline-block; color: #C7C7C7; text-decoration: none;" aria-label="Instagram de Kani Barber Studio">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#C7C7C7" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display: block;">
                        <rect width="20" height="20" x="2" y="2" rx="5" ry="5"/>
                        <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/>
                        <line x1="17.5" x2="17.51" y1="6.5" y2="6.5"/>
                      </svg>
                    </a>
                  </td>
                </tr>
              </table>

              <p style="margin: 0 0 4px; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 13px; line-height: 1.5; color: #C7C7C7;">
                © 2026 Kani Barber Studio · San Isidro Labrador 7, Martínez
              </p>
              <p style="margin: 0; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 12px; line-height: 1.5; color: #C7C7C7;">
                Correo automático de confirmación · turnos@kanibarber.com
              </p>
            </td>
          </tr>

        </table>

        <!--[if (gte mso 9)|(IE)]>
        </td>
        </tr>
        </table>
        <![endif]-->
      </td>
    </tr>
  </table>
</body>
</html>`;

  const text = `KANI BARBER STUDIO
Se confirmó tu turno

Hola ${payload.clientName}, te esperamos en Kani.

Se confirmó tu turno el día ${spanishDate} a las ${cleanTime} hs, para un servicio de ${payload.serviceName} con ${payload.barberName}.

--------------------------------------------------
DETALLE DEL TURNO

Fecha: ${capitalizedDate}
Hora: ${cleanTime} hs
Servicio: ${payload.serviceName}
Barbero: ${payload.barberName}

Agregar al calendario:
${calendarUrl}

Cancelar turno:
${cancellationUrl}

--------------------------------------------------
RESUMEN

${isNoDeposit ? `Reserva sin seña
Abonás el total de ${safe.remainingPayment} en el local.` : isFreeService ? `Servicio bonificado al 100 %
Total a pagar: $0` : isPercent10 || isPercent50 ? `Precio original: ${safe.originalPrice}
Descuento (${isPercent10 ? '10%' : '50%'}): -${safe.discount}
Total final: ${safe.finalPrice}
Seña efectivamente abonada: ${safe.downPayment}
Saldo en el local: ${safe.remainingPayment}

Podés abonar el saldo en efectivo o por transferencia.` : `Importe: ${safe.servicePrice}
Seña abonada: ${safe.downPayment}
Saldo a pagar en el local: ${safe.remainingPayment}

Podés abonar el saldo en efectivo o por transferencia.`}

--------------------------------------------------
CÓMO LLEGAR

San Isidro Labrador 7
Martínez, Buenos Aires

Ver en Google Maps:
${mapsUrl}

Contactar por WhatsApp:
${whatsAppUrl}

Instagram:
${instagramUrl}

--------------------------------------------------
PUNTUALIDAD

Se establece una tolerancia de 15 minutos a partir del horario reservado. Transcurrido ese plazo, el turno podrá ser cancelado para respetar la atención de los siguientes clientes.

--------------------------------------------------
© 2026 Kani Barber Studio · San Isidro Labrador 7, Martínez
Correo automático de confirmación · turnos@kanibarber.com`;

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
  const benefitNoteText = payload.benefitCode
    ? `\n\nTené en cuenta que el código de beneficio utilizado (${payload.benefitCode}) ha sido consumido y no puede reutilizarse.`
    : '';
  const benefitNoteHtml = payload.benefitCode
    ? `<p style="color:#7A2C3A;font-size:13px;margin:12px 0;">Tené en cuenta que el código de beneficio utilizado (<strong>${escapeHtml(payload.benefitCode)}</strong>) ha sido consumido y no puede reutilizarse.</p>`
    : '';
  return {
    subject: 'Se canceló tu turno en Kani Barber Studio',
    text: `${sentence}${benefitNoteText}\n\nReservá un nuevo turno: ${bookingUrl}`,
    html: `<html lang="es"><body style="font-family:Arial,sans-serif;padding:24px"><p>${escapeHtml(sentence)}</p>${benefitNoteHtml}<a href="${escapeHtml(bookingUrl)}" style="display:inline-block;padding:12px 18px;background:#702B3A;color:#fff;border-radius:8px;text-decoration:none">Reservá un nuevo turno</a></body></html>`,
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
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#f3efe8;color:#1c1c1c;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.55"><div style="width:100%;padding:24px 12px;box-sizing:border-box"><div style="max-width:600px;margin:0 auto"><header style="background:#161616;padding:22px 24px;color:#f4f1eb;letter-spacing:.14em;font-size:16px;font-weight:700">Kani Barber Studio</header><main style="background:#fff;padding:30px 24px"><h1 style="margin:0;color:#161616;font-size:28px;line-height:1.15;font-weight:700">${title}</h1><p style="margin:18px 0 24px;color:#555;line-height:1.65">Hola ${safe.clientName}:<br><br>Para confirmar tu turno, transferí la seña con los siguientes datos.</p><section style="margin:0 0 26px;padding:18px 20px;background:#f3e7d3;border-left:4px solid #a37b43"><p style="margin:0 0 4px;color:#765529;font-size:12px;letter-spacing:.08em;text-transform:uppercase;font-weight:700">Seña a transferir</p><p style="margin:0;color:#161616;font-size:32px;line-height:1.1;font-weight:700">${safe.downPayment}</p></section><section style="margin:0 0 26px;padding:20px;background:#faf9f6;border:1px solid #e5e0d8"><h2 style="margin:0 0 16px;color:#161616;font-size:18px;line-height:1.25">Datos para la transferencia</h2><div style="border-top:1px solid #e5e0d8"><p style="margin:0;padding:10px 0;border-bottom:1px solid #e5e0d8"><strong style="display:inline-block;width:86px;color:#6d6d6d;font-size:12px">Titular</strong><span style="overflow-wrap:anywhere">${safe.transferHolderName}</span></p><p style="margin:0;padding:10px 0;border-bottom:1px solid #e5e0d8"><strong style="display:inline-block;width:86px;color:#6d6d6d;font-size:12px">Alias</strong><span style="overflow-wrap:anywhere;font-weight:700">${safe.transferAlias}</span></p><p style="margin:0;padding:10px 0 0"><strong style="display:inline-block;width:86px;color:#6d6d6d;font-size:12px">CUIT</strong><span style="overflow-wrap:anywhere">${safe.transferCuit}</span></p></div></section><section style="margin:0 0 26px;padding:0 0 22px;border-bottom:1px solid #e5e0d8"><h2 style="margin:0 0 16px;color:#161616;font-size:18px;line-height:1.25">Datos de tu turno</h2><p style="margin:0 0 9px"><strong style="color:#6d6d6d;font-size:12px">Servicio</strong><br>${safe.serviceName} · ${payload.serviceDurationMinutes} min</p><p style="margin:0 0 9px"><strong style="color:#6d6d6d;font-size:12px">Barbero</strong><br>${safe.barberName}</p><p style="margin:0 0 9px"><strong style="color:#6d6d6d;font-size:12px">Fecha</strong><br>${safe.date}</p><p style="margin:0 0 16px"><strong style="color:#6d6d6d;font-size:12px">Horario</strong><br>${safe.time}</p><p style="margin:0 0 7px"><strong>Precio total del servicio:</strong> ${safe.servicePrice}</p><p style="margin:0"><strong>Importe restante en el local:</strong> ${safe.remainingPayment}</p></section><section style="margin:0 0 24px"><p style="margin:0 0 10px"><strong>Kani Barber Studio</strong> · San Isidro Labrador 7, Martínez</p><a href="${mapsUrl}" style="display:inline-block;color:#9f173b;font-weight:700;text-decoration:underline;text-underline-offset:3px">Ver ubicación en Google Maps</a></section><section style="margin:0;padding:16px 18px;background:#f8f5ef;color:#555;border-left:3px solid #c9b28b"><strong style="color:#333">Importante:</strong> tu turno todavía no está confirmado. Una vez verificado el pago de la seña, tu turno se confirmará automáticamente. Te enviaremos un email de confirmación.</section><p style="margin:24px 0 0;color:#555">¡Gracias por elegir Kani Barber Studio!</p></main><footer style="color:#8b8b8b;font-size:12px;line-height:1.5;text-align:center;padding:16px 8px">Mensaje automático de Kani Barber Studio.</footer></div></div></body></html>`;
  const text = `${title}\n\nHola ${payload.clientName}:\n\nPara confirmar tu turno, transferí la seña con los siguientes datos.\n\nSEÑA A TRANSFERIR\n${formatArs(payload.downPaymentArs)}\n\nDATOS PARA LA TRANSFERENCIA\nTitular: ${payload.transferHolderName}\nAlias: ${payload.transferAlias}\nCUIT: ${payload.transferCuit}\n\nDATOS DE TU TURNO\nServicio: ${payload.serviceName} · ${payload.serviceDurationMinutes} min\nBarbero: ${payload.barberName}\nFecha: ${date}\nHorario: ${time}\nPrecio total del servicio: ${formatArs(payload.servicePriceArs)}\nImporte restante en el local: ${formatArs(remainingPayment)}\n\nKani Barber Studio · San Isidro Labrador 7, Martínez\nVer ubicación en Google Maps: ${mapsUrl}\n\nImportante: tu turno todavía no está confirmado. Una vez verificado el pago de la seña, tu turno se confirmará automáticamente. Te enviaremos un email de confirmación.\n\n¡Gracias por elegir Kani Barber Studio!\n\nMensaje automático de Kani Barber Studio.`;
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
