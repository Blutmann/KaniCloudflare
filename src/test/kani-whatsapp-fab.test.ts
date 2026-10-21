import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('Kani Barber Studio - Floating WhatsApp FAB (Mobile & Desktop)', () => {
  const stylesPath = path.resolve(__dirname, '../styles.css');
  const bookingPath = path.resolve(__dirname, '../components/kani/booking.tsx');

  const css = fs.readFileSync(stylesPath, 'utf-8');
  const bookingCode = fs.readFileSync(bookingPath, 'utf-8');

  it('1. Enlace a WhatsApp oficial y atributos de accesibilidad en Booking', () => {
    expect(bookingCode).toContain('https://wa.me/5491128436014');
    expect(bookingCode).toContain('className="booking-whatsapp-fab"');
    expect(bookingCode).toContain('aria-label="Consultas por WhatsApp"');
    expect(bookingCode).toContain('target="_blank"');
    expect(bookingCode).toContain('rel="noopener noreferrer"');
    expect(bookingCode).toContain('!mobileMenuOpen');
  });

  it('2. Separación vertical en Mobile (mínimo 100px desde el borde inferior)', () => {
    expect(css).toMatch(/\.booking-whatsapp-fab\s*\{[^}]*bottom:\s*calc\(100px \+ env\(safe-area-inset-bottom\)\)/);
    expect(css).toMatch(/\.booking-whatsapp-fab\s*\{[^}]*right:\s*calc\(20px \+ env\(safe-area-inset-right\)\)/);
  });

  it('3. Visualización y posición equivalente en Desktop (>= 768px)', () => {
    // No debe estar oculto en desktop
    expect(css).not.toContain('.booking-whatsapp-fab {\n    display: none !important;');

    // Debe mostrarse con display: flex y separación equivalente respecto a Continuar y al footer
    expect(css).toContain('right: max(24px, calc((100% - 860px) / 2));');
    expect(css).toContain('bottom: calc(var(--site-footer-height, 170px) + 100px);');
  });

  it('4. Accesibilidad, foco visible y diseño circular de 48x48px', () => {
    // Dimensiones táctiles WCAG
    expect(css).toMatch(/\.booking-whatsapp-fab\s*\{[^}]*width:\s*48px/);
    expect(css).toMatch(/\.booking-whatsapp-fab\s*\{[^}]*height:\s*48px/);
    expect(css).toMatch(/\.booking-whatsapp-fab\s*\{[^}]*border-radius:\s*50%/);

    // Foco accesible
    expect(css).toMatch(/\.booking-whatsapp-fab:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--gold\)/);
    expect(css).toMatch(/html\[data-theme="light"\] \.booking-whatsapp-fab:focus-visible\s*\{[^}]*outline:\s*2px solid #702B3A/);
    expect(css).toMatch(/html\[data-theme='dark'\] \.booking-whatsapp-fab:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--gold\)/);
  });

  it('5. Holgura de scroll inferior en Mobile para no tapar contenido', () => {
    expect(css).toMatch(/\.booking-page\s*\{[^}]*padding-bottom:\s*calc\(150px \+ env\(safe-area-inset-bottom\)\)/);
  });
});
