import { supabase } from '@/integrations/supabase/client';
import type { Tables } from '@/integrations/supabase/types';
import { bookingStartTimes, minutes, parseDate, services, type Barber } from '@/lib/kani-model';
import { BUSINESS_TIME_ZONE, businessDateToday } from '@/lib/kani-mobile-appointments';

export type AvailabilitySlot = Tables<'barber_availability_slots'>;
export type PublicAvailabilitySlot = Omit<Tables<'available_barber_slots'>, 'status'> & {
  status: AvailabilitySlot['status'];
  barber_name: Barber;
};
export type ConfiguredService = Omit<(typeof services)[number], 'price' | 'duration'> & {
  price: number;
  duration: number;
};
export type PublicAvailabilityStart = {
  barber_id: string;
  slot_date: string;
  start_time: string;
  is_exception: boolean;
  compatible_services: string[];
  barber_name: Barber;
};

const AVAILABILITY_STEP_MINUTES = 5;

export const FIXED_BOOKING_START_TIMES = bookingStartTimes;

export function isFixedBookingStart(value: string) {
  return FIXED_BOOKING_START_TIMES.includes(value.slice(0, 5));
}

const EFFECTIVE_SERVICE_DURATION_SECONDS: Record<number, number> = {
  30: 30 * 60,
  45: 45 * 60,
  60: 60 * 60,
};

export function effectiveServiceDurationSeconds(duration: number) {
  return EFFECTIVE_SERVICE_DURATION_SECONDS[duration] ?? duration * 60;
}

function requiredAvailabilitySegments(duration: number) {
  return Math.ceil(effectiveServiceDurationSeconds(duration) / (AVAILABILITY_STEP_MINUTES * 60));
}

export function isManageableScheduleDate(slotDate: string, today = businessDateToday()) {
  return slotDate >= today && parseDate(slotDate).getDay() !== 0;
}

const slotFields = 'id, barber_id, slot_date, start_time, end_time, status, internal_note, created_at, updated_at, updated_by';
const publicSlotFields = 'id, barber_id, slot_date, start_time, end_time, status';

let cachedServices: { data: ConfiguredService[]; timestamp: number } | null = null;
const SERVICES_CACHE_TTL_MS = 2 * 60 * 1000; // 2 minutes

export function clearServicesCache() {
  cachedServices = null;
}

export async function readConfiguredServices(options: { bypassCache?: boolean } = {}): Promise<ConfiguredService[]> {
  const now = Date.now();
  if (!options.bypassCache && cachedServices && now - cachedServices.timestamp < SERVICES_CACHE_TTL_MS) {
    return cachedServices.data;
  }
  const { data, error } = await supabase
    .from('services')
    .select('name, duration_minutes, price_ars')
    .eq('active', true)
    .order('name', { ascending: true });
  if (error) throw error;
  const byName = new Map((data ?? []).map(row => [row.name, row]));
  const result = services.flatMap(service => {
    const configured = byName.get(service.name)
      ?? (service.id === 'corte-barba' ? (byName.get('Corte + barba') ?? byName.get('Corte y barba')) : undefined);
    return configured ? [{ ...service, price: configured.price_ars, duration: configured.duration_minutes }] : [];
  });
  cachedServices = { data: result, timestamp: now };
  return result;
}

let cachedActiveBarbers: { data: { id: string; name: string }[]; timestamp: number } | null = null;
const BARBERS_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export function clearActiveBarbersCache() {
  cachedActiveBarbers = null;
}

async function getActiveBarbers(): Promise<{ id: string; name: string }[]> {
  const now = Date.now();
  if (cachedActiveBarbers && now - cachedActiveBarbers.timestamp < BARBERS_CACHE_TTL_MS) {
    return cachedActiveBarbers.data;
  }
  const { data, error } = await supabase.from('barbers').select('id, name').eq('active', true);
  if (error) throw error;
  const result = data ?? [];
  cachedActiveBarbers = { data: result, timestamp: now };
  return result;
}

export async function readPublicAvailabilityStarts(barber: Barber | null, fromDate: string, toDate: string) {
  const allBarbers = await getActiveBarbers();
  const barberRows = barber ? allBarbers.filter(b => b.name === barber) : allBarbers;
  if (!barberRows.length) return [] as PublicAvailabilityStart[];
  const barberById = new Map(barberRows.map(row => [row.id, row.name as Barber]));
  const { data, error } = await supabase.rpc('read_valid_availability_starts', {
    p_barber_id: barber ? barberRows[0]?.id ?? null : null,
    p_from_date: fromDate,
    p_to_date: toDate,
  });
  if (error) throw error;
  return (data ?? []).flatMap(row => {
    const barberName = barberById.get(row.barber_id);
    return barberName ? [{ ...row, barber_name: barberName }] : [];
  }) as PublicAvailabilityStart[];
}

export function availabilityStartTimesForServiceDate(
  starts: PublicAvailabilityStart[],
  date: string,
  serviceName: string,
  now: Date,
  barber?: Barber | null,
) {
  return [...new Set(starts
    .filter(start => start.slot_date === date)
    .filter(start => !barber || start.barber_name === barber)
    .filter(start => isFixedBookingStart(start.start_time))
    .filter(start => start.compatible_services.includes(serviceName) || ((serviceName === 'Corte y barba' || serviceName === 'Corte + barba') && (start.compatible_services.includes('Corte + barba') || start.compatible_services.includes('Corte y barba'))))
    .filter(start => slotCanStillBeBooked(start.slot_date, start.start_time, now))
    .map(start => start.start_time.slice(0, 5)))].sort();
}

export function eligibleBarbersForAvailabilityStart(
  starts: PublicAvailabilityStart[],
  date: string,
  time: string,
  serviceName: string,
  now: Date,
) {
  return [...new Set(starts
    .filter(start => start.slot_date === date && start.start_time.slice(0, 5) === time)
    .filter(start => isFixedBookingStart(start.start_time))
    .filter(start => start.compatible_services.includes(serviceName) || ((serviceName === 'Corte y barba' || serviceName === 'Corte + barba') && (start.compatible_services.includes('Corte + barba') || start.compatible_services.includes('Corte y barba'))))
    .filter(start => slotCanStillBeBooked(start.slot_date, start.start_time, now))
    .map(start => start.barber_name))];
}

function businessClockMinutes(now: Date) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: BUSINESS_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const hour = Number(parts.find(part => part.type === 'hour')?.value ?? 0);
  const minute = Number(parts.find(part => part.type === 'minute')?.value ?? 0);
  return hour * 60 + minute;
}

export function slotCanStillBeBooked(slotDate: string, startTime: string, now: Date) {
  const today = businessDateToday(now);
  return slotDate !== today || minutes(startTime.slice(0, 5)) > businessClockMinutes(now);
}

function availableSegmentStarts(
  slots: PublicAvailabilitySlot[],
  date: string,
  barber?: Barber | null,
) {
  const starts = new Set<number>();
  const blockedStarts = new Set<number>();
  slots
    .filter(slot => slot.slot_date === date && slot.status === 'AVAILABLE')
    .filter(slot => !barber || slot.barber_name === barber)
    .forEach(slot => {
      const start = minutes(slot.start_time.slice(0, 5));
      const end = minutes(slot.end_time.slice(0, 5));
      for (let value = start; value < end; value += AVAILABILITY_STEP_MINUTES) {
        starts.add(value);
      }
    });
  slots
    .filter(slot => slot.slot_date === date && slot.status === 'UNAVAILABLE')
    .filter(slot => !barber || slot.barber_name === barber)
    .forEach(slot => {
      const start = minutes(slot.start_time.slice(0, 5));
      const end = minutes(slot.end_time.slice(0, 5));
      for (let value = start; value < end; value += AVAILABILITY_STEP_MINUTES) {
        blockedStarts.add(value);
      }
    });
  blockedStarts.forEach(value => starts.delete(value));
  return starts;
}

export function availableTimesForServiceDate(
  slots: PublicAvailabilitySlot[],
  date: string,
  duration: number,
  now: Date,
  barber?: Barber | null,
) {
  if (duration <= 0 || duration % AVAILABILITY_STEP_MINUTES !== 0) return [];
  const segmentStarts = availableSegmentStarts(slots, date, barber);
  const times: string[] = [];
  for (const startTime of FIXED_BOOKING_START_TIMES) {
    const start = minutes(startTime);
    if (!slotCanStillBeBooked(date, startTime, now)) continue;
    const complete = Array.from(
      { length: requiredAvailabilitySegments(duration) },
      (_, index) => start + index * AVAILABILITY_STEP_MINUTES,
    ).every(segment => segmentStarts.has(segment));
    if (complete) times.push(startTime);
  }
  return times;
}

export function eligibleBarbersForServiceSlot(
  slots: PublicAvailabilitySlot[],
  date: string,
  time: string,
  duration: number,
  now: Date,
) {
  return [...new Set(slots
    .map(slot => slot.barber_name)
    .filter(barber => availableTimesForServiceDate(slots, date, duration, now, barber).includes(time)))];
}

export async function readAvailabilitySlots(barberId: string, slotDate: string) {
  return readAvailabilitySlotsForRange(barberId, { start: slotDate, end: slotDate });
}

export async function readAvailabilitySlotsForRange(
  barberId: string,
  range: { start?: string; end?: string } | null = null,
) {
  let query = supabase
    .from('barber_availability_slots')
    .select(slotFields)
    .eq('barber_id', barberId);
  if (range?.start) query = query.gte('slot_date', range.start);
  if (range?.end) query = query.lte('slot_date', range.end);
  const { data: rangedData, error: rangedError } = await query
    .order('slot_date', { ascending: true })
    .order('start_time', { ascending: true });
  if (rangedError) throw rangedError;
  return rangedData as AvailabilitySlot[];
}

export async function readAvailabilityStartsForRange(
  barberId: string,
  range: { start?: string; end?: string } | null = null,
) {
  const { data, error } = await supabase.rpc('read_valid_availability_starts', {
    p_barber_id: barberId,
    p_from_date: range?.start ?? null,
    p_to_date: range?.end ?? null,
  });
  if (error) throw error;
  return (data ?? []) as Array<{
    barber_id: string;
    slot_date: string;
    start_time: string;
    is_exception: boolean;
    compatible_services: string[];
  }>;
}

export async function updateAvailabilitySlot({
  id,
  barberId,
  status,
  internalNote,
}: {
  id: string;
  barberId: string;
  status: AvailabilitySlot['status'];
  internalNote: string | null;
}) {
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) throw userError ?? new Error('Sesión no disponible');
  const { data, error } = await supabase.rpc('update_availability_slot', {
    p_slot_id: id,
    p_status: status,
    p_internal_note: internalNote?.trim() || null,
  });
  if (error) throw error;
  const updated = data?.[0];
  if (!updated || updated.barber_id !== barberId) throw new Error('El slot no pertenece al barbero autorizado.');
  return updated as AvailabilitySlot;
}

export function validateAvailabilityRange(startTime: string, endTime?: string | null) {
  const parseTime = (value: string) => {
    const [hoursText, minutesText] = value.split(':');
    return { hours: Number(hoursText), minutesValue: Number(minutesText) };
  };
  const start = parseTime(startTime);
  const validTime = (value: { hours: number; minutesValue: number }, isEnd = false) =>
    Number.isInteger(value.hours)
    && Number.isInteger(value.minutesValue)
    && value.hours >= 0
    && value.hours <= 23
    && value.minutesValue >= 0
    && value.minutesValue <= 59
    && (value.minutesValue % AVAILABILITY_STEP_MINUTES === 0 || (isEnd && value.hours === 23 && value.minutesValue === 59));

  if (!validTime(start)) {
    throw new Error('La hora de inicio debe ser válida entre 00:00 y 23:59.');
  }

  const normalizedStart = `${String(start.hours).padStart(2, '0')}:${String(start.minutesValue).padStart(2, '0')}`;
  let normalizedEnd: string | null = null;
  if (endTime) {
    const end = parseTime(endTime);
    if (!validTime(end, true)) {
      throw new Error('La hora de fin debe ser válida entre 00:00 y 23:59.');
    }
    normalizedEnd = `${String(end.hours).padStart(2, '0')}:${String(end.minutesValue).padStart(2, '0')}:00`;
    if (normalizedEnd <= `${normalizedStart}:00`) {
      throw new Error('La hora de fin debe ser posterior a la hora de inicio.');
    }
  }

  return {
    normalizedStart: `${normalizedStart}:00`,
    normalizedEnd,
  };
}

export async function createAvailabilitySlots({
  barberId,
  dates,
  startTime,
  endTime,
}: {
  barberId: string;
  dates: string[];
  startTime: string;
  endTime?: string | null;
}) {
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) throw userError ?? new Error('Sesión no disponible');

  const { normalizedStart, normalizedEnd } = validateAvailabilityRange(startTime, endTime);

  const businessToday = businessDateToday();
  const validDates = dates.filter(slotDate => isManageableScheduleDate(slotDate, businessToday));
  if (validDates.length !== dates.filter(Boolean).length) throw new Error(`La fecha debe ser un día de atención desde ${businessToday}; los domingos permanecen cerrados.`);
  if (validDates.length === 0) throw new Error('Elegí al menos una fecha.');
  const { data, error } = await supabase.rpc('create_availability_slots', {
    p_barber_id: barberId,
    p_slot_dates: validDates,
    p_start_time: normalizedStart,
    p_end_time: normalizedEnd,
  });
  if (error) throw error;
  return (data ?? []) as AvailabilitySlot[];
}

export type DashboardAvailabilitySlot = Pick<AvailabilitySlot, 'id' | 'barber_id' | 'slot_date' | 'start_time' | 'end_time' | 'status'>;
export async function readDashboardAvailabilitySlots(fromDate: string, toDate: string) {
  const { data, error } = await supabase
    .from('barber_availability_slots')
    .select('id, barber_id, slot_date, start_time, end_time, status')
    .gte('slot_date', fromDate)
    .lte('slot_date', toDate)
    .order('slot_date', { ascending: true })
    .order('start_time', { ascending: true });
  if (error) throw error;
  return (data ?? []) as DashboardAvailabilitySlot[];
}
