import { describe, expect, it } from 'vitest';
import {
  detectCardNetwork,
  formatCardPan,
  formatDni,
  getYearOptions,
  MONTH_OPTIONS,
  validateCardholder,
  validateCvv,
  validateDni,
  validateExpiry,
  validatePan,
} from '@/lib/kani-card-validation';

describe('Card validation and detection utilities', () => {
  const configuredMethods = [
    { id: 1, label: 'Visa' },
    { id: 104, label: 'Mastercard' },
    { id: 63, label: 'Cabal' },
  ];

  it('detects Visa card and maps to payment_method_id 1', () => {
    const res = detectCardNetwork('4507 9900 0000 4905', configuredMethods);
    expect(res.brand).toBe('visa');
    expect(res.isSupported).toBe(true);
    expect(res.methodId).toBe(1);
    expect(res.codeSize).toBe(3);
  });

  it('detects Mastercard card and maps to payment_method_id 104', () => {
    const res = detectCardNetwork('541234', configuredMethods);
    expect(res.brand).toBe('mastercard');
    expect(res.isSupported).toBe(true);
    expect(res.methodId).toBe(104);
  });

  it('detects Cabal card (589657) and maps to payment_method_id 63', () => {
    const res = detectCardNetwork('589657', configuredMethods);
    expect(res.brand).toBe('cabal');
    expect(res.isSupported).toBe(true);
    expect(res.methodId).toBe(63);
  });

  it('detects Cabal card (6042) and maps to payment_method_id 63', () => {
    const res = detectCardNetwork('6042', configuredMethods);
    expect(res.brand).toBe('cabal');
    expect(res.isSupported).toBe(true);
    expect(res.methodId).toBe(63);
  });

  it('detects American Express as unsupported when not in configuredMethods', () => {
    const res = detectCardNetwork('378282', configuredMethods);
    expect(res.brand).toBe('american-express');
    expect(res.isSupported).toBe(false);
    expect(res.methodId).toBeNull();
    expect(res.codeSize).toBe(4);
  });

  it('formats PAN with standard gaps (4 4 4 4)', () => {
    expect(formatCardPan('4507990000004905')).toBe('4507 9900 0000 4905');
    expect(formatCardPan('4507 9900')).toBe('4507 9900');
  });

  it('formats PAN for Amex gaps (4 6 5)', () => {
    expect(formatCardPan('378282246310005', [4, 10])).toBe('3782 822463 10005');
  });

  it('validates PAN with Luhn and network support', () => {
    const detectedVisa = detectCardNetwork('4507990000004905', configuredMethods);
    const validRes = validatePan('4507990000004905', detectedVisa, configuredMethods);
    expect(validRes.status).toBe('valid');
    expect(validRes.errorMessage).toBeNull();

    // Incomplete PAN is idle
    const incompleteRes = validatePan('450799', detectedVisa, configuredMethods);
    expect(incompleteRes.status).toBe('idle');

    // Invalid Luhn
    const invalidLuhnRes = validatePan('4507990000004906', detectedVisa, configuredMethods);
    expect(invalidLuhnRes.status).toBe('invalid');
    expect(invalidLuhnRes.errorMessage).toBe('Número de tarjeta inválido.');

    // Unsupported network (Amex with fake Luhn)
    const detectedAmex = detectCardNetwork('378282246310005', configuredMethods);
    const unsupportedRes = validatePan('378282246310005', detectedAmex, configuredMethods);
    expect(unsupportedRes.status).toBe('invalid');
    expect(unsupportedRes.errorMessage).toBe('Esta tarjeta no está disponible como medio de pago.');
  });

  it('formats and validates DNI', () => {
    expect(formatDni('40123456')).toBe('40.123.456');
    expect(validateDni('40.123.456').status).toBe('valid');
    expect(validateDni('12345').status).toBe('invalid');
    expect(validateDni('').status).toBe('idle');
  });

  it('validates CVV according to codeSize', () => {
    expect(validateCvv('123', 3).status).toBe('valid');
    expect(validateCvv('12', 3).status).toBe('invalid');
    expect(validateCvv('1234', 4).status).toBe('valid');
    expect(validateCvv('123', 4).status).toBe('invalid');
  });

  it('validates cardholder name', () => {
    expect(validateCardholder('Juan Perez').status).toBe('valid');
    expect(validateCardholder('J').status).toBe('invalid');
    expect(validateCardholder('').status).toBe('idle');
  });

  it('validates expiry against current date', () => {
    const fixedNow = new Date('2026-10-15T00:00:00Z');
    // Future month in current year
    expect(validateExpiry('11', '26', fixedNow).status).toBe('valid');
    // Current month in current year
    expect(validateExpiry('10', '26', fixedNow).status).toBe('valid');
    // Past month in current year
    expect(validateExpiry('09', '26', fixedNow).status).toBe('invalid');
    expect(validateExpiry('09', '26', fixedNow).errorMessage).toBe('La tarjeta está vencida.');
    // Future year
    expect(validateExpiry('01', '27', fixedNow).status).toBe('valid');
    // Past year
    expect(validateExpiry('12', '25', fixedNow).status).toBe('invalid');
  });

  it('provides month options with 12 months in Spanish', () => {
    expect(MONTH_OPTIONS).toHaveLength(12);
    expect(MONTH_OPTIONS[0].label).toBe('Enero (01)');
    expect(MONTH_OPTIONS[11].label).toBe('Diciembre (12)');
  });

  it('provides dynamic year options up to currentYear + 20', () => {
    const fixedNow = new Date('2026-10-15T00:00:00Z');
    const years = getYearOptions(fixedNow);
    expect(years).toHaveLength(21);
    expect(years[0].label).toBe('2026');
    expect(years[0].value).toBe('26');
    expect(years[20].label).toBe('2046');
    expect(years[20].value).toBe('46');
  });
});
