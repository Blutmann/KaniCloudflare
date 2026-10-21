import { KANI_DEPOSIT_ARS, KANI_MANUAL_DEPOSIT_ARS, type RealAppointment, type RealAppointmentStatus } from './kani-appointments';
import { addCalendarDays, businessDateToday, startOfBusinessWeek, BUSINESS_TIME_ZONE } from './kani-mobile-appointments';
import { normalizeEmailForComparison, normalizePhoneForComparison } from './kani-phone';

export type StatisticsDatePreset =
  | 'TODAY'
  | 'YESTERDAY'
  | 'THIS_WEEK'
  | 'THIS_MONTH'
  | 'THIS_YEAR'
  | 'PREVIOUS_MONTH'
  | 'PREVIOUS_YEAR'
  | 'LAST_7_DAYS'
  | 'LAST_14_DAYS'
  | 'LAST_30_DAYS'
  | 'LAST_60_DAYS'
  | 'LAST_90_DAYS'
  | 'LAST_180_DAYS'
  | 'LAST_365_DAYS'
  | 'SPECIFIC';

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

export const SPANISH_MONTH_NAMES = [
  '',
  'Enero',
  'Febrero',
  'Marzo',
  'Abril',
  'Mayo',
  'Junio',
  'Julio',
  'Agosto',
  'Septiembre',
  'Octubre',
  'Noviembre',
  'Diciembre',
];

export const SPANISH_MONTH_ABBR = [
  '',
  'Ene',
  'Feb',
  'Mar',
  'Abr',
  'May',
  'Jun',
  'Jul',
  'Ago',
  'Sep',
  'Oct',
  'Nov',
  'Dic',
];

export function computePeriodStartMonth(
  currentYear: number,
  currentMonth: number,
  monthsCount: number,
): { year: number; month: number } {
  let startM = currentMonth - (monthsCount - 1);
  let startY = currentYear;
  while (startM < 1) {
    startM += 12;
    startY -= 1;
  }
  return { year: startY, month: startM };
}

export function computePeriodMonthRangeLabel(
  currentYear: number,
  currentMonth: number,
  monthsCount: number,
): string {
  const { year: startY, month: startM } = computePeriodStartMonth(
    currentYear,
    currentMonth,
    monthsCount,
  );
  const startAbbr = SPANISH_MONTH_ABBR[startM];
  const endAbbr = SPANISH_MONTH_ABBR[currentMonth];

  if (startY === currentYear) {
    return `${startAbbr} - ${endAbbr} ${currentYear}`;
  }
  return `${startAbbr} ${startY} - ${endAbbr} ${currentYear}`;
}

export function getStatisticsPresetLabels(
  todayStr: string = businessDateToday(),
): Record<StatisticsDatePreset, string> {
  const parts = todayStr.split('-');
  const currentYear = parseInt(parts[0], 10) || new Date().getFullYear();
  const currentMonth = parseInt(parts[1], 10) || new Date().getMonth() + 1; // 1-12

  // 1. Mes actual: Nombre completo del mes + año
  const thisMonthLabel = `${SPANISH_MONTH_NAMES[currentMonth]} ${currentYear}`;

  // 2. Año actual: año
  const thisYearLabel = `${currentYear}`;

  // 3. Mes anterior: Nombre completo del mes anterior + año (con ajuste de año si cambia)
  let prevMonth = currentMonth - 1;
  let prevMonthYear = currentYear;
  if (prevMonth < 1) {
    prevMonth = 12;
    prevMonthYear -= 1;
  }
  const prevMonthLabel = `${SPANISH_MONTH_NAMES[prevMonth]} ${prevMonthYear}`;

  // 4. Año anterior: año anterior
  const prevYearLabel = `${currentYear - 1}`;

  // 5. Último trimestre (3 meses) y Último semestre (6 meses) con soporte multi-año
  const quarterLabel = computePeriodMonthRangeLabel(currentYear, currentMonth, 3);
  const semesterLabel = computePeriodMonthRangeLabel(currentYear, currentMonth, 6);

  return {
    TODAY: 'Hoy',
    YESTERDAY: 'Ayer',
    THIS_WEEK: 'Esta semana',
    THIS_MONTH: thisMonthLabel,
    THIS_YEAR: thisYearLabel,
    PREVIOUS_MONTH: prevMonthLabel,
    PREVIOUS_YEAR: prevYearLabel,
    LAST_7_DAYS: 'Últimos 7 días',
    LAST_14_DAYS: 'Últimos 14 días',
    LAST_30_DAYS: 'Últimos 30 días',
    LAST_60_DAYS: 'Últimos 60 días',
    LAST_90_DAYS: quarterLabel,
    LAST_180_DAYS: semesterLabel,
    LAST_365_DAYS: 'Últimos 365 días',
    SPECIFIC: 'Fecha específica',
  };
}

export const statisticsPresets: StatisticsDatePreset[] = [
  'TODAY',
  'YESTERDAY',
  'THIS_WEEK',
  'THIS_MONTH',
  'THIS_YEAR',
  'PREVIOUS_MONTH',
  'PREVIOUS_YEAR',
  'LAST_7_DAYS',
  'LAST_14_DAYS',
  'LAST_90_DAYS',
  'LAST_180_DAYS',
  'SPECIFIC',
];

export const statisticsPresetLabels: Record<StatisticsDatePreset, string> = getStatisticsPresetLabels();

export type DateRange = {
  start: string;
  end: string;
} | null;

export function dateRangeForStatisticsPreset(
  preset: StatisticsDatePreset,
  today: string,
  specificDate = '',
): DateRange {
  const [yearStr, monthStr] = today.split('-');
  const currentYear = parseInt(yearStr, 10);
  const currentMonth = parseInt(monthStr, 10); // 1-12

  if (preset === 'TODAY') {
    return { start: today, end: today };
  }
  if (preset === 'YESTERDAY') {
    const yesterday = addCalendarDays(today, -1);
    return { start: yesterday, end: yesterday };
  }
  if (preset === 'THIS_WEEK') {
    // Desde el lunes de la semana actual hasta el momento/día actual. No incluir días futuros.
    const start = startOfBusinessWeek(today);
    return { start, end: today };
  }
  if (preset === 'THIS_MONTH') {
    // Desde el día 1 del mes actual hasta el momento/día actual. No incluir días futuros del mismo mes.
    const start = `${yearStr}-${monthStr}-01`;
    return { start, end: today };
  }
  if (preset === 'THIS_YEAR') {
    // Desde el 1 de enero del año actual hasta el momento/día actual.
    return { start: `${yearStr}-01-01`, end: today };
  }
  if (preset === 'PREVIOUS_MONTH') {
    // Mes calendario anterior completo, desde su primer hasta su último día.
    let prevYear = currentYear;
    let prevMonth = currentMonth - 1;
    if (prevMonth < 1) {
      prevMonth = 12;
      prevYear -= 1;
    }
    const prevMonthStr = String(prevMonth).padStart(2, '0');
    const start = `${prevYear}-${prevMonthStr}-01`;
    const lastDay = new Date(Date.UTC(prevYear, prevMonth, 0)).getUTCDate();
    const end = `${prevYear}-${prevMonthStr}-${String(lastDay).padStart(2, '0')}`;
    return { start, end };
  }
  if (preset === 'PREVIOUS_YEAR') {
    // Año calendario anterior completo, del 1 de enero al 31 de diciembre.
    const prevYear = currentYear - 1;
    return { start: `${prevYear}-01-01`, end: `${prevYear}-12-31` };
  }
  if (preset === 'LAST_7_DAYS') {
    // Hoy + los 6 días calendario anteriores.
    return { start: addCalendarDays(today, -6), end: today };
  }
  if (preset === 'LAST_14_DAYS') {
    // Hoy + los 13 días calendario anteriores.
    return { start: addCalendarDays(today, -13), end: today };
  }
  if (preset === 'LAST_30_DAYS') {
    return { start: addCalendarDays(today, -29), end: today };
  }
  if (preset === 'LAST_60_DAYS') {
    return { start: addCalendarDays(today, -59), end: today };
  }
  if (preset === 'LAST_90_DAYS') {
    // Mes actual + los 2 meses calendario anteriores, desde el día 1 del primer mes hasta el momento/día actual.
    const { year: startY, month: startM } = computePeriodStartMonth(currentYear, currentMonth, 3);
    const start = `${startY}-${String(startM).padStart(2, '0')}-01`;
    return { start, end: today };
  }
  if (preset === 'LAST_180_DAYS') {
    // Mes actual + los 5 meses calendario anteriores, desde el día 1 del primer mes hasta el momento/día actual.
    const { year: startY, month: startM } = computePeriodStartMonth(currentYear, currentMonth, 6);
    const start = `${startY}-${String(startM).padStart(2, '0')}-01`;
    return { start, end: today };
  }
  if (preset === 'LAST_365_DAYS') {
    return { start: addCalendarDays(today, -364), end: today };
  }
  if (preset === 'SPECIFIC') {
    return specificDate ? { start: specificDate, end: specificDate } : null;
  }
  return null;
}

export type StatisticsFilterOptions = {
  dateRange: DateRange;
  timeSlotFilter: TimeSlotFilter;
  barberFilter: string;
  serviceFilter?: string;
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

    // Service Filter
    if (options.serviceFilter && options.serviceFilter !== 'Todos') {
      const srvName = (appointment.serviceName || appointment.service || '').toLowerCase();
      if (options.serviceFilter === 'Corte y barba') {
        if (!srvName.includes('barba') || !srvName.includes('corte')) return false;
      } else if (options.serviceFilter === 'Corte') {
        if (srvName.includes('barba') || !srvName.includes('corte')) return false;
      } else if (options.serviceFilter === 'Barba') {
        if (srvName.includes('corte') || !srvName.includes('barba')) return false;
      } else if (options.serviceFilter === 'Otros') {
        if (srvName.includes('corte') || srvName.includes('barba')) return false;
      }
    }

    return true;
  });
}

export type AppointmentKpiSummary = {
  total: number;
  confirmed: number;
  pending: number;
  cancelled: number;
  noShow: number;
  completed?: number;
  completionRate?: number;
};

export function computeKpiSummary(appointments: RealAppointment[]): AppointmentKpiSummary {
  let confirmed = 0;
  let pending = 0;
  let cancelled = 0;
  let noShow = 0;

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
      case 'NO_SHOW':
        noShow++;
        break;
    }
  }

  const total = appointments.length;

  return {
    total,
    confirmed,
    pending,
    cancelled,
    noShow,
    completed: 0,
    completionRate: 0,
  };
}

export type FinancialControlSummary = {
  // A. Señas cobradas
  depositsCollected: {
    totalArs: number;
    count: number;
  };
  // B. Cobros pendientes (de turnos vigentes con seña abonada que todavía no se ejecutaron)
  pendingBalances: {
    totalArs: number;
    count: number;
  };
  // C. Total cobrado por servicios ejecutados
  completedServices: {
    totalCollectedArs: number; // Efectivamente recibido
    totalServiceValueArs: number; // Valor nominal de los servicios
    unpaidBalanceArs: number; // Saldo impago diferenciado de servicios ejecutados
    count: number;
  };
  // D. Señas retenidas por inasistencias
  retainedNoShowDeposits: {
    totalArs: number;
    count: number;
    items: Array<{
      appointmentId: string;
      requestNumber?: number;
      clientName: string;
      serviceName: string;
      barberName: string;
      date: string;
      time: string;
      depositAmountArs: number;
      reason?: string | null;
    }>;
  };
  // E. Devoluciones y condonaciones
  refundsAndWaives: {
    refundsTotalArs: number;
    refundsCount: number;
    waivesCount: number;
    waivesTotalArs: number;
    totalImpactArs: number;
    items: Array<{
      appointmentId: string;
      requestNumber?: number;
      clientName: string;
      decision: 'REFUND' | 'WAIVE';
      amountArs: number;
      reason: string;
      date: string;
      actor?: string;
    }>;
  };
};

export function getAppointmentDepositAmount(appointment: RealAppointment): number {
  if (appointment.depositAmountArs !== undefined && appointment.depositAmountArs !== null) {
    return appointment.depositAmountArs;
  }
  const servicePrice = appointment.servicePrice || 0;
  const standardDeposit = KANI_DEPOSIT_ARS;
  return servicePrice > 0 ? Math.min(servicePrice, standardDeposit) : standardDeposit;
}

export function computeFinancialControl(appointments: RealAppointment[]): FinancialControlSummary {
  const summary: FinancialControlSummary = {
    depositsCollected: { totalArs: 0, count: 0 },
    pendingBalances: { totalArs: 0, count: 0 },
    completedServices: { totalCollectedArs: 0, totalServiceValueArs: 0, unpaidBalanceArs: 0, count: 0 },
    retainedNoShowDeposits: { totalArs: 0, count: 0, items: [] },
    refundsAndWaives: { refundsTotalArs: 0, refundsCount: 0, waivesCount: 0, waivesTotalArs: 0, totalImpactArs: 0, items: [] },
  };

  for (const apt of appointments) {
    const servicePrice = apt.servicePrice || 0;
    const depositAmount = getAppointmentDepositAmount(apt);
    const hasDepositPaid = Boolean(apt.depositPaid);
    const effectiveDeposit = hasDepositPaid ? depositAmount : 0;

    // A. Señas cobradas: dinero efectivamente recibido por señas de turnos
    if (hasDepositPaid && effectiveDeposit > 0) {
      summary.depositsCollected.totalArs += effectiveDeposit;
      summary.depositsCollected.count += 1;
    }

    // B. Cobros pendientes: saldo pendiente de los turnos vigentes que todavía no se ejecutaron y que ya tienen una seña abonada.
    // Saldo pendiente = importe total del servicio − seña efectivamente recibida.
    // Excluye cancelaciones (CANCELLED), inasistencias (NO_SHOW), ejecutados (COMPLETED) y turnos sin seña recibida.
    if (apt.statusCode === 'CONFIRMED' && hasDepositPaid) {
      const remainingBalance = Math.max(0, servicePrice - effectiveDeposit);
      summary.pendingBalances.totalArs += remainingBalance;
      summary.pendingBalances.count += 1;
    }

    // C. Total cobrado por servicios ejecutados: importe total de servicios efectivamente realizados y cobrados
    if (apt.statusCode === 'COMPLETED') {
      summary.completedServices.count += 1;
      summary.completedServices.totalServiceValueArs += servicePrice;

      // Si balancePaid no es false, el servicio está totalmente cobrado (saldo + seña = total servicio)
      const isBalancePaid = apt.balancePaid !== false;
      if (isBalancePaid) {
        summary.completedServices.totalCollectedArs += servicePrice;
      } else {
        // Servicio ejecutado con saldo impago: solo se contabiliza lo efectivamente recibido (la seña) y se diferencia el saldo impago
        summary.completedServices.totalCollectedArs += effectiveDeposit;
        summary.completedServices.unpaidBalanceArs += Math.max(0, servicePrice - effectiveDeposit);
      }
    }

    // D. Señas retenidas por inasistencias: dinero correspondiente a señas de clientes que no asistieron
    // Solo turnos explícitamente marcados como inasistencia (NO_SHOW), con seña efectivamente abonada, no devuelta ni condonada
    if (apt.statusCode === 'NO_SHOW' && hasDepositPaid && apt.noShowDecision !== 'WAIVE' && apt.noShowDecision !== 'REFUND') {
      summary.retainedNoShowDeposits.totalArs += effectiveDeposit;
      summary.retainedNoShowDeposits.count += 1;
      summary.retainedNoShowDeposits.items.push({
        appointmentId: apt.id,
        requestNumber: apt.requestNumber,
        clientName: apt.name,
        serviceName: apt.serviceName || apt.service || 'Servicio',
        barberName: apt.barber,
        date: apt.date,
        time: apt.time,
        depositAmountArs: effectiveDeposit,
        reason: apt.noShowReason,
      });
    }

    // E. Devoluciones y condonaciones
    if (apt.noShowDecision === 'REFUND') {
      const refundAmount = apt.noShowRefundAmountArs && apt.noShowRefundAmountArs > 0 ? apt.noShowRefundAmountArs : effectiveDeposit;
      summary.refundsAndWaives.refundsTotalArs += refundAmount;
      summary.refundsAndWaives.refundsCount += 1;
      summary.refundsAndWaives.totalImpactArs += refundAmount;
      summary.refundsAndWaives.items.push({
        appointmentId: apt.id,
        requestNumber: apt.requestNumber,
        clientName: apt.name,
        decision: 'REFUND',
        amountArs: refundAmount,
        reason: apt.noShowReason || 'Devolución de seña acordada',
        date: apt.date,
        actor: apt.createdByDisplayName || undefined,
      });
    } else if (apt.noShowDecision === 'WAIVE') {
      const waivedAmount = depositAmount;
      summary.refundsAndWaives.waivesCount += 1;
      summary.refundsAndWaives.waivesTotalArs += waivedAmount;
      summary.refundsAndWaives.totalImpactArs += waivedAmount;
      summary.refundsAndWaives.items.push({
        appointmentId: apt.id,
        requestNumber: apt.requestNumber,
        clientName: apt.name,
        decision: 'WAIVE',
        amountArs: waivedAmount,
        reason: apt.noShowReason || 'Condonación de penalización autorizada',
        date: apt.date,
        actor: apt.createdByDisplayName || undefined,
      });
    }
  }

  return summary;
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
  origin?: 'PUBLIC_WEB' | 'MANUAL';
  isManual?: boolean;
  createdByDisplayName?: string | null;
  depositRequired?: boolean;
  depositPaid?: boolean;
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
  const clientsList: ClientDirectoryItem[] = [];
  const phoneMap = new Map<string, ClientDirectoryItem>();
  const emailMap = new Map<string, ClientDirectoryItem>();
  const idMap = new Map<string, ClientDirectoryItem>();

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
      origin: appointment.origin,
      isManual: appointment.isManual,
      createdByDisplayName: appointment.createdByDisplayName,
      depositRequired: appointment.depositRequired,
      depositPaid: appointment.depositPaid,
    };

    const normPhone = normalizePhoneForComparison(appointment.phone);
    const normEmail = normalizeEmailForComparison(appointment.email);
    const clientId = appointment.clientId?.trim();

    let targetClient: ClientDirectoryItem | null = null;
    const clientByPhone = normPhone ? phoneMap.get(normPhone) : null;
    const clientByEmail = normEmail ? emailMap.get(normEmail) : null;

    // Detectar y resolver posibles conflictos entre teléfono y correo
    if (clientByPhone && clientByEmail && clientByPhone !== clientByEmail) {
      // Conflicto: el teléfono coincide con el cliente A y el email con el cliente B.
      // Desambiguar por nombre si coincide exactamente con uno y no con el otro.
      const aptName = (appointment.name || '').trim().toLowerCase();
      const namePhone = clientByPhone.name.trim().toLowerCase();
      const nameEmail = clientByEmail.name.trim().toLowerCase();

      if (aptName && aptName === namePhone && aptName !== nameEmail) {
        targetClient = clientByPhone;
      } else if (aptName && aptName === nameEmail && aptName !== namePhone) {
        targetClient = clientByEmail;
      } else {
        // Si no se puede desambiguar con certeza, no fusionar arbitrariamente: mantener separado
        targetClient = null;
      }
    } else if (clientByPhone && clientByEmail && clientByPhone === clientByEmail) {
      targetClient = clientByPhone;
    } else if (clientByPhone) {
      targetClient = clientByPhone;
      if (normEmail && !emailMap.has(normEmail)) {
        emailMap.set(normEmail, targetClient);
        if (!targetClient.email) targetClient.email = appointment.email?.trim() || '';
      }
    } else if (clientByEmail) {
      targetClient = clientByEmail;
      if (normPhone && !phoneMap.has(normPhone)) {
        phoneMap.set(normPhone, targetClient);
        if (!targetClient.phone) targetClient.phone = appointment.phone?.trim() || '';
      }
    } else if (clientId && idMap.has(clientId)) {
      targetClient = idMap.get(clientId)!;
      if (normPhone && !phoneMap.has(normPhone)) phoneMap.set(normPhone, targetClient);
      if (normEmail && !emailMap.has(normEmail)) emailMap.set(normEmail, targetClient);
    }

    const isCompleted = (appointment.statusCode as string) === 'COMPLETED';
    const isConfirmedOrCompleted = appointment.statusCode === 'CONFIRMED' || isCompleted;

    if (!targetClient) {
      targetClient = {
        id: clientId || appointment.id,
        name: (appointment.name || '').trim() || 'Cliente',
        email: appointment.email?.trim() || '',
        phone: appointment.phone?.trim() || '',
        totalAppointments: 1,
        totalCancelled: appointment.statusCode === 'CANCELLED' ? 1 : 0,
        totalConfirmed: isConfirmedOrCompleted ? 1 : 0,
        totalCompleted: isCompleted ? 1 : 0,
        totalActive: appointment.statusCode === 'CONFIRMED' || appointment.statusCode === 'REQUESTED' || appointment.statusCode === 'PENDING' ? 1 : 0,
        lastBookingDate: appointment.date,
        lastBookingTime: appointment.time,
        lastBookingStatus: appointment.statusCode,
        lastServiceName: appointment.serviceName,
        lastBarberName: appointment.barber,
        appointments: [historyItem],
      };
      clientsList.push(targetClient);
      if (normPhone && !phoneMap.has(normPhone)) phoneMap.set(normPhone, targetClient);
      if (normEmail && !emailMap.has(normEmail)) emailMap.set(normEmail, targetClient);
      if (clientId && !idMap.has(clientId)) idMap.set(clientId, targetClient);
    } else {
      targetClient.totalAppointments++;
      if (appointment.statusCode === 'CANCELLED') targetClient.totalCancelled++;
      if (isConfirmedOrCompleted) {
        targetClient.totalConfirmed = (targetClient.totalConfirmed || 0) + 1;
      }
      if (isCompleted) {
        targetClient.totalCompleted++;
      }
      if (appointment.statusCode === 'CONFIRMED' || appointment.statusCode === 'REQUESTED' || appointment.statusCode === 'PENDING') {
        targetClient.totalActive++;
      }

      // Actualizar a la reserva más reciente
      if (
        appointment.date > targetClient.lastBookingDate ||
        (appointment.date === targetClient.lastBookingDate && (appointment.time || '') > (targetClient.lastBookingTime || ''))
      ) {
        targetClient.lastBookingDate = appointment.date;
        targetClient.lastBookingTime = appointment.time;
        targetClient.lastBookingStatus = appointment.statusCode;
        targetClient.lastServiceName = appointment.serviceName;
        targetClient.lastBarberName = appointment.barber;
      }

      // Preservar el nombre más completo
      if (appointment.name && (!targetClient.name || targetClient.name.length < appointment.name.length)) {
        targetClient.name = appointment.name.trim();
      }
      if (appointment.email && !targetClient.email) targetClient.email = appointment.email.trim();
      if (appointment.phone && !targetClient.phone) targetClient.phone = appointment.phone.trim();

      targetClient.appointments.push(historyItem);
    }
  }

  // Ordenar turnos de cada cliente del más reciente al más antiguo
  for (const client of clientsList) {
    client.appointments.sort((a, b) =>
      (b.bookingDate + (b.startTime || '')).localeCompare(a.bookingDate + (a.startTime || ''))
    );
  }

  return clientsList;
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
