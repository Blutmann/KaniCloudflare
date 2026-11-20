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

  it('conserva activos AVIF, WebP y JPG de Light Mode y Dark Mode en resolución 4K desktop y mobile', () => {
    const mobileAvif = path.resolve(root, 'public/backgrounds/kani_light_mobile_v5.avif');
    const mobileWebp = path.resolve(root, 'public/backgrounds/light-mode-mobile-1440x2560-v12-41.webp');
    const desktopAvif = path.resolve(root, 'public/backgrounds/kani_light_desktop_v5.avif');
    const desktopWebp = path.resolve(root, 'public/backgrounds/light-mode-desktop-3840x2160-v12-41.webp');
    const darkDesktopAvif = path.resolve(root, 'public/backgrounds/dark-mode-desktop-3840x2160-v12-41.avif');
    const darkMobileAvif = path.resolve(root, 'public/backgrounds/dark-mode-mobile-1440x2560-v12-41.avif');

    for (const file of [mobileAvif, mobileWebp, desktopAvif, desktopWebp, darkDesktopAvif, darkMobileAvif]) {
      expect(existsSync(file)).toBe(true);
    }

    // Los AVIF maestros 1440x2560 y 3840x2160 conservan detalle completo con compresión AVIF optimizada
    expect(statSync(mobileAvif).size).toBeGreaterThan(100_000);
    expect(statSync(desktopAvif).size).toBeGreaterThan(200_000);
    expect(statSync(mobileWebp).size).toBeLessThan(150_000);
    expect(statSync(desktopWebp).size).toBeLessThan(350_000);
  });

  it('posiciona la composición del prisma y kanji en Light y Dark Mode manteniendo -webkit-image-set y 100lvh', () => {
    expect(section).toContain('V12.41');
    expect(section).toContain('background-position: 50% 50% !important;');
    expect(section).toContain('-webkit-image-set(');
    expect(section).toContain('html[data-theme="dark"] .liquid-glass-atmosphere');
    expect(section).toContain('background-position: 58% 52% !important;');
    expect(section).toContain('background-size: cover !important;');
    expect(section).toContain('height: 100lvh;');
  });
});
