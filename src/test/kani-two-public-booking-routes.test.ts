import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('Kani Barber Studio — Dos rutas públicas de reserva con distintos proveedores de pago', () => {
  const rootRoutePath = path.resolve(__dirname, '../routes/index.tsx');
  const reservaV4RoutePath = path.resolve(__dirname, '../routes/reserva-v4.tsx');
  const reservarTurnoRoutePath = path.resolve(__dirname, '../routes/reservar-turno.tsx');
  const reservarTurnoMpRoutePath = path.resolve(__dirname, '../routes/reservar-turno-mercadopago.tsx');
  const reservaV5RoutePath = path.resolve(__dirname, '../routes/reserva-v5.tsx');
  const sharedConfirmationPath = path.resolve(__dirname, '../components/kani/booking-confirmed-screen.tsx');
  const paywayBookingPath = path.resolve(__dirname, '../components/kani/experimental/payway-booking.tsx');
  const mpBookingPath = path.resolve(__dirname, '../components/kani/experimental/mercadopago-booking.tsx');
  const mpServerPath = path.resolve(__dirname, '../lib/kani-mercadopago.server.ts');
  const mpFunctionsPath = path.resolve(__dirname, '../lib/kani-mercadopago.functions.ts');
  const cssV4Path = path.resolve(__dirname, '../components/kani/experimental/reserva-v4.css');

  describe('1. Redirecciones y rutas públicas', () => {
    it('/ redirige limpiamente a /reservar-turno preservando query params', () => {
      const code = fs.readFileSync(rootRoutePath, 'utf-8');
      expect(code).toContain("throw redirect({");
      expect(code).toContain("to: '/reservar-turno'");
      expect(code).toContain("search: (search as Record<string, unknown>) || {}");
    });

    it('/reserva-v4 redirige a /reservar-turno preservando query params', () => {
      const code = fs.readFileSync(reservaV4RoutePath, 'utf-8');
      expect(code).toContain("throw redirect({");
      expect(code).toContain("to: '/reservar-turno'");
      expect(code).toContain("search: (search as Record<string, unknown>) || {}");
    });

    it('/reservar-turno monta PaywayBooking con estilos de Reserva V4', () => {
      const code = fs.readFileSync(reservarTurnoRoutePath, 'utf-8');
      expect(code).toContain("createFileRoute('/reservar-turno')");
      expect(code).toContain("component: PaywayBooking");
      expect(code).toContain("import '@/components/kani/experimental/reserva-v4.css'");
    });

    it('/reservar-turno-mercadopago monta MercadoPagoBooking con estilos de Reserva V4', () => {
      const code = fs.readFileSync(reservarTurnoMpRoutePath, 'utf-8');
      expect(code).toContain("createFileRoute('/reservar-turno-mercadopago')");
      expect(code).toContain("component: MercadoPagoBooking");
      expect(code).toContain("import '@/components/kani/experimental/reserva-v4.css'");
    });

    it('/reserva-v5 permanece intacta', () => {
      const code = fs.readFileSync(reservaV5RoutePath, 'utf-8');
      expect(code).toContain("createFileRoute('/reserva-v5')");
      expect(code).toContain("PaywayBookingV5");
    });
  });

  describe('2. Arquitectura de componentes compartidos y 5 pasos', () => {
    it('MercadoPagoBooking utiliza Booking variant="v3" (5 pasos: Servicio, Barbero, Fecha, Horario, Datos)', () => {
      const code = fs.readFileSync(mpBookingPath, 'utf-8');
      expect(code).toContain('<Booking');
      expect(code).toContain('variant="v3"');
      expect(code).toContain('onPaymentRequest={begin}');
      expect(code).toContain('className="payway-reservation mercadopago-reservation"');
    });

    it('PaywayBooking y MercadoPagoBooking comparten la misma pantalla final BookingConfirmedScreen', () => {
      const paywayCode = fs.readFileSync(paywayBookingPath, 'utf-8');
      const mpCode = fs.readFileSync(mpBookingPath, 'utf-8');
      const confirmedCode = fs.readFileSync(sharedConfirmationPath, 'utf-8');

      expect(paywayCode).toContain('<BookingConfirmedScreen');
      expect(mpCode).toContain('<BookingConfirmedScreen');

      // Verifica todos los elementos requeridos de la confirmación
      expect(confirmedCode).toContain('Turno confirmado');
      expect(confirmedCode).toContain('Te enviamos la confirmación por mail.');
      expect(confirmedCode).toContain('Resumen de tu turno');
      expect(confirmedCode).toContain('Estos son los detalles de tu reserva.');
      expect(confirmedCode).toContain('¿Dónde estamos?');
      expect(confirmedCode).toContain('San Isidro Labrador 7 · Martínez');
      expect(confirmedCode).toContain('KANI_MAPS_EMBED_URL');
      expect(confirmedCode).toContain('Cómo llegar');
      expect(confirmedCode).toContain('Instagram');
      expect(confirmedCode).toContain('Volver al inicio');
      expect(confirmedCode).toContain('booking-cta confirmation-cta');
      expect(confirmedCode).toContain('confirmation-btn-home');
    });

    it('reserva-v4.css incluye selectores para ambas experiencias (.payway-reservation y .mercadopago-reservation)', () => {
      const css = fs.readFileSync(cssV4Path, 'utf-8');
      expect(css).toContain('.payway-reservation');
      expect(css).toContain('.mercadopago-reservation');
      expect(css).toMatch(/\.payway-reservation,\s*\.mercadopago-reservation\s*\{\s*display:\s*contents;\s*\}/);
    });
  });

  describe('3. Integración de Mercado Pago (Orders API, seña $5.000 y confirmación)', () => {
    it('MercadoPagoBooking crea la orden mediante createBookingOrderFn sin credenciales cliente', () => {
      const code = fs.readFileSync(mpBookingPath, 'utf-8');
      expect(code).toContain('createBookingOrderFn');
      expect(code).toContain('createRealAppointment');
      expect(code).toContain('window.location.assign(checkoutUrl)');
    });

    it('Monto de seña estándar es $5.000 ARS en Mercado Pago y Payway', () => {
      const mpCode = fs.readFileSync(mpBookingPath, 'utf-8');
      expect(mpCode).toContain('KANI_STANDARD_DEPOSIT_ARS');
      expect(mpCode).toContain('Pagar seña de $5.000 con Mercado Pago');
    });

    it('handleGetAppointmentPaymentStatus resuelve detalles del turno (servicio, barbero, cliente, precio y seña)', () => {
      const serverCode = fs.readFileSync(mpServerPath, 'utf-8');
      const functionsCode = fs.readFileSync(mpFunctionsPath, 'utf-8');

      expect(serverCode).toContain('servicePriceArs');
      expect(serverCode).toContain('depositAmountArs: 5000');
      expect(functionsCode).toContain('servicePriceArs?: number;');
    });

    it('pago.exito redirige a BookingConfirmedScreen o muestra confirmación sin perder estilo Reserva V4', () => {
      const exitoCode = fs.readFileSync(path.resolve(__dirname, '../routes/pago.exito.tsx'), 'utf-8');
      expect(exitoCode).toContain('BookingConfirmedScreen');
      expect(exitoCode).toContain('homeUrl="/reservar-turno-mercadopago"');
    });
  });
});
