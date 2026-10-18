import type { RealAppointment, RealAppointmentStatus } from './kani-appointments';

export type MobileStatusFilter = 'ALL' | RealAppointmentStatus;
export type MobileDatePreset = 'ALL' | 'TODAY' | 'TOMORROW' | 'NEXT_10_DAYS' | 'THIS_WEEK' | 'SPECIFIC';
export type MobileDateRange = { start: string; end: string } | null;

export const BUSINESS_TIME_ZONE = 'America/Argentina/Buenos_Aires';

export const mobileDatePresetLabels: Record<MobileDatePreset, string> = {
  ALL: 'Todos los días',
  TODAY: 'Hoy',
  TOMORROW: 'Mañana',
  NEXT_10_DAYS: 'Próximos 10 días',
  THIS_WEEK: 'Esta semana',
  SPECIFIC: 'Fecha específica',
};

function isoFromParts(parts: Intl.DateTimeFormatPart[]) {
  const values = Object.fromEntries(parts.filter(part => ['year', 'month', 'day'].includes(part.type)).map(part => [part.type, part.value]));
  return `${values['year']}-${values['month']}-${values['day']}`;
}

/** Fecha calendario actual en la zona horaria del negocio, no en la del servidor. */
export function businessDateToday(now = new Date()) {
  return isoFromParts(new Intl.DateTimeFormat('en-CA', {
    timeZone: BUSINESS_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now));
}

export function addCalendarDays(date: string, amount: number) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + amount);
  return value.toISOString().slice(0, 10);
}

export function startOfBusinessWeek(date: string) {
  const value = new Date(`${date}T00:00:00Z`);
  const day = value.getUTCDay();
  return addCalendarDays(date, -((day + 6) % 7));
}

export function dateRangeForMobilePreset(
  preset: MobileDatePreset,
  today: string,
  specificDate = '',
): MobileDateRange {
  if (preset === 'ALL') return null;
  if (preset === 'TODAY') return { start: today, end: today };
  if (preset === 'TOMORROW') {
    const tomorrow = addCalendarDays(today, 1);
    return { start: tomorrow, end: tomorrow };
  }
  if (preset === 'NEXT_10_DAYS') return { start: today, end: addCalendarDays(today, 9) };
  if (preset === 'THIS_WEEK') {
    const start = startOfBusinessWeek(today);
    return { start, end: addCalendarDays(start, 6) };
  }
  return specificDate ? { start: specificDate, end: specificDate } : null;
}

export type ScheduleDatePreset =
  | 'TODAY'
  | 'TOMORROW'
  | 'THIS_WEEK'
  | 'THIS_MONTH'
  | 'NEXT_7_DAYS'
  | 'NEXT_14_DAYS'
  | 'NEXT_21_DAYS'
  | 'SPECIFIC';

export const schedulePresets: ScheduleDatePreset[] = [
  'TODAY',
  'TOMORROW',
  'THIS_WEEK',
  'THIS_MONTH',
  'NEXT_7_DAYS',
  'NEXT_14_DAYS',
  'NEXT_21_DAYS',
  'SPECIFIC',
];

export const schedulePresetLabels: Record<ScheduleDatePreset, string> = {
  TODAY: 'Hoy',
  TOMORROW: 'Mañana',
  THIS_WEEK: 'Esta semana',
  THIS_MONTH: 'Este mes',
  NEXT_7_DAYS: 'Próximos 7 días',
  NEXT_14_DAYS: 'Próximos 14 días',
  NEXT_21_DAYS: 'Próximos 21 días',
  SPECIFIC: 'Fecha específica',
};

export function dateRangeForSchedulePreset(
  preset: ScheduleDatePreset,
  today: string,
  specificDate = '',
): MobileDateRange {
  if (preset === 'TODAY') {
    return { start: today, end: today };
  }
  if (preset === 'TOMORROW') {
    const tomorrow = addCalendarDays(today, 1);
    return { start: tomorrow, end: tomorrow };
  }
  if (preset === 'THIS_WEEK') {
    const start = startOfBusinessWeek(today);
    return { start, end: addCalendarDays(start, 6) };
  }
  if (preset === 'THIS_MONTH') {
    const [yearStr, monthStr] = today.split('-');
    const currentYear = parseInt(yearStr, 10);
    const currentMonth = parseInt(monthStr, 10);
    const start = `${yearStr}-${monthStr}-01`;
    const lastDayOfMonth = new Date(Date.UTC(currentYear, currentMonth, 0)).getUTCDate();
    const end = `${yearStr}-${monthStr}-${String(lastDayOfMonth).padStart(2, '0')}`;
    return { start, end };
  }
  if (preset === 'NEXT_7_DAYS') {
    return { start: today, end: addCalendarDays(today, 6) };
  }
  if (preset === 'NEXT_14_DAYS') {
    return { start: today, end: addCalendarDays(today, 13) };
  }
  if (preset === 'NEXT_21_DAYS') {
    return { start: today, end: addCalendarDays(today, 20) };
  }
  if (preset === 'SPECIFIC') {
    return specificDate ? { start: specificDate, end: specificDate } : null;
  }
  return null;
}

type MobileAppointmentFilterOptions = {
  dateRange: MobileDateRange;
  statusFilter: MobileStatusFilter;
  barberFilter: string;
  role: 'ADMIN' | 'BARBER';
  profileBarberId: string | null;
  permittedBarberIds: ReadonlySet<string>;
};

/** Aplica primero el alcance de seguridad y luego los filtros visibles del panel. */
export function filterMobileAppointments(
  appointments: RealAppointment[],
  options: MobileAppointmentFilterOptions,
) {
  return appointments
    .filter(appointment => {
      if (!options.permittedBarberIds.has(appointment.barberId)) return false;
      if (options.role === 'BARBER') return appointment.barberId === options.profileBarberId;
      return options.barberFilter === 'Todos' || appointment.barber === options.barberFilter;
    })
    .filter(appointment => !options.dateRange || (appointment.date >= options.dateRange.start && appointment.date <= options.dateRange.end))
    .filter(appointment => {
      if (options.statusFilter === 'ALL') return true;
      if (options.statusFilter === 'CONFIRMED') {
        return appointment.statusCode === 'CONFIRMED' || (appointment.statusCode as string) === 'COMPLETED';
      }
      return appointment.statusCode === options.statusFilter;
    })
    .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
}
