import { normalizeBenefitCode } from '@/lib/kani-benefit-codes';
import {
  isPublicBookingBarber,
  serviceFor,
  services,
  type Barber,
  type ServiceId,
} from '@/lib/kani-model';
import { normalizePhone, type PhoneCountry } from '@/lib/kani-phone';

export const BOOKING_DRAFT_STORAGE_KEY = 'kani:booking:recovery-draft:v1';
export const BOOKING_DRAFT_MAX_AGE_MS = 60 * 60 * 1000;
export const BOOKING_DRAFT_PRE_APPOINTMENT_CUTOFF_MS = 15 * 60 * 1000;

export type BookingDraftV1 = {
  version: 1;
  service: ServiceId | null;
  barber: Barber | null;
  barberDeferred: boolean;
  date: string | null;
  time: string | null;
  name: string | null;
  phone: string | null;
  phoneCountry: PhoneCountry | null;
  email: string | null;
  benefitCode: string | null;
  lastMeaningfulActivityAt: number;
  expiresAt: number;
};

export type BookingDraftInput = {
  service: ServiceId | '' | null | undefined;
  barber: Barber | null | undefined;
  barberDeferred: boolean;
  date: string | null | undefined;
  time: string | null | undefined;
  name: string | null | undefined;
  phone: string | null | undefined;
  phoneCountry: PhoneCountry | null | undefined;
  email: string | null | undefined;
  benefitCode: string | null | undefined;
  lastMeaningfulActivityAt: number;
};

export function isValidBookingName(name: string): boolean {
  return name.trim().length >= 3;
}

export function isValidBookingEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

export function isValidBookingPhone(phone: string, country: PhoneCountry): boolean {
  return Boolean(normalizePhone(phone, country));
}

function isValidIsoDateString(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function isValidSlotTimeString(value: unknown): value is string {
  return typeof value === 'string' && /^\d{2}:\d{2}$/.test(value.slice(0, 5));
}

function isValidServiceId(value: unknown): value is ServiceId {
  return typeof value === 'string' && services.some(item => item.id === value);
}

function isValidPhoneCountry(value: unknown): value is PhoneCountry {
  return typeof value === 'string' && value.length >= 2 && value.length <= 4;
}

/**
 * Computes absolute UTC epoch ms for a date (`YYYY-MM-DD`) and time (`HH:mm`)
 * in `America/Argentina/Buenos_Aires` (UTC-3 year-round, no DST).
 */
export function buenosAiresAppointmentStartMs(date: string, time: string): number | null {
  if (!isValidIsoDateString(date) || !isValidSlotTimeString(time)) return null;
  const hhmm = time.slice(0, 5);
  const parsed = Date.parse(`${date}T${hhmm}:00-03:00`);
  return Number.isFinite(parsed) ? parsed : null;
}

export function computeDraftExpiresAt(
  lastMeaningfulActivityAt: number,
  date: string | null,
  time: string | null,
): number {
  const activityExpiry = lastMeaningfulActivityAt + BOOKING_DRAFT_MAX_AGE_MS;
  if (date && time) {
    const startMs = buenosAiresAppointmentStartMs(date, time);
    if (startMs !== null) {
      return Math.min(activityExpiry, startMs - BOOKING_DRAFT_PRE_APPOINTMENT_CUTOFF_MS);
    }
  }
  return activityExpiry;
}

export function hasMeaningfulDraftData(draft: Pick<
  BookingDraftV1,
  'service' | 'barber' | 'barberDeferred' | 'date' | 'time' | 'name' | 'phone' | 'email' | 'benefitCode'
>): boolean {
  return Boolean(
    draft.service ||
      draft.barber ||
      draft.barberDeferred ||
      draft.date ||
      draft.time ||
      draft.name ||
      draft.phone ||
      draft.email ||
      draft.benefitCode,
  );
}

/**
 * Only offer recovery UI when the user made progress beyond picking a single service alone.
 */
export function hasSignificantRecoveryProgress(draft: Pick<
  BookingDraftV1,
  'service' | 'barber' | 'barberDeferred' | 'date' | 'time' | 'name' | 'phone' | 'email' | 'benefitCode'
>): boolean {
  return Boolean(
    draft.barber ||
      draft.barberDeferred ||
      draft.date ||
      draft.time ||
      draft.name ||
      draft.phone ||
      draft.email ||
      draft.benefitCode,
  );
}

export function buildValidatedBookingDraft(input: BookingDraftInput): BookingDraftV1 | null {
  const service = isValidServiceId(input.service) ? input.service : null;
  const barberDeferred = Boolean(input.barberDeferred);
  const rawBarber = !barberDeferred && typeof input.barber === 'string' && isPublicBookingBarber(input.barber)
    ? input.barber
    : null;
  const date = isValidIsoDateString(input.date) ? input.date : null;
  const time = date && isValidSlotTimeString(input.time) ? input.time.slice(0, 5) : null;

  const rawName = typeof input.name === 'string' ? input.name.trim() : '';
  const name = isValidBookingName(rawName) ? rawName : null;

  const phoneCountry: PhoneCountry = isValidPhoneCountry(input.phoneCountry) ? input.phoneCountry : 'AR';
  const rawPhone = typeof input.phone === 'string' ? input.phone : '';
  const normalizedPhone = normalizePhone(rawPhone, phoneCountry);
  const phone = normalizedPhone ? rawPhone.trim() : null;

  const rawEmail = typeof input.email === 'string' ? input.email.trim() : '';
  const email = isValidBookingEmail(rawEmail) ? rawEmail : null;

  const normalizedBenefit = typeof input.benefitCode === 'string' ? normalizeBenefitCode(input.benefitCode) : '';
  const benefitCode = normalizedBenefit || null;

  const activityAt = Number.isFinite(input.lastMeaningfulActivityAt) ? input.lastMeaningfulActivityAt : Date.now();
  const expiresAt = computeDraftExpiresAt(activityAt, date, time);

  const draft: BookingDraftV1 = {
    version: 1,
    service,
    barber: rawBarber,
    barberDeferred,
    date,
    time,
    name,
    phone,
    phoneCountry: phone ? phoneCountry : null,
    email,
    benefitCode,
    lastMeaningfulActivityAt: activityAt,
    expiresAt,
  };

  if (!hasMeaningfulDraftData(draft)) return null;
  return draft;
}

export function sanitizeStoredBookingDraft(raw: unknown, nowMs = Date.now()): BookingDraftV1 | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  if (record.version !== 1) return null;
  if (typeof record.lastMeaningfulActivityAt !== 'number' || !Number.isFinite(record.lastMeaningfulActivityAt)) {
    return null;
  }
  if (typeof record.expiresAt !== 'number' || !Number.isFinite(record.expiresAt)) {
    return null;
  }

  const rebuilt = buildValidatedBookingDraft({
    service: record.service as ServiceId | null,
    barber: record.barber as Barber | null,
    barberDeferred: Boolean(record.barberDeferred),
    date: record.date as string | null,
    time: record.time as string | null,
    name: record.name as string | null,
    phone: record.phone as string | null,
    phoneCountry: (record.phoneCountry as PhoneCountry | null) ?? 'AR',
    email: record.email as string | null,
    benefitCode: record.benefitCode as string | null,
    lastMeaningfulActivityAt: record.lastMeaningfulActivityAt,
  });

  if (!rebuilt) return null;
  const effectiveExpiresAt = Math.min(record.expiresAt, rebuilt.expiresAt);
  if (nowMs >= effectiveExpiresAt) return null;

  return {
    ...rebuilt,
    expiresAt: effectiveExpiresAt,
  };
}

export function clearBookingDraft(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(BOOKING_DRAFT_STORAGE_KEY);
  } catch {
    // Ignore blocked storage / private mode errors gracefully
  }
}

export function readValidBookingDraft(nowMs = Date.now()): BookingDraftV1 | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(BOOKING_DRAFT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const valid = sanitizeStoredBookingDraft(parsed, nowMs);
    if (!valid) {
      clearBookingDraft();
      return null;
    }
    return valid;
  } catch {
    clearBookingDraft();
    return null;
  }
}

export function saveBookingDraft(input: BookingDraftInput, nowMs = Date.now()): BookingDraftV1 | null {
  if (typeof window === 'undefined') return null;
  const draft = buildValidatedBookingDraft(input);
  if (!draft || nowMs >= draft.expiresAt) {
    clearBookingDraft();
    return null;
  }
  try {
    window.localStorage.setItem(BOOKING_DRAFT_STORAGE_KEY, JSON.stringify(draft));
    return draft;
  } catch {
    return null;
  }
}

export function formatDraftServiceLabel(serviceId: ServiceId | null): string {
  if (!serviceId) return '';
  return serviceFor(serviceId).name;
}
