import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('Kani Barber Studio — Ajustes visuales en Resumen y Servicio', () => {
  const stylesPath = path.resolve(__dirname, '../styles.css');
  const bookingPath = path.resolve(__dirname, '../components/kani/booking.tsx');

  const css = fs.readFileSync(stylesPath, 'utf-8');
  const bookingCode = fs.readFileSync(bookingPath, 'utf-8');

  it('1. Resumen Desktop: booking-summary-cards comparte el ancho del contenedor sin max-width restrictivo', () => {
    // En desktop, booking-summary-cards tiene width: 100% y no max-width: 860px
    expect(css).toMatch(/\.booking-summary-cards\s*\{[^}]*width:\s*100%/);
    expect(css).not.toMatch(/\.booking-summary-cards\s*\{[^}]*max-width:\s*860px/);
  });

  it('2. Resumen: el aviso de solicitud pendiente tiene un container propio con clase booking-summary-card', () => {
    expect(bookingCode).toContain('booking-summary-card summary-pending-notice');
    expect(bookingCode).toContain('Tu solicitud está pendiente hasta que abones la seña.');
  });

  it('3. Resumen: el aviso pendiente utiliza ícono y texto en bordó institucional (claro y oscuro)', () => {
    expect(css).toMatch(/html\[data-theme='light'\]\s*\.summary-pending-notice[^{]*\{[^}]*color:\s*#702B3A\s*!important/);
    expect(css).toMatch(/html\[data-theme='light'\]\s*\.summary-pending-notice\s*svg\s*\{[^}]*color:\s*#702B3A\s*!important/);
    expect(css).toMatch(/html\[data-theme='dark'\]\s*\.summary-pending-notice[^{]*\{[^}]*color:\s*color-mix\(in srgb,\s*var\(--primary\)\s*70%,\s*#FFFFFF\)\s*!important/);
    expect(css).toMatch(/html\[data-theme='dark'\]\s*\.summary-pending-notice\s*svg\s*\{[^}]*color:\s*color-mix\(in srgb,\s*var\(--primary\)\s*70%,\s*#FFFFFF\)\s*!important/);
  });

  it('4. Servicio: el aviso sobre la seña conserva texto e ícono de alto contraste en ambos temas', () => {
    expect(css).toMatch(/html\[data-theme='light'\]\s*\.booking-deposit-notice\s*\{[^}]*color:\s*var\(--foreground\)\s*!important/);
    expect(css).toMatch(/html\[data-theme='light'\]\s*\.booking-deposit-notice\s*svg\s*\{[^}]*color:\s*var\(--foreground\)\s*!important/);
    expect(css).toMatch(/html\[data-theme='dark'\]\s*\.booking-deposit-notice\s*\{[^}]*color:\s*var\(--foreground\)\s*!important/);
    expect(css).toMatch(/html\[data-theme='dark'\]\s*\.booking-deposit-notice\s*svg\s*\{[^}]*color:\s*var\(--foreground\)\s*!important/);
  });

  it('5. Servicio: el aviso sobre la seña coincide en opacidad y fondo con las cards de servicios', () => {
    // Fondo claro con blur idéntico a booking-option
    expect(css).toMatch(/html\[data-theme='light'\]\s*\.booking-deposit-notice\s*\{[^}]*background:\s*#ffffff29\s*!important/);
    expect(css).toMatch(/html\[data-theme='light'\]\s*\.booking-deposit-notice\s*\{[^}]*backdrop-filter:\s*blur\(8px\)/);
    expect(css).toMatch(/html\[data-theme='light'\]\s*\.booking-deposit-notice\s*\{[^}]*border-color:\s*var\(--border\)\s*!important/);

    // Fondo oscuro con blur idéntico a booking-option
    expect(css).toMatch(/html\[data-theme='dark'\]\s*\.booking-deposit-notice\s*\{[^}]*background:\s*#1818189c\s*!important/);
    expect(css).toMatch(/html\[data-theme='dark'\]\s*\.booking-deposit-notice\s*\{[^}]*backdrop-filter:\s*blur\(8px\)/);
    expect(css).toMatch(/html\[data-theme='dark'\]\s*\.booking-deposit-notice\s*\{[^}]*border-color:\s*var\(--border\)\s*!important/);
  });

  it('6. Mobile: container del aviso pendiente adaptado a densidad compacta', () => {
    expect(css).toMatch(/\.summary-pending-notice\s*\{[^}]*padding:\s*8px 12px/);
  });
});
