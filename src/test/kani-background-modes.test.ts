import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('Kani Barber Studio - Fondos de pantalla en los 4 modos (mobile/desktop x claro/oscuro)', () => {
  const stylesPath = path.resolve(__dirname, '../styles.css');
  const publicDir = path.resolve(__dirname, '../../public');
  const css = fs.readFileSync(stylesPath, 'utf-8');

  it('1. Existen los 4 archivos de fondo originales en el directorio public', () => {
    expect(fs.existsSync(path.join(publicDir, 'kani-fondo-oscuro-mobile.webp'))).toBe(true);
    expect(fs.existsSync(path.join(publicDir, 'kani-fondo-claro-mobile-blanco.webp'))).toBe(true);
    expect(fs.existsSync(path.join(publicDir, 'kani-fondo-oscuro-desktop.webp'))).toBe(true);
    expect(fs.existsSync(path.join(publicDir, 'kani-fondo-claro-desktop-blanco.webp'))).toBe(true);
  });

  it('2. Body es transparente para no tapar el pseudo-elemento body::before', () => {
    // body debe tener background-color: transparent para evitar que una capa sólida tape body::before
    expect(css).toMatch(/body\s*\{[^}]*background-color:\s*transparent/);
  });

  it('3. Modo Mobile Claro aplica el fondo vertical claro original', () => {
    expect(css).toMatch(/html\[data-theme="light"\]\s*body::before\s*\{[^}]*url\('\/kani-fondo-claro-mobile-blanco\.webp'\)/);
  });

  it('4. Modo Mobile Oscuro aplica el fondo vertical oscuro original', () => {
    expect(css).toMatch(/html\[data-theme="dark"\]\s*body::before\s*\{[^}]*url\('\/kani-fondo-oscuro-mobile\.webp'\)/);
  });

  it('5. Modo Desktop Claro aplica el fondo panorámico claro original en media queries desktop', () => {
    expect(css).toMatch(/html\[data-theme="light"\]\s*body::before\s*\{[^}]*background-image:\s*url\('\/kani-fondo-claro-desktop-blanco\.webp'\)/);
  });

  it('6. Modo Desktop Oscuro aplica el fondo panorámico oscuro original en media queries desktop', () => {
    expect(css).toMatch(/html\[data-theme="dark"\]\s*body::before\s*\{[^}]*background-image:\s*url\('\/kani-fondo-oscuro-desktop\.webp'\)/);
  });

  it('7. body::before tiene position fixed, inset 0, pointer-events none y cover no-repeat', () => {
    expect(css).toMatch(/body::before\s*\{[^}]*position:\s*fixed/);
    expect(css).toMatch(/body::before\s*\{[^}]*inset:\s*0/);
    expect(css).toMatch(/body::before\s*\{[^}]*pointer-events:\s*none/);
    expect(css).toMatch(/html\[data-theme="light"\]\s*body::before\s*\{[^}]*cover no-repeat/);
    expect(css).toMatch(/html\[data-theme="dark"\]\s*body::before\s*\{[^}]*cover no-repeat/);
  });
});
