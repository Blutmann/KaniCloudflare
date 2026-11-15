import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('KANI V12.47.8 — Eliminar zoom automático en formularios Mobile (iOS / Touch)', () => {
  const stylesPath = path.resolve(__dirname, '../styles.css');
  const rootPath = path.resolve(__dirname, '../routes/__root.tsx');
  const bookingPath = path.resolve(__dirname, '../components/kani/booking.tsx');
  const siteHeaderPath = path.resolve(__dirname, '../components/kani/site-header.tsx');

  const stylesCss = fs.readFileSync(stylesPath, 'utf-8');
  const rootCode = fs.readFileSync(rootPath, 'utf-8');
  const bookingCode = fs.readFileSync(bookingPath, 'utf-8');
  const siteHeaderCode = fs.readFileSync(siteHeaderPath, 'utf-8');

  it('1. Viewport en __root.tsx preserva accesibilidad (no bloquea zoom manual con maximum-scale=1 ni user-scalable=no)', () => {
    expect(rootCode).toContain('width=device-width, initial-scale=1, viewport-fit=cover');
    expect(rootCode).not.toContain('maximum-scale=1');
    expect(rootCode).not.toContain('user-scalable=no');
    expect(rootCode).not.toContain('user-scalable=0');
  });

  it('2. Regla compartida en styles.css garantiza font-size >= 16px en mobile y dispositivos táctiles (hover: none and pointer: coarse)', () => {
    expect(stylesCss).toMatch(
      /@media\s*\(max-width:\s*767px\),\s*\(hover:\s*none\)\s*and\s*\(pointer:\s*coarse\)\s*\{[\s\S]*?html\s+body\s+:is\([\s\S]*?input:not\(\[type="checkbox"\]\):not\(\[type="radio"\]\)[\s\S]*?textarea,[\s\S]*?select,[\s\S]*?\.select-control[\s\S]*?\)\s*\{[\s\S]*?font-size:\s*max\(16px,\s*1rem\)\s*!important;/
    );
  });

  it('3. Campo de código de descuento (#booking-discount-code) mantiene >= 16px en mobile y no reduce a 12px en <= 340px', () => {
    expect(stylesCss).toMatch(
      /html\s+body\s+\.booking-page\s+\.booking-contact-form\s+input#booking-discount-code\s*\{[\s\S]*?font-size:\s*max\(16px,\s*1rem\)\s*!important;/
    );
    expect(stylesCss).toMatch(
      /\.discount-input-row\s+\.discount-input,[\s\S]*?input#booking-discount-code\s*\{[\s\S]*?font-size:\s*16px;/
    );
    const max340Match = stylesCss.match(/@media\s*\(max-width:\s*340px\)\s*\{[\s\S]*?\.discount-input-row\s+\.discount-input\s*\{([^}]*)\}/);
    expect(max340Match).not.toBeNull();
    expect(max340Match?.[1]).not.toMatch(/font-size\s*:\s*12px/);
  });

  it('4. Tipografía desktop con mouse (min-width: 768px and hover: hover and pointer: fine) conserva 13px en descuento', () => {
    expect(stylesCss).toMatch(
      /@media\s*\(min-width:\s*768px\)\s*and\s*\(hover:\s*hover\)\s*and\s*\(pointer:\s*fine\)\s*\{[\s\S]*?\.discount-input-row\s+\.discount-input[\s\S]*?font-size:\s*13px;/
    );
  });

  it('5. No se reintroducen listeners artificiales de scroll/zoom en booking.tsx ni cambios al posicionamiento de SiteHeader', () => {
    expect(bookingCode).not.toContain("addEventListener('focusout'");
    expect(bookingCode).not.toMatch(/setTimeout\([^)]*window\.scrollTo/);
    expect(bookingCode).not.toContain("window.visualViewport.addEventListener('resize'");
    expect(siteHeaderCode).toContain('openPathRef.current = window.location.pathname;');
  });
});
