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
  const v12301Idx = liquidCss.indexOf('(V12.30.1)');
  const v12301 = v12301Idx >= 0 ? liquidCss.slice(v12301Idx) : '';

  it('incluye los cuatro activos AVIF optimizados y sus fallbacks WebP en public/backgrounds sin Base64', () => {
    const assets = [
      'public/backgrounds/champagne-silk-light-desktop.avif',
      'public/backgrounds/champagne-silk-light-mobile.avif',
      'public/backgrounds/kani-ink-dark-desktop.avif',
      'public/backgrounds/kani-ink-dark-mobile.avif',
      'public/backgrounds/champagne-silk-light-desktop.webp',
      'public/backgrounds/champagne-silk-light-mobile.webp',
      'public/backgrounds/kani-ink-dark-desktop.webp',
      'public/backgrounds/kani-ink-dark-mobile.webp',
    ];
    for (const rel of assets) {
      const abs = path.resolve(root, rel);
      expect(existsSync(abs), `Falta archivo ${rel}`).toBe(true);
      expect(statSync(abs).size).toBeGreaterThan(1000);
      const maxSize = rel.includes('champagne-silk-light-') ? 850_000 : 100_000;
      expect(statSync(abs).size).toBeLessThan(maxSize);
    }
    expect(v12301).not.toContain('data:image/');
  });

  it('selecciona Champagne Silk y KANI Ink por tema y relación de aspecto mediante image-set con fallback WebP', () => {
    expect(v12301Idx).toBeGreaterThan(-1);
    expect(v12301).toContain("url('/backgrounds/champagne-silk-light-mobile.avif') type('image/avif')");
    expect(v12301).toContain("url('/backgrounds/champagne-silk-light-desktop.avif') type('image/avif')");
    expect(v12301).toContain("url('/backgrounds/kani-ink-dark-mobile.avif') type('image/avif')");
    expect(v12301).toContain("url('/backgrounds/kani-ink-dark-desktop.avif') type('image/avif')");
    expect(v12301).toContain('min-aspect-ratio: 1001/1000');
    expect(v12301).toContain('min-aspect-ratio: 60/100');
    expect(v12301).toContain('min-aspect-ratio: 190/100');
  });

  it('mantiene continuidad Safari iOS (100lvh), transparencia de .liquid-glass-page en Admin/Contacto/Legales y respeto a reduced-motion', () => {
    expect(v12301).toContain('height: 100lvh;');
    expect(v12301).toContain('prefers-reduced-motion: reduce');
    expect(v12301).toContain('background-color: transparent !important;');
    expect(adminCss).not.toContain('linear-gradient(180deg, #ecebe8');
    expect(adminCss).not.toContain('linear-gradient(180deg, #0a0a0c');
  });
});
