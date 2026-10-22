import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('Kani Barber Studio - Admin Pagos Layout (Servicio antes de Barbero en Mobile y Desktop)', () => {
  const stylesPath = path.resolve(__dirname, '../styles.css');
  const componentPath = path.resolve(__dirname, '../components/kani/admin-payments.tsx');

  const css = fs.readFileSync(stylesPath, 'utf-8');
  const componentCode = fs.readFileSync(componentPath, 'utf-8');

  it('1. Mobile (< 640px) define la fila 2 exactamente como "servicio barbero" con proporción 60% / 40%', () => {
    // Normal grid
    expect(css).toMatch(
      /@media\s*\(\s*max-width:\s*639px\s*\)\s*\{[\s\S]*?\.admin-payment-form-grid\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0,\s*3fr\)\s*minmax\(0,\s*2fr\)[\s\S]*?grid-template-areas:\s*[\s\S]*?"fecha horario"[\s\S]*?"servicio barbero"[\s\S]*?"metodo importe"[\s\S]*?"cliente sena"[\s\S]*?"contacto descuento"/
    );

    // Grid with has-other
    expect(css).toMatch(
      /\.admin-payment-form-grid\.has-other\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0,\s*3fr\)\s*minmax\(0,\s*2fr\)[\s\S]*?grid-template-areas:\s*[\s\S]*?"fecha horario"[\s\S]*?"servicio barbero"[\s\S]*?"detalle detalle"[\s\S]*?"metodo importe"[\s\S]*?"cliente sena"[\s\S]*?"contacto descuento"/
    );
  });

  it('2. Desktop (>= 640px) define la fila 1 exactamente como "fecha horario servicio barbero"', () => {
    // Normal grid
    expect(css).toMatch(
      /@media\s*\(\s*min-width:\s*640px\s*\)\s*\{[\s\S]*?\.admin-payment-form-grid\s*\{[\s\S]*?grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\)[\s\S]*?grid-template-areas:\s*[\s\S]*?"fecha horario servicio barbero"[\s\S]*?"metodo importe descuento sena"[\s\S]*?"cliente contacto total submit"/
    );

    // Grid with has-other
    expect(css).toMatch(
      /\.admin-payment-form-grid\.has-other\s*\{[\s\S]*?grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\)[\s\S]*?grid-template-areas:\s*[\s\S]*?"fecha horario servicio barbero"[\s\S]*?"detalle detalle detalle detalle"[\s\S]*?"metodo importe descuento sena"[\s\S]*?"cliente contacto total submit"/
    );
  });

  it('3. En el JSX de AdminPayments, el contenedor de Servicio precede al de Barbero en orden DOM', () => {
    const servicioIdx = componentCode.indexOf('className="payment-field-servicio');
    const barberoIdx = componentCode.indexOf('className="payment-field-barbero');

    expect(servicioIdx).toBeGreaterThan(0);
    expect(barberoIdx).toBeGreaterThan(0);
    expect(servicioIdx).toBeLessThan(barberoIdx);
  });
});
