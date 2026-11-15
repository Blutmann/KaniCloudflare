import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

describe('Liquid Glass V12.42.1 — Jerarquía visual Desktop (Servicios, Avisos y Botones)', () => {
  const root = process.cwd();
  const desktopCss = readFileSync(
    path.resolve(root, 'src/components/kani/experimental/liquid-glass-desktop-v12-22.css'),
    'utf8',
  );
  const liquidRoute = readFileSync(
    path.resolve(root, 'src/routes/reservar.tsx'),
    'utf8',
  );

  it('mantiene liquid-glass-desktop-v12-22.css estrictamente acotado a desktop (>= 1024px) sin reglas mobile', () => {
    expect(liquidRoute).toContain('liquid-glass-desktop-v12-22.css');
    expect(desktopCss).toMatch(/^[\s\S]*?@media\s*\(min-width:\s*1024px\)\s*\{/);
    expect(desktopCss).not.toContain('@media (max-width:');
    expect(desktopCss).toContain('@media (min-width: 1024px) and (max-height: 780px)');
  });

  it('supera la especificidad de liquid-glass.css para garantizar separación 20–24px, altura 94–110px y tipografía equilibrada en Servicio', () => {
    expect(desktopCss).toContain(
      'html[data-theme] body .site-shell .liquid-glass-reservation[data-services-variant="a"] .booking-page .booking-service-options',
    );
    expect(desktopCss).toContain('gap: clamp(20px, 2.25dvh, 24px) !important;');
    expect(desktopCss).toContain('min-height: clamp(94px, 10.6dvh, 110px) !important;');
    expect(desktopCss).toContain('margin-top: 0 !important;');
    expect(desktopCss).toContain('padding: clamp(20px, 2.25dvh, 26px) clamp(24px, 2.2vw, 32px) !important;');

    // Nombre y precio equivalentes en 18–20px semibold; duración en 13–14px
    expect(desktopCss).toMatch(/\.booking-option-name\s*\{[^}]*font-size:\s*clamp\(18px,\s*1\.28vw,\s*20px\)\s*!important;[^}]*font-weight:\s*600\s*!important;/);
    expect(desktopCss).toMatch(/\.booking-option-price\s*\{[^}]*font-size:\s*clamp\(18px,\s*1\.28vw,\s*20px\)\s*!important;[^}]*font-weight:\s*600\s*!important;/);
    expect(desktopCss).toMatch(/\.booking-option-duration\s*\{[^}]*font-size:\s*clamp\(13px,\s*0\.94vw,\s*14px\)\s*!important;[^}]*font-weight:\s*400\s*!important;/);
  });

  it('ubica los tres mensajes informativos por debajo de los títulos y servicios manteniendo legibilidad y saltos de línea', () => {
    for (const selector of [
      'html[data-theme] body .site-shell .liquid-glass-reservation .booking-page .booking-deposit-notice',
      'html[data-theme] body .site-shell .liquid-glass-reservation .booking-page .calendar-footer-info .calendar-note',
      'html[data-theme] body .site-shell .liquid-glass-reservation .booking-page .summary-pending-notice',
    ]) {
      const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const ruleRegex = new RegExp(
        `${escaped}\\s*\\{[^}]*font-size:\\s*clamp\\(12\\.5px,\\s*0\\.88vw,\\s*13\\.5px\\)\\s*!important;[^}]*font-weight:\\s*400\\s*!important;`,
      );
      expect(desktopCss).toMatch(ruleRegex);
    }

    expect(desktopCss).toContain('white-space: normal !important;');
    expect(desktopCss).toContain('max-height: none !important;');
    expect(desktopCss).toContain('.booking-page .booking-deposit-notice svg');
    expect(desktopCss).toContain('.booking-page .calendar-footer-info .calendar-note > span:first-child');
    expect(desktopCss).toContain('.booking-page .summary-pending-notice p');
    expect(desktopCss).toContain('.booking-page .summary-pending-notice svg');
  });

  it('eleva la altura de Volver y Continuar/Pagar seña a 52–60px centrados en los cinco pasos desktop', () => {
    expect(desktopCss).toContain(
      'html[data-theme] body .site-shell .liquid-glass-reservation .booking-cta:not(.mobile-menu-cta) .booking-cta-inner :is(.booking-back-button, .booking-next-button, .payway-submit-btn)',
    );
    expect(desktopCss).toContain('height: clamp(52px, 5.8dvh, 60px) !important;');
    expect(desktopCss).toContain('min-height: clamp(52px, 5.8dvh, 60px) !important;');
    expect(desktopCss).toContain('align-items: center !important;');
    expect(desktopCss).toContain('justify-content: center !important;');
  });
});
