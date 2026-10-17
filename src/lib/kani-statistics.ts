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

export type TimeSlotFilter = 'ALL' | 'MORNING' | 'AFTERNOON';

export const statisticsPresetLabels: Record<StatisticsDatePreset, string> = {
  LAST_7_DAYS: 'Últimos 7 días',
  LAST_10_DAYS: 'Últimos 10 días',
  LAST_30_DAYS: 'Últimos 30 días',
  LAST_90_DAYS: 'Últimos 90 días',
  LAST_6_MONTHS: 'Últimos 6 meses',
  LAST_1_YEAR: 'Último 1 año',
  ALL: 'Todos los registros',
  SPECIFIC: 'Fecha específica',
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
      const hour = parseInt(appointment.time.slice(0, 2), 10);
      if (Number.isNaN(hour)) return false;
      if (options.timeSlotFilter === 'MORNING' && hour >= 14) return false;
      if (options.timeSlotFilter === 'AFTERNOON' && hour < 14) return false;
    }

    return true;
  });
}

export type AppointmentKpiSummary = {
  total: number;
  completed: number;
  confirmed: number;
  pending: number;
  cancelled: number;
  completionRate: number; // percentage completed over (completed + confirmed + cancelled + pending)
};

export function computeKpiSummary(appointments: RealAppointment[]): AppointmentKpiSummary {
  let completed = 0;
  let confirmed = 0;
  let pending = 0;
  let cancelled = 0;

  for (const appointment of appointments) {
    switch (appointment.statusCode) {
      case 'COMPLETED':
        completed++;
        break;
      case 'CONFIRMED':
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
  const completionRate = total > 0 ? Math.round((completed / total) * 100) : 0;

  return {
    total,
    completed,
    confirmed,
    pending,
    cancelled,
    completionRate,
  };
}

export type DailyDemandPoint = {
  date: string;
  label: string;
  count: number;
  completed: number;
  cancelled: number;
  isPeak: boolean;
};

export function computeDailyDemand(appointments: RealAppointment[]): {
  points: DailyDemandPoint[];
  peakDate: string | null;
  peakCount: number;
} {
  const countsByDate = new Map<string, { total: number; completed: number; cancelled: number }>();

  for (const appointment of appointments) {
    const current = countsByDate.get(appointment.date) ?? { total: 0, completed: 0, cancelled: 0 };
    current.total++;
    if (appointment.statusCode === 'COMPLETED') current.completed++;
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
      completed: entry.completed,
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
  peakHour: string | null;
  peakHourCount: number;
  slots: HourlyDemandPoint[];
};

export function computeHourlyDistribution(appointments: RealAppointment[]): HourlyDistributionSummary {
  const countsByHour = new Map<string, number>();
  let morningCount = 0;
  let afternoonCount = 0;

  for (const appointment of appointments) {
    const timePrefix = appointment.time.slice(0, 2);
    const hourSlot = `${timePrefix}:00`;
    countsByHour.set(hourSlot, (countsByHour.get(hourSlot) ?? 0) + 1);

    const hourNum = parseInt(timePrefix, 10);
    if (!Number.isNaN(hourNum)) {
      if (hourNum < 14) {
        morningCount++;
      } else {
        afternoonCount++;
      }
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

export type ClientDirectoryItem = {
  id: string;
  name: string;
  email: string;
  phone: string;
  totalAppointments: number;
  lastBookingDate: string;
  lastBookingTime?: string;
  lastBookingStatus?: RealAppointmentStatus;
  lastServiceName?: string;
  lastBarberName?: string;
};

export type ClientSortField = 'name' | 'email' | 'phone' | 'totalAppointments' | 'lastBookingDate';
export type SortDirection = 'asc' | 'desc';

export function aggregateClientsDirectory(appointments: RealAppointment[]): ClientDirectoryItem[] {
  const clientsMap = new Map<string, ClientDirectoryItem>();

  for (const appointment of appointments) {
    // Unique key: phone or email or name
    const key = (appointment.phone || appointment.email || appointment.name).trim().toLowerCase();
    if (!key) continue;

    const existing = clientsMap.get(key);
    if (!existing) {
      clientsMap.set(key, {
        id: appointment.id,
        name: appointment.name,
        email: appointment.email,
        phone: appointment.phone,
        totalAppointments: 1,
        lastBookingDate: appointment.date,
        lastBookingTime: appointment.time,
        lastBookingStatus: appointment.statusCode,
        lastServiceName: appointment.serviceName,
        lastBarberName: appointment.barber,
      });
    } else {
      existing.totalAppointments++;
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
    }
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
