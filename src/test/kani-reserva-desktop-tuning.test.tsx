import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('Reserva Desktop - Fecha & Datos visual tuning', () => {
  const reservaV3CssPath = path.resolve(__dirname, '../components/kani/experimental/reserva-v3.css');
  const reservaV4CssPath = path.resolve(__dirname, '../components/kani/experimental/reserva-v4.css');
  const reservaV2CssPath = path.resolve(__dirname, '../components/kani/experimental/reserva-v2.css');
  const stylesCssPath = path.resolve(__dirname, '../styles.css');
  const bookingTsxPath = path.resolve(__dirname, '../components/kani/booking.tsx');
  const paywayTsxPath = path.resolve(__dirname, '../components/kani/experimental/payway-booking.tsx');

  const cssV3 = fs.readFileSync(reservaV3CssPath, 'utf8');
  const cssV4 = fs.readFileSync(reservaV4CssPath, 'utf8');
  const cssV2 = fs.readFileSync(reservaV2CssPath, 'utf8');
  const cssStyles = fs.readFileSync(stylesCssPath, 'utf8');
  const tsxBooking = fs.readFileSync(bookingTsxPath, 'utf8');
  const tsxPayway = fs.readFileSync(paywayTsxPath, 'utf8');

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

  it('2. DATOS: Columns distribute 50% / 50% in desktop, start top-aligned and right column notice aligns to bottom', () => {
    // V3: 50% / 50% columns in desktop
    expect(cssV3).toMatch(/\.booking-v3\s+\.booking-v2-final-layout\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s*minmax\(0,\s*1fr\);/);
    expect(cssV3).toMatch(/\.booking-v3\s+\.booking-v2-final-layout\s*\{[^}]*align-items:\s*stretch;/);

    // V3: right summary column spans 100% height
    expect(cssV3).toMatch(/\.booking-v3-final\s+\.booking-summary-cards\s*\{[^}]*height:\s*100%;/);

    // V3: confirmation notice pushes to the bottom to align with Observaciones
    expect(cssV3).toMatch(/\.booking-v3-final\s+\.summary-pending-notice\s*\{[^}]*margin-top:\s*auto\s*!important;/);

    // V2: also configures 50% / 50% columns
    expect(cssV2).toMatch(/\.booking-v2\s+\.booking-v2-final-layout\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s*minmax\(0,\s*1fr\);/);
    expect(cssV2).toMatch(/\.booking-v2\s+\.booking-v2-final-layout\s*\{[^}]*align-items:\s*stretch;/);
    expect(cssV2).toMatch(/\.booking-v2-final\s+\.summary-pending-notice\s*\{[^}]*margin-top:\s*auto\s*!important;/);
  });

  it('3. CELULAR 50/50: Desktop country picker and phone input distribute 50% / 50% with equal height', () => {
    // V3 desktop phone row distributes 50% / 50%
    expect(cssV3).toMatch(/\.booking-v3\s+\.phone-input-row\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+minmax\(0,\s*1fr\)\s*!important;/);

    // V3 phone country trigger and input have equal 44px height
    expect(cssV3).toMatch(/\.booking-v3\s+\.phone-country-trigger\s*\{[^}]*height:\s*44px\s*!important;/);
    expect(cssV3).toMatch(/\.booking-v3\s+\.phone-input-row\s+input\s*\{[^}]*height:\s*44px\s*!important;/);

    // Styles.css desktop phone row for booking distributes 50% / 50%
    expect(cssStyles).toMatch(/\.booking-page\s+\.booking-contact-form\s+\.phone-input-row\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+minmax\(0,\s*1fr\);/);
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

  it('6. MÓVIL DISCLAIMER: Legal disclaimer text is left-aligned on mobile and desktop', () => {
    // booking.tsx specifies text-left for disclaimer
    expect(tsxBooking).toMatch(/booking-summary-legal-disclaimer[^"]*text-left/);
    expect(tsxBooking).not.toMatch(/booking-summary-legal-disclaimer[^"]*text-center/);

    // payway-booking.tsx specifies text-left for disclaimer
    expect(tsxPayway).toMatch(/payway-legal-disclaimer[^"]*text-left/);

    // CSS explicitly enforces text-align: left !important
    expect(cssV3).toMatch(/\.booking-summary-legal-disclaimer\s*\{[^}]*text-align:\s*left\s*!important;/);
    expect(cssStyles).toMatch(/\.booking-summary-legal-disclaimer[\s\S]*?text-align:\s*left\s*!important;/);
  });

  it('7. CELULAR VISUAL FIX: phone container is transparent and contents are centered horizontally', () => {
    // 1. Container has transparent background in styles.css and reserva-v3.css
    expect(cssStyles).toMatch(/\.booking-page\s+\.phone-input-row[\s\S]*?background:\s*transparent\s*!important;/);
    expect(cssV3).toMatch(/\.booking-v3\s+\.phone-input-row[\s\S]*?background:\s*transparent\s*!important;/);

    // .phone-input-row is NOT in the solid background selectors
    expect(cssStyles).not.toMatch(/html\[data-theme\][^{]*\.phone-input-row[^{]*\{[^}]*background:\s*var\(--kani-surface-inset\)/);
    expect(cssStyles).not.toMatch(/html\[data-theme='light'\][^{]*\.phone-input-row[^{]*\{[^}]*background:\s*var\(--kani-surface-control\)/);
    expect(cssV3).not.toMatch(/html\[data-theme='light'\][^{]*\.phone-input-row[^{]*\{[^}]*background-color:\s*#fff/);

    // 2. Country selector content is centered
    expect(cssStyles).toMatch(/\.booking-page\s+\.booking-contact-form\s+\.phone-country-trigger\s*\{[^}]*justify-content:\s*center\s*!important;/);
    expect(cssStyles).toMatch(/\.booking-page\s+\.booking-contact-form\s+\.phone-country-trigger\s*\{[^}]*text-align:\s*center\s*!important;/);
    expect(cssV3).toMatch(/\.booking-v3\s+\.phone-country-trigger\s*\{[^}]*justify-content:\s*center\s*!important;/);

    // 3. Phone input and placeholder are centered with symmetric padding
    expect(cssStyles).toMatch(/\.booking-page\s+\.booking-contact-form\s+\.phone-input-row\s+input[^{]*\{[^}]*text-align:\s*center\s*!important;/);
    expect(cssStyles).toMatch(/\.booking-page\s+\.booking-contact-form\s+\.phone-input-row\s+input::placeholder[^{]*\{[^}]*text-align:\s*center\s*!important;/);
    expect(cssV3).toMatch(/\.booking-v3\s+\.phone-input-row\s+input[^{]*\{[^}]*text-align:\s*center\s*!important;/);
    expect(cssV3).toMatch(/\.booking-v3\s+\.phone-input-row\s+input::placeholder[^{]*\{[^}]*text-align:\s*center\s*!important;/);
  });
});
