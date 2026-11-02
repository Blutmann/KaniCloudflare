import { describe, expect, it } from 'vitest';
import {
  calculateBenefitAmounts,
  generateBenefitCodeString,
  isValidBenefitCodeFormat,
  normalizeBenefitCode,
  type BenefitCodeType,
} from './kani-benefit-codes';

describe('Kani Benefit Codes Calculation Engine', () => {
  it('A. Reserva sin seña (NO_DEPOSIT): $30.000 servicio -> $0 seña, $0 descuento, $30.000 saldo local', () => {
    const calc = calculateBenefitAmounts(30000, 5000, 'NO_DEPOSIT', 'KANI-ABCD-1234');
    expect(calc.originalPriceArs).toBe(30000);
    expect(calc.discountAmountArs).toBe(0);
    expect(calc.finalPriceArs).toBe(30000);
    expect(calc.onlineDepositArs).toBe(0);
    expect(calc.inPersonBalanceArs).toBe(30000);
    expect(calc.skipOnlinePayment).toBe(true);
    expect(calc.buttonLabel).toBe('Reservar turno');
  });

  it('B. Servicio gratuito (FREE_SERVICE): $25.000 servicio -> $25.000 bonificación, $0 total, $0 seña, $0 saldo', () => {
    const calc = calculateBenefitAmounts(25000, 5000, 'FREE_SERVICE', 'KANI-FREE-100');
    expect(calc.originalPriceArs).toBe(25000);
    expect(calc.discountAmountArs).toBe(25000);
    expect(calc.finalPriceArs).toBe(0);
    expect(calc.onlineDepositArs).toBe(0);
    expect(calc.inPersonBalanceArs).toBe(0);
    expect(calc.skipOnlinePayment).toBe(true);
    expect(calc.buttonLabel).toBe('Reservar turno');
  });

  it('C. Descuento del 10 % (PERCENT_10): $30.000 servicio -> $3.000 desc, $27.000 total, $5.000 seña, $22.000 saldo', () => {
    const calc = calculateBenefitAmounts(30000, 5000, 'PERCENT_10', 'KANI-DESC-10');
    expect(calc.originalPriceArs).toBe(30000);
    expect(calc.discountAmountArs).toBe(3000);
    expect(calc.finalPriceArs).toBe(27000);
    expect(calc.onlineDepositArs).toBe(5000);
    expect(calc.inPersonBalanceArs).toBe(22000);
    expect(calc.skipOnlinePayment).toBe(false);
    expect(calc.buttonLabel).toBe('Pagar seña con tarjeta');
  });

  it('D. Descuento del 50 % (PERCENT_50): $25.000 servicio -> $12.500 desc, $12.500 total, $5.000 seña, $7.500 saldo', () => {
    const calc = calculateBenefitAmounts(25000, 5000, 'PERCENT_50', 'KANI-DESC-50');
    expect(calc.originalPriceArs).toBe(25000);
    expect(calc.discountAmountArs).toBe(12500);
    expect(calc.finalPriceArs).toBe(12500);
    expect(calc.onlineDepositArs).toBe(5000);
    expect(calc.inPersonBalanceArs).toBe(7500);
    expect(calc.skipOnlinePayment).toBe(false);
    expect(calc.buttonLabel).toBe('Pagar seña con tarjeta');
  });

  it('Regla cuando la seña supera el total final: la seña online nunca supera el total y saldo nunca es negativo', () => {
    // Servicio de $8.000 con 50% descuento -> total final $4.000. Seña habitual $5.000.
    const calc = calculateBenefitAmounts(8000, 5000, 'PERCENT_50');
    expect(calc.finalPriceArs).toBe(4000);
    expect(calc.onlineDepositArs).toBe(4000); // Topeado al total final
    expect(calc.inPersonBalanceArs).toBe(0);
    expect(calc.skipOnlinePayment).toBe(false);
  });

  it('Generación y normalización de códigos', () => {
    const code = generateBenefitCodeString();
    expect(code).toMatch(/^KANI-[2-9A-Z]{4}-[2-9A-Z]{4}$/);
    const randomSuffix = code.slice(5); // Ignorar el prefijo KANI-
    expect(randomSuffix).not.toMatch(/[01OI]/); // Caracteres ambiguos excluidos
    expect(isValidBenefitCodeFormat(code)).toBe(true);

    expect(normalizeBenefitCode(' kani-abcd-1234 ')).toBe('KANI-ABCD-1234');
    expect(normalizeBenefitCode('kani abcd 1234')).toBe('KANI-ABCD-1234');
    expect(isValidBenefitCodeFormat('KANI-9X2M-7B4K')).toBe(true);
    expect(isValidBenefitCodeFormat('ab')).toBe(false); // muy corto
  });
});
