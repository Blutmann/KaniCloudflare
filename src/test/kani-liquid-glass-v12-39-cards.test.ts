import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

describe('Liquid Glass V12.39 — Restauración integral del efecto Liquid Glass en cards', () => {
  const root = process.cwd();
  const liquidCss = readFileSync(
    path.resolve(root, 'src/components/kani/experimental/liquid-glass.css'),
    'utf8',
  );
  const adminCss = readFileSync(
    path.resolve(root, 'src/components/kani/experimental/liquid-glass-admin.css'),
    'utf8',
  );
  const stylesCss = readFileSync(path.resolve(root, 'src/styles.css'), 'utf8');

  const bookingIdx = liquidCss.indexOf('LIQUID GLASS V12.39');
  const bookingSection = bookingIdx >= 0 ? liquidCss.slice(bookingIdx) : '';

  const adminIdx = adminCss.indexOf('LAYER 11 · V12.39');
  const adminSection = adminIdx >= 0 ? adminCss.slice(adminIdx) : '';

  it('recalibra tokens --lg-v36-* en Reservas para Light Pearl lúcido y Dark Obsidiana translúcida sin velos opacos', () => {
    expect(bookingIdx).toBeGreaterThan(-1);
    expect(bookingSection).toContain('rgba(255, 255, 255, 0.38)');
    expect(bookingSection).toContain('rgba(248, 246, 242, 0.20)');
    expect(bookingSection).toContain('rgba(255, 251, 244, 0.085)');
    expect(bookingSection).toContain('rgba(22, 22, 28, 0.20)');
    expect(bookingSection).toContain('--lg-v36-border-selected: rgba(178, 144, 78, 0.82);');
    expect(bookingSection).toContain('--lg-v36-border-selected: rgba(212, 180, 114, 0.80);');
    expect(liquidCss).toContain('border: 1.5px solid var(--lg-v36-border-selected) !important;');
    expect(bookingSection).toContain('--lg-v36-day-bg: rgba(255, 255, 255, 0.24)');
    expect(bookingSection).toContain('--lg-v36-day-bg: rgba(255, 255, 255, 0.055)');
  });

  it('elimina el Backdrop Root doble en .calendar-panel con especificidad #_ para liberar a .calendar-glass-card', () => {
    expect(bookingSection).toContain('.calendar-panel');
    expect(bookingSection).toContain('#_');
    expect(bookingSection).toContain('will-change: auto !important;');
    expect(bookingSection).toContain('-webkit-backdrop-filter: none !important;');
    expect(bookingSection).toContain('backdrop-filter: none !important;');
    expect(bookingSection).toContain('.calendar-panel)::before');
    expect(bookingSection).toContain('.calendar-footer-info');
    expect(bookingSection).toContain('content: none !important;');
  });

  it('incluye prefijo Safari -webkit-backdrop-filter y fallbacks @supports not y prefers-reduced-transparency en Reservas', () => {
    expect(bookingSection).toContain('-webkit-backdrop-filter: blur(18px) saturate(165%) brightness(1.02) !important;');
    expect(bookingSection).toContain('backdrop-filter: blur(18px) saturate(165%) brightness(1.02) !important;');
    expect(bookingSection).toContain('-webkit-backdrop-filter: blur(18px) saturate(168%) brightness(1.08) !important;');
    expect(bookingSection).toContain('backdrop-filter: blur(18px) saturate(168%) brightness(1.08) !important;');
    expect(bookingSection).toContain('@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px)))');
    expect(bookingSection).toContain('@media (prefers-reduced-transparency: reduce)');
  });

  it('recalibra admin (--lga-glass-*) y desactiva backdrop-filter doble en subcards anidadas (.v2-metric, .v2-empty, .kani-mcard-sessions, .v2-insight-grid)', () => {
    expect(adminIdx).toBeGreaterThan(-1);
    expect(adminCss).toContain('--lga-glass-nested: rgba(255, 255, 255, 0.26);');
    expect(adminCss).toContain('--lga-glass-nested: rgba(255, 250, 242, 0.055);');
    expect(adminCss).toContain('rgba(255, 255, 255, 0.34) 0%');
    expect(adminCss).toContain('rgba(255, 250, 242, 0.065) 0%');
    expect(adminSection).toContain('.v2-memberships-page > .v2-panel');
    expect(adminSection).toContain('.v2-metric');
    expect(adminSection).toContain('.v2-empty');
    expect(adminSection).toContain('.kani-mcard-sessions');
    expect(adminSection).toContain('.v2-insight-grid article');
    expect(adminSection).toContain('.maintenance-section .space-y-3 > div');
    expect(adminSection).toContain('background: var(--lga-glass-nested) !important;');
    expect(adminSection).toContain('-webkit-backdrop-filter: none !important;');
    expect(adminSection).toContain('backdrop-filter: none !important;');
    expect(adminSection).toContain('@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px)))');
    expect(adminSection).toContain('@media (prefers-reduced-transparency: reduce)');
  });

  it('preserva intactas las rutas tradicionales en src/styles.css sin reglas V12.39', () => {
    expect(stylesCss).not.toContain('LIQUID GLASS V12.39');
    expect(stylesCss).not.toContain('--lga-glass-nested');
  });
});
