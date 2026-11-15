import { createServerFn } from "@tanstack/react-start";
import { verifyCancellationSignature } from "./kani-cancellation-token";
import { createRequestSupabaseClient } from "./kani-notifications.server";
import { dispatchAppointmentNotification } from "./kani-notifications.functions";
import { isAppointmentPast } from "./kani-mobile-appointments";

/**
 * Retorna las horas restantes entre el momento actual (o fecha dada) y la cita,
 * respetando el huso de Argentina (UTC-3).
 */
export function getHoursUntilAppointment(
  bookingDate?: string | null,
  startTime?: string | null,
  now = new Date()
): number {
  if (!bookingDate || !startTime) return -1;
  const dateParts = bookingDate.trim().split('-');
  if (dateParts.length !== 3) return -1;
  const year = parseInt(dateParts[0], 10);
  const month = parseInt(dateParts[1], 10);
  const day = parseInt(dateParts[2], 10);

  const timeClean = startTime.trim().slice(0, 5);
  const [hourStr, minStr] = timeClean.split(':');
  const hour = parseInt(hourStr, 10);
  const min = parseInt(minStr, 10);

  if (isNaN(year) || isNaN(month) || isNaN(day) || isNaN(hour) || isNaN(min)) {
    return -1;
  }

  // Argentina: UTC-3 fijo (sin horario de verano). Hora local + 3 = UTC.
  const apptUtc = Date.UTC(year, month - 1, day, hour + 3, min, 0);
  const nowUtc = now.getTime();
  return (apptUtc - nowUtc) / (1000 * 60 * 60);
}

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
    isWithin24Hours: boolean;
    canCancel: boolean;
    hoursUntil: number;
    cancellationReason?: string | null;
  };
};

export type CancellationConfirmResult = {
  ok: boolean;
  error?: "INVALID_TOKEN" | "NOT_FOUND" | "APPOINTMENT_PAST" | "WITHIN_24_HOURS" | "NOT_CANCELABLE" | "SERVER_ERROR";
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
    const hoursUntil = getHoursUntilAppointment(apt.booking_date, apt.start_time);
    const isPast = isAppointmentPast(apt.booking_date, apt.start_time) || hoursUntil < 0;
    const isWithin24Hours = !isPast && hoursUntil < 24;
    const canCancel = !isPast && !isWithin24Hours && apt.status === 'CONFIRMED';

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
        isWithin24Hours,
        canCancel,
        hoursUntil,
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
      .select("id, status, booking_date, start_time, client_phone")
      .eq("id", appointmentId)
      .maybeSingle();

    if (fetchErr || !apt) {
      return { ok: false, error: "NOT_FOUND", message: "Turno no encontrado." };
    }

    // Idempotency: if already cancelled, return success without duplicating notifications
    if (apt.status === "CANCELLED") {
      return { ok: true, alreadyCancelled: true, message: "El turno ya fue cancelado previamente." };
    }

    if (apt.status === "COMPLETED" || apt.status === "NO_SHOW") {
      return {
        ok: false,
        error: "NOT_CANCELABLE",
        message: "Este turno ya fue completado y no puede ser cancelado.",
      };
    }

    if (isAppointmentPast(apt.booking_date, apt.start_time)) {
      return {
        ok: false,
        error: "APPOINTMENT_PAST",
        message: "El turno ya transcurrió y no puede ser cancelado.",
      };
    }

    const hoursUntil = getHoursUntilAppointment(apt.booking_date, apt.start_time);
    if (hoursUntil < 24) {
      return {
        ok: false,
        error: "WITHIN_24_HOURS",
        message: "No es posible cancelar el turno de forma online con menos de 24 horas de anticipación. Por favor comunicate con el estudio por WhatsApp.",
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
