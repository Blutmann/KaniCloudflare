import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('Kani Barber Studio - Ajuste de estados visuales del stepper en desktop', () => {
  const stylesPath = path.resolve(__dirname, '../styles.css');
  const bookingPath = path.resolve(__dirname, '../components/kani/booking.tsx');

  const css = fs.readFileSync(stylesPath, 'utf-8');
  const bookingCode = fs.readFileSync(bookingPath, 'utf-8');

  it('1. Elimina el fondo rectangular en hover y active de los pasos en desktop', () => {
    // Debe existir la sección de reglas dentro de @media(min-width:768px)
    expect(css).toContain('@media(min-width:768px)');
    
    // Reglas para hover, active y focus en booking-progress buttons
    expect(css).toMatch(/\.booking-progress\s*>\s*button:hover[\s\S]*?background:\s*transparent\s*!important/);
    expect(css).toMatch(/\.booking-progress\s*>\s*button:active[\s\S]*?background:\s*transparent\s*!important/);
    expect(css).toMatch(/\.booking-progress\s*>\s*button:hover[\s\S]*?box-shadow:\s*none\s*!important/);
  });

  it('2. Proporciona un indicador de foco accesible y discreto en el círculo del paso', () => {
    // Focus visible elimina el marco rectangular exterior
    expect(css).toMatch(/\.booking-progress\s*>\s*button:focus-visible[\s\S]*?outline:\s*none\s*!important/);
    expect(css).toMatch(/\.booking-progress\s*>\s*button:focus-visible[\s\S]*?box-shadow:\s*none\s*!important/);

    // Focus visible añade outline circular sobre el span numérico/icono
    expect(css).toMatch(/\.booking-progress\s*>\s*button:focus-visible\s*>\s*span[\s\S]*?outline:\s*2px solid var\(--gold\)/);
    expect(css).toMatch(/\.booking-progress\s*>\s*button:focus-visible\s*>\s*span[\s\S]*?border-radius:\s*50%/);

    // Adaptación para tema claro
    expect(css).toMatch(/html\[data-theme='light'\][\s\S]*?\.booking-progress\s*>\s*button:focus-visible\s*>\s*span[\s\S]*?outline-color:\s*#702B3A/);
  });

  it('3. Mantiene intacta la lógica de navegación y stepper en el componente booking', () => {
    // El botón conserva la capacidad de hacer clic hacia pasos anteriores completados
    expect(bookingCode).toContain('booking-progress');
    expect(bookingCode).toContain('disabled={i > visibleStep}');
    expect(bookingCode).toContain('onClick={() => move(stageOrder[i] ?? 0)}');
    expect(bookingCode).toContain('variant="ghost"');
  });

  it('4. Conserva el escalado sutil de hover en pasos completados sin fondo rectangular', () => {
    expect(css).toMatch(/\.booking-progress\s*>\s*button\.complete:hover\s*>\s*span[\s\S]*?transform:\s*scale\(1\.08\)/);
  });
});
