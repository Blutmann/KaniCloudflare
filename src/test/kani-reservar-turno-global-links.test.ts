import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('Kani Barber Studio — Actualización global de enlaces de reservas a /reservar (V12.47)', () => {
  const rootDir = path.resolve(__dirname, '..');

  it('1. Contacto: el card de Horarios / Reservar turno dirige a bookingPath (/reservar o /reservar-turno-old)', () => {
    const targetRoute = path.join(rootDir, 'routes', 'contacto.tsx');
    const oldRoute = path.join(rootDir, 'routes', 'contacto-old.tsx');
    const estudioCode = fs.readFileSync(targetRoute, 'utf8');
    const oldCode = fs.readFileSync(oldRoute, 'utf8');
    expect(estudioCode).toContain('to={bookingPath}');
    expect(estudioCode).toContain('bookingPath = "/reservar"');
    expect(estudioCode).toContain('Reservar turno');
    expect(oldCode).toContain('bookingPath="/reservar-turno-old"');
  });

  it('2. Menú desplegable: la opción «Reservar turno» dirige a /reservar (o Mercado Pago / -old según contexto)', () => {
    const headerCode = fs.readFileSync(path.join(rootDir, 'components', 'kani', 'site-header.tsx'), 'utf8');
    expect(headerCode).toContain("isLiquidRoute");
    expect(headerCode).toContain("'/reservar'");
    expect(headerCode).toContain("'/reservar-turno-mercadopago'");
    expect(headerCode).toContain("'/reservar-turno-old'");
    expect(headerCode).toMatch(/<Link to=\{bookingTarget\}[^>]*>[^<]*<ArrowUpRight \/>\s*Reservar turno\s*<\/Link>/);
  });

  it('3. Header / MobileMenuAction: «Volver a la reserva» dirige a la ruta contextual de reserva', () => {
    const headerCode = fs.readFileSync(path.join(rootDir, 'components', 'kani', 'site-header.tsx'), 'utf8');
    expect(headerCode).toContain("const target = isLiquidGlassPath(path)");
    expect(headerCode).toContain("if (path !== target) void navigate({ to: target });");
  });

  it('4. Cierre de sesión: redirige a /reservar (o Mercado Pago / -old si está en ese contexto)', () => {
    const headerCode = fs.readFileSync(path.join(rootDir, 'components', 'kani', 'site-header.tsx'), 'utf8');
    expect(headerCode).toContain("const isMp = path.includes('mercadopago');");
    expect(headerCode).toContain("to: isLiquidRoute ? '/reservar' : isMp ? '/reservar-turno-mercadopago' : '/reservar-turno-old'");
  });

  it('5. Pantalla de confirmación y flujo de reservas: «Volver al inicio» dirige a /reservar por defecto y -old preserva /reservar-turno-old', () => {
    const bookingCode = fs.readFileSync(path.join(rootDir, 'components', 'kani', 'booking.tsx'), 'utf8');
    const confirmedScreenCode = fs.readFileSync(path.join(rootDir, 'components', 'kani', 'booking-confirmed-screen.tsx'), 'utf8');
    const paywayCode = fs.readFileSync(path.join(rootDir, 'components', 'kani', 'experimental', 'payway-booking.tsx'), 'utf8');

    expect(bookingCode).toContain('? "/reservar-turno-old"');
    expect(bookingCode).toContain(': "/reservar"');
    expect(confirmedScreenCode).toContain("homeUrl = '/reservar'");
    expect(paywayCode).toContain("homeUrl = '/reservar'");
  });

  it('6. Rutas heredadas /reservar-turno y /reservar-turno-liquid redirigen limpiamente a /reservar con query params', () => {
    const reservarTurnoCode = fs.readFileSync(path.join(rootDir, 'routes', 'reservar-turno.tsx'), 'utf8');
    const reservarLiquidCode = fs.readFileSync(path.join(rootDir, 'routes', 'reservar-turno-liquid.tsx'), 'utf8');
    expect(reservarTurnoCode).toMatch(/to:\s*['"]\/reservar['"]/);
    expect(reservarTurnoCode).toContain('search');
    expect(reservarLiquidCode).toMatch(/to:\s*['"]\/reservar['"]/);
    expect(reservarLiquidCode).toContain('search');
  });

  it('7. Rutas públicas principales redirigen a /reservar y -old conserva Payway clásico', () => {
    const indexCode = fs.readFileSync(path.join(rootDir, 'routes', 'index.tsx'), 'utf8');
    const reservaV4Code = fs.readFileSync(path.join(rootDir, 'routes', 'reserva-v4.tsx'), 'utf8');
    const oldRouteCode = fs.readFileSync(path.join(rootDir, 'routes', 'reservar-turno-old.tsx'), 'utf8');

    expect(indexCode).toMatch(/to:\s*['"]\/reservar['"]/);
    expect(reservaV4Code).toMatch(/to:\s*['"]\/reservar['"]/);
    expect(oldRouteCode).toContain('homeUrl="/reservar-turno-old"');
  });

  it('8. Flujo alternativo de Mercado Pago conserva su ruta y retornos de pago enlazan a /reservar', () => {
    const mpBookingCode = fs.readFileSync(path.join(rootDir, 'components', 'kani', 'experimental', 'mercadopago-booking.tsx'), 'utf8');
    const pagoExitoCode = fs.readFileSync(path.join(rootDir, 'routes', 'pago.exito.tsx'), 'utf8');
    const pagoErrorCode = fs.readFileSync(path.join(rootDir, 'routes', 'pago.error.tsx'), 'utf8');
    const pagoPendienteCode = fs.readFileSync(path.join(rootDir, 'routes', 'pago.pendiente.tsx'), 'utf8');

    expect(mpBookingCode).toContain('homeUrl="/reservar-turno-mercadopago"');
    expect(pagoExitoCode).toContain('to="/reservar"');
    expect(pagoExitoCode).toContain('homeUrl="/reservar"');
    expect(pagoExitoCode).not.toContain('/reservar-turno-mercadopago');
    expect(pagoErrorCode).toContain('to="/reservar"');
    expect(pagoErrorCode).not.toContain('/reservar-turno-mercadopago');
    expect(pagoPendienteCode).toContain('to="/reservar"');
    expect(pagoPendienteCode).not.toContain('/reservar-turno-mercadopago');
  });
});
