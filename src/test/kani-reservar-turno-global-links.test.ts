import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { getLegacyRouteRedirectUrl } from '@/lib/kani-seo-routing.server';

describe('Kani Barber Studio — Enlaces globales canónicos a /reservar y redirects 301', () => {
  const rootDir = path.resolve(__dirname, '..');

  it('1. Contacto: el CTA de reserva dirige a /reservar', () => {
    const targetRoute = path.join(rootDir, 'routes', 'contacto.tsx');
    const estudioCode = fs.readFileSync(targetRoute, 'utf8');
    expect(estudioCode).toContain('bookingPath = "/reservar"');
    expect(estudioCode).toContain('bookingPath');
  });

  it('2. Menú desplegable: «Reservar turno» dirige a /reservar', () => {
    const headerCode = fs.readFileSync(path.join(rootDir, 'components', 'kani', 'site-header.tsx'), 'utf8');
    expect(headerCode).toContain("const bookingTarget = '/reservar';");
    expect(headerCode).toMatch(/<Link to=\{bookingTarget\}[^>]*>[^<]*<ArrowUpRight \/>\s*Reservar turno\s*<\/Link>/);
  });

  it('3. Header / MobileMenuAction: «Volver a la reserva» dirige a /reservar', () => {
    const headerCode = fs.readFileSync(path.join(rootDir, 'components', 'kani', 'site-header.tsx'), 'utf8');
    expect(headerCode).toContain("const target = '/reservar';");
    expect(headerCode).toContain('if (path !== target) void navigate({ to: target });');
  });

  it('4. Cierre de sesión: redirige a /reservar', () => {
    const headerCode = fs.readFileSync(path.join(rootDir, 'components', 'kani', 'site-header.tsx'), 'utf8');
    expect(headerCode).toContain("void navigate({ to: '/reservar' });");
  });

  it('5. Pantalla de confirmación y flujo de reservas: «Volver al inicio» dirige a /reservar', () => {
    const confirmedScreenCode = fs.readFileSync(path.join(rootDir, 'components', 'kani', 'booking-confirmed-screen.tsx'), 'utf8');
    const paywayCode = fs.readFileSync(path.join(rootDir, 'components', 'kani', 'experimental', 'payway-booking.tsx'), 'utf8');

    expect(confirmedScreenCode).toContain("homeUrl = '/reservar'");
    expect(paywayCode).toContain("homeUrl = '/reservar'");
  });

  it('6. Rutas heredadas de reserva redirigen 301 server-side a /reservar preservando query params', () => {
    expect(getLegacyRouteRedirectUrl('https://www.kanibarber.com/reservar-turno?utm_source=ig')).toBe(
      'https://www.kanibarber.com/reservar?utm_source=ig',
    );
    expect(getLegacyRouteRedirectUrl('https://www.kanibarber.com/reservar-turno-liquid?barber=Gonzalo')).toBe(
      'https://www.kanibarber.com/reservar?barber=Gonzalo',
    );
    expect(getLegacyRouteRedirectUrl('https://www.kanibarber.com/reserva-v4')).toBe(
      'https://www.kanibarber.com/reservar',
    );
    expect(getLegacyRouteRedirectUrl('https://www.kanibarber.com/reservar-turno-old')).toBe(
      'https://www.kanibarber.com/reservar',
    );
  });

  it('7. Ruta raíz / redirige a /reservar tanto server-side como en fallback de router', () => {
    const indexCode = fs.readFileSync(path.join(rootDir, 'routes', 'index.tsx'), 'utf8');
    expect(indexCode).toMatch(/to:\s*['"]\/reservar['"]/);
    expect(getLegacyRouteRedirectUrl('https://www.kanibarber.com/')).toBe(
      'https://www.kanibarber.com/reservar',
    );
  });

  it('8. Retornos de Mercado Pago (/pago/exito, /pago/error, /pago/pendiente) enlazan a /reservar', () => {
    const pagoExitoCode = fs.readFileSync(path.join(rootDir, 'routes', 'pago.exito.tsx'), 'utf8');
    const pagoErrorCode = fs.readFileSync(path.join(rootDir, 'routes', 'pago.error.tsx'), 'utf8');
    const pagoPendienteCode = fs.readFileSync(path.join(rootDir, 'routes', 'pago.pendiente.tsx'), 'utf8');

    expect(pagoExitoCode).toContain('to="/reservar"');
    expect(pagoExitoCode).toContain('homeUrl="/reservar"');
    expect(pagoExitoCode).not.toContain('/reservar-turno-mercadopago');
    expect(pagoErrorCode).toContain('to="/reservar"');
    expect(pagoErrorCode).not.toContain('/reservar-turno-mercadopago');
    expect(pagoPendienteCode).toContain('to="/reservar"');
    expect(pagoPendienteCode).not.toContain('/reservar-turno-mercadopago');
  });
});
