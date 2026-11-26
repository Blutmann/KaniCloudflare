import type { BenefitCodeType } from './kani-benefit-codes';

export type BookingPaymentGateway = 'DIRECT_ZERO_DEPOSIT' | 'MERCADO_PAGO' | 'PAYWAY';

export interface BookingPaymentRoutingInput {
  barberName?: string | null;
  benefitType?: BenefitCodeType | null;
  skipOnlinePayment?: boolean;
  onlineDepositArs?: number | null;
}

/**
 * Determines whether a barber's online booking deposits are processed via Mercado Pago (Checkout Pro).
 * Currently Gonzalo routes to Mercado Pago; Valentín and Lautaro remain on Payway.
 */
export function isMercadoPagoBarber(barberName?: string | null): boolean {
  if (!barberName) return false;
  return barberName.trim().toLowerCase() === 'gonzalo';
}

/**
 * Pure payment gateway router for the public /reservar booking flow.
 * Always evaluates against the final barber assigned to the appointment:
 * 1. If a $0 deposit benefit applies (NO_DEPOSIT, FREE_SERVICE, skipOnlinePayment, or onlineDepositArs <= 0) -> DIRECT_ZERO_DEPOSIT
 * 2. If the final barber is Gonzalo -> MERCADO_PAGO
 * 3. Otherwise (Valentín, Lautaro, etc.) -> PAYWAY
 */
export function resolveBookingPaymentGateway(input: BookingPaymentRoutingInput): BookingPaymentGateway {
  const isZeroDeposit =
    Boolean(input.skipOnlinePayment) ||
    input.benefitType === 'NO_DEPOSIT' ||
    input.benefitType === 'FREE_SERVICE' ||
    (typeof input.onlineDepositArs === 'number' &&
      Number.isFinite(input.onlineDepositArs) &&
      input.onlineDepositArs <= 0);

  if (isZeroDeposit) {
    return 'DIRECT_ZERO_DEPOSIT';
  }

  if (isMercadoPagoBarber(input.barberName)) {
    return 'MERCADO_PAGO';
  }

  return 'PAYWAY';
}
