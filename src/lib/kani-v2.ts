import type { RealAppointment } from "./kani-appointments";
import type { ServicePayment } from "./kani-payments";
import type { AvailabilitySlot } from "./kani-availability";
import { minutes } from "./kani-model";

export const PREVIEW_PROJECT = "iockpxtkflyjfagkvgnr";

// Cloudflare Workers Preview/Test deployments for Kani Barber Studio:
// Matches:
// - kanibarberstudio-cloudflare.kanibarber.workers.dev
// - <deployment-id>-kanibarberstudio-cloudflare.kanibarber.workers.dev
// - kanibarberstudio-cloudflare.tomasblutmannliriumprive.workers.dev
// - <deployment-id>-kanibarberstudio-cloudflare.tomasblutmannliriumprive.workers.dev
const CLOUDFLARE_PREVIEW_HOSTNAME_PATTERN =
  /^(?:[a-zA-Z0-9_-]+-)?kanibarberstudio-cloudflare\.(?:kanibarber|tomasblutmannliriumprive)\.workers\.dev$/i;

export function isV2PreviewHost(hostname: string): boolean {
  if (!hostname) return false;
  const cleanHost = hostname.trim().toLowerCase();
  if (cleanHost === "localhost" || cleanHost === "127.0.0.1") return true;
  return CLOUDFLARE_PREVIEW_HOSTNAME_PATTERN.test(cleanHost);
}

export function isV2Preview(url: string, hostname: string): boolean {
  try {
    if (!url || !hostname) return false;
    return (
      new URL(url).hostname === `${PREVIEW_PROJECT}.supabase.co` &&
      isV2PreviewHost(hostname)
    );
  } catch {
    return false;
  }
}

export function scopeV2<T extends { barberId: string }>(
  items: T[],
  role: string,
  ownId: string | null,
  filter = "ALL",
) {
  return items.filter(
    (item) =>
      (role === "ADMIN" || (role === "BARBER" && ownId !== null && item.barberId === ownId)) &&
      (filter === "ALL" || item.barberId === filter),
  );
}

export function slotReserved(slot: AvailabilitySlot, appointments: RealAppointment[]) {
  return appointments.some(
    (a) =>
      a.barberId === slot.barber_id &&
      a.date === slot.slot_date &&
      ["PENDING", "CONFIRMED"].includes(a.statusCode) &&
      minutes(slot.start_time) <
        (a.endTime ? minutes(a.endTime) : minutes(a.time) + (a.serviceDuration ?? 45)) &&
      minutes(slot.end_time) > minutes(a.time),
  );
}

export function paymentSummary(payments: ServicePayment[]) {
  const collected = payments.reduce((sum, p) => sum + p.collectedAmountArs, 0);

  const executedAppointmentIds = new Set(
    payments.filter((p) => !p.isDepositMovement && p.appointmentId).map((p) => p.appointmentId)
  );

  const depositMovementAptIds = new Set(
    payments.filter((p) => p.isDepositMovement && p.appointmentId).map((p) => p.appointmentId)
  );

  const value = payments.reduce((sum, p) => {
    if (p.isDepositMovement && p.appointmentId && executedAppointmentIds.has(p.appointmentId)) {
      return sum;
    }
    return sum + p.finalAmountArs;
  }, 0);

  const deposits = payments.reduce((sum, p) => {
    if (p.isDepositMovement) {
      return sum + p.collectedAmountArs;
    }
    if (p.appointmentId && depositMovementAptIds.has(p.appointmentId)) {
      return sum;
    }
    return sum + (p.onlineDepositAmountArs || 0);
  }, 0);

  return {
    count: payments.length,
    collected,
    value,
    deposits,
  };
}

// Join exclusively by persisted client/appointment IDs. Never merge people by name.
export function clientHistory(
  clientId: string,
  appointments: RealAppointment[],
  payments: ServicePayment[],
) {
  const history = appointments.filter((a) => a.clientId === clientId);
  const ids = new Set(history.map((a) => a.id));
  const linked = payments.filter((p) => p.appointmentId && ids.has(p.appointmentId));
  const paidIds = new Set(linked.map((p) => p.appointmentId));
  const visits = new Set([
    ...history.filter((a) => a.statusCode === "COMPLETED").map((a) => a.id),
    ...paidIds,
  ]);
  const dates = [...new Set(history.filter((a) => visits.has(a.id)).map((a) => a.date))].sort();
  const lastVisit = dates.at(-1) ?? null;
  const frequency =
    dates.length > 1
      ? Math.round(
          (Date.parse(`${dates.at(-1)}T12:00:00Z`) - Date.parse(`${dates[0]}T12:00:00Z`)) /
            86400000 /
            (dates.length - 1),
        )
      : null;
  return {
    history,
    payments: linked,
    visits: visits.size,
    recordedSpend: paymentSummary(linked).value,
    cancellations: history.filter((a) => a.statusCode === "CANCELLED").length,
    lastVisit,
    frequency,
  };
}

export function changePercent(current: number, previous: number): number | null {
  return previous > 0 ? Math.round(((current - previous) / previous) * 100) : null;
}
