import cardValidator from 'card-validator';

// Ensure Cabal is registered in card-validator's creditCardType
const cct = ((cardValidator as unknown as { creditCardType: { default?: typeof cardValidator.creditCardType } & typeof cardValidator.creditCardType }).creditCardType.default ||
  cardValidator.creditCardType);

if (typeof cct?.addCard === 'function') {
  try {
    cct.addCard({
      niceType: 'Cabal',
      type: 'cabal',
      patterns: [589657, [604200, 604399], 6042, 6043],
      gaps: [4, 8, 12],
      lengths: [16],
      code: { name: 'CVV', size: 3 },
      matchStrength: 3,
    });
  } catch {
    // Card already added or modified in runtime
  }
}

export type SupportedCardBrand = 'visa' | 'mastercard' | 'cabal' | 'american-express';

export interface CardDetectionResult {
  rawBrand: string | null;
  niceType: string;
  brand: SupportedCardBrand | 'other' | null;
  isSupported: boolean;
  methodId: number | null;
  gaps: number[];
  lengths: number[];
  codeSize: number;
}

export interface ConfiguredPaymentMethod {
  id: number;
  label: string;
}

/**
 * Normalizes card brand string to supported brand or 'other'.
 */
export function normalizeCardBrand(type: string | null | undefined): SupportedCardBrand | 'other' | null {
  if (!type) return null;
  const lower = type.toLowerCase();
  if (lower.includes('visa')) return 'visa';
  if (lower.includes('mastercard') || lower.includes('master-card')) return 'mastercard';
  if (lower.includes('cabal')) return 'cabal';
  if (lower.includes('american-express') || lower.includes('amex')) return 'american-express';
  return 'other';
}

/**
 * Finds matching payment_method_id from configured methods for a given card brand.
 */
export function matchPaymentMethodId(
  brand: SupportedCardBrand | 'other' | null,
  configuredMethods: ConfiguredPaymentMethod[]
): number | null {
  if (!brand || brand === 'other' || !Array.isArray(configuredMethods)) return null;

  for (const method of configuredMethods) {
    const label = method.label.toLowerCase();
    if (brand === 'visa' && /\bvisa\b/i.test(label)) return method.id;
    if (brand === 'mastercard' && /\bmastercard\b/i.test(label)) return method.id;
    if (brand === 'cabal' && /\bcabal\b/i.test(label)) return method.id;
    if (brand === 'american-express' && /\b(amex|american\s*express)\b/i.test(label)) return method.id;
  }

  return null;
}

/**
 * Detects card network and information from digits.
 */
export function detectCardNetwork(
  panOrDigits: string,
  configuredMethods: ConfiguredPaymentMethod[] = []
): CardDetectionResult {
  const digits = panOrDigits.replace(/\D/g, '');
  const numberValidation = cardValidator.number(digits);
  const card = numberValidation.card;

  const rawBrand = card?.type ?? null;
  const niceType = card?.niceType ?? (digits.length >= 1 ? 'Tarjeta' : '');
  const brand = normalizeCardBrand(rawBrand);
  const methodId = matchPaymentMethodId(brand, configuredMethods);
  const isSupported = methodId !== null;

  return {
    rawBrand,
    niceType,
    brand,
    isSupported,
    methodId,
    gaps: card?.gaps ?? [4, 8, 12],
    lengths: card?.lengths ?? [16],
    codeSize: card?.code?.size ?? 3,
  };
}

/**
 * Formats PAN with spaces according to gaps.
 */
export function formatCardPan(value: string, gaps: number[] = [4, 8, 12]): string {
  const digits = value.replace(/\D/g, '');
  if (!digits) return '';

  const parts: string[] = [];
  let prev = 0;
  for (const gap of gaps) {
    if (digits.length > gap) {
      parts.push(digits.slice(prev, gap));
      prev = gap;
    } else {
      break;
    }
  }
  parts.push(digits.slice(prev));

  return parts.filter(Boolean).join(' ');
}

/**
 * Validates PAN completely:
 * - Empty check
 * - Length check
 * - Luhn algorithm check
 * - Network supported check
 */
export function validatePan(
  pan: string,
  detected: CardDetectionResult,
  configuredMethods: ConfiguredPaymentMethod[]
): {
  status: 'idle' | 'valid' | 'invalid';
  errorMessage: string | null;
} {
  const digits = pan.replace(/\D/g, '');
  if (!digits) {
    return { status: 'idle', errorMessage: null };
  }

  const numberValidation = cardValidator.number(digits);

  // Still typing / incomplete
  const minLength = detected.lengths[0] ?? 16;
  const maxLength = detected.lengths[detected.lengths.length - 1] ?? 19;

  if (digits.length < minLength) {
    return { status: 'idle', errorMessage: null };
  }

  // Length is sufficient, now verify Luhn & validity
  if (!numberValidation.isValid || digits.length > maxLength) {
    return { status: 'invalid', errorMessage: 'Número de tarjeta inválido.' };
  }

  // Network must be supported in configured methods
  if (!detected.isSupported) {
    return { status: 'invalid', errorMessage: 'Esta tarjeta no está disponible como medio de pago.' };
  }

  return { status: 'valid', errorMessage: null };
}

/**
 * Formats DNI with dots (e.g. 40.123.456).
 */
export function formatDni(dni: string): string {
  const digits = dni.replace(/\D/g, '').slice(0, 10);
  if (!digits) return '';
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

/**
 * Validates DNI:
 * Must have between 6 and 10 digits.
 */
export function validateDni(dni: string): {
  status: 'idle' | 'valid' | 'invalid';
  errorMessage: string | null;
} {
  const digits = dni.replace(/\D/g, '');
  if (!digits) return { status: 'idle', errorMessage: null };
  if (digits.length >= 6 && digits.length <= 10) {
    return { status: 'valid', errorMessage: null };
  }
  return { status: 'invalid', errorMessage: 'Ingresá un DNI válido.' };
}

/**
 * Validates Security Code (CVV).
 */
export function validateCvv(cvv: string, expectedLength = 3): {
  status: 'idle' | 'valid' | 'invalid';
  errorMessage: string | null;
} {
  const digits = cvv.replace(/\D/g, '');
  if (!digits) return { status: 'idle', errorMessage: null };
  if (digits.length === expectedLength) {
    return { status: 'valid', errorMessage: null };
  }
  return {
    status: 'invalid',
    errorMessage: `Ingresá los ${expectedLength} dígitos de seguridad.`,
  };
}

/**
 * Validates Cardholder Name.
 */
export function validateCardholder(name: string): {
  status: 'idle' | 'valid' | 'invalid';
  errorMessage: string | null;
} {
  const trimmed = name.trim();
  if (!trimmed) return { status: 'idle', errorMessage: null };
  if (trimmed.length < 3) {
    return { status: 'invalid', errorMessage: 'Ingresá el nombre como figura en la tarjeta.' };
  }
  return { status: 'valid', errorMessage: null };
}

/**
 * Validates Expiry Month and Year.
 */
export function validateExpiry(
  month: string,
  year: string,
  now = new Date()
): {
  status: 'idle' | 'valid' | 'invalid';
  errorMessage: string | null;
} {
  if (!month || !year) return { status: 'idle', errorMessage: null };

  const m = parseInt(month, 10);
  const y = parseInt(year.length === 2 ? `20${year}` : year, 10);

  if (isNaN(m) || isNaN(y) || m < 1 || m > 12) {
    return { status: 'invalid', errorMessage: 'Fecha de vencimiento inválida.' };
  }

  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1; // 1-indexed

  if (y < currentYear || (y === currentYear && m < currentMonth)) {
    return { status: 'invalid', errorMessage: 'La tarjeta está vencida.' };
  }

  return { status: 'valid', errorMessage: null };
}

/**
 * Generates month options with labels like "Enero (01)".
 */
export const MONTH_OPTIONS = [
  { value: '01', label: 'Enero (01)', num: 1 },
  { value: '02', label: 'Febrero (02)', num: 2 },
  { value: '03', label: 'Marzo (03)', num: 3 },
  { value: '04', label: 'Abril (04)', num: 4 },
  { value: '05', label: 'Mayo (05)', num: 5 },
  { value: '06', label: 'Junio (06)', num: 6 },
  { value: '07', label: 'Julio (07)', num: 7 },
  { value: '08', label: 'Agosto (08)', num: 8 },
  { value: '09', label: 'Septiembre (09)', num: 9 },
  { value: '10', label: 'Octubre (10)', num: 10 },
  { value: '11', label: 'Noviembre (11)', num: 11 },
  { value: '12', label: 'Diciembre (12)', num: 12 },
];

/**
 * Generates dynamic year options from currentYear to currentYear + 20.
 */
export function getYearOptions(now = new Date()): { value: string; label: string; fullYear: number }[] {
  const currentYear = now.getFullYear();
  const years: { value: string; label: string; fullYear: number }[] = [];
  for (let i = 0; i <= 20; i++) {
    const fullYear = currentYear + i;
    const value = String(fullYear).slice(-2);
    years.push({ value, label: String(fullYear), fullYear });
  }
  return years;
}
