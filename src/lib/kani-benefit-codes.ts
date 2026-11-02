/**
 * Kani Barber Studio — Benefit & Discount Codes Engine
 * 
 * Defines the 4 official single-use benefit types:
 * - NO_DEPOSIT: "Reserva sin seña" (0 discount, $0 online deposit, full price paid in person)
 * - FREE_SERVICE: "Servicio gratuito" (100% discount, $0 deposit, $0 balance, $0 total, 0 monetary impact in accounting)
 * - PERCENT_10: "Descuento del 10 %" (10% off total, standard deposit forms part of final total)
 * - PERCENT_50: "Descuento del 50 %" (50% off total, standard deposit forms part of final total)
 * 
 * Strict invariants:
 * - Online deposit never exceeds final total price.
 * - In-person balance is never negative.
 * - When online deposit is $0, Payway checkout is omitted entirely.
 * - Single-use only; locked during checkout; consumed permanently upon appointment confirmation.
 * - When an appointment is cancelled, the benefit code remains CONSUMED and non-reusable.
 */

export type BenefitCodeType = 'NO_DEPOSIT' | 'FREE_SERVICE' | 'PERCENT_10' | 'PERCENT_50';

export type BenefitCodeStatus = 'ACTIVE' | 'LOCKED' | 'CONSUMED' | 'DISABLED';

export interface BenefitCodeItem {
  id: string;
  code: string;
  type: BenefitCodeType;
  internalNote?: string | null;
  status: BenefitCodeStatus;
  createdByUserId?: string | null;
  createdByDisplayName?: string | null;
  createdAt: string;
  updatedAt: string;
  consumedAt?: string | null;
  consumedAppointmentId?: string | null;
  consumedClientId?: string | null;
  // Details from consumed appointment (when joined)
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
      label: string;
      calculation: BenefitCalculation;
      message?: string;
    })
  | {
      valid: false;
      message: string;
      error?: string;
      type?: never;
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

/**
 * Normalizes user-entered benefit code:
 * Converts to uppercase, trims whitespace, collapses inner spacing.
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
 * Codes must be 4 to 32 alphanumeric characters or hyphens.
 */
export function isValidBenefitCodeFormat(code: string): boolean {
  const normalized = normalizeBenefitCode(code);
  return /^[A-Z0-9-]{4,32}$/.test(normalized);
}

/**
 * Generates an unguessable single-use benefit code:
 * Format: KANI-XXXX-XXXX using cryptographically secure random bytes
 * Alphabet excludes ambiguous characters (0, O, 1, I).
 */
export function generateBenefitCodeString(): string {
  const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  const getRandomChunk = (len: number) => {
    let result = '';
    const bytes = new Uint8Array(len);
    crypto.getRandomValues(bytes);
    for (let i = 0; i < len; i++) {
      result += chars[bytes[i] % chars.length];
    }
    return result;
  };
  return `KANI-${getRandomChunk(4)}-${getRandomChunk(4)}`;
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
