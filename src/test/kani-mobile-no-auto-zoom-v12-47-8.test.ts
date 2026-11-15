import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('KANI V12.47.8 / V12.47.8.1 — Sin zoom automático, refinamiento tipográfico y estabilidad del fondo mobile', () => {
  const stylesPath = path.resolve(__dirname, '../styles.css');
  const liquidGlassPath = path.resolve(__dirname, '../components/kani/experimental/liquid-glass.css');
  const rootPath = path.resolve(__dirname, '../routes/__root.tsx');
  const bookingPath = path.resolve(__dirname, '../components/kani/booking.tsx');
  const siteHeaderPath = path.resolve(__dirname, '../components/kani/site-header.tsx');

  const stylesCss = fs.readFileSync(stylesPath, 'utf-8');
  const liquidCss = fs.readFileSync(liquidGlassPath, 'utf-8');
  const rootCode = fs.readFileSync(rootPath, 'utf-8');
  const bookingCode = fs.readFileSync(bookingPath, 'utf-8');
  const siteHeaderCode = fs.readFileSync(siteHeaderPath, 'utf-8');

  it('1. Viewport en __root.tsx preserva accesibilidad (no bloquea zoom manual con maximum-scale=1 ni user-scalable=no)', () => {
    expect(rootCode).toContain('width=device-width, initial-scale=1, viewport-fit=cover');
    expect(rootCode).not.toContain('maximum-scale=1');
    expect(rootCode).not.toContain('user-scalable=no');
    expect(rootCode).not.toContain('user-scalable=0');
  });

  it('2. Regla compartida en styles.css garantiza font-size >= 16px en controles editables nativos sin inflar .select-control', () => {
    const v12478Section = stylesCss.slice(stylesCss.indexOf('V12.47.8'));
    expect(v12478Section).toMatch(
      /@media\s*\(max-width:\s*767px\),\s*\(hover:\s*none\)\s*and\s*\(pointer:\s*coarse\)\s*\{[\s\S]*?html\s+body\s+:is\([\s\S]*?input:not\(\[type="checkbox"\]\):not\(\[type="radio"\]\)[\s\S]*?textarea,[\s\S]*?select[\s\S]*?\)\s*\{[\s\S]*?font-size:\s*max\(16px,\s*1rem\)\s*!important;/
    );
    expect(v12478Section).not.toMatch(/\.select-control\s*\)\s*\{/);
  });

  it('3. Placeholders discretos (13px Inter) y refinamiento óptico de descuento y Payway en mobile', () => {
    expect(stylesCss).toMatch(
      /::placeholder\s*\{[\s\S]*?font-family:\s*var\(--font-sans\)\s*!important;[\s\S]*?font-size:\s*13px\s*!important;/
    );
    expect(stylesCss).toMatch(
      /input#booking-discount-code,\s*html\s+body\s+\.booking-page\s+\.booking-contact-form\s+\.discount-input\s*\{[\s\S]*?font-family:\s*var\(--font-sans\)\s*!important;[\s\S]*?font-size:\s*max\(16px,\s*1rem\)\s*!important;/
    );
    expect(stylesCss).toMatch(
      /\.payway-card-form\s+:is\(input,\s*select\)[\s\S]*?font-family:\s*var\(--font-sans\)\s*!important;/
    );
  });

  it('4. Fondo .liquid-glass-atmosphere anclado a 100lvh (bottom: auto) y bloqueado a portrait en <= 539px ante teclado virtual', () => {
    const v124781Idx = liquidCss.indexOf('LIQUID GLASS V12.47.8.1');
    expect(v124781Idx).toBeGreaterThan(-1);
    const section = liquidCss.slice(v124781Idx);

    expect(section).toContain('bottom: auto !important;');
    expect(section).toContain('height: 100lvh !important;');
    expect(section).toContain('min-height: 100lvh !important;');
    expect(section).toMatch(/@media\s*\(max-width:\s*539px\)/);
    expect(section).toContain('background-position: 58% 52% !important;');
    expect(stylesCss).toMatch(/@media\s*\(max-width:\s*767px\)\s*\{\s*body::before\s*\{[\s\S]*?bottom:\s*auto;[\s\S]*?height:\s*100lvh;/);
  });

  it('5. No se reintroducen listeners artificiales de scroll/zoom en booking.tsx ni cambios al posicionamiento de SiteHeader', () => {
    expect(bookingCode).not.toContain("addEventListener('focusout'");
    expect(bookingCode).not.toMatch(/setTimeout\([^)]*window\.scrollTo/);
    expect(bookingCode).not.toContain("window.visualViewport.addEventListener('resize'");
    expect(siteHeaderCode).toContain('openPathRef.current = window.location.pathname;');
  });
});
