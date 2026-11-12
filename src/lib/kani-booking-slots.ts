import { minutes } from '@/lib/kani-model';

export type BookingTimePeriod = 'morning' | 'afternoon';

export type BookingTimeSlotItem = {
  time: string;
  status: 'AVAILABLE' | 'UNAVAILABLE';
};

export type BookingTimePeriodGroup = {
  period: BookingTimePeriod;
  label: string;
  timeRangeHint: string;
  slots: BookingTimeSlotItem[];
};

export type BookingConflictPhase = 'pre_submit' | 'pre_payment' | 'post_payment_check';

export class SlotUnavailableConflictError extends Error {
  readonly code = 'SLOT_UNAVAILABLE_CONFLICT';
  readonly phase: BookingConflictPhase;
  readonly slotDate?: string | undefined;
  readonly slotTime?: string | undefined;

  constructor(
    message = 'Ese horario ya no está disponible.',
    options?: { phase?: BookingConflictPhase; slotDate?: string; slotTime?: string },
  ) {
    super(message);
    this.name = 'SlotUnavailableConflictError';
    this.phase = options?.phase ?? 'pre_payment';
    this.slotDate = options?.slotDate;
    this.slotTime = options?.slotTime;
  }
}

const NON_CONFLICT_ERROR_MARKERS = [
  'BENEFIT_CODE_',
  'código de beneficio',
  'ORDER_CREATION_FAILED',
  'PAYMENT_REVIEW_REQUIRED',
  'late_review',
  'en revisión',
  'No pudimos validar la tarjeta',
];

const AVAILABILITY_CONFLICT_MARKERS = [
  'SLOT_UNAVAILABLE',
  'SLOT_ALREADY_BOOKED',
  'OVERLAP_CONFLICT',
  'SLOT_COLLISION',
  'BOOKING_DATE_OUT_OF_RANGE',
  'START_TIME_NOT_ALLOWED',
  'SUNDAY_CLOSED',
  'Ese horario ya no está disponible',
  'El horario seleccionado ya no se encuentra disponible',
  'El barbero ya tiene un turno reservado',
  'Ese horario acaba de dejar de estar disponible',
  'La fecha seleccionada ya no está disponible',
  'El estudio permanece cerrado los domingos',
];

/**
 * Classifies whether an error or message is an unambiguous slot-availability conflict
 * prior to charging/confirming, avoiding false positives on payment/network/benefit errors.
 */
export function isAvailabilityConflictError(error: unknown): boolean {
  if (error instanceof SlotUnavailableConflictError) return true;

  let text = '';
  if (typeof error === 'string') {
    text = error;
  } else if (error instanceof Error) {
    text = `${error.name} ${error.message}`;
  } else if (typeof error === 'object' && error !== null) {
    const obj = error as Record<string, unknown>;
    text = [obj['code'], obj['error'], obj['message'], obj['details']]
      .filter(value => typeof value === 'string')
      .join(' ');
  }

  if (!text) return false;
  if (NON_CONFLICT_ERROR_MARKERS.some(marker => text.includes(marker))) {
    return false;
  }
  return AVAILABILITY_CONFLICT_MARKERS.some(marker => text.includes(marker));
}

export function normalizeSlotTime(value: string): string {
  return value.trim().slice(0, 5);
}

/**
 * Splits day schedule into Mañana (< 14:00) and Tarde (>= 14:00).
 */
export function getTimePeriod(time: string): BookingTimePeriod {
  return minutes(normalizeSlotTime(time)) < 14 * 60 ? 'morning' : 'afternoon';
}

export function sortTimesAscending(times: readonly string[]): string[] {
  const unique = new Set<string>();
  for (const raw of times) {
    const clean = normalizeSlotTime(raw);
    if (/^\d{2}:\d{2}$/.test(clean)) {
      unique.add(clean);
    }
  }
  return [...unique].sort((a, b) => minutes(a) - minutes(b));
}

/**
 * Merges real available start times with known session-conflicted times for the active date/barber,
 * always trusting `availableTimes` when a slot becomes available again and keeping strict ascending order.
 */
export function buildSlotItemsForDate(
  availableTimes: readonly string[],
  conflictedTimes: readonly string[] = [],
): BookingTimeSlotItem[] {
  const availableSet = new Set(sortTimesAscending(availableTimes));
  const combined = sortTimesAscending([...availableSet, ...conflictedTimes]);
  return combined.map(time => ({
    time,
    status: availableSet.has(time) ? 'AVAILABLE' : 'UNAVAILABLE',
  }));
}

const PERIOD_META: Record<BookingTimePeriod, { label: string; timeRangeHint: string }> = {
  morning: { label: 'Mañana', timeRangeHint: 'Antes de las 14:00' },
  afternoon: { label: 'Tarde', timeRangeHint: 'Desde las 14:00' },
};

/**
 * Groups time slots into chronological Mañana (< 14:00) and Tarde (>= 14:00) sections,
 * omitting empty periods so empty sections never add visual noise.
 */
export function groupSlotsByPeriod(slots: readonly BookingTimeSlotItem[]): BookingTimePeriodGroup[] {
  const ordered = [...slots].sort(
    (a, b) => minutes(normalizeSlotTime(a.time)) - minutes(normalizeSlotTime(b.time)),
  );
  const buckets: Record<BookingTimePeriod, BookingTimeSlotItem[]> = {
    morning: [],
    afternoon: [],
  };
  for (const slot of ordered) {
    buckets[getTimePeriod(slot.time)].push({
      ...slot,
      time: normalizeSlotTime(slot.time),
    });
  }

  const periods: BookingTimePeriod[] = ['morning', 'afternoon'];
  return periods
    .filter(period => buckets[period].length > 0)
    .map(period => ({
      period,
      label: PERIOD_META[period].label,
      timeRangeHint: PERIOD_META[period].timeRangeHint,
      slots: buckets[period],
    }));
}

/**
 * Selects up to `maxCount` (default 3) verified available times closest to `requestedTime`,
 * then returns them sorted chronologically for intuitive scanning.
 */
export function findClosestAlternativeTimes({
  requestedTime,
  availableTimes,
  maxCount = 3,
}: {
  requestedTime: string;
  availableTimes: readonly string[];
  maxCount?: number;
}): string[] {
  const targetClean = normalizeSlotTime(requestedTime);
  const targetMin = /^\d{2}:\d{2}$/.test(targetClean) ? minutes(targetClean) : 0;
  const limit = Math.max(0, maxCount);
  if (limit === 0) return [];

  const uniqueCandidates = sortTimesAscending(availableTimes).filter(time => time !== targetClean);
  const closest = [...uniqueCandidates]
    .sort((a, b) => {
      const diffA = Math.abs(minutes(a) - targetMin);
      const diffB = Math.abs(minutes(b) - targetMin);
      if (diffA !== diffB) return diffA - diffB;
      return minutes(a) - minutes(b);
    })
    .slice(0, limit);

  return closest.sort((a, b) => minutes(a) - minutes(b));
}
