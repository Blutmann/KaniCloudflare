import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('Kani Barber Studio - Floating WhatsApp FAB (Mobile & Desktop)', () => {
  const stylesPath = path.resolve(__dirname, '../styles.css');
  const bookingPath = path.resolve(__dirname, '../components/kani/booking.tsx');
  const siteHeaderPath = path.resolve(__dirname, '../components/kani/site-header.tsx');

  const css = fs.readFileSync(stylesPath, 'utf-8');
  const bookingCode = fs.readFileSync(bookingPath, 'utf-8');
  const siteHeaderCode = fs.readFileSync(siteHeaderPath, 'utf-8');

  it('1. Enlace a WhatsApp oficial y atributos de accesibilidad en Booking', () => {
    expect(bookingCode).toContain('https://wa.me/5491128436014');
    expect(bookingCode).toContain('className="booking-whatsapp-fab"');
    expect(bookingCode).toContain('aria-label="Consultas por WhatsApp"');
    expect(bookingCode).toContain('target="_blank"');
    expect(bookingCode).toContain('rel="noopener noreferrer"');
    expect(bookingCode).toContain('!mobileMenuOpen');
  });

  it('2. Separación vertical en Mobile respecto a Continuar', () => {
    expect(css).toMatch(/\.booking-whatsapp-fab\s*\{[^}]*bottom:\s*calc\(88px \+ env\(safe-area-inset-bottom\)\)/);
    expect(css).toMatch(/\.booking-whatsapp-fab\s*\{[^}]*right:\s*calc\(20px \+ env\(safe-area-inset-right\)\)/);
  });

  it('3. Visualización en Header para Desktop y oculto en reservas de Desktop', () => {
    // En Desktop (>= 768px), el botón flotante dentro de reservas debe estar oculto
    expect(css).toMatch(/@media\(min-width:\s*768px\)[\s\S]*?\.booking-whatsapp-fab\s*\{[^}]*display:\s*none !important;/);

    // En Desktop, el header contiene el botón de WhatsApp junto al selector de tema
    expect(siteHeaderCode).toContain('HeaderWhatsApp');
    expect(siteHeaderCode).toContain('className="header-control-button header-whatsapp-button hidden md:inline-flex"');
    expect(siteHeaderCode).toContain('https://wa.me/5491128436014');
  });

  it('4. Accesibilidad, foco visible y diseño compacto redondeado (no circular)', () => {
    // Dimensiones táctiles y bordes redondeados coherentes con la UI (var(--radius-control))
    expect(css).toMatch(/\.booking-whatsapp-fab\s*\{[^}]*width:\s*44px/);
    expect(css).toMatch(/\.booking-whatsapp-fab\s*\{[^}]*height:\s*44px/);
    expect(css).toMatch(/\.booking-whatsapp-fab\s*\{[^}]*border-radius:\s*var\(--radius-control,\s*0\.65rem\)/);

    // Foco accesible
    expect(css).toMatch(/\.booking-whatsapp-fab:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--gold\)/);
    expect(css).toMatch(/html\[data-theme="light"\] \.booking-whatsapp-fab:focus-visible\s*\{[^}]*outline:\s*2px solid #702B3A/);
    expect(css).toMatch(/html\[data-theme='dark'\] \.booking-whatsapp-fab:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--gold\)/);
  });

  it('5. Holgura de scroll inferior en Mobile ajustada sin espacio fantasma', () => {
    expect(css).toMatch(/\.booking-page\s*\{[^}]*padding-bottom:\s*calc\(76px \+ env\(safe-area-inset-bottom\)\)/);
  });
});
