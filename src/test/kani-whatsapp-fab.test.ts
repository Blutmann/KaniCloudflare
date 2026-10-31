import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('Kani Barber Studio - WhatsApp en Header (Mobile & Desktop) y eliminación de FAB', () => {
  const stylesPath = path.resolve(__dirname, '../styles.css');
  const bookingPath = path.resolve(__dirname, '../components/kani/booking.tsx');
  const siteHeaderPath = path.resolve(__dirname, '../components/kani/site-header.tsx');

  const css = fs.readFileSync(stylesPath, 'utf-8');
  const bookingCode = fs.readFileSync(bookingPath, 'utf-8');
  const siteHeaderCode = fs.readFileSync(siteHeaderPath, 'utf-8');

  it('1. El botón flotante (FAB) de WhatsApp fue eliminado completamente del flujo de reserva', () => {
    // Sin elemento FAB ni clases en booking.tsx
    expect(bookingCode).not.toContain('booking-whatsapp-fab');
    expect(bookingCode).not.toContain('booking-whatsapp-icon');

    // Sin reglas CSS para el FAB en styles.css
    expect(css).not.toContain('.booking-whatsapp-fab');
    expect(css).not.toContain('.booking-whatsapp-icon');
  });

  it('2. WhatsApp está incorporado al Header tanto en Mobile como en Desktop', () => {
    // Componente HeaderWhatsApp presente en site-header.tsx
    expect(siteHeaderCode).toContain('export function HeaderWhatsApp()');

    // Visible tanto en mobile como en desktop (inline-flex, sin hidden)
    expect(siteHeaderCode).toContain('className="header-control-button header-whatsapp-button inline-flex"');
    expect(siteHeaderCode).not.toContain('header-whatsapp-button hidden md:inline-flex');

    // Enlace oficial de WhatsApp conservado
    expect(siteHeaderCode).toMatch(/KANI_PUBLIC_WHATSAPP_URL|https:\/\/wa\.me\/5491155616438/);
    expect(siteHeaderCode).toContain('aria-label="Consultas por WhatsApp"');
    expect(siteHeaderCode).toContain('target="_blank"');
    expect(siteHeaderCode).toContain('rel="noopener noreferrer"');
  });

  it('3. HeaderWhatsApp se renderiza junto al control de tema en la barra de cabecera', () => {
    expect(siteHeaderCode).toMatch(/<HeaderWhatsApp\s*\/>\s*<ThemeToggle\s*\/>/);
  });

  it('4. Holgura de scroll inferior en Mobile ajustada para la barra CTA sin espacio reservado para FAB', () => {
    expect(css).toMatch(/\.booking-page\s*\{[^}]*padding-bottom:\s*calc\(76px \+ env\(safe-area-inset-bottom\)\)/);
  });
});
