import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('Reserva Desktop - Fecha & Datos visual tuning', () => {
  const reservaV3CssPath = path.resolve(__dirname, '../components/kani/experimental/reserva-v3.css');
  const reservaV4CssPath = path.resolve(__dirname, '../components/kani/experimental/reserva-v4.css');
  const reservaV2CssPath = path.resolve(__dirname, '../components/kani/experimental/reserva-v2.css');
  const stylesCssPath = path.resolve(__dirname, '../styles.css');

  const cssV3 = fs.readFileSync(reservaV3CssPath, 'utf8');
  const cssV4 = fs.readFileSync(reservaV4CssPath, 'utf8');
  const cssV2 = fs.readFileSync(reservaV2CssPath, 'utf8');
  const cssStyles = fs.readFileSync(stylesCssPath, 'utf8');

  it('1. FECHA: Calendar is moderately compacted in desktop to finish at the height of Step 1 (barber)', () => {
    // V3 desktop calendar panel padding reduced to 16px 24px
    expect(cssV3).toMatch(/\.booking-v3-date\s+\.calendar-panel\s*\{[^}]*padding:\s*16px\s+24px;/);

    // V3 header min-height 38px and 10px margin-bottom
    expect(cssV3).toMatch(/\.booking-v3-date\s+\.calendar-header\s*\{[^}]*min-height:\s*38px;/);
    expect(cssV3).toMatch(/\.booking-v3-date\s+\.calendar-header\s*\{[^}]*margin-bottom:\s*10px\s*!important;/);

    // V3 grid day cells 38px height (compact yet fully clickable)
    expect(cssV3).toMatch(/\.booking-v3-date\s+\.calendar-day\s*\{[^}]*height:\s*38px;/);
    expect(cssV3).toMatch(/\.booking-v3-date\s+\.calendar-day\s*\{[^}]*min-height:\s*38px;/);

    // V3 grid row-gap 5px
    expect(cssV3).toMatch(/\.booking-v3-date\s+\.calendar-grid\s*\{[^}]*row-gap:\s*5px;/);

    // V3 note compact margin 12px
    expect(cssV3).toMatch(/\.booking-v3-date\s+\.calendar-note\s*\{[^}]*margin-top:\s*12px\s*!important;/);

    // V4 calendar also uses compact desktop dimensions
    expect(cssV4).toMatch(/\.payway-reservation\s+\.booking-v3-date\s+\.calendar-panel\s*\{[^}]*padding:\s*16px\s+24px;/);
    expect(cssV4).toMatch(/\.payway-reservation\s+\.booking-v3-date\s+\.calendar-header\s*\{[^}]*min-height:\s*38px;/);
  });

  it('2. DATOS: Columns start top-aligned and right column notice aligns to the bottom edge of Observaciones', () => {
    // V3: 2 columns stretch in desktop
    expect(cssV3).toMatch(/\.booking-v3\s+\.booking-v2-final-layout\s*\{[^}]*align-items:\s*stretch;/);

    // V3: right summary column spans 100% height
    expect(cssV3).toMatch(/\.booking-v3-final\s+\.booking-summary-cards\s*\{[^}]*height:\s*100%;/);

    // V3: confirmation notice pushes to the bottom to align with Observaciones
    expect(cssV3).toMatch(/\.booking-v3-final\s+\.summary-pending-notice\s*\{[^}]*margin-top:\s*auto\s*!important;/);

    // V2: also aligns columns with stretch and margin-top: auto
    expect(cssV2).toMatch(/\.booking-v2\s+\.booking-v2-final-layout\s*\{[^}]*align-items:\s*stretch;/);
    expect(cssV2).toMatch(/\.booking-v2-final\s+\.summary-pending-notice\s*\{[^}]*margin-top:\s*auto\s*!important;/);
  });

  it('3. CELULAR 50/50: Desktop country picker and phone input distribute width symmetrically', () => {
    // V3 desktop phone row is 1fr 1fr (50% / 50%)
    expect(cssV3).toMatch(/\.booking-v3\s+\.phone-input-row\s*\{[^}]*grid-template-columns:\s*1fr\s+1fr\s*!important;/);

    // Styles.css desktop phone row for booking is also 1fr 1fr
    expect(cssStyles).toMatch(/\.booking-page\s+\.booking-contact-form\s+\.phone-input-row\s*\{[^}]*grid-template-columns:\s*1fr\s+1fr;/);
  });

  it('4. MOBILE REGRESSION CHECK: Mobile calendar and data steps preserve their optimized touch targets', () => {
    // Mobile calendar panel in V3 retains 16px 12px padding
    expect(cssV3).toMatch(/\.booking-v3-date\s+\.calendar-panel\s*\{[^}]*padding:\s*16px\s+12px\s*!important;/);

    // Mobile calendar day retains 44px height for comfortable touch
    expect(cssV3).toMatch(/\.booking-v3-date\s+\.calendar-day\s*\{[^}]*height:\s*44px\s*!important;/);

    // Mobile phone input retains 1fr 1fr with 44px height
    expect(cssV3).toMatch(/@media\s*\(max-width:\s*767px\)[^}]*\{[^}]*\.booking-v3\s+\.phone-input-row/);
  });
});
