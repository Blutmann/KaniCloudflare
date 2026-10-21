import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('Kani Barber Studio - Ajuste de transparencias en modo oscuro', () => {
  const stylesPath = path.resolve(__dirname, '../styles.css');
  const css = fs.readFileSync(stylesPath, 'utf-8');

  it('1. Iconos de servicios inactivos toman el token var(--muted-foreground) y los activos conservan el dorado', () => {
    // Inactivos: toman el color directamente de var(--muted-foreground)
    expect(css).toMatch(/html\[data-theme='dark'\] \.booking-option:not\(\.selected\)\s*\.service-icon-mask\s*\{[^}]*background-color:\s*var\(--muted-foreground\)\s*!important/);

    // Activo / seleccionado: conserva el filtro dorado original
    expect(css).toMatch(/html\[data-theme='dark'\] \.booking-option\.selected \.option-icon img\s*\{[^}]*filter:\s*brightness\(0\)\s*saturate\(100%\)\s*invert\(69%\)/);
  });

  it('2. Cards y botones inactivos en modo oscuro reciben el fondo translúcido #1818189c', () => {
    // Cards de servicio, barbero y botones de barbero
    expect(css).toMatch(/html\[data-theme='dark'\] \.booking-option,\s*html\[data-theme='dark'\] \.booking-defer-option,\s*html\[data-theme='dark'\] \.barber-choice-list > button\s*\{[^}]*background:\s*#1818189c\s*!important/);

    // Horarios disponibles inactivos
    expect(css).toMatch(/html\[data-theme='dark'\] \.booking-time-slot:not\(\.selected\):not\(:disabled\)\s*\{[^}]*background:\s*#1818189c\s*!important/);

    // Botón Volver
    expect(css).toMatch(/html\[data-theme='dark'\] \.booking-back-button\s*\{[^}]*background:\s*#1818189c\s*!important/);

    // Botón de control del header
    expect(css).toMatch(/html\[data-theme='dark'\] \.header-control-button\s*\{[^}]*background:\s*#1818189c\s*!important/);

    // Paneles y containers: Calendario, Resumen, Aviso de seña, Confirmación y WhatsApp FAB
    expect(css).toMatch(/html\[data-theme='dark'\] \.calendar-panel\s*\{[^}]*background:\s*#1818189c\s*!important/);
    expect(css).toMatch(/html\[data-theme='dark'\] \.booking-summary-card\s*\{[^}]*background:\s*#1818189c\s*!important/);
    expect(css).toMatch(/html\[data-theme='dark'\] \.booking-deposit-notice\s*\{[^}]*background:\s*#1818189c\s*!important/);
    expect(css).toMatch(/html\[data-theme='dark'\] \.confirmation-details\s*\{[^}]*background:\s*#1818189c\s*!important/);
    expect(css).toMatch(/html\[data-theme='dark'\] \.booking-whatsapp-fab\s*\{[^}]*background:\s*#1818189c\s*!important/);
  });

  it('3. Estados seleccionados y deshabilitados conservan su fondo sólido por accesibilidad', () => {
    // Horario seleccionado conserva fondo dorado sólido
    expect(css).toMatch(/html\[data-theme='dark'\] \.booking-time-slot\.selected[^}]*\{[^}]*background:\s*var\(--gold\)\s*!important/);

    // Día de calendario seleccionado conserva fondo dorado sólido
    expect(css).toMatch(/html\[data-theme='dark'\] \.calendar-day\.selected[^}]*\{[^}]*background:\s*var\(--gold\)\s*!important/);

    // Botón siguiente deshabilitado conserva fondo sólido para contraste de estado
    expect(css).toMatch(/html\[data-theme='dark'\] \.booking-next-button:disabled\s*\{[^}]*background:\s*var\(--button-primary-disabled-bg\)\s*!important/);
  });
});
