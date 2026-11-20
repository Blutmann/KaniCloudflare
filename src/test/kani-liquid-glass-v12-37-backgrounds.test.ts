import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

describe('Liquid Glass V12.37 — Integración definitiva de los cuatro fondos responsive', () => {
  const root = process.cwd();
  const liquidCss = readFileSync(
    path.resolve(root, 'src/components/kani/experimental/liquid-glass.css'),
    'utf8',
  );
  const stylesCss = readFileSync(path.resolve(root, 'src/styles.css'), 'utf8');
  const headersFile = path.resolve(root, 'public/_headers');
  const v1237Idx = liquidCss.indexOf('LIQUID GLASS V12.37');
  const section = v1237Idx >= 0 ? liquidCss.slice(v1237Idx) : '';

  const variants = [
    'light-mode-desktop-3840x2160-v12-41',
    'light-mode-mobile-1440x2560-v12-41',
    'dark-mode-desktop-3840x2160-v12-41',
    'dark-mode-mobile-1440x2560-v12-41',
  ];

  it('1. Integra los 4 fondos en AVIF, WebP y JPG con nombres versionados y elimina los fondos obsoletos', () => {
    for (const base of variants) {
      for (const ext of ['avif', 'webp', 'jpg']) {
        const abs = path.resolve(root, `public/backgrounds/${base}.${ext}`);
        expect(existsSync(abs), `Falta public/backgrounds/${base}.${ext}`).toBe(true);
        expect(statSync(abs).size).toBeGreaterThan(50_000);
      }
    }

    const legacyNames = [
      'champagne-silk-light-desktop.avif',
      'champagne-silk-light-mobile.avif',
      'kani-ink-dark-desktop.avif',
      'kani-ink-dark-mobile.avif',
      'light-mode-desktop-3840x2160-v12-37.avif',
      'light-mode-mobile-1440x2560-v12-37.avif',
      'dark-mode-desktop-3840x2160-v12-37.avif',
      'dark-mode-mobile-1440x2560-v12-37.avif',
    ];
    for (const legacy of legacyNames) {
      expect(existsSync(path.resolve(root, `public/backgrounds/${legacy}`))).toBe(false);
    }
  });

  it('2. Define fallback JPG + WebP (-webkit-image-set) + AVIF/WebP/JPG (image-set) para las 4 combinaciones', () => {
    expect(v1237Idx).toBeGreaterThan(-1);
    expect(section).toContain("url('/backgrounds/kani_light_desktop.avif') type('image/avif')");
    expect(section).toContain("url('/backgrounds/kani_light_mobile.avif') type('image/avif')");
    for (const base of variants) {
      expect(section).toContain(`url('/backgrounds/${base}.jpg')`);
      expect(section).toContain(`url('/backgrounds/${base}.webp') type('image/webp')`);
      expect(section).toContain(`url('/backgrounds/${base}.jpg') type('image/jpeg')`);
      if (base.startsWith('dark-mode-')) {
        expect(section).toContain(`url('/backgrounds/${base}.avif') type('image/avif')`);
      }
    }
    expect(section).not.toContain('champagne-silk-light-');
    expect(section).not.toContain('kani-ink-dark-');
  });

  it('3. Ajusta posicionamiento específico por proporción, estabilidad móvil 100lvh y caché inmutable', () => {
    expect(section).toContain('background-color: #f4f5f7 !important;');
    expect(section).toContain('background-color: #050507 !important;');
    expect(section).toContain('height: 100lvh;');
    expect(section).toContain('min-height: 100dvh;');
    expect(section).toContain('(min-aspect-ratio: 620/1000) and (max-aspect-ratio: 1000/1000)');
    expect(section).toContain('(min-aspect-ratio: 1001/1000) and (max-aspect-ratio: 1450/1000)');
    expect(section).toContain('(min-aspect-ratio: 1950/1000)');
    expect(section).toContain('backdrop-filter: blur(18px) saturate(142%)');

    expect(existsSync(headersFile)).toBe(true);
    const headers = readFileSync(headersFile, 'utf8');
    expect(headers).toContain('/backgrounds/*');
    expect(headers).toContain('immutable');
  });

  it('4. Sincroniza kani-theme en __root.tsx antes del primer paint para evitar doble descarga o flash Light->Dark', () => {
    const rootTsx = readFileSync(path.resolve(root, 'src/routes/__root.tsx'), 'utf8');
    expect(rootTsx).toContain("window.localStorage.getItem('kani-theme')");
    expect(rootTsx).toContain('document.documentElement.dataset.theme=t');
  });

  it('5. Mantiene intactas las rutas tradicionales en src/styles.css sin dependencias de Liquid Glass V12.37', () => {
    expect(stylesCss).not.toContain('-v12-41');
    expect(stylesCss).not.toContain('.liquid-glass-atmosphere');
  });
});
