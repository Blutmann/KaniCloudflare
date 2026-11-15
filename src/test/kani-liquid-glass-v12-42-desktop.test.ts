import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

describe('Liquid Glass V12.42 — Refinamientos Desktop (Servicio y legibilidad de avisos)', () => {
  const root = process.cwd();
  const desktopCss = readFileSync(
    path.resolve(root, 'src/components/kani/experimental/liquid-glass-desktop-v12-22.css'),
    'utf8',
  );
  const liquidRoute = readFileSync(
    path.resolve(root, 'src/routes/reservar-turno-liquid.tsx'),
    'utf8',
  );

  it('mantiene liquid-glass-desktop-v12-22.css estrictamente acotado al breakpoint desktop (>= 1024px) y a la ruta Liquid Glass', () => {
    expect(liquidRoute).toContain('liquid-glass-desktop-v12-22.css');
    expect(desktopCss).toMatch(/^[\s\S]*?@media\s*\(min-width:\s*1024px\)\s*\{/);
    expect(desktopCss).not.toContain('@media (max-width:');
  });

  it('aumenta el espaciado vertical entre tarjetas de servicio en Desktop usando la referencia de Barbero', () => {
    expect(desktopCss).toMatch(
      /\.booking-service-options\s*\{[^}]*display:\s*flex\s*!important;[^}]*flex-direction:\s*column\s*!important;[^}]*gap:\s*clamp\(20px,\s*1\.55vw,\s*24px\)\s*!important;/,
    );
    expect(desktopCss).toContain('.booking-barber-options');
    expect(desktopCss).toContain('gap: clamp(16px, 1.5vw, 22px) !important;');
  });

  it('amplía la tipografía, padding y alineación de los tres mensajes informativos sin recortar ni alterar el cristal', () => {
    for (const selector of [
      '.booking-page .booking-deposit-notice',
      '.booking-page .calendar-footer-info .calendar-note',
      '.booking-page .summary-pending-notice',
    ]) {
      const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const ruleRegex = new RegExp(`${escaped}\\s*\\{[^}]*font-size:\\s*clamp\\(14\\.5px,\\s*1\\.05vw,\\s*16px\\)\\s*!important;`);
      expect(desktopCss).toMatch(ruleRegex);
    }

    expect(desktopCss).toContain('white-space: normal !important;');
    expect(desktopCss).toContain('max-height: none !important;');
    expect(desktopCss).toContain('.booking-page .booking-deposit-notice svg');
    expect(desktopCss).toContain('.booking-page .calendar-footer-info .calendar-note > span:first-child');
    expect(desktopCss).toContain('.booking-page .summary-pending-notice p');
    expect(desktopCss).toContain('.booking-page .summary-pending-notice svg');
  });
});
