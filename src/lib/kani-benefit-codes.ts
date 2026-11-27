/**
 * Kani Barber Studio — Benefit & Discount Codes Engine
 * 
 * Defines the 4 official benefit types:
 * - NO_DEPOSIT: "Reserva sin seña" (0 discount, $0 online deposit, full price paid in person)
 * - FREE_SERVICE: "Servicio gratuito" (100% discount, $0 deposit, $0 balance, $0 total, 0 monetary impact in accounting)
 * - PERCENT_10: "Descuento del 10 %" (10% off total, standard deposit forms part of final total)
 * - PERCENT_50: "Descuento del 50 %" (50% off total, standard deposit forms part of final total)
 * 
 * Modalities:
 * - SINGLE_USE: "Un solo uso" (consumido al confirmar una reserva)
 * - REUSABLE: "Reutilizable" (múltiples reservas mientras esté activo y dentro de su vigencia)
 * 
 * Validity:
 * - NO_EXPIRATION: Sin vencimiento
 * - ONE_WEEK: Durante una semana
 * - ONE_MONTH: Durante un mes (mes calendario ajustando al último día válido)
 * - CUSTOM_DURATION: Duración personalizada (X días, semanas o meses)
 * - DATE_RANGE: Desde una fecha hasta otra
 * 
 * Timezone:
 * - America/Argentina/Buenos_Aires (UTC-3)
 * - End date without explicit time covers full day until 23:59:59.999-03:00.
 */

export type BenefitCodeType = 'NO_DEPOSIT' | 'FREE_SERVICE' | 'PERCENT_10' | 'PERCENT_50';

export type BenefitUsageMode = 'SINGLE_USE' | 'LIMITED_USE' | 'REUSABLE';

export type BenefitBatchCount = 1 | 5 | 10;

export const DEFAULT_LIMITED_USE_MAX_USES = 10;

export type BenefitValidityType =
  | 'NO_EXPIRATION'
  | 'ONE_WEEK'
  | 'ONE_MONTH'
  | 'CUSTOM_DURATION'
  | 'DATE_RANGE';

export type BenefitDurationUnit = 'DAYS' | 'WEEKS' | 'MONTHS';

/**
 * Administrative and business statuses:
 * - ACTIVE: Activo y disponible para reservas
 * - SCHEDULED: Programado (fecha de inicio futura)
 * - DISABLED: Desactivado manualmente por un administrador
 * - EXPIRED: Vencido según su fecha límite de vigencia
 * - CONSUMED: Consumido (solo para códigos de un solo uso)
 * - DELETED: Eliminado (soft delete, conservado en historial)
 * - LOCKED: Estado transitorio en checkout para single-use
 */
export type BenefitCodeStatus =
  | 'ACTIVE'
  | 'SCHEDULED'
  | 'DISABLED'
  | 'EXPIRED'
  | 'CONSUMED'
  | 'DELETED'
  | 'LOCKED';

export interface BenefitCodeUsageItem {
  id: string;
  appointmentId: string;
  requestNumber: number | null;
  bookingDate: string | null;
  bookingTime: string | null;
  appointmentStatus: string | null;
  serviceName: string | null;
  barberName: string | null;
  clientId?: string | null;
  clientName?: string | null;
  clientPhone?: string | null;
  clientEmail?: string | null;
  usedAt: string;
  originalPriceArs?: number | null;
  discountAmountArs?: number | null;
  finalPriceArs?: number | null;
  onlineDepositArs?: number | null;
  inPersonBalanceArs?: number | null;
  isAppointmentCancelled?: boolean;
}

export interface BenefitCodeItem {
  id: string;
  code: string;
  type: BenefitCodeType;
  usageMode: BenefitUsageMode;
  validityType: BenefitValidityType;
  validFrom: string;
  validUntil?: string | null;
  validityDurationValue?: number | null;
  validityDurationUnit?: BenefitDurationUnit | null;
  timesUsed: number;
  maxUses?: number | null;
  internalNote?: string | null;
  status: BenefitCodeStatus;
  rawStatus?: string;
  isLockedInCheckout?: boolean;
  createdByUserId?: string | null;
  createdByDisplayName?: string | null;
  createdAt: string;
  updatedAt: string;
  lastEditedAt?: string | null;
  lastEditedByUserId?: string | null;
  lastEditedByDisplayName?: string | null;
  deletedAt?: string | null;
  deletedByUserId?: string | null;
  deletedByDisplayName?: string | null;

  // Detalles del último consumo o snapshot compatible
  consumedAt?: string | null;
  consumedAppointmentId?: string | null;
  consumedClientId?: string | null;
  clientName?: string | null;
  clientPhone?: string | null;
  clientEmail?: string | null;
  appointmentRequestNumber?: number | null;
  appointmentDate?: string | null;
  appointmentTime?: string | null;
  appointmentStatus?: string | null;
  appointmentService?: string | null;
  appointmentBarber?: string | null;
  originalPriceArs?: number | null;
  discountAmountArs?: number | null;
  finalPriceArs?: number | null;
  onlineDepositArs?: number | null;
  inPersonBalanceArs?: number | null;
  isAppointmentCancelled?: boolean;

  // Historial 1:N completo de turnos asociados
  usages?: BenefitCodeUsageItem[];
}

export interface BenefitCalculation {
  code: string;
  benefitType: BenefitCodeType;
  benefitLabel: string;
  originalPriceArs: number;
  discountAmountArs: number;
  finalPriceArs: number;
  onlineDepositArs: number;
  inPersonBalanceArs: number;
  skipOnlinePayment: boolean;
  buttonLabel: string;
  explanation: string;
}

export type BenefitQuote =
  | (BenefitCalculation & {
      valid: true;
      type: BenefitCodeType;
      usageMode?: BenefitUsageMode;
      label: string;
      calculation: BenefitCalculation;
      message?: string;
    })
  | {
      valid: false;
      message: string;
      error?: string;
      type?: never;
      usageMode?: never;
      label?: never;
      originalPriceArs?: never;
      discountAmountArs?: never;
      finalPriceArs?: never;
      onlineDepositArs?: never;
      inPersonBalanceArs?: never;
      skipOnlinePayment?: never;
      code?: never;
    };

export const BENEFIT_TYPE_DEFINITIONS: Record<
  BenefitCodeType,
  {
    label: string;
    shortLabel: string;
    description: string;
    requiresOnlineDeposit: boolean;
    discountPercent: number;
  }
> = {
  NO_DEPOSIT: {
    label: 'Reserva sin seña',
    shortLabel: 'Sin seña',
    description: 'Sin descuento, pero permite reservar sin pagar seña.',
    requiresOnlineDeposit: false,
    discountPercent: 0,
  },
  FREE_SERVICE: {
    label: 'Servicio gratuito',
    shortLabel: '100% bonificado',
    description: 'Bonificación del 100% de la seña y del servicio.',
    requiresOnlineDeposit: false,
    discountPercent: 100,
  },
  PERCENT_10: {
    label: 'Descuento del 10%',
    shortLabel: '10% OFF',
    description: 'Bonificación del 10% del servicio. Se abona la seña completa.',
    requiresOnlineDeposit: true,
    discountPercent: 10,
  },
  PERCENT_50: {
    label: 'Descuento del 50%',
    shortLabel: '50% OFF',
    description: 'Bonificación del 50% del servicio. Se abona la seña completa.',
    requiresOnlineDeposit: true,
    discountPercent: 50,
  },
} as const;

export const BENEFIT_USAGE_MODE_DEFINITIONS: Record<
  BenefitUsageMode,
  {
    label: string;
    description: string;
    badgeLabel: string;
  }
> = {
  SINGLE_USE: {
    label: 'Único uso',
    description: 'Se consume permanentemente al confirmar una reserva.',
    badgeLabel: 'Único uso',
  },
  LIMITED_USE: {
    label: '10 usos',
    description: 'Permite hasta 10 reservas confirmadas y luego se agota automáticamente.',
    badgeLabel: '10 usos',
  },
  REUSABLE: {
    label: 'Reutilizable',
    description: 'Permite múltiples reservas mientras esté activo y dentro de su vigencia.',
    badgeLabel: 'Reutilizable',
  },
};

export const BENEFIT_VALIDITY_TYPE_DEFINITIONS: Record<
  BenefitValidityType,
  {
    label: string;
    description: string;
  }
> = {
  NO_EXPIRATION: {
    label: 'Sin vencimiento',
    description: 'Válido por tiempo indeterminado mientras esté activo.',
  },
  ONE_WEEK: {
    label: 'Durante una semana',
    description: 'Válido durante 7 días desde la fecha de inicio.',
  },
  ONE_MONTH: {
    label: 'Durante un mes',
    description: 'Válido durante 1 mes calendario desde la fecha de inicio.',
  },
  CUSTOM_DURATION: {
    label: 'Duración personalizada',
    description: 'Definir una cantidad específica de días, semanas o meses.',
  },
  DATE_RANGE: {
    label: 'Desde una fecha hasta otra',
    description: 'Definir fecha exacta de inicio y fin (incluye día completo).',
  },
};

/**
 * Normalizes user-entered benefit code:
 * Converts to uppercase, trims whitespace, collapses inner spacing into hyphens.
 */
export function normalizeBenefitCode(code: string | undefined | null): string {
  if (!code) return '';
  return code
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '-');
}

/**
 * Validates benefit code syntax.
 * Codes must be 4 to 32 alphanumeric characters (including Ñ) or hyphens.
 */
export function isValidBenefitCodeFormat(code: string): boolean {
  const normalized = normalizeBenefitCode(code);
  return /^[A-Z0-9Ñ-]{4,32}$/.test(normalized);
}

const BENEFIT_CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

function randomBenefitChunk(len: number): string {
  let result = '';
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  for (let i = 0; i < len; i++) {
    result += BENEFIT_CODE_ALPHABET[bytes[i] % BENEFIT_CODE_ALPHABET.length];
  }
  return result;
}

/**
 * Generates an unguessable single-use benefit code:
 * Format: KANI-XXXX-XXXX using cryptographically secure random bytes
 * Alphabet excludes ambiguous characters (0, O, 1, I).
 */
export function generateBenefitCodeString(): string {
  return `KANI-${randomBenefitChunk(4)}-${randomBenefitChunk(4)}`;
}

// Alias for backwards compatibility
export const generateBenefitCode = generateBenefitCodeString;

/**
 * Generates a unique benefit code for batch creation, optionally honoring a sanitized prefix.
 * Always produces a valid 4..32 char code.
 */
export function generateBatchBenefitCodeString(prefix?: string | null): string {
  const cleanPrefix = normalizeBenefitCode(prefix)
    .replace(/[^A-Z0-9Ñ-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 24);
  if (!cleanPrefix) {
    return generateBenefitCodeString();
  }
  return `${cleanPrefix}-${randomBenefitChunk(4)}`;
}

function getBuenosAiresContextualOccasion(baseDate: Date): { year: number; tag: string } {
  const todayStr = getBuenosAiresTodayDateString(baseDate);
  const [year, month, day] = todayStr.split('-').map(Number);

  // Navidad (10–26 Dic)
  if (month === 12 && day >= 10 && day <= 26) {
    return { year, tag: 'NAVIDAD' };
  }
  // Año Nuevo (27–31 Dic usa año entrante; 1–7 Ene usa año actual)
  if (month === 12 && day >= 27) {
    return { year: year + 1, tag: 'AÑO' };
  }
  if (month === 1 && day <= 7) {
    return { year, tag: 'AÑO' };
  }
  // San Valentín (8–16 Feb)
  if (month === 2 && day >= 8 && day <= 16) {
    return { year, tag: 'VALENTIN' };
  }
  // Día del Padre AR (10–22 Jun)
  if (month === 6 && day >= 10 && day <= 22) {
    return { year, tag: 'PADRE' };
  }
  // Día del Amigo AR (14–22 Jul)
  if (month === 7 && day >= 14 && day <= 22) {
    return { year, tag: 'AMIGO' };
  }
  // Primavera (18–26 Sep)
  if (month === 9 && day >= 18 && day <= 26) {
    return { year, tag: 'PRIMAVERA' };
  }
  // Black Friday / Cyber (20 Nov–3 Dic)
  if ((month === 11 && day >= 20) || (month === 12 && day <= 3)) {
    return { year, tag: 'BLACK' };
  }

  // Estaciones del hemisferio sur
  if (month === 12 || month === 1 || month === 2) {
    return { year, tag: 'VERANO' };
  }
  if (month >= 3 && month <= 5) {
    return { year, tag: 'OTOÑO' };
  }
  if (month >= 6 && month <= 8) {
    return { year, tag: 'INVIERNO' };
  }
  return { year, tag: 'PRIMAVERA' };
}

function getBenefitTagForSuggestion(type: BenefitCodeType): string {
  switch (type) {
    case 'PERCENT_10':
      return '10OFF';
    case 'PERCENT_50':
      return '50OFF';
    case 'NO_DEPOSIT':
      return 'SIN-SEÑA';
    case 'FREE_SERVICE':
      return 'FREE';
  }
}

/**
 * Generates contextual benefit code suggestions based on:
 * - Current date in America/Argentina/Buenos_Aires (holidays/seasons)
 * - Selected usageMode (SINGLE_USE, LIMITED_USE, REUSABLE)
 * - Selected benefitType
 *
 * Strictly filters against `existingCodes` (all active, consumed, disabled, or deleted codes in DB)
 * so an already-used code is NEVER suggested.
 */
export function generateContextualBenefitCodeSuggestions(params: {
  type: BenefitCodeType;
  usageMode: BenefitUsageMode;
  existingCodes?: Iterable<string>;
  baseDate?: Date;
  count?: number;
}): string[] {
  const count = Math.max(1, params.count ?? 2);
  const baseDate = params.baseDate ?? new Date();
  const occasion = getBuenosAiresContextualOccasion(baseDate);
  const benefitTag = getBenefitTagForSuggestion(params.type);

  const usedSet = new Set<string>();
  if (params.existingCodes) {
    for (const c of params.existingCodes) {
      const norm = normalizeBenefitCode(c);
      if (norm) usedSet.add(norm);
    }
  }

  const buildCandidate = (slot: number): string => {
    if (slot === 0) {
      // Contextual por fecha AR (ej. KANI-2026-NAVIDAD-X9E3 / KANI-2027-AÑO-7J9Q)
      return `KANI-${occasion.year}-${occasion.tag}-${randomBenefitChunk(4)}`;
    }
    if (params.type === 'NO_DEPOSIT') {
      // Formato natural con Ñ: KANI-SIN-SEÑA-X910
      return `KANI-SIN-SEÑA-${randomBenefitChunk(4)}`;
    }
    if (params.usageMode === 'LIMITED_USE') {
      // Para 10 usos: ej. KANI-OFF-N8Z1-X9G2
      const prefix = params.type === 'PERCENT_10' || params.type === 'PERCENT_50' ? 'OFF' : benefitTag;
      return `KANI-${prefix}-${randomBenefitChunk(4)}-${randomBenefitChunk(4)}`;
    }
    if (params.usageMode === 'REUSABLE') {
      return `KANI-CLUB-${benefitTag}-${randomBenefitChunk(4)}`;
    }
    return `KANI-${benefitTag}-${randomBenefitChunk(4)}-${randomBenefitChunk(4)}`;
  };

  const results: string[] = [];
  for (let slot = 0; slot < count; slot++) {
    let chosen = '';
    for (let attempt = 0; attempt < 40; attempt++) {
      const candidate = normalizeBenefitCode(buildCandidate(slot));
      if (
        isValidBenefitCodeFormat(candidate) &&
        !usedSet.has(candidate) &&
        !results.includes(candidate)
      ) {
        chosen = candidate;
        break;
      }
    }
    if (!chosen) {
      for (let attempt = 0; attempt < 40; attempt++) {
        const fallback = generateBenefitCodeString();
        if (!usedSet.has(fallback) && !results.includes(fallback)) {
          chosen = fallback;
          break;
        }
      }
    }
    if (chosen) {
      results.push(chosen);
      usedSet.add(chosen);
    }
  }

  return results;
}

/**
 * Timezone helpers for Buenos Aires (UTC-3)
 */
export function getBuenosAiresTodayDateString(baseDate?: Date): string {
  const d = baseDate || new Date();
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(d); // YYYY-MM-DD
}

/**
 * Formats a Date or ISO string into Buenos Aires DD/MM/YYYY
 */
export function formatBuenosAiresDate(isoStringOrDate?: string | Date | null): string {
  if (!isoStringOrDate) return 'Sin fecha';
  try {
    const d = typeof isoStringOrDate === 'string' ? new Date(isoStringOrDate) : isoStringOrDate;
    if (Number.isNaN(d.getTime())) return String(isoStringOrDate);
    return new Intl.DateTimeFormat('es-AR', {
      timeZone: 'America/Argentina/Buenos_Aires',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }).format(d);
  } catch {
    return String(isoStringOrDate);
  }
}

/**
 * Formats a Date or ISO string into Buenos Aires DD/MM/YYYY HH:mm hs
 */
export function formatBuenosAiresDateTime(isoStringOrDate?: string | Date | null): string {
  if (!isoStringOrDate) return 'Sin fecha';
  try {
    const d = typeof isoStringOrDate === 'string' ? new Date(isoStringOrDate) : isoStringOrDate;
    if (Number.isNaN(d.getTime())) return String(isoStringOrDate);
    return new Intl.DateTimeFormat('es-AR', {
      timeZone: 'America/Argentina/Buenos_Aires',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(d) + ' hs';
  } catch {
    return String(isoStringOrDate);
  }
}

/**
 * Pure calculation of calendar month addition adjusting to the last valid day of the month.
 * Examples:
 * - 2026-03-31 + 1 month = 2026-04-30
 * - 2026-01-31 + 1 month = 2026-02-28
 * - 2024-01-31 + 1 month = 2024-02-29 (bisiesto)
 */
export function addCalendarMonths(year: number, month: number, day: number, monthsToAdd: number): { year: number; month: number; day: number } {
  const targetTotalMonths = (year * 12 + (month - 1)) + monthsToAdd;
  const targetYear = Math.floor(targetTotalMonths / 12);
  const targetMonth = (targetTotalMonths % 12) + 1;
  // Get days in target month by passing day 0 of the next month
  const daysInTargetMonth = new Date(Date.UTC(targetYear, targetMonth, 0)).getUTCDate();
  const targetDay = Math.min(day, daysInTargetMonth);
  return { year: targetYear, month: targetMonth, day: targetDay };
}

export interface ValidityCalculationInput {
  validityType: BenefitValidityType;
  startDate?: string; // YYYY-MM-DD
  endDate?: string;   // YYYY-MM-DD
  durationValue?: number;
  durationUnit?: BenefitDurationUnit;
  baseNow?: Date;
}

export interface ValidityCalculationResult {
  validFromIso: string;
  validUntilIso: string | null;
  startDateString: string;
  endDateString: string | null;
  summary: string;
  detail: string;
  isValid: boolean;
  error?: string;
}

/**
 * Calculates start and end timestamps in Buenos Aires timezone (UTC-3)
 * according to the 5 official validity options.
 */
export function calculateValidityDates(input: ValidityCalculationInput): ValidityCalculationResult {
  const baseNow = input.baseNow || new Date();
  const todayBa = getBuenosAiresTodayDateString(baseNow);
  const startStr = (input.startDate && input.startDate.trim()) || todayBa;

  // Validate start date format YYYY-MM-DD
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startStr)) {
    return {
      validFromIso: new Date().toISOString(),
      validUntilIso: null,
      startDateString: startStr,
      endDateString: null,
      summary: 'Fecha de inicio inválida',
      detail: 'La fecha de inicio debe tener formato AAAA-MM-DD.',
      isValid: false,
      error: 'Fecha de inicio inválida.',
    };
  }

  const [startYear, startMonth, startDay] = startStr.split('-').map(Number);
  const isStartToday = startStr === todayBa;

  // Start is at 00:00:00-03:00 Buenos Aires (or current exact time if today)
  const validFromIso = isStartToday
    ? baseNow.toISOString()
    : new Date(`${startStr}T00:00:00.000-03:00`).toISOString();

  let validUntilIso: string | null = null;
  let endStr: string | null = null;
  let summary = '';
  let detail = '';

  switch (input.validityType) {
    case 'NO_EXPIRATION': {
      validUntilIso = null;
      endStr = null;
      summary = 'Sin vencimiento';
      detail = isStartToday
        ? 'Activo sin límite de fecha desde hoy.'
        : `Válido sin vencimiento a partir del ${formatBuenosAiresDate(`${startStr}T00:00:00-03:00`)}.`;
      break;
    }

    case 'ONE_WEEK': {
      // 7 days from start date: start + 7 days at 23:59:59.999-03:00
      const startDateUtc = new Date(Date.UTC(startYear, startMonth - 1, startDay));
      startDateUtc.setUTCDate(startDateUtc.getUTCDate() + 7);
      const endYear = startDateUtc.getUTCFullYear();
      const endMonth = String(startDateUtc.getUTCMonth() + 1).padStart(2, '0');
      const endDay = String(startDateUtc.getUTCDate()).padStart(2, '0');
      endStr = `${endYear}-${endMonth}-${endDay}`;
      validUntilIso = new Date(`${endStr}T23:59:59.999-03:00`).toISOString();
      summary = `Durante 1 semana (hasta el ${formatBuenosAiresDate(`${endStr}T00:00:00-03:00`)})`;
      detail = `Válido desde el ${formatBuenosAiresDate(`${startStr}T00:00:00-03:00`)} hasta el ${formatBuenosAiresDate(`${endStr}T00:00:00-03:00`)} inclusive (23:59 hs).`;
      break;
    }

    case 'ONE_MONTH': {
      // 1 calendar month with day capping
      const target = addCalendarMonths(startYear, startMonth, startDay, 1);
      const endMonth = String(target.month).padStart(2, '0');
      const endDay = String(target.day).padStart(2, '0');
      endStr = `${target.year}-${endMonth}-${endDay}`;
      validUntilIso = new Date(`${endStr}T23:59:59.999-03:00`).toISOString();
      summary = `Durante 1 mes (hasta el ${formatBuenosAiresDate(`${endStr}T00:00:00-03:00`)})`;
      detail = `Válido desde el ${formatBuenosAiresDate(`${startStr}T00:00:00-03:00`)} hasta el ${formatBuenosAiresDate(`${endStr}T00:00:00-03:00`)} inclusive (23:59 hs).`;
      break;
    }

    case 'CUSTOM_DURATION': {
      const val = Math.max(1, Math.round(Number(input.durationValue) || 1));
      const unit = input.durationUnit || 'DAYS';

      if (unit === 'DAYS') {
        const dObj = new Date(Date.UTC(startYear, startMonth - 1, startDay));
        dObj.setUTCDate(dObj.getUTCDate() + val);
        const y = dObj.getUTCFullYear();
        const m = String(dObj.getUTCMonth() + 1).padStart(2, '0');
        const d = String(dObj.getUTCDate()).padStart(2, '0');
        endStr = `${y}-${m}-${d}`;
        summary = `Por ${val} ${val === 1 ? 'día' : 'días'} (hasta el ${formatBuenosAiresDate(`${endStr}T00:00:00-03:00`)})`;
      } else if (unit === 'WEEKS') {
        const dObj = new Date(Date.UTC(startYear, startMonth - 1, startDay));
        dObj.setUTCDate(dObj.getUTCDate() + val * 7);
        const y = dObj.getUTCFullYear();
        const m = String(dObj.getUTCMonth() + 1).padStart(2, '0');
        const d = String(dObj.getUTCDate()).padStart(2, '0');
        endStr = `${y}-${m}-${d}`;
        summary = `Por ${val} ${val === 1 ? 'semana' : 'semanas'} (hasta el ${formatBuenosAiresDate(`${endStr}T00:00:00-03:00`)})`;
      } else {
        // MONTHS
        const target = addCalendarMonths(startYear, startMonth, startDay, val);
        const m = String(target.month).padStart(2, '0');
        const d = String(target.day).padStart(2, '0');
        endStr = `${target.year}-${m}-${d}`;
        summary = `Por ${val} ${val === 1 ? 'mes' : 'meses'} (hasta el ${formatBuenosAiresDate(`${endStr}T00:00:00-03:00`)})`;
      }

      validUntilIso = new Date(`${endStr}T23:59:59.999-03:00`).toISOString();
      detail = `Válido desde el ${formatBuenosAiresDate(`${startStr}T00:00:00-03:00`)} hasta el ${formatBuenosAiresDate(`${endStr}T00:00:00-03:00`)} inclusive (23:59 hs).`;
      break;
    }

    case 'DATE_RANGE': {
      if (!input.endDate || !/^\d{4}-\d{2}-\d{2}$/.test(input.endDate)) {
        return {
          validFromIso,
          validUntilIso: null,
          startDateString: startStr,
          endDateString: null,
          summary: 'Fecha final requerida',
          detail: 'Debe seleccionar una fecha final para el rango de vigencia.',
          isValid: false,
          error: 'Debe seleccionar una fecha final.',
        };
      }

      endStr = input.endDate.trim();
      if (endStr < startStr) {
        return {
          validFromIso,
          validUntilIso: null,
          startDateString: startStr,
          endDateString: endStr,
          summary: 'Rango de fechas inválido',
          detail: 'La fecha final no puede ser anterior a la fecha de inicio.',
          isValid: false,
          error: 'La fecha final no puede ser anterior a la fecha de inicio.',
        };
      }

      validUntilIso = new Date(`${endStr}T23:59:59.999-03:00`).toISOString();
      summary = `Del ${formatBuenosAiresDate(`${startStr}T00:00:00-03:00`)} al ${formatBuenosAiresDate(`${endStr}T00:00:00-03:00`)}`;
      detail = `Válido desde el ${formatBuenosAiresDate(`${startStr}T00:00:00-03:00`)} hasta el ${formatBuenosAiresDate(`${endStr}T00:00:00-03:00`)} inclusive (23:59 hs).`;
      break;
    }
  }

  return {
    validFromIso,
    validUntilIso,
    startDateString: startStr,
    endDateString: endStr,
    summary,
    detail,
    isValid: true,
  };
}

/**
 * Computes the real-time business status of a benefit code:
 * - DELETED: if soft-deleted
 * - DISABLED: if manually disabled
 * - CONSUMED: if SINGLE_USE and consumed or used
 * - EXPIRED: if validUntil is in the past
 * - SCHEDULED: if validFrom is in the future
 * - ACTIVE: if valid and ready for bookings
 */
export function computeBenefitCodeStatus(
  item: {
    status?: string;
    usageMode?: BenefitUsageMode;
    validFrom?: string;
    validUntil?: string | null;
    deletedAt?: string | null;
    timesUsed?: number;
    maxUses?: number | null;
  },
  now: Date = new Date()
): BenefitCodeStatus {
  if (item.deletedAt) return 'DELETED';
  if (item.status === 'DISABLED') return 'DISABLED';

  const usageMode = item.usageMode || 'SINGLE_USE';
  if (usageMode === 'SINGLE_USE' && (item.status === 'CONSUMED' || (item.timesUsed ?? 0) > 0)) {
    return 'CONSUMED';
  }
  if (usageMode === 'LIMITED_USE') {
    const limit =
      typeof item.maxUses === 'number' && item.maxUses > 0
        ? item.maxUses
        : DEFAULT_LIMITED_USE_MAX_USES;
    if (item.status === 'CONSUMED' || (item.timesUsed ?? 0) >= limit) {
      return 'CONSUMED';
    }
  }

  const nowMs = now.getTime();

  if (item.validUntil) {
    const untilMs = new Date(item.validUntil).getTime();
    if (!Number.isNaN(untilMs) && untilMs < nowMs) {
      return 'EXPIRED';
    }
  }

  if (item.validFrom) {
    const fromMs = new Date(item.validFrom).getTime();
    if (!Number.isNaN(fromMs) && fromMs > nowMs) {
      return 'SCHEDULED';
    }
  }

  return 'ACTIVE';
}

/**
 * Pure calculation of benefit pricing and deposit according to Kani studio rules.
 * 
 * Rules:
 * - NO_DEPOSIT: discount = 0, final = original, online deposit = 0, balance = original. Button: "Reservar turno".
 * - FREE_SERVICE: discount = original, final = 0, online deposit = 0, balance = 0. Button: "Reservar turno".
 * - PERCENT_10: discount = 10% of original, final = original - discount.
 *               online deposit = min(standardDeposit, final).
 *               balance = final - online deposit. Button: "Pagar seña con tarjeta" (or "Reservar turno" if deposit is 0).
 * - PERCENT_50: discount = 50% of original, final = original - discount.
 *               online deposit = min(standardDeposit, final).
 *               balance = final - online deposit. Button: "Pagar seña con tarjeta" (or "Reservar turno" if deposit is 0).
 * 
 * Strict bounds:
 * - onlineDepositArs <= finalPriceArs.
 * - inPersonBalanceArs >= 0.
 * - If onlineDepositArs === 0 -> skipOnlinePayment = true.
 */
export function calculateBenefitAmounts(
  originalPriceArs: number,
  standardDepositArs: number,
  benefitType: BenefitCodeType,
  code: string = ''
): BenefitCalculation {
  const safeOriginal = Math.max(0, Math.round(originalPriceArs));
  const safeStandardDeposit = Math.max(0, Math.round(standardDepositArs));

  let discountAmountArs = 0;
  let finalPriceArs = safeOriginal;
  let onlineDepositArs = safeStandardDeposit;
  let explanation = '';

  switch (benefitType) {
    case 'NO_DEPOSIT':
      discountAmountArs = 0;
      finalPriceArs = safeOriginal;
      onlineDepositArs = 0;
      explanation = 'Reserva sin seña online. Abonás el total del servicio en el local.';
      break;

    case 'FREE_SERVICE':
      discountAmountArs = safeOriginal;
      finalPriceArs = 0;
      onlineDepositArs = 0;
      explanation = 'Servicio 100% bonificado. No requiere pago de seña ni saldo.';
      break;

    case 'PERCENT_10':
      discountAmountArs = Math.round(safeOriginal * 0.10);
      finalPriceArs = Math.max(0, safeOriginal - discountAmountArs);
      onlineDepositArs = Math.min(safeStandardDeposit, finalPriceArs);
      explanation = `Descuento del 10% aplicado (−$${discountAmountArs.toLocaleString('es-AR')}).`;
      break;

    case 'PERCENT_50':
      discountAmountArs = Math.round(safeOriginal * 0.50);
      finalPriceArs = Math.max(0, safeOriginal - discountAmountArs);
      onlineDepositArs = Math.min(safeStandardDeposit, finalPriceArs);
      explanation = `Descuento del 50% aplicado (−$${discountAmountArs.toLocaleString('es-AR')}).`;
      break;
  }

  // Cap online deposit to final price (cannot charge more than total)
  onlineDepositArs = Math.min(onlineDepositArs, finalPriceArs);
  const inPersonBalanceArs = Math.max(0, finalPriceArs - onlineDepositArs);
  const skipOnlinePayment = onlineDepositArs <= 0;
  const buttonLabel = skipOnlinePayment ? 'Reservar turno' : 'Pagar seña con tarjeta';

  return {
    code: normalizeBenefitCode(code),
    benefitType,
    benefitLabel: BENEFIT_TYPE_DEFINITIONS[benefitType].label,
    originalPriceArs: safeOriginal,
    discountAmountArs,
    finalPriceArs,
    onlineDepositArs,
    inPersonBalanceArs,
    skipOnlinePayment,
    buttonLabel,
    explanation,
  };
}
