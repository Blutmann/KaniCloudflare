import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('Reserva V4 UI Mobile - Calendar, Horario Title and Barber Spacing', () => {
  const reservaV4CssPath = path.resolve(__dirname, '../components/kani/experimental/reserva-v4.css');
  const reservaV5CssPath = path.resolve(__dirname, '../components/kani/experimental/reserva-v5.css');
  const cssV4 = fs.readFileSync(reservaV4CssPath, 'utf-8');
  const cssV5 = fs.readFileSync(reservaV5CssPath, 'utf-8');

  it('1. CALENDARIO: Mes utiliza font-weight regular (400) dinámicamente en desktop y mobile', () => {
    // Desktop: 19px y font-weight: 400 !important
    expect(cssV4).toMatch(
      /\.payway-reservation\s+\.booking-v3-date\s+\.calendar-header\s+h2\s*\{[^}]*font-size:\s*19px;[^}]*font-weight:\s*400\s*!important;/
    );

    // Mobile (< 768px): 16px y font-weight: 400 !important
    expect(cssV4).toMatch(
      /@media\s*\(max-width:\s*767px\)[\s\S]*?\.payway-reservation\s+\.booking-v3-date\s+\.calendar-header\s+h2\s*\{[^}]*font-size:\s*16px;[^}]*font-weight:\s*400\s*!important;/
    );
  });

  it('2. HORARIOS: "Elegí un horario" comparte exactamente la misma tipografía y escala de los demás pasos', () => {
    // Mobile: 22px display font con font-weight 500 y line-height 1.2 unificado con el resto de pasos
    expect(cssV4).toMatch(
      /\.payway-reservation\s+\.booking-page\s+\.booking-title-row\.booking-time-heading\s+\.section-title\s*\{[\s\S]*?font-family:\s*var\(--font-display\)\s*!important;/
    );
    expect(cssV4).toMatch(
      /\.payway-reservation\s+\.booking-page\s+\.booking-title-row\.booking-time-heading\s+\.section-title\s*\{[\s\S]*?font-size:\s*22px\s*!important;/
    );
    expect(cssV4).toMatch(
      /\.payway-reservation\s+\.booking-page\s+\.booking-title-row\.booking-time-heading\s+\.section-title\s*\{[\s\S]*?font-weight:\s*500\s*!important;/
    );
    expect(cssV4).toMatch(
      /\.payway-reservation\s+\.booking-page\s+\.booking-title-row\.booking-time-heading\s+\.section-title\s*\{[\s\S]*?line-height:\s*1\.2\s*!important;/
    );

    // Desktop: 28px
    expect(cssV4).toMatch(
      /@media\s*\(min-width:\s*768px\)[\s\S]*?\.payway-reservation\s+\.booking-page\s+\.booking-title-row\.booking-time-heading\s+\.section-title\s*\{[^}]*font-size:\s*28px\s*!important;/
    );
  });

  it('3. HORARIOS: Distribución responsive en mobile previene overflow y preserva fecha secundaria', () => {
    // Flex-wrap con row-gap y column-gap para acomodación en 360px
    expect(cssV4).toMatch(
      /\.payway-reservation\s+\.booking-page\s+\.booking-title-row\.booking-time-heading\s*\{[\s\S]*?flex-wrap:\s*wrap\s*!important;/
    );
    expect(cssV4).toMatch(
      /\.payway-reservation\s+\.booking-page\s+\.booking-title-row\.booking-time-heading\s*\{[\s\S]*?row-gap:\s*6px\s*!important;/
    );
    expect(cssV4).toMatch(
      /\.payway-reservation\s+\.booking-page\s+\.booking-title-row\.booking-time-heading\s*\{[\s\S]*?column-gap:\s*8px\s*!important;/
    );

    // Fecha secundaria mantiene su tamaño y estilo visual secundario
    expect(cssV4).toMatch(
      /\.payway-reservation\s+\.booking-page\s+\.booking-title-row\.booking-time-heading\s+\.booking-time-heading-date\s*\{[\s\S]*?font-size:\s*13\.5px\s*!important;/
    );
    expect(cssV4).toMatch(
      /\.payway-reservation\s+\.booking-page\s+\.booking-title-row\.booking-time-heading\s+\.booking-time-heading-date\s*\{[\s\S]*?color:\s*var\(--muted-foreground\)\s*!important;/
    );
  });

  it('4. SELECCIÓN DE BARBERO: Espaciado vertical ampliado (12 a 20px de separación adicional)', () => {
    // Mobile: margin-top: 24px (+8px sobre mt-4 16px) y padding-top: 20px (+8px sobre pt-3 12px) = +16px incremento total
    expect(cssV4).toMatch(
      /\.payway-reservation:not\(\.reserva-v5\)\s+\.barber-choice-inline\s*\{[\s\S]*?margin-top:\s*24px\s*!important;/
    );
    expect(cssV4).toMatch(
      /\.payway-reservation:not\(\.reserva-v5\)\s+\.barber-choice-inline\s*\{[\s\S]*?padding-top:\s*20px\s*!important;/
    );

    // Separación del título respecto a las tarjetas: margin-bottom: 14px (+4px sobre mb-2.5 10px)
    expect(cssV4).toMatch(
      /\.payway-reservation:not\(\.reserva-v5\)\s+\.barber-choice-inline\s+h2\s*\{[\s\S]*?margin-bottom:\s*14px\s*!important;/
    );

    // Desktop: margin-top: 28px, padding-top: 24px, margin-bottom: 16px
    expect(cssV4).toMatch(
      /@media\s*\(min-width:\s*768px\)[\s\S]*?\.payway-reservation:not\(\.reserva-v5\)\s+\.barber-choice-inline\s*\{[^}]*margin-top:\s*28px\s*!important;/
    );
    expect(cssV4).toMatch(
      /@media\s*\(min-width:\s*768px\)[\s\S]*?\.payway-reservation:not\(\.reserva-v5\)\s+\.barber-choice-inline\s*\{[^}]*padding-top:\s*24px\s*!important;/
    );
  });

  it('5. AISLAMIENTO: /reserva-v5 permanece intacta', () => {
    // Las reglas nuevas en reserva-v4 excluyen .reserva-v5 y no modifican reserva-v5.css
    expect(cssV4).toContain('.payway-reservation:not(.reserva-v5) .barber-choice-inline');
    expect(cssV5).not.toContain('.payway-reservation:not(.reserva-v5)');
  });
});
