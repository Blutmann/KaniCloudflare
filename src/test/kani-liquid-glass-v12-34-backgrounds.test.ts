import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

describe('Liquid Glass V12.34 — Integración de Fondos Light Mode (Mobile 1440x2560 & Desktop 3840x2160)', () => {
  const root = process.cwd();
  const liquidCss = readFileSync(
    path.resolve(root, 'src/components/kani/experimental/liquid-glass.css'),
    'utf8',
  );
  const v12301Idx = liquidCss.indexOf('LIQUID GLASS V12.30.1');
  const section = v12301Idx >= 0 ? liquidCss.slice(v12301Idx) : '';

  it('conserva activos AVIF y WebP de Light Mode (4K desktop y mobile) junto a Dark Mode intacto', () => {
    const mobileAvif = path.resolve(root, 'public/backgrounds/champagne-silk-light-mobile.avif');
    const mobileWebp = path.resolve(root, 'public/backgrounds/champagne-silk-light-mobile.webp');
    const desktopAvif = path.resolve(root, 'public/backgrounds/champagne-silk-light-desktop.avif');
    const desktopWebp = path.resolve(root, 'public/backgrounds/champagne-silk-light-desktop.webp');
    const darkDesktopAvif = path.resolve(root, 'public/backgrounds/kani-ink-dark-desktop.avif');
    const darkMobileAvif = path.resolve(root, 'public/backgrounds/kani-ink-dark-mobile.avif');

    for (const file of [mobileAvif, mobileWebp, desktopAvif, desktopWebp, darkDesktopAvif, darkMobileAvif]) {
      expect(existsSync(file)).toBe(true);
    }

    // Los nuevos AVIF maestros 1440x2560 y 3840x2160 conservan detalle completo y sus WebP son livianos
    expect(statSync(mobileAvif).size).toBeGreaterThan(200_000);
    expect(statSync(desktopAvif).size).toBeGreaterThan(500_000);
    expect(statSync(mobileWebp).size).toBeLessThan(150_000);
    expect(statSync(desktopWebp).size).toBeLessThan(350_000);
  });

  it('centra la composición del prisma y kanji en Light Mode sin alterar Dark Mode ni Safari -webkit-image-set', () => {
    expect(section).toContain('V12.34');
    expect(section).toContain('background-position: center center !important;');
    expect(section).toContain('-webkit-image-set(');
    expect(section).toContain("html[data-theme=\"dark\"] .liquid-glass-atmosphere");
    expect(section).toContain("background-position: 94% 86% !important;");
    expect(section).toContain("background-position: 90% 88% !important;");
    expect(section).toContain('background-size: cover !important;');
    expect(section).toContain('height: 100lvh;');
  });
});
