import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('Kani Barber Studio — Optimización visual de servicios y barberos', () => {
  const stylesPath = path.resolve(__dirname, '../styles.css');
  const css = fs.readFileSync(stylesPath, 'utf8');

  it('1. Centrado vertical global de tarjetas en desktop y mobile', () => {
    // Desktop .booking-option has align-items: center
    expect(css).toMatch(/\.booking-option\s*\{[^}]*align-items:\s*center;/);

    // Mobile .booking-option has align-items: center
    expect(css).toMatch(/\.booking-option\s*\{[^}]*display:\s*flex;\s*align-items:\s*center;/);

    // Mobile .booking-defer-option has align-items: center
    expect(css).toMatch(/\.booking-defer-option\s*\{[^}]*display:\s*flex;\s*align-items:\s*center;/);

    // Selection circles align self to center
    expect(css).toMatch(/\.booking-option\s+\.selection-circle,\s*\r?\n\.booking-defer-option\s+\.selection-circle\s*\{[^}]*align-self:\s*center\s*!important;/);
  });

  it('2. Pantalla «Elegí un servicio»: textos compactos (gap 3px) y centrado vertical limpio sin hack top: -12px', () => {
    // Service copy uses grid with row-gap: 3px and line-height: 1.2
    expect(css).toMatch(/\.service-option\s+\.booking-option-copy\s*\{[^}]*row-gap:\s*3px;/);
    expect(css).toMatch(/\.service-option\s+\.booking-option-name\s*\{[^}]*line-height:\s*1\.2;/);
    expect(css).toMatch(/\.service-option\s+\.booking-option-duration\s*\{[^}]*line-height:\s*1\.2;/);

    // Meta uses display: contents to let duration and price participate directly in copy grid
    expect(css).toMatch(/\.service-option\s+\.booking-option-meta\s*\{[^}]*display:\s*contents;/);

    // Price is naturally centered vertically via align-self: center spanning 2 rows
    expect(css).toMatch(/\.service-option\s+\.booking-option-price\s*\{[^}]*align-self:\s*center;/);

    // No top: -12px hack remains in styles.css
    expect(css).not.toMatch(/\.service-option\s+\.booking-option-price\s*\{[^}]*top:\s*-12px/);

    // Service icon is centered
    expect(css).toMatch(/\.service-option\s+\.option-icon\s*\{[^}]*align-self:\s*center\s*!important;/);
  });

  it('3. Pantalla «Elegí un barbero» y opción «Elegir más adelante»: textos compactos (gap 3px) y centrado vertical', () => {
    // Barber copy and Defer copy share compact flex column with gap: 3px
    expect(css).toMatch(/\.booking-page\s+\.booking-barber-options\s+\.booking-option-copy,\s*\r?\n\.booking-page\s+\.booking-defer-option\s+\.booking-defer-copy\s*\{[^}]*gap:\s*3px\s*!important;/);
    expect(css).toMatch(/\.booking-page\s+\.booking-barber-options\s+\.booking-option-copy,\s*\r?\n\.booking-page\s+\.booking-defer-option\s+\.booking-defer-copy\s*\{[^}]*justify-content:\s*center\s*!important;/);

    // Barber name and handle have line-height: 1.2 and reset margins
    expect(css).toMatch(/\.booking-page\s+\.booking-barber-options\s+\.booking-barber-name,\s*\r?\n\.booking-page\s+\.booking-defer-option\s+\.booking-defer-copy\s*>\s*span:first-child\s*\{[^}]*line-height:\s*1\.2\s*!important;/);
    expect(css).toMatch(/\.booking-page\s+\.booking-barber-options\s+\.booking-barber-handle,\s*\r?\n\.booking-page\s+\.booking-defer-option\s+\.booking-defer-copy\s*>\s*span:last-child\s*\{[^}]*line-height:\s*1\.2\s*!important;/);

    // Barber avatar and defer mark align self to center
    expect(css).toMatch(/\.booking-option\s+\.barber-avatar,\s*\r?\n\.booking-defer-option\s+\.barber-defer-mark\s*\{[^}]*align-self:\s*center\s*!important;/);
  });

  it('4. Conserva compatibilidad con las especificaciones de iconos de servicios', () => {
    // Desktop: 44px
    expect(css).toMatch(/\.service-icon-mask\s*\{[^}]*width:\s*44px;\s*height:\s*44px;/);

    // Mobile: 40px coherente con .option-icon móvil
    expect(css).toMatch(/\.booking-option\s*\.option-icon\s*\.service-icon-mask\s*\{\s*width:\s*40px;\s*height:\s*40px;\s*\}/);

    // Modo claro y oscuro respetan tokens de color
    expect(css).toMatch(/html\[data-theme='light'\] \.booking-option:not\(\.selected\)\s*\.service-icon-mask\s*\{[^}]*background-color:\s*#702B3A\s*!important/);
    expect(css).toMatch(/html\[data-theme='dark'\] \.booking-option:not\(\.selected\)\s*\.service-icon-mask\s*\{[^}]*background-color:\s*var\(--gold\)\s*!important/);
  });
});
