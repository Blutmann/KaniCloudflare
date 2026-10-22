import type { RealAppointment } from "./kani-appointments";
import type { ServicePayment } from "./kani-payments";
import type { AvailabilitySlot } from "./kani-availability";
import { minutes } from "./kani-model";

export const PREVIEW_PROJECT = "iockpxtkflyjfagkvgnr";
export function isV2Preview(url: string, hostname: string) {
  try {
    return (
      new URL(url).hostname === `${PREVIEW_PROJECT}.supabase.co` &&
      ["localhost", "127.0.0.1", "kanibarberstudio-cloudflare.kanibarber.workers.dev"].includes(
        hostname,
      )
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
  return {
    count: payments.length,
    collected: payments.reduce((sum, p) => sum + p.collectedAmountArs, 0),
    value: payments.reduce((sum, p) => sum + p.finalAmountArs, 0),
    deposits: payments.reduce((sum, p) => sum + p.onlineDepositAmountArs, 0),
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
