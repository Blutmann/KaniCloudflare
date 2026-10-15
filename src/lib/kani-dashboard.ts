import { minutes, serviceFor, type Barber } from '@/lib/kani-model';
import type { RealAppointment } from '@/lib/kani-appointments';
import type { DashboardAvailabilitySlot } from '@/lib/kani-availability';

export type DashboardPeriod = 'week' | '30days' | 'month' | 'custom';

export type DashboardRange = {
  startDate: string;
  endDate: string;
  label: string;
};

export type DashboardMetrics = {
  requested: number;
  confirmed: number;
  pending: number;
  cancelled: number;
  completed: number;
  resolved: number;
  confirmationRate: number | null;
};

export type DashboardDailyDemand = {
  key: number;
  label: string;
  fullLabel: string;
  requested: number;
  confirmed: number;
};

export type OccupancyCounts = {
  confirmed: number;
  pending: number;
  available: number;
  unavailable: number;
};

export type DashboardOccupancyCell = OccupancyCounts & {
  key: string;
  dayKey: number;
  dayLabel: string;
  time: string;
  total: number;
};

export const DASHBOARD_DAYS = [
  { key: 1, label: 'Lun', fullLabel: 'Lunes' },
  { key: 2, label: 'Mar', fullLabel: 'Martes' },
  { key: 3, label: 'Mié', fullLabel: 'Miércoles' },
  { key: 4, label: 'Jue', fullLabel: 'Jueves' },
  { key: 5, label: 'Vie', fullLabel: 'Viernes' },
  { key: 6, label: 'Sáb', fullLabel: 'Sábado' },
] as const;

function parseIsoDate(value: string) {
  const [year = 1970, month = 1, day = 1] = value.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day, 12));
}

function toIsoDate(value: Date) {
  return [value.getUTCFullYear(), String(value.getUTCMonth() + 1).padStart(2, '0'), String(value.getUTCDate()).padStart(2, '0')].join('-');
}

function shiftIsoDate(value: string, days: number) {
  const date = parseIsoDate(value);
  date.setUTCDate(date.getUTCDate() + days);
  return toIsoDate(date);
}

function formatRangeLabel(startDate: string, endDate: string) {
  const format = (value: string) => parseIsoDate(value).toLocaleDateString('es-AR', { day: '2-digit', month: 'short', timeZone: 'UTC' });
  return startDate === endDate ? format(startDate) : `${format(startDate)} — ${format(endDate)}`;
}

export function getDashboardRange(period: DashboardPeriod, customStart: string, customEnd: string, today: string): DashboardRange | null {
  const todayDate = parseIsoDate(today);
  let startDate = today;
  let endDate = today;

  if (period === 'custom') {
    if (!customStart || !customEnd || customStart > customEnd) return null;
    startDate = customStart;
    endDate = customEnd;
  } else if (period === '30days') {
    startDate = shiftIsoDate(today, -29);
  } else if (period === 'month') {
    const first = new Date(Date.UTC(todayDate.getUTCFullYear(), todayDate.getUTCMonth(), 1, 12));
    const last = new Date(Date.UTC(todayDate.getUTCFullYear(), todayDate.getUTCMonth() + 1, 0, 12));
    startDate = toIsoDate(first);
    endDate = toIsoDate(last);
  } else {
    const dayOfWeek = todayDate.getUTCDay() || 7;
    startDate = shiftIsoDate(today, 1 - dayOfWeek);
    endDate = shiftIsoDate(startDate, 5);
  }

  const periodLabels: Record<DashboardPeriod, string> = {
    week: 'Esta semana',
    '30days': 'Últimos 30 días',
    month: 'Este mes',
    custom: 'Rango personalizado',
  };
  return { startDate, endDate, label: `${periodLabels[period]} · ${formatRangeLabel(startDate, endDate)}` };
}

export function getPreviousRange(range: DashboardRange): DashboardRange {
  const days = Math.round((parseIsoDate(range.endDate).getTime() - parseIsoDate(range.startDate).getTime()) / 86400000) + 1;
  const endDate = shiftIsoDate(range.startDate, -1);
  const startDate = shiftIsoDate(endDate, -(days - 1));
  return { startDate, endDate, label: formatRangeLabel(startDate, endDate) };
}

function inRange(date: string, range: DashboardRange) {
  return date >= range.startDate && date <= range.endDate;
}

export function filterAppointments(appointments: RealAppointment[], range: DashboardRange, barber?: Barber | null) {
  return appointments.filter(appointment => inRange(appointment.date, range) && (!barber || appointment.barber === barber));
}

export function summarizeAppointments(appointments: RealAppointment[]): DashboardMetrics {
  const requested = appointments.length;
  const confirmed = appointments.filter(appointment => appointment.statusCode === 'CONFIRMED').length;
  const pending = appointments.filter(appointment => appointment.statusCode === 'PENDING').length;
  const cancelled = appointments.filter(appointment => appointment.statusCode === 'CANCELLED').length;
  const completed = appointments.filter(appointment => appointment.statusCode === 'COMPLETED').length;
  const resolved = confirmed + cancelled + completed;
  return { requested, confirmed, pending, cancelled, completed, resolved, confirmationRate: resolved ? confirmed / resolved : null };
}

function weekdayKey(value: string) {
  const day = parseIsoDate(value).getUTCDay();
  return day === 0 ? 7 : day;
}

export function buildDailyDemand(appointments: RealAppointment[], range: DashboardRange): DashboardDailyDemand[] {
  return DASHBOARD_DAYS.map(day => {
    const rows = appointments.filter(appointment => inRange(appointment.date, range) && weekdayKey(appointment.date) === day.key);
    return {
      key: day.key,
      label: day.label,
      fullLabel: day.fullLabel,
      requested: rows.length,
      confirmed: rows.filter(appointment => appointment.statusCode === 'CONFIRMED').length,
    };
  });
}

function appointmentOverlapsSlot(appointment: RealAppointment, slot: DashboardAvailabilitySlot) {
  if (appointment.date !== slot.slot_date || appointment.statusCode === 'CANCELLED' || appointment.barberId !== slot.barber_id) return false;
  const appointmentStart = minutes(appointment.time);
  const appointmentEnd = appointmentStart + serviceFor(appointment.service).duration;
  const slotStart = minutes(slot.start_time.slice(0, 5));
  const slotEnd = minutes(slot.end_time.slice(0, 5));
  return appointmentStart < slotEnd && appointmentEnd > slotStart;
}

function slotCounts(slot: DashboardAvailabilitySlot, appointments: RealAppointment[]): OccupancyCounts {
  const overlapping = appointments.filter(appointment => appointmentOverlapsSlot(appointment, slot));
  if (overlapping.some(appointment => appointment.statusCode === 'CONFIRMED' || appointment.statusCode === 'COMPLETED')) {
    return { confirmed: 1, pending: 0, available: 0, unavailable: 0 };
  }
  if (overlapping.some(appointment => appointment.statusCode === 'PENDING')) {
    return { confirmed: 0, pending: 1, available: 0, unavailable: 0 };
  }
  return slot.status === 'UNAVAILABLE'
    ? { confirmed: 0, pending: 0, available: 0, unavailable: 1 }
    : { confirmed: 0, pending: 0, available: 1, unavailable: 0 };
}

export function buildOccupancyCells(slots: DashboardAvailabilitySlot[], appointments: RealAppointment[], range: DashboardRange) {
  const filteredSlots = slots.filter(slot => inRange(slot.slot_date, range));
  const timeRows = [...new Set(filteredSlots.map(slot => slot.start_time.slice(0, 5)))].sort();
  const cells: DashboardOccupancyCell[] = [];

  for (const time of timeRows) {
    for (const day of DASHBOARD_DAYS) {
      const matchingSlots = filteredSlots.filter(slot => weekdayKey(slot.slot_date) === day.key && slot.start_time.slice(0, 5) === time);
      const counts = matchingSlots.reduce<OccupancyCounts>((total, slot) => {
        const next = slotCounts(slot, appointments);
        return {
          confirmed: total.confirmed + next.confirmed,
          pending: total.pending + next.pending,
          available: total.available + next.available,
          unavailable: total.unavailable + next.unavailable,
        };
      }, { confirmed: 0, pending: 0, available: 0, unavailable: 0 });
      cells.push({ ...counts, key: `${day.key}-${time}`, dayKey: day.key, dayLabel: day.fullLabel, time, total: matchingSlots.length });
    }
  }
  return { cells, timeRows };
}

export function comparisonPercent(current: number, previous: number) {
  if (previous === 0) return null;
  return ((current - previous) / previous) * 100;
}

export function hasComparableMetrics(current: DashboardMetrics, previous: DashboardMetrics) {
  return current.resolved > 0 && previous.resolved > 0;
}

export function formatPercentage(value: number | null) {
  return value === null ? '—' : `${Math.round(value * 100)}%`;
}

export function formatDelta(value: number | null) {
  if (value === null) return null;
  const rounded = Math.round(value);
  return `${rounded > 0 ? '+' : ''}${rounded}% vs. período anterior`;
}
