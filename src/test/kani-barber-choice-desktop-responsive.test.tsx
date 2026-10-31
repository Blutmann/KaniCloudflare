import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('KANI — Selector de barberos en Horario («¿Quién te va a atender?»)', () => {
  const stylesCss = fs.readFileSync(path.resolve(process.cwd(), 'src/styles.css'), 'utf-8');
  const reservaV4Css = fs.readFileSync(path.resolve(process.cwd(), 'src/components/kani/experimental/reserva-v4.css'), 'utf-8');

  it('1. En Desktop (≥1024px), define grilla de 4 columnas equivalentes para 4 barberos en styles.css', () => {
    expect(stylesCss).toMatch(
      /@media\s*\(\s*min-width:\s*1024px\s*\)[\s\S]*?\.barber-choice-list[\s\S]*?grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\)/
    );
  });

  it('2. En Desktop (≥1024px), ajusta dinámicamente columnas sin dejar espacios vacíos (1, 2, 3 y 4 barberos)', () => {
    // 1 barbero
    expect(stylesCss).toMatch(/\.barber-choice-list\[data-barbers-count="1"\][\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\)/);
    // 2 barberos
    expect(stylesCss).toMatch(/\.barber-choice-list\[data-barbers-count="2"\][\s\S]*?grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
    // 3 barberos
    expect(stylesCss).toMatch(/\.barber-choice-list\[data-barbers-count="3"\][\s\S]*?grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/);
    // 4 barberos
    expect(stylesCss).toMatch(/\.barber-choice-list\[data-barbers-count="4"\][\s\S]*?grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\)/);
  });

  it('3. En Desktop (≥1024px), incluye soporte con pseudo-clase :has() como progressive enhancement', () => {
    expect(stylesCss).toMatch(/\.barber-choice-list:has\(>\s*:only-child\)[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\)/);
    expect(stylesCss).toMatch(/\.barber-choice-list:has\(>\s*:nth-child\(2\):last-child\)[\s\S]*?grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
    expect(stylesCss).toMatch(/\.barber-choice-list:has\(>\s*:nth-child\(3\):last-child\)[\s\S]*?grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/);
    expect(stylesCss).toMatch(/\.barber-choice-list:has\(>\s*:nth-child\(4\)\)[\s\S]*?grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\)/);
  });

  it('4. En Mobile (< 1024px / ≤ 767px), preserva 3 columnas (repeat(3, minmax(0, 1fr)))', () => {
    // Base rule
    expect(stylesCss).toMatch(/\.barber-choice-list\s*\{[^}]*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/);
    // Mobile media query rule
    expect(stylesCss).toMatch(/@media\s*\(\s*max-width:\s*767px\s*\)[\s\S]*?\.barber-choice-list\s*\{[^}]*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/);
  });

  it('5. En reserva-v4.css (Payway y Mercado Pago), define la misma grilla de 4 columnas para Desktop (≥1024px)', () => {
    expect(reservaV4Css).toMatch(
      /@media\s*\(\s*min-width:\s*1024px\s*\)[\s\S]*?\.payway-reservation:not\(\.reserva-v5\)\s*\.barber-choice-list[\s\S]*?grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\)/
    );
    expect(reservaV4Css).toMatch(/\.payway-reservation:not\(\.reserva-v5\)\s*\.barber-choice-list\[data-barbers-count="3"\][\s\S]*?repeat\(3,\s*minmax\(0,\s*1fr\)\)/);
    expect(reservaV4Css).toMatch(/\.payway-reservation:not\(\.reserva-v5\)\s*\.barber-choice-list\[data-barbers-count="2"\][\s\S]*?repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
    expect(reservaV4Css).toMatch(/\.payway-reservation:not\(\.reserva-v5\)\s*\.barber-choice-list\[data-barbers-count="1"\][\s\S]*?minmax\(0,\s*1fr\)/);
  });

  it('6. Booking component incluye el atributo data-barbers-count para facilitar matching reactivo', () => {
    const bookingCode = fs.readFileSync(path.resolve(process.cwd(), 'src/components/kani/booking.tsx'), 'utf-8');
    expect(bookingCode).toContain('data-barbers-count={candidateBarbers.length}');
  });
});
