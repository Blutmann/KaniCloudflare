import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';

describe('Liquid Glass V12.30.1 — Integración de Fondos Champagne Silk y KANI Ink', () => {
  const root = process.cwd();
  const liquidCss = readFileSync(
    path.resolve(root, 'src/components/kani/experimental/liquid-glass.css'),
    'utf8',
  );
  const adminCss = readFileSync(
    path.resolve(root, 'src/components/kani/experimental/liquid-glass-admin.css'),
    'utf8',
  );
  const v12301Idx = liquidCss.indexOf('LIQUID GLASS V12.30.1');
  const v12301 = v12301Idx >= 0 ? liquidCss.slice(v12301Idx) : '';

  it('incluye los cuatro activos AVIF maestros y sus fallbacks WebP y JPG versionados en public/backgrounds sin Base64', () => {
    const assets = [
      'public/backgrounds/kani_light_desktop.avif',
      'public/backgrounds/kani_light_mobile.avif',
      'public/backgrounds/dark-mode-desktop-3840x2160-v12-41.avif',
      'public/backgrounds/dark-mode-mobile-1440x2560-v12-41.avif',
      'public/backgrounds/light-mode-desktop-3840x2160-v12-41.webp',
      'public/backgrounds/light-mode-mobile-1440x2560-v12-41.webp',
      'public/backgrounds/dark-mode-desktop-3840x2160-v12-41.webp',
      'public/backgrounds/dark-mode-mobile-1440x2560-v12-41.webp',
      'public/backgrounds/light-mode-desktop-3840x2160-v12-41.jpg',
      'public/backgrounds/light-mode-mobile-1440x2560-v12-41.jpg',
      'public/backgrounds/dark-mode-desktop-3840x2160-v12-41.jpg',
      'public/backgrounds/dark-mode-mobile-1440x2560-v12-41.jpg',
    ];
    for (const rel of assets) {
      const abs = path.resolve(root, rel);
      expect(existsSync(abs), `Falta archivo ${rel}`).toBe(true);
      expect(statSync(abs).size).toBeGreaterThan(1000);
      expect(statSync(abs).size).toBeLessThan(1_500_000);
    }
    expect(v12301).not.toContain('data:image/');
  });

  it('selecciona los fondos por tema y relación de aspecto mediante image-set con fallback WebP y JPG', () => {
    expect(v12301Idx).toBeGreaterThan(-1);
    expect(v12301).toContain("url('/backgrounds/kani_light_mobile.avif') type('image/avif')");
    expect(v12301).toContain("url('/backgrounds/kani_light_desktop.avif') type('image/avif')");
    expect(v12301).toContain("url('/backgrounds/dark-mode-mobile-1440x2560-v12-41.avif') type('image/avif')");
    expect(v12301).toContain("url('/backgrounds/dark-mode-desktop-3840x2160-v12-41.avif') type('image/avif')");
    expect(v12301).toContain('min-aspect-ratio: 1001/1000');
    expect(v12301).toContain('min-aspect-ratio: 620/1000');
    expect(v12301).toContain('min-aspect-ratio: 1950/1000');
  });

  it('mantiene continuidad Safari iOS (100lvh), transparencia de .liquid-glass-page en Admin/Contacto/Legales y respeto a reduced-motion', () => {
    expect(v12301).toContain('height: 100lvh;');
    expect(v12301).toContain('prefers-reduced-motion: reduce');
    expect(v12301).toContain('background-color: transparent !important;');
    expect(adminCss).not.toContain('linear-gradient(180deg, #ecebe8');
    expect(adminCss).not.toContain('linear-gradient(180deg, #0a0a0c');
  });
});
