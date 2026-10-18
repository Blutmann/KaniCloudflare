import type { RealAppointment, RealAppointmentStatus } from './kani-appointments';
import { addCalendarDays, businessDateToday, BUSINESS_TIME_ZONE } from './kani-mobile-appointments';

export type StatisticsDatePreset =
  | 'LAST_7_DAYS'
  | 'LAST_10_DAYS'
  | 'LAST_30_DAYS'
  | 'LAST_90_DAYS'
  | 'LAST_6_MONTHS'
  | 'LAST_1_YEAR'
  | 'ALL'
  | 'SPECIFIC'
  | 'CUSTOM';

export type TimeSlotCategory = 'MORNING' | 'AFTERNOON' | 'NIGHT' | 'OUTSIDE';

export type TimeSlotFilter = 'ALL' | 'MORNING' | 'AFTERNOON' | 'NIGHT';

/**
 * Categoriza el horario de una reserva según las 3 franjas oficiales:
 * - Mañana: 10:00 a 12:00 (10:00 <= hora < 12:00)
 * - Tarde: 12:00 a 18:00 (12:00 <= hora < 18:00)
 * - Noche: 18:00 a 20:00 (18:00 <= hora < 20:00)
 * - Fuera de franja: turnos especiales antes de las 10:00 o a partir de las 20:00.
 */
export function classifyAppointmentTime(timeStr: string): TimeSlotCategory {
  if (!timeStr) return 'OUTSIDE';
  const parts = timeStr.trim().split(':');
  if (parts.length < 2) return 'OUTSIDE';
  const hour = parseInt(parts[0], 10);
  const minute = parseInt(parts[1], 10);
  if (Number.isNaN(hour) || Number.isNaN(minute)) return 'OUTSIDE';

  const totalMinutes = hour * 60 + minute;
  const morningStart = 10 * 60; // 10:00
  const afternoonStart = 12 * 60; // 12:00
  const nightStart = 18 * 60; // 18:00
  const nightEnd = 20 * 60; // 20:00

  if (totalMinutes >= morningStart && totalMinutes < afternoonStart) {
    return 'MORNING';
  }
  if (totalMinutes >= afternoonStart && totalMinutes < nightStart) {
    return 'AFTERNOON';
  }
  if (totalMinutes >= nightStart && totalMinutes < nightEnd) {
    return 'NIGHT';
  }
  return 'OUTSIDE';
}

export const statisticsPresetLabels: Record<StatisticsDatePreset, string> = {
  LAST_7_DAYS: 'Últimos 7 días',
  LAST_10_DAYS: 'Últimos 10 días',
  LAST_30_DAYS: 'Últimos 30 días',
  LAST_90_DAYS: 'Últimos 90 días',
  LAST_6_MONTHS: 'Últimos 6 meses',
  LAST_1_YEAR: 'Último año',
  ALL: 'Histórico completo',
  SPECIFIC: 'Día específico',
  CUSTOM: 'Rango personalizado',
};

export type DateRange = {
  start: string;
  end: string;
} | null;

export function dateRangeForStatisticsPreset(
  preset: StatisticsDatePreset,
  today: string,
  specificDate = '',
  customRange: { start: string; end: string } = { start: '', end: '' },
): DateRange {
  if (preset === 'ALL') return null;
  if (preset === 'LAST_7_DAYS') {
    return { start: addCalendarDays(today, -6), end: today };
  }
  if (preset === 'LAST_10_DAYS') {
    return { start: addCalendarDays(today, -9), end: today };
  }
  if (preset === 'LAST_30_DAYS') {
    return { start: addCalendarDays(today, -29), end: today };
  }
  if (preset === 'LAST_90_DAYS') {
    return { start: addCalendarDays(today, -89), end: today };
  }
  if (preset === 'LAST_6_MONTHS') {
    return { start: addCalendarDays(today, -180), end: today };
  }
  if (preset === 'LAST_1_YEAR') {
    return { start: addCalendarDays(today, -365), end: today };
  }
  if (preset === 'SPECIFIC') {
    const target = specificDate || today;
    return { start: target, end: target };
  }
  if (preset === 'CUSTOM') {
    if (!customRange.start && !customRange.end) return null;
    const start = customRange.start || customRange.end || today;
    const end = customRange.end || customRange.start || today;
    return start <= end ? { start, end } : { start: end, end: start };
  }
  return null;
}

export type StatisticsFilterOptions = {
  dateRange: DateRange;
  timeSlotFilter: TimeSlotFilter;
  barberFilter: string;
  role: 'ADMIN' | 'BARBER';
  profileBarberId: string | null;
  permittedBarberIds: ReadonlySet<string>;
};

export function filterStatisticsAppointments(
  appointments: RealAppointment[],
  options: StatisticsFilterOptions,
): RealAppointment[] {
  return appointments.filter((appointment) => {
    // Role & Barber Scope
    if (!options.permittedBarberIds.has(appointment.barberId)) return false;
    if (options.role === 'BARBER') {
      if (appointment.barberId !== options.profileBarberId) return false;
    } else if (options.barberFilter !== 'Todos' && appointment.barber !== options.barberFilter) {
      return false;
    }

    // Date Range
    if (options.dateRange) {
      if (appointment.date < options.dateRange.start || appointment.date > options.dateRange.end) {
        return false;
      }
    }

    // Time Slot Filter
    if (options.timeSlotFilter !== 'ALL') {
      const category = classifyAppointmentTime(appointment.time);
      if (category !== options.timeSlotFilter) return false;
    }

    return true;
  });
}

export type AppointmentKpiSummary = {
  total: number;
  confirmed: number;
  pending: number;
  cancelled: number;
  completed?: number;
  completionRate?: number;
};

export function computeKpiSummary(appointments: RealAppointment[]): AppointmentKpiSummary {
  let confirmed = 0;
  let pending = 0;
  let cancelled = 0;

  for (const appointment of appointments) {
    switch (appointment.statusCode) {
      case 'CONFIRMED':
      case 'COMPLETED' as any:
        confirmed++;
        break;
      case 'PENDING':
        pending++;
        break;
      case 'CANCELLED':
        cancelled++;
        break;
    }
  }

  const total = appointments.length;

  return {
    total,
    confirmed,
    pending,
    cancelled,
    completed: 0,
    completionRate: 0,
  };
}

export type DailyDemandPoint = {
  date: string;
  label: string;
  count: number;
  confirmed: number;
  completed?: number;
  cancelled: number;
  isPeak: boolean;
};

export function computeDailyDemand(appointments: RealAppointment[]): {
  points: DailyDemandPoint[];
  peakDate: string | null;
  peakCount: number;
} {
  const countsByDate = new Map<string, { total: number; confirmed: number; cancelled: number }>();

  for (const appointment of appointments) {
    const current = countsByDate.get(appointment.date) ?? { total: 0, confirmed: 0, cancelled: 0 };
    current.total++;
    if (appointment.statusCode === 'CONFIRMED' || (appointment.statusCode as string) === 'COMPLETED') {
      current.confirmed++;
    }
    if (appointment.statusCode === 'CANCELLED') current.cancelled++;
    countsByDate.set(appointment.date, current);
  }

  const sortedDates = [...countsByDate.keys()].sort();
  let peakDate: string | null = null;
  let peakCount = 0;

  for (const date of sortedDates) {
    const entry = countsByDate.get(date)!;
    if (entry.total > peakCount) {
      peakCount = entry.total;
      peakDate = date;
    }
  }

  const points: DailyDemandPoint[] = sortedDates.map((date) => {
    const entry = countsByDate.get(date)!;
    // Format label: e.g. "17/10"
    const parts = date.split('-');
    const label = parts.length === 3 ? `${parts[2]}/${parts[1]}` : date;
    return {
      date,
      label,
      count: entry.total,
      confirmed: entry.confirmed,
      completed: entry.confirmed,
      cancelled: entry.cancelled,
      isPeak: entry.total === peakCount && peakCount > 0,
    };
  });

  return { points, peakDate, peakCount };
}

export type HourlyDemandPoint = {
  hourSlot: string; // e.g. "10:00"
  count: number;
  percentage: number;
  isPeak: boolean;
};

export type HourlyDistributionSummary = {
  morningCount: number;
  morningPercentage: number;
  afternoonCount: number;
  afternoonPercentage: number;
  nightCount: number;
  nightPercentage: number;
  outsideCount: number;
  peakHour: string | null;
  peakHourCount: number;
  slots: HourlyDemandPoint[];
};

export function computeHourlyDistribution(appointments: RealAppointment[]): HourlyDistributionSummary {
  const countsByHour = new Map<string, number>();
  let morningCount = 0;
  let afternoonCount = 0;
  let nightCount = 0;
  let outsideCount = 0;

  for (const appointment of appointments) {
    const timePrefix = appointment.time.slice(0, 2);
    const hourSlot = `${timePrefix}:00`;
    countsByHour.set(hourSlot, (countsByHour.get(hourSlot) ?? 0) + 1);

    const category = classifyAppointmentTime(appointment.time);
    if (category === 'MORNING') {
      morningCount++;
    } else if (category === 'AFTERNOON') {
      afternoonCount++;
    } else if (category === 'NIGHT') {
      nightCount++;
    } else {
      outsideCount++;
    }
  }

  const total = appointments.length;
  let peakHour: string | null = null;
  let peakHourCount = 0;

  const sortedSlots = [...countsByHour.keys()].sort();
  for (const slot of sortedSlots) {
    const count = countsByHour.get(slot)!;
    if (count > peakHourCount) {
      peakHourCount = count;
      peakHour = slot;
    }
  }

  const slots: HourlyDemandPoint[] = sortedSlots.map((hourSlot) => {
    const count = countsByHour.get(hourSlot)!;
    return {
      hourSlot,
      count,
      percentage: total > 0 ? Math.round((count / total) * 100) : 0,
      isPeak: count === peakHourCount && peakHourCount > 0,
    };
  });

  return {
    morningCount,
    morningPercentage: total > 0 ? Math.round((morningCount / total) * 100) : 0,
    afternoonCount,
    afternoonPercentage: total > 0 ? Math.round((afternoonCount / total) * 100) : 0,
    nightCount,
    nightPercentage: total > 0 ? Math.round((nightCount / total) * 100) : 0,
    outsideCount,
    peakHour,
    peakHourCount,
    slots,
  };
}

export type ServiceDemandPoint = {
  serviceName: string;
  count: number;
  percentage: number;
  totalRevenue: number;
};

export function computeServiceDemand(appointments: RealAppointment[]): ServiceDemandPoint[] {
  const countsByService = new Map<string, { count: number; revenue: number }>();

  for (const appointment of appointments) {
    const serviceName = appointment.serviceName || appointment.service || 'Otro';
    const price = appointment.servicePrice || 0;
    const current = countsByService.get(serviceName) ?? { count: 0, revenue: 0 };
    current.count++;
    current.revenue += price;
    countsByService.set(serviceName, current);
  }

  const total = appointments.length;
  return [...countsByService.entries()]
    .map(([serviceName, { count, revenue }]) => ({
      serviceName,
      count,
      percentage: total > 0 ? Math.round((count / total) * 100) : 0,
      totalRevenue: revenue,
    }))
    .sort((a, b) => b.count - a.count);
}

export type ClientAppointmentHistoryItem = {
  id: string;
  requestNumber: number;
  bookingDate: string;
  startTime: string;
  endTime?: string;
  serviceName: string;
  barberName: string;
  status: string;
  statusCode: RealAppointmentStatus;
  notes: string;
  createdAt?: string;
};

export type ClientDirectoryItem = {
  id: string;
  name: string;
  email: string;
  phone: string;
  totalAppointments: number;
  totalCancelled: number;
  totalConfirmed: number;
  totalCompleted: number;
  totalActive: number;
  lastBookingDate: string;
  lastBookingTime?: string;
  lastBookingStatus?: RealAppointmentStatus;
  lastServiceName?: string;
  lastBarberName?: string;
  appointments: ClientAppointmentHistoryItem[];
};

export type ClientSortField = 'name' | 'email' | 'phone' | 'totalAppointments' | 'lastBookingDate';
export type SortDirection = 'asc' | 'desc';

export function aggregateClientsDirectory(appointments: RealAppointment[]): ClientDirectoryItem[] {
  const clientsMap = new Map<string, ClientDirectoryItem>();

  for (const appointment of appointments) {
    const historyItem: ClientAppointmentHistoryItem = {
      id: appointment.id,
      requestNumber: appointment.requestNumber,
      bookingDate: appointment.date,
      startTime: appointment.time,
      endTime: appointment.endTime,
      serviceName: appointment.serviceName || appointment.service || 'Servicio',
      barberName: appointment.barber,
      status: appointment.status,
      statusCode: appointment.statusCode,
      notes: appointment.notes,
      createdAt: appointment.createdAt,
    };

    // Unique key: client_id if present, otherwise phone or email or name
    const key = (appointment.clientId || appointment.phone || appointment.email || appointment.name).trim().toLowerCase();
    if (!key) continue;

    const isCompleted = (appointment.statusCode as string) === 'COMPLETED';
    const isConfirmedOrCompleted = appointment.statusCode === 'CONFIRMED' || isCompleted;

    const existing = clientsMap.get(key);
    if (!existing) {
      clientsMap.set(key, {
        id: appointment.clientId || appointment.id,
        name: appointment.name,
        email: appointment.email,
        phone: appointment.phone,
        totalAppointments: 1,
        totalCancelled: appointment.statusCode === 'CANCELLED' ? 1 : 0,
        totalConfirmed: isConfirmedOrCompleted ? 1 : 0,
        totalCompleted: isCompleted ? 1 : 0,
        totalActive: appointment.statusCode === 'CONFIRMED' || appointment.statusCode === 'REQUESTED' ? 1 : 0,
        lastBookingDate: appointment.date,
        lastBookingTime: appointment.time,
        lastBookingStatus: appointment.statusCode,
        lastServiceName: appointment.serviceName,
        lastBarberName: appointment.barber,
        appointments: [historyItem],
      });
    } else {
      existing.totalAppointments++;
      if (appointment.statusCode === 'CANCELLED') existing.totalCancelled++;
      if (isConfirmedOrCompleted) {
        existing.totalConfirmed = (existing.totalConfirmed || 0) + 1;
      }
      if (isCompleted) {
        existing.totalCompleted++;
      }
      if (appointment.statusCode === 'CONFIRMED' || appointment.statusCode === 'REQUESTED') {
        existing.totalActive++;
      }

      // Compare if this appointment is more recent
      if (
        appointment.date > existing.lastBookingDate ||
        (appointment.date === existing.lastBookingDate && (appointment.time || '') > (existing.lastBookingTime || ''))
      ) {
        existing.lastBookingDate = appointment.date;
        existing.lastBookingTime = appointment.time;
        existing.lastBookingStatus = appointment.statusCode;
        existing.lastServiceName = appointment.serviceName;
        existing.lastBarberName = appointment.barber;
      }
      // Preserve cleanest formatted name/phone/email if available
      if (appointment.name && (!existing.name || existing.name.length < appointment.name.length)) {
        existing.name = appointment.name;
      }
      if (appointment.email && !existing.email) existing.email = appointment.email;
      if (appointment.phone && !existing.phone) existing.phone = appointment.phone;

      existing.appointments.push(historyItem);
    }
  }

  // Sort appointments in each client newest first
  for (const client of clientsMap.values()) {
    client.appointments.sort((a, b) =>
      (b.bookingDate + (b.startTime || '')).localeCompare(a.bookingDate + (a.startTime || ''))
    );
  }

  return [...clientsMap.values()];
}

export function filterAndSortClients(
  clients: ClientDirectoryItem[],
  query: string,
  sortField: ClientSortField,
  sortDirection: SortDirection,
): ClientDirectoryItem[] {
  const q = query.trim().toLowerCase();

  let filtered = clients;
  if (q) {
    filtered = clients.filter((client) => {
      const matchName = client.name.toLowerCase().includes(q);
      const matchEmail = client.email.toLowerCase().includes(q);
      const matchPhone = client.phone.toLowerCase().includes(q);
      return matchName || matchEmail || matchPhone;
    });
  }

  return [...filtered].sort((a, b) => {
    let cmp = 0;
    if (sortField === 'name') {
      cmp = a.name.localeCompare(b.name, 'es', { sensitivity: 'base' });
    } else if (sortField === 'email') {
      cmp = a.email.localeCompare(b.email, 'es', { sensitivity: 'base' });
    } else if (sortField === 'phone') {
      cmp = a.phone.localeCompare(b.phone);
    } else if (sortField === 'totalAppointments') {
      cmp = a.totalAppointments - b.totalAppointments;
    } else if (sortField === 'lastBookingDate') {
      cmp = `${a.lastBookingDate}${a.lastBookingTime || ''}`.localeCompare(
        `${b.lastBookingDate}${b.lastBookingTime || ''}`,
      );
    }

    return sortDirection === 'asc' ? cmp : -cmp;
  });
}
