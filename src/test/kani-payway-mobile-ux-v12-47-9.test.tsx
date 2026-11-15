import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('KANI — Optimización UX Mobile del Modal Payway (Footer Sticky, CVV/DNI 50/50, Aviso Compacto)', () => {
  const paywayPath = path.resolve(__dirname, '../components/kani/experimental/payway-booking.tsx');
  const reservaV4Path = path.resolve(__dirname, '../components/kani/experimental/reserva-v4.css');
  const liquidGlassPath = path.resolve(__dirname, '../components/kani/experimental/liquid-glass.css');
  const bookingPath = path.resolve(__dirname, '../components/kani/booking.tsx');
  const stylesPath = path.resolve(__dirname, '../styles.css');

  const paywayCode = fs.readFileSync(paywayPath, 'utf-8');
  const reservaV4Css = fs.readFileSync(reservaV4Path, 'utf-8');
  const liquidCss = fs.readFileSync(liquidGlassPath, 'utf-8');
  const bookingCode = fs.readFileSync(bookingPath, 'utf-8');
  const stylesCss = fs.readFileSync(stylesPath, 'utf-8');

  it('1. Mensaje de descuento no aplicado reducido a «Descuento no aplicado. Seña: $X» con ícono de advertencia y padding compacto', () => {
    expect(bookingCode).toContain("const INVALID_BENEFIT_PAYWAY_NOTICE = 'Descuento no aplicado.';");
    expect(paywayCode).toContain('{invalidBenefitNotice} Seña: <strong>{money(checkout?.depositArs ?? 5000)}</strong>');
    expect(paywayCode).toContain('payway-benefit-warning-icon');
    expect(liquidCss).toMatch(/\.payway-benefit-warning\s*\{[\s\S]*?padding:\s*6px 10px\s*!important;/);
  });

  it('2. Reorganiza CVV (50%) y DNI (50%) en fila compartida .payway-cvv-dni-row con labels independientes y ayuda integrada', () => {
    expect(paywayCode).toContain('className="payway-cvv-dni-row"');
    expect(paywayCode).toContain('payway-cvv-col');
    expect(paywayCode).toContain('payway-dni-col');
    expect(paywayCode).toContain('aria-label="Ayuda sobre el CVV"');

    // Orden: PAN -> Vencimiento -> CVV/DNI -> Titular
    const panIdx = paywayCode.indexOf('name="card_number"');
    const expIdx = paywayCode.indexOf('name="card_expiration_month"');
    const cvvIdx = paywayCode.indexOf('name="security_code"');
    const dniIdx = paywayCode.indexOf('name="card_holder_doc_number"');
    const holderIdx = paywayCode.indexOf('name="card_holder_name"');
    expect(panIdx).toBeGreaterThan(-1);
    expect(expIdx).toBeGreaterThan(panIdx);
    expect(cvvIdx).toBeGreaterThan(expIdx);
    expect(dniIdx).toBeGreaterThan(cvvIdx);
    expect(holderIdx).toBeGreaterThan(dniIdx);

    expect(reservaV4Css).toMatch(
      /\.payway-cvv-dni-row\s*\{[\s\S]*?display:\s*grid;[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\)\s+minmax\(0,\s*1fr\);/,
    );
  });

  it('3. Footer sticky (.payway-checkout-footer) mantiene visible «Pagar seña» separado del cuerpo scrolleable (.payway-checkout-body)', () => {
    expect(paywayCode).toContain('className="payway-checkout-header"');
    expect(paywayCode).toContain('className="payway-checkout-body"');
    expect(paywayCode).toContain('className="payway-checkout-footer"');

    const bodyIdx = paywayCode.indexOf('className="payway-checkout-body"');
    const footerIdx = paywayCode.indexOf('className="payway-checkout-footer"');
    const submitIdx = paywayCode.indexOf('className="action-positive payway-submit-btn"');
    expect(footerIdx).toBeGreaterThan(bodyIdx);
    expect(submitIdx).toBeGreaterThan(footerIdx);

    expect(liquidCss).toMatch(
      /\.payway-checkout:has\(\.payway-card-form\)\s*\{[\s\S]*?display:\s*flex\s*!important;[\s\S]*?flex-direction:\s*column\s*!important;[\s\S]*?overflow:\s*hidden\s*!important;/,
    );
    expect(liquidCss).toMatch(
      /\.payway-checkout:has\(\.payway-card-form\)\s+\.payway-checkout-body\s*\{[\s\S]*?overflow-y:\s*auto\s*!important;/,
    );
    expect(liquidCss).toMatch(
      /\.payway-checkout:has\(\.payway-card-form\)\s+\.payway-checkout-footer\s*\{[\s\S]*?flex:\s*0 0 auto\s*!important;/,
    );
  });

  it('4. Aprovecha altura útil con dvh y safe areas en mobile y conserva >= 16px en inputs de Payway para evitar zoom en iOS', () => {
    expect(liquidCss).toMatch(
      /@media\s*\(max-width:\s*640px\)[\s\S]*?\.payway-checkout:has\(\.payway-card-form\)[\s\S]*?max-height:\s*calc\(100dvh\s*-\s*max\(16px,\s*env\(safe-area-inset-top,\s*8px\)\)\s*-\s*max\(16px,\s*env\(safe-area-inset-bottom,\s*8px\)\)\)\s*!important;/,
    );
    expect(stylesCss).toMatch(
      /@media\s*\(max-width:\s*767px\),\s*\(hover:\s*none\)\s*and\s*\(pointer:\s*coarse\)[\s\S]*?font-size:\s*max\(16px,\s*1rem\)\s*!important;/,
    );
  });
});
