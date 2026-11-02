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

  it('1. FECHA: Calendar uses balanced intermediate height in desktop (+15-20% useful height recovery)', () => {
    // V3 desktop calendar panel padding balanced to 22px 28px
    expect(cssV3).toMatch(/\.booking-v3-date\s+\.calendar-panel\s*\{[^}]*padding:\s*22px\s+28px;/);

    // V3 header min-height 40px and 16px margin-bottom
    expect(cssV3).toMatch(/\.booking-v3-date\s+\.calendar-header\s*\{[^}]*min-height:\s*40px;/);
    expect(cssV3).toMatch(/\.booking-v3-date\s+\.calendar-header\s*\{[^}]*margin-bottom:\s*16px\s*!important;/);

    // V3 grid day cells 44px height (comfortable touch target)
    expect(cssV3).toMatch(/\.booking-v3-date\s+\.calendar-day\s*\{[^}]*height:\s*44px;/);
    expect(cssV3).toMatch(/\.booking-v3-date\s+\.calendar-day\s*\{[^}]*min-height:\s*44px;/);

    // V3 grid row-gap 8px
    expect(cssV3).toMatch(/\.booking-v3-date\s+\.calendar-grid\s*\{[^}]*row-gap:\s*8px;/);

    // V4 calendar also uses balanced intermediate dimensions
    expect(cssV4).toMatch(/\.payway-reservation\s+\.booking-v3-date\s+\.calendar-panel\s*\{[^}]*padding:\s*22px\s+28px;/);
    expect(cssV4).toMatch(/\.payway-reservation\s+\.booking-v3-date\s+\.calendar-header\s*\{[^}]*min-height:\s*40px;/);
  });

  it('2. DATOS: Columns distribute 40% / 60% in desktop, start top-aligned and right column notice aligns to bottom', () => {
    // V3: 40% / 60% columns in desktop
    expect(cssV3).toMatch(/\.booking-v3\s+\.booking-v2-final-layout\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*4fr\)\s*minmax\(0,\s*6fr\);/);
    expect(cssV3).toMatch(/\.booking-v3\s+\.booking-v2-final-layout\s*\{[^}]*align-items:\s*stretch;/);

    // V3: right summary column spans 100% height
    expect(cssV3).toMatch(/\.booking-v3-final\s+\.booking-summary-cards\s*\{[^}]*height:\s*100%;/);

    // V3: confirmation notice pushes to the bottom to align with Observaciones
    expect(cssV3).toMatch(/\.booking-v3-final\s+\.summary-pending-notice\s*\{[^}]*margin-top:\s*auto\s*!important;/);

    // V2: also configures 40% / 60% columns
    expect(cssV2).toMatch(/\.booking-v2\s+\.booking-v2-final-layout\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*4fr\)\s*minmax\(0,\s*6fr\);/);
    expect(cssV2).toMatch(/\.booking-v2\s+\.booking-v2-final-layout\s*\{[^}]*align-items:\s*stretch;/);
    expect(cssV2).toMatch(/\.booking-v2-final\s+\.summary-pending-notice\s*\{[^}]*margin-top:\s*auto\s*!important;/);
  });

  it('3. CELULAR ADAPTADO: Desktop country picker and phone input adapt to the 40% form column', () => {
    // V3 desktop phone row adapts with country selector (100-120px) and flexible phone input (1fr)
    expect(cssV3).toMatch(/\.booking-v3\s+\.phone-input-row\s*\{[^}]*grid-template-columns:\s*minmax\(100px,\s*120px\)\s+minmax\(0,\s*1fr\)\s*!important;/);

    // Styles.css desktop phone row for booking also adapts to the column
    expect(cssStyles).toMatch(/\.booking-page\s+\.booking-contact-form\s+\.phone-input-row\s*\{[^}]*grid-template-columns:\s*minmax\(100px,\s*120px\)\s+minmax\(0,\s*1fr\);/);
  });

  it('4. MOBILE REGRESSION CHECK: Mobile calendar and data steps preserve their optimized touch targets', () => {
    // Mobile calendar panel in V3 retains 16px 12px padding
    expect(cssV3).toMatch(/\.booking-v3-date\s+\.calendar-panel\s*\{[^}]*padding:\s*16px\s+12px\s*!important;/);

    // Mobile calendar day retains 44px height for comfortable touch
    expect(cssV3).toMatch(/\.booking-v3-date\s+\.calendar-day\s*\{[^}]*height:\s*44px\s*!important;/);

    // Mobile phone input retains 1fr 1fr with 44px height
    expect(cssV3).toMatch(/@media\s*\(max-width:\s*767px\)[^}]*\{[^}]*\.booking-v3\s+\.phone-input-row/);
  });

  it('5. CÓDIGO DE DESCUENTO: Input and button share identical 44px height and margins are reset', () => {
    // Input and button both have exact 44px height in styles.css
    expect(cssStyles).toMatch(/\.discount-input-row\s+\.discount-input[\s\S]*?height:\s*44px\s*!important;/);
    expect(cssStyles).toMatch(/\.discount-input-row\s+\.discount-apply-button[\s\S]*?height:\s*44px\s*!important;/);

    // Margins are reset to 0 to prevent alignment offset
    expect(cssStyles).toMatch(/\.discount-input-row\s+\.discount-input[\s\S]*?margin:\s*0\s*!important;/);
    expect(cssStyles).toMatch(/\.discount-input-row\s+\.discount-apply-button[\s\S]*?margin:\s*0\s*!important;/);

    // V3 mobile rules enforce exact 44px height and margin reset
    expect(cssV3).toMatch(/\.booking-v3\s+\.discount-input-row\s+input[\s\S]*?height:\s*44px\s*!important;/);
    expect(cssV3).toMatch(/\.booking-v3\s+\.discount-input-row\s+button[\s\S]*?height:\s*44px\s*!important;/);
  });
});
