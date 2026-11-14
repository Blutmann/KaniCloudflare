import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

describe('Liquid Glass V12.29 — Contenedor Global Desktop y Stepper Blur Real', () => {
  const root = process.cwd();
  const liquidCss = readFileSync(
    path.resolve(root, 'src/components/kani/experimental/liquid-glass.css'),
    'utf8',
  );
  const desktopCss = readFileSync(
    path.resolve(root, 'src/components/kani/experimental/liquid-glass-desktop-v12-22.css'),
    'utf8',
  );
  const baseCss = readFileSync(path.resolve(root, 'src/styles.css'), 'utf8');

  it('define variables fluidas globales (--lg-global-w) aisladas para rutas Liquid Glass en desktop', () => {
    expect(liquidCss).toContain('--lg-global-gutter: clamp(32px, 3.2vw, 72px);');
    expect(liquidCss).toContain('--lg-global-max-w: clamp(1184px, 88vw, 2040px);');
    expect(liquidCss).toContain('--lg-global-w: min(calc(100% - (var(--lg-global-gutter) * 2)), var(--lg-global-max-w));');
    expect(liquidCss).toContain('.site-header.liquid-glass-header > .site-container');
    expect(liquidCss).toContain('.site-footer > .site-container.site-footer-inner');
    expect(liquidCss).toContain('.mobile-menu--liquid .mobile-menu-scroll');
    expect(baseCss).toContain('.site-container { width: min(1184px, calc(100% - 80px)); margin-inline: auto; }');
  });

  it('alinea .booking-page y .booking-layout con el ancho fluido global sin recorte de max-width', () => {
    expect(desktopCss).toContain('width: min(var(--lg-global-w');
    expect(desktopCss).toContain('max-width: none !important;');
  });

  it('posiciona el stepper móvil como capa translúcida sobre el scroll para desenfoque real en Light y Dark', () => {
    const v1229Idx = liquidCss.indexOf('LIQUID GLASS V12.29');
    expect(v1229Idx).toBeGreaterThan(-1);
    const section = liquidCss.slice(v1229Idx);
    expect(section).toContain('@media (max-width: 767px)');
    expect(section).toContain('overflow: clip !important;');
    expect(section).toContain('position: absolute !important;');
    expect(section).toContain('-webkit-backdrop-filter: blur(22px) saturate(168%) !important;');
    expect(section).toContain('backdrop-filter: blur(22px) saturate(168%) !important;');
    expect(section).toContain('padding-top: 71px !important;');
    expect(section).toContain('@media (prefers-reduced-transparency: reduce) and (max-width: 767px)');
  });
});
