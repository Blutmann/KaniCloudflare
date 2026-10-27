export type TimeCapsule = {
  time: string; // "09:30"
  endTime: string; // "10:15"
  minutes: number; // 570
  available: boolean;
  conflictReason?: string;
};

export type PeriodFilter = 'COMERCIAL' | 'ANTES' | 'DESPUES' | 'TODOS';

export const PERIOD_LABELS: Record<PeriodFilter, string> = {
  COMERCIAL: 'Comercial (10:00 - 19:00)',
  ANTES: 'Antes (00:00 - 09:45)',
  DESPUES: 'Después (19:15 - 23:45)',
  TODOS: 'Todos (00:00 - 23:45)',
};

export function formatDuration(minutes: number): string {
  if (!minutes || minutes <= 0) return '0 min';
  const hours = Math.floor(minutes / 60);
  const remainingMins = minutes % 60;
  if (hours === 0) return `${remainingMins} min`;
  if (remainingMins === 0) return hours === 1 ? '1 hora (60 min)' : `${hours} horas (${minutes} min)`;
  return `${hours} h ${remainingMins} min (${minutes} min)`;
}

export function timeToMinutes(time: string): number {
  if (!time) return 0;
  const [h, m] = time.slice(0, 5).split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

export function minutesToTime(minutes: number): string {
  const norm = Math.max(0, Math.min(24 * 60, minutes));
  const h = Math.floor(norm / 60);
  const m = norm % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function isIntervalOverlapping(
  startA: number,
  endA: number,
  startB: number,
  endB: number,
): boolean {
  // Overlaps strictly when: startA < endB && endA > startB
  // Adjacent boundaries (endA === startB or startA === endB) do NOT overlap.
  return startA < endB && endA > startB;
}

export type ComputeSlotsInput = {
  appointments: Array<{
    id: string;
    barberId: string;
    date: string;
    time: string;
    endTime?: string;
    serviceDuration?: number;
    statusCode: string;
  }>;
  barberId: string;
  date: string;
  durationMinutes: number;
  excludeAppointmentId?: string;
  granularityMinutes?: number;
};

export function computeAvailableManualSlots({
  appointments,
  barberId,
  date,
  durationMinutes,
  excludeAppointmentId,
  granularityMinutes = 15,
}: ComputeSlotsInput): TimeCapsule[] {
  if (!barberId || !date || durationMinutes <= 0) return [];

  // Filter relevant non-cancelled appointments for the same barber on the selected date
  const relevant = appointments.filter((apt) => {
    if (apt.barberId !== barberId) return false;
    if (apt.date !== date) return false;
    if (apt.statusCode === 'CANCELLED') return false;
    if (excludeAppointmentId && apt.id === excludeAppointmentId) return false;
    return true;
  });

  const existingIntervals = relevant.map((apt) => {
    const start = timeToMinutes(apt.time);
    const end = apt.endTime
      ? timeToMinutes(apt.endTime)
      : start + (apt.serviceDuration || 45);
    return { id: apt.id, start, end };
  });

  const slots: TimeCapsule[] = [];
  const totalDayMinutes = 24 * 60;

  for (let t = 0; t + durationMinutes <= totalDayMinutes; t += granularityMinutes) {
    const slotStart = t;
    const slotEnd = t + durationMinutes;
    const timeStr = minutesToTime(slotStart);
    const endTimeStr = minutesToTime(slotEnd);

    const conflict = existingIntervals.find((inv) =>
      isIntervalOverlapping(slotStart, slotEnd, inv.start, inv.end),
    );

    slots.push({
      time: timeStr,
      endTime: endTimeStr,
      minutes: slotStart,
      available: !conflict,
      conflictReason: conflict ? 'Horario ocupado por otro turno' : undefined,
    });
  }

  return slots;
}

export function filterSlotsByPeriod(slots: TimeCapsule[], period: PeriodFilter): TimeCapsule[] {
  switch (period) {
    case 'COMERCIAL':
      // 10:00 (600 min) to 19:00 (1140 min)
      return slots.filter((s) => s.minutes >= 600 && s.minutes <= 1140);
    case 'ANTES':
      // 00:00 (0 min) to 09:45 (585 min)
      return slots.filter((s) => s.minutes < 600);
    case 'DESPUES':
      // 19:15 (1155 min) to 23:45 (1425 min)
      return slots.filter((s) => s.minutes > 1140);
    case 'TODOS':
    default:
      return slots;
  }
}
