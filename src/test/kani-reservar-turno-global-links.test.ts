import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('Kani Barber Studio — Actualización global de enlaces de reservas a /reservar-turno', () => {
  const rootDir = path.resolve(__dirname, '..');

  it('1. Contacto: el card de Horarios / Solicitar turno dirige a /reservar-turno', () => {
    const estudioCode = fs.readFileSync(path.join(rootDir, 'routes', 'estudio.tsx'), 'utf8');
    expect(estudioCode).toContain('to="/reservar-turno"');
    expect(estudioCode).toContain('Solicitar turno');
    expect(estudioCode).not.toContain('to="/reservar"');
  });

  it('2. Menú desplegable: la opción «Solicitar turno» dirige a /reservar-turno o /reservar-turno-mercadopago', () => {
    const headerCode = fs.readFileSync(path.join(rootDir, 'components', 'kani', 'site-header.tsx'), 'utf8');
    expect(headerCode).toContain("path.includes('mercadopago') ? '/reservar-turno-mercadopago' : '/reservar-turno'");
    expect(headerCode).toMatch(/<Link to=\{path\.includes\('mercadopago'\) \? '\/reservar-turno-mercadopago' : '\/reservar-turno'\}[^>]*>[^<]*<ArrowUpRight \/>\s*Solicitar turno\s*<\/Link>/);
  });

  it('3. Header / MobileMenuAction: «Volver a la solicitud» dirige a la ruta oficial de reserva', () => {
    const headerCode = fs.readFileSync(path.join(rootDir, 'components', 'kani', 'site-header.tsx'), 'utf8');
    expect(headerCode).toContain("const target = path.includes('mercadopago') ? '/reservar-turno-mercadopago' : '/reservar-turno';");
    expect(headerCode).toContain("if (path !== target) void navigate({ to: target });");
    expect(headerCode).not.toContain("void navigate({ to: '/reservar' });");
  });

  it('4. Cierre de sesión: redirige a /reservar-turno (o Mercado Pago si está en ese contexto)', () => {
    const headerCode = fs.readFileSync(path.join(rootDir, 'components', 'kani', 'site-header.tsx'), 'utf8');
    expect(headerCode).toContain("const isMp = path.includes('mercadopago');");
    expect(headerCode).toContain("navigate({ to: isMp ? '/reservar-turno-mercadopago' : '/reservar-turno' })");
  });

  it('5. Pantalla de confirmación y flujo de reservas: «Volver al inicio» dirige a /reservar-turno', () => {
    const bookingCode = fs.readFileSync(path.join(rootDir, 'components', 'kani', 'booking.tsx'), 'utf8');
    const confirmedScreenCode = fs.readFileSync(path.join(rootDir, 'components', 'kani', 'booking-confirmed-screen.tsx'), 'utf8');
    const paywayCode = fs.readFileSync(path.join(rootDir, 'components', 'kani', 'experimental', 'payway-booking.tsx'), 'utf8');

    expect(bookingCode).toContain('const homeLink = isV5 ? "/reserva-v5" : isV3 ? "/reserva-v3" : isV2 ? "/reserva-v2" : "/reservar-turno";');
    expect(confirmedScreenCode).toContain("homeUrl = '/reservar-turno'");
    expect(paywayCode).toContain('homeUrl="/reservar-turno"');
  });

  it('6. Redirección de compatibilidad: /reservar redirige limpiamente a /reservar-turno con query params', () => {
    const reservarCode = fs.readFileSync(path.join(rootDir, 'routes', 'reservar.tsx'), 'utf8');
    expect(reservarCode).toMatch(/to:\s*['"]\/reservar-turno['"]/);
    expect(reservarCode).toContain('search');
    expect(reservarCode).toContain('<Navigate to="/reservar-turno" />');
  });

  it('7. Rutas públicas principales redirigen a /reservar-turno', () => {
    const indexCode = fs.readFileSync(path.join(rootDir, 'routes', 'index.tsx'), 'utf8');
    const reservaV4Code = fs.readFileSync(path.join(rootDir, 'routes', 'reserva-v4.tsx'), 'utf8');

    expect(indexCode).toMatch(/to:\s*['"]\/reservar-turno['"]/);
    expect(reservaV4Code).toMatch(/to:\s*['"]\/reservar-turno['"]/);
  });

  it('8. Flujo alternativo de Mercado Pago conserva su navegación independiente', () => {
    const mpBookingCode = fs.readFileSync(path.join(rootDir, 'components', 'kani', 'experimental', 'mercadopago-booking.tsx'), 'utf8');
    const pagoExitoCode = fs.readFileSync(path.join(rootDir, 'routes', 'pago.exito.tsx'), 'utf8');
    const pagoErrorCode = fs.readFileSync(path.join(rootDir, 'routes', 'pago.error.tsx'), 'utf8');
    const pagoPendienteCode = fs.readFileSync(path.join(rootDir, 'routes', 'pago.pendiente.tsx'), 'utf8');

    expect(mpBookingCode).toContain('homeUrl="/reservar-turno-mercadopago"');
    expect(pagoExitoCode).toContain('to="/reservar-turno-mercadopago"');
    expect(pagoErrorCode).toContain('to="/reservar-turno-mercadopago"');
    expect(pagoPendienteCode).toContain('to="/reservar-turno-mercadopago"');
  });
});
