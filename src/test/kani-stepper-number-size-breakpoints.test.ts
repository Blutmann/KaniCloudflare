import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('Kani Barber Studio — Stepper desktop number size & breakpoint verification', () => {
  const stylesPath = path.resolve(__dirname, '../styles.css');
  const v3CssPath = path.resolve(__dirname, '../components/kani/experimental/reserva-v3.css');
  const bookingPath = path.resolve(__dirname, '../components/kani/booking.tsx');

  const css = fs.readFileSync(stylesPath, 'utf-8');
  const v3Css = fs.readFileSync(v3CssPath, 'utf-8');
  const bookingCode = fs.readFileSync(bookingPath, 'utf-8');

  it('1. Números en desktop (min-width: 768px): reducidos de 12px a 11px', () => {
    // styles.css base desktop
    expect(css).toMatch(/@media\(min-width:768px\)[\s\S]*?\.booking-progress\s*>\s*button\s*>\s*span[^{]*\{[^}]*font-size:\s*11px/);
    // reserva-v3.css base desktop
    expect(v3Css).toMatch(/@media\s*\(min-width:\s*768px\)[\s\S]*?\.booking-page\.booking-v3\s+\.booking-progress\s*>\s*button\s*>\s*span[^{]*\{[^}]*font-size:\s*11px/);
  });

  it('2. Números en pantallas 2K: reducidos exactamente a 10px', () => {
    // styles.css 2K
    expect(css).toMatch(/@media\s*\(min-width:\s*1920px\),\s*\(min-width:\s*1921px\),\s*\(min-width:\s*768px\)\s*and\s*\(min-height:\s*1081px\)[\s\S]*?\.booking-progress\s*>\s*button\s*>\s*span[^{]*\{[^}]*font-size:\s*10px/);
    // reserva-v3.css 2K
    expect(v3Css).toMatch(/@media\s*\(min-width:\s*1920px\),\s*\(min-width:\s*1921px\),\s*\(min-width:\s*768px\)\s*and\s*\(min-height:\s*1081px\)[\s\S]*?\.booking-page\.booking-v3\s+\.booking-progress\s*>\s*button\s*>\s*span[^{]*\{[^}]*font-size:\s*10px/);
  });

  it('3. Mantiene el tamaño de los círculos (24x24 px) y el centrado con place-items: center', () => {
    // Círculo base 24px
    expect(css).toMatch(/\.booking-progress\s*>\s*button\s*>\s*span\s*\{[^}]*width:\s*24px;\s*height:\s*24px/);
    expect(css).toMatch(/\.booking-progress\s*>\s*button\s*>\s*span\s*\{[^}]*border-radius:\s*50%/);
    // Centrado de los números
    expect(css).toMatch(/\.booking-progress\s*>\s*button\s*>\s*span[^{]*\{[^}]*display:\s*grid;\s*place-items:\s*center/);
    expect(v3Css).toMatch(/\.booking-page\.booking-v3\s+\.booking-progress\s*>\s*button\s*>\s*span[^{]*\{[^}]*display:\s*grid;\s*place-items:\s*center/);
  });

  it('4. Conserva intactos los textos de los pasos en 14px y los íconos de completado Check size 13', () => {
    // Textos de pasos en desktop
    expect(css).toMatch(/\.booking-progress\s+small[^{]*\{[^}]*font-size:\s*14px/);
    expect(v3Css).toMatch(/@media\s*\(min-width:\s*768px\)[\s\S]*?\.booking-page\.booking-v3\s+\.booking-progress\s+small[^{]*\{[^}]*font-size:\s*14px/);
    // Ícono Check en pasos completados
    expect(bookingCode).toContain('<Check size={13} />');
  });

  it('5. No modifica la versión móvil (conserva font-size de 9px / 8.5px en max-width: 767px)', () => {
    expect(css).toMatch(/@media\s*\(max-width:\s*767px\)[\s\S]*?\.booking-page\s+\.booking-progress\s*>\s*button\s*>\s*span[^{]*\{[^}]*font-size:\s*9px/);
    expect(v3Css).toMatch(/@media\s*\(max-width:\s*767px\)[\s\S]*?\.booking-page\.booking-v3\s+\.booking-progress\s*>\s*button\s*>\s*span[^{]*\{[^}]*font-size:\s*8\.5px\s*!important/);
  });
});
