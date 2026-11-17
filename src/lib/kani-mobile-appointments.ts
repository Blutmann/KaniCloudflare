import type { RealAppointment, RealAppointmentStatus } from './kani-appointments';
import { serviceFor } from './kani-model';

export type MobileStatusFilter = 'ALL' | RealAppointmentStatus;
export type AppointmentsDatePreset =
  | 'TODAY'
  | 'TOMORROW'
  | 'THIS_WEEK'
  | 'THIS_MONTH'
  | 'NEXT_7_DAYS'
  | 'NEXT_14_DAYS'
  | 'NEXT_21_DAYS'
  | 'SPECIFIC';

export type MobileDatePreset = AppointmentsDatePreset;
export type MobileDateRange = {
  start: string;
  end: string;
  endExclusive?: string;
} | null;

export const BUSINESS_TIME_ZONE = 'America/Argentina/Buenos_Aires';

export const appointmentsPresets: AppointmentsDatePreset[] = [
  'TODAY',
  'TOMORROW',
  'THIS_WEEK',
  'THIS_MONTH',
  'NEXT_7_DAYS',
  'NEXT_14_DAYS',
  'NEXT_21_DAYS',
  'SPECIFIC',
];

export const appointmentsPresetLabels: Record<AppointmentsDatePreset, string> = {
  TODAY: 'Hoy',
  TOMORROW: 'Mañana',
  THIS_WEEK: 'Esta semana',
  THIS_MONTH: 'Este mes',
  NEXT_7_DAYS: 'Próximos 7 días',
  NEXT_14_DAYS: 'Próximos 14 días',
  NEXT_21_DAYS: 'Próximos 21 días',
  SPECIFIC: 'Fecha específica',
};

export const mobileDatePresets = appointmentsPresets;
export const mobileDatePresetLabels = appointmentsPresetLabels;

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

/** Determina si una fecha y horario de turno ya transcurrieron en el huso de Argentina */
export function isAppointmentPast(bookingDate?: string | null, startTime?: string | null): boolean {
  if (!bookingDate) return false;
  const today = businessDateToday();
  if (bookingDate < today) return true;
  if (bookingDate > today) return false;
  const now = new Date();
  const timeFormatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: BUSINESS_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const currentArgTime = timeFormatter.format(now);
  const apptTime = (startTime || '23:59').slice(0, 5);
  return apptTime < currentArgTime;
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

export function dateRangeForAppointmentsPreset(
  preset: AppointmentsDatePreset,
  today: string,
  specificDate = '',
): MobileDateRange {
  if (preset === 'TODAY') {
    const endExclusive = addCalendarDays(today, 1);
    return { start: today, end: today, endExclusive };
  }
  if (preset === 'TOMORROW') {
    const tomorrow = addCalendarDays(today, 1);
    const endExclusive = addCalendarDays(today, 2);
    return { start: tomorrow, end: tomorrow, endExclusive };
  }
  if (preset === 'THIS_WEEK') {
    const start = startOfBusinessWeek(today);
    const endExclusive = addCalendarDays(start, 7);
    const end = addCalendarDays(start, 6);
    return { start, end, endExclusive };
  }
  if (preset === 'THIS_MONTH') {
    const [yearStr, monthStr] = today.split('-');
    const currentYear = parseInt(yearStr, 10);
    const currentMonth = parseInt(monthStr, 10);
    const start = `${yearStr}-${monthStr}-01`;
    const nextMonthDate = new Date(Date.UTC(currentYear, currentMonth, 1));
    const endExclusive = nextMonthDate.toISOString().slice(0, 10);
    const lastDayOfMonth = new Date(Date.UTC(currentYear, currentMonth, 0)).getUTCDate();
    const end = `${yearStr}-${monthStr}-${String(lastDayOfMonth).padStart(2, '0')}`;
    return { start, end, endExclusive };
  }
  if (preset === 'NEXT_7_DAYS') {
    const endExclusive = addCalendarDays(today, 7);
    const end = addCalendarDays(today, 6);
    return { start: today, end, endExclusive };
  }
  if (preset === 'NEXT_14_DAYS') {
    const endExclusive = addCalendarDays(today, 14);
    const end = addCalendarDays(today, 13);
    return { start: today, end, endExclusive };
  }
  if (preset === 'NEXT_21_DAYS') {
    const endExclusive = addCalendarDays(today, 21);
    const end = addCalendarDays(today, 20);
    return { start: today, end, endExclusive };
  }
  if (preset === 'SPECIFIC') {
    if (!specificDate) return null;
    const endExclusive = addCalendarDays(specificDate, 1);
    return { start: specificDate, end: specificDate, endExclusive };
  }
  return null;
}

export const dateRangeForMobilePreset = dateRangeForAppointmentsPreset;

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
    .filter(appointment => {
      if (!options.dateRange) return true;
      if (options.dateRange.endExclusive) {
        return appointment.date >= options.dateRange.start && appointment.date < options.dateRange.endExclusive;
      }
      return appointment.date >= options.dateRange.start && appointment.date <= options.dateRange.end;
    })
    .filter(appointment => {
      if (options.statusFilter === 'ALL') return true;
      if (options.statusFilter === 'CONFIRMED') {
        return appointment.statusCode === 'CONFIRMED' || (appointment.statusCode as string) === 'COMPLETED';
      }
      return appointment.statusCode === options.statusFilter;
    })
    .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
}

export type V2AgendaPeriodPreset =
  | 'TODAY'
  | 'NEXT_5_DAYS'
  | 'THIS_WEEK'
  | 'NEXT_10_DAYS'
  | 'THIS_MONTH'
  | 'PREVIOUS_MONTH'
  | 'THIS_YEAR'
  | 'CUSTOM'
  | 'DATE';

export const v2AgendaPeriodOrder: V2AgendaPeriodPreset[] = [
  'TODAY',
  'NEXT_5_DAYS',
  'THIS_WEEK',
  'NEXT_10_DAYS',
  'THIS_MONTH',
  'PREVIOUS_MONTH',
  'THIS_YEAR',
  'CUSTOM',
  'DATE',
];

const MONTHS_FULL_ES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

const MONTHS_SHORT_ES = [
  'ene.', 'feb.', 'mar.', 'abr.', 'may.', 'jun.',
  'jul.', 'ago.', 'sep.', 'oct.', 'nov.', 'dic.',
];

export function businessTimeNowHHMM(now = new Date()): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: BUSINESS_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(now);
}

/**
 * Determina si un turno finalizó temporalmente en America/Argentina/Buenos_Aires
 * comparando (fecha y hora de inicio + duración real del servicio) <= hora actual.
 * No altera el estado del turno.
 */
export function isAppointmentTemporallyFinished(
  appointment: Pick<RealAppointment, 'date' | 'time' | 'startTime' | 'endTime' | 'service' | 'serviceDuration'>,
  now = new Date(),
): boolean {
  const bookingDate = appointment.date;
  if (!bookingDate) return false;

  const today = businessDateToday(now);
  const currentTime = businessTimeNowHHMM(now);

  const rawStart = (appointment.startTime || appointment.time || '').trim().slice(0, 5);
  const [startH, startM] = rawStart.split(':').map((n) => parseInt(n, 10));
  if (Number.isNaN(startH) || Number.isNaN(startM)) {
    return bookingDate < today;
  }

  const duration =
    typeof appointment.serviceDuration === 'number' && appointment.serviceDuration > 0
      ? appointment.serviceDuration
      : serviceFor(appointment.service).duration || 45;

  const totalEndMin = startH * 60 + startM + duration;
  const dayOverflow = Math.floor(totalEndMin / 1440);
  const endMinutesOfDay = totalEndMin % 1440;
  const endDate = dayOverflow > 0 ? addCalendarDays(bookingDate, dayOverflow) : bookingDate;
  const endHHMM = `${String(Math.floor(endMinutesOfDay / 60)).padStart(2, '0')}:${String(endMinutesOfDay % 60).padStart(2, '0')}`;

  if (endDate < today) return true;
  if (endDate > today) return false;
  return endHHMM <= currentTime;
}

const MONTHS_SHORT_TITLE_ES = [
  'Ene.', 'Feb.', 'Mar.', 'Abr.', 'May.', 'Jun.',
  'Jul.', 'Ago.', 'Sep.', 'Oct.', 'Nov.', 'Dic.',
];

export function formatV2AgendaPeriodLabel(
  preset: V2AgendaPeriodPreset,
  today: string,
  _compact = false,
): string {
  const [yearStr, monthStr] = today.split('-');
  const year = parseInt(yearStr, 10);
  const monthIdx = Math.max(0, Math.min(11, parseInt(monthStr, 10) - 1));

  switch (preset) {
    case 'TODAY':
      return 'Hoy';
    case 'NEXT_5_DAYS':
      return 'Próximos 5 días';
    case 'THIS_WEEK': {
      const weekStart = startOfBusinessWeek(today);
      const weekEnd = addCalendarDays(weekStart, 6);
      const [sY, sM, sD] = weekStart.split('-').map((v) => parseInt(v, 10));
      const [eY, eM, eD] = weekEnd.split('-').map((v) => parseInt(v, 10));
      if (sY !== eY) {
        return `${sD} ${MONTHS_SHORT_TITLE_ES[sM - 1]} ${sY} - ${eD} ${MONTHS_SHORT_TITLE_ES[eM - 1]} ${eY}`;
      }
      if (sM !== eM) {
        return `${sD} ${MONTHS_SHORT_TITLE_ES[sM - 1]} - ${eD} ${MONTHS_SHORT_TITLE_ES[eM - 1]}`;
      }
      return `${sD} - ${eD} ${MONTHS_SHORT_TITLE_ES[eM - 1]}`;
    }
    case 'NEXT_10_DAYS':
      return 'Próximos 10 días';
    case 'THIS_MONTH':
      return `${MONTHS_FULL_ES[monthIdx]} ${year}`;
    case 'PREVIOUS_MONTH': {
      const prevDate = new Date(Date.UTC(year, monthIdx - 1, 1));
      const prevYear = prevDate.getUTCFullYear();
      const prevMonthIdx = prevDate.getUTCMonth();
      return `${MONTHS_FULL_ES[prevMonthIdx]} ${prevYear}`;
    }
    case 'THIS_YEAR':
      return `${year}`;
    case 'CUSTOM':
      return 'Rango personalizado';
    case 'DATE':
      return 'Fecha exacta';
  }
}

export function dateRangeForV2AgendaPeriod(
  preset: V2AgendaPeriodPreset,
  today: string,
  specificDate = '',
  customStart = '',
  customEnd = '',
): { start: string; end: string } {
  const [yearStr, monthStr] = today.split('-');
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10);

  switch (preset) {
    case 'TODAY':
      return { start: today, end: today };
    case 'NEXT_5_DAYS':
      return { start: today, end: addCalendarDays(today, 4) };
    case 'THIS_WEEK': {
      const start = startOfBusinessWeek(today);
      return { start, end: addCalendarDays(start, 6) };
    }
    case 'NEXT_10_DAYS':
      return { start: today, end: addCalendarDays(today, 9) };
    case 'THIS_MONTH': {
      const start = `${yearStr}-${monthStr}-01`;
      const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
      return { start, end: `${yearStr}-${monthStr}-${String(lastDay).padStart(2, '0')}` };
    }
    case 'PREVIOUS_MONTH': {
      const prevFirst = new Date(Date.UTC(year, month - 2, 1));
      const prevLast = new Date(Date.UTC(year, month - 1, 0));
      return {
        start: prevFirst.toISOString().slice(0, 10),
        end: prevLast.toISOString().slice(0, 10),
      };
    }
    case 'THIS_YEAR':
      return { start: `${yearStr}-01-01`, end: `${yearStr}-12-31` };
    case 'CUSTOM':
      return { start: customStart || today, end: customEnd || today };
    case 'DATE':
      return { start: specificDate || today, end: specificDate || today };
  }
}

/**
 * Ordenamiento cronológico inteligente:
 * - Mantiene el agrupamiento por fecha (a.date vs b.date).
 * - Para el día actual (en períodos con vista futura como NEXT_10_DAYS o TODAY),
 *   ubica primero los turnos próximos/en curso y luego los ya finalizados hoy.
 */
export function sortV2AgendaAppointments(
  appointments: RealAppointment[],
  period: V2AgendaPeriodPreset,
  now = new Date(),
): RealAppointment[] {
  const today = businessDateToday(now);
  const prioritizeUpcomingToday =
    period === 'NEXT_10_DAYS' ||
    period === 'NEXT_5_DAYS' ||
    period === 'TODAY' ||
    period === 'THIS_WEEK';

  return [...appointments].sort((a, b) => {
    if (a.date !== b.date) {
      return a.date.localeCompare(b.date);
    }
    if (prioritizeUpcomingToday && a.date === today) {
      const aFinished = isAppointmentTemporallyFinished(a, now) ? 1 : 0;
      const bFinished = isAppointmentTemporallyFinished(b, now) ? 1 : 0;
      if (aFinished !== bFinished) {
        return aFinished - bFinished;
      }
    }
    return (a.time || '').localeCompare(b.time || '');
  });
}
