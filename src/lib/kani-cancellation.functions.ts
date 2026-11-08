import { createServerFn } from "@tanstack/react-start";
import { verifyCancellationSignature } from "./kani-cancellation-token";
import { createRequestSupabaseClient } from "./kani-notifications.server";
import { dispatchAppointmentNotification } from "./kani-notifications.functions";
import { isAppointmentPast } from "./kani-mobile-appointments";

export type CancellationDetailsResult = {
  ok: boolean;
  error?: "INVALID_TOKEN" | "NOT_FOUND" | "SERVER_ERROR";
  appointment?: {
    id: string;
    serviceName: string;
    barberName: string;
    bookingDate: string;
    startTime: string;
    status: string;
    isPast: boolean;
    cancellationReason?: string | null;
  };
};

export type CancellationConfirmResult = {
  ok: boolean;
  error?: "INVALID_TOKEN" | "NOT_FOUND" | "APPOINTMENT_PAST" | "NOT_CANCELABLE" | "SERVER_ERROR";
  message?: string;
  alreadyCancelled?: boolean;
};

export async function handleGetCancellationDetails(data: {
  appointmentId: string;
  token: string;
}): Promise<CancellationDetailsResult> {
  const { appointmentId, token } = data;
  if (!verifyCancellationSignature(appointmentId, token)) {
    return { ok: false, error: "INVALID_TOKEN" };
  }

  try {
    const supabase = await createRequestSupabaseClient();
    const { data: apt, error } = await supabase
      .from("appointments")
      .select(`
        id,
        booking_date,
        start_time,
        status,
        cancellation_reason,
        barber:barbers(name),
        service:services(name)
      `)
      .eq("id", appointmentId)
      .maybeSingle();

    if (error || !apt) {
      return { ok: false, error: "NOT_FOUND" };
    }

    const barberName = (apt.barber as any)?.name || "Barbero";
    const serviceName = (apt.service as any)?.name || "Servicio Kani";
    const isPast = isAppointmentPast(apt.booking_date, apt.start_time);

    return {
      ok: true,
      appointment: {
        id: apt.id,
        serviceName,
        barberName,
        bookingDate: apt.booking_date,
        startTime: apt.start_time,
        status: apt.status,
        isPast,
        cancellationReason: apt.cancellation_reason,
      },
    };
  } catch (err) {
    console.error("[Cancellation] Error getting details:", err);
    return { ok: false, error: "SERVER_ERROR" };
  }
}

export async function handleConfirmCancellation(data: {
  appointmentId: string;
  token: string;
}): Promise<CancellationConfirmResult> {
  const { appointmentId, token } = data;
  if (!verifyCancellationSignature(appointmentId, token)) {
    return { ok: false, error: "INVALID_TOKEN", message: "Token de cancelación inválido." };
  }

  try {
    const supabase = await createRequestSupabaseClient();

    // Check current appointment state
    const { data: apt, error: fetchErr } = await supabase
      .from("appointments")
      .select("id, status, booking_date, start_time, client_phone, membership_consumption_id")
      .eq("id", appointmentId)
      .maybeSingle();

    if (fetchErr || !apt) {
      return { ok: false, error: "NOT_FOUND", message: "Turno no encontrado." };
    }

    // Idempotency: if already cancelled, return success without duplicating notifications
    if (apt.status === "CANCELLED") {
      return { ok: true, alreadyCancelled: true, message: "El turno ya fue cancelado previamente." };
    }

    if (apt.status === "COMPLETED" || apt.status === "NO_SHOW" || (apt as any).membership_consumption_id) {
      return {
        ok: false,
        error: "NOT_CANCELABLE",
        message: "Este turno ya fue completado o tiene una sesión consumida y no puede ser cancelado por este enlace.",
      };
    }

    if (isAppointmentPast(apt.booking_date, apt.start_time)) {
      return {
        ok: false,
        error: "APPOINTMENT_PAST",
        message: "El turno ya transcurrió y no puede ser cancelado.",
      };
    }

    // Update appointment to CANCELLED
    const nowIso = new Date().toISOString();
    const { error: updateErr } = await supabase
      .from("appointments")
      .update({
        status: "CANCELLED",
        cancellation_reason: "CLIENT_CANCELLED",
        cancelled_at: nowIso,
        updated_at: nowIso,
      })
      .eq("id", appointmentId);

    if (updateErr) {
      console.error("[Cancellation] Update error:", updateErr);
      return { ok: false, error: "SERVER_ERROR", message: "No se pudo actualizar el estado del turno." };
    }

    // Create outbox notification event for CANCELLED
    const { data: claimToken, error: rpcErr } = await supabase.rpc(
      "create_appointment_notification_event",
      {
        p_appointment_id: appointmentId,
        p_notification_type: "CANCELLED",
      }
    );

    if (rpcErr) {
      console.warn("[Cancellation] Outbox RPC warning:", rpcErr);
    } else if (claimToken) {
      try {
        await dispatchAppointmentNotification({
          appointmentId,
          claimToken,
          clientPhone: apt.client_phone,
        });
      } catch (notifErr) {
        console.warn("[Cancellation] Dispatch warning:", notifErr);
      }
    }

    return { ok: true, message: "Turno cancelado exitosamente." };
  } catch (err) {
    console.error("[Cancellation] Error confirming cancellation:", err);
    return { ok: false, error: "SERVER_ERROR", message: "Error interno del servidor." };
  }
}

export const getCancellationDetailsFn = createServerFn({ method: "POST" })
  .validator((data: { appointmentId: string; token: string }) => {
    if (!data?.appointmentId || !data?.token) {
      throw new Error("CANCELLATION_INPUT_INVALID");
    }
    return data;
  })
  .handler(async ({ data }): Promise<CancellationDetailsResult> => handleGetCancellationDetails(data));

export const confirmCancellationFn = createServerFn({ method: "POST" })
  .validator((data: { appointmentId: string; token: string }) => {
    if (!data?.appointmentId || !data?.token) {
      throw new Error("CANCELLATION_INPUT_INVALID");
    }
    return data;
  })
  .handler(async ({ data }): Promise<CancellationConfirmResult> => handleConfirmCancellation(data));
