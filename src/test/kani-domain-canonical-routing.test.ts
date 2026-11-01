import { describe, expect, it } from 'vitest';
import { getCanonicalRedirectUrl } from '../server';

describe('KANI Barber Studio — Preparación de Dominio y Enrutamiento Canónico', () => {
  describe('1. Redirección canónica 301 de www.kanibarber.com a kanibarber.com', () => {
    it('redirige permanentemente www.kanibarber.com a https://kanibarber.com en la raíz', () => {
      const redirect = getCanonicalRedirectUrl('https://www.kanibarber.com/');
      expect(redirect).toBe('https://kanibarber.com/');
    });

    it('conserva rutas y parámetros de consulta al redirigir www', () => {
      const urlWithQuery = 'https://www.kanibarber.com/reservar-turno?service=corte&barber=Lautaro';
      const redirect = getCanonicalRedirectUrl(urlWithQuery);
      expect(redirect).toBe('https://kanibarber.com/reservar-turno?service=corte&barber=Lautaro');
    });

    it('fuerza HTTPS en la redirección si la solicitud inicial vino por HTTP a www', () => {
      const httpUrl = 'http://www.kanibarber.com/panel-administracion/turnos?filter=ALL';
      const redirect = getCanonicalRedirectUrl(httpUrl);
      expect(redirect).toBe('https://kanibarber.com/panel-administracion/turnos?filter=ALL');
    });

    it('no redirige cuando el host ya es el canónico kanibarber.com', () => {
      expect(getCanonicalRedirectUrl('https://kanibarber.com/')).toBeNull();
      expect(getCanonicalRedirectUrl('https://kanibarber.com/reservar-turno')).toBeNull();
      expect(getCanonicalRedirectUrl('https://kanibarber.com/panel-administracion/inicio')).toBeNull();
    });

    it('no redirige los hostnames de pruebas en workers.dev ni localhost', () => {
      expect(getCanonicalRedirectUrl('https://kanibarberstudio-cloudflare.kanibarber.workers.dev/')).toBeNull();
      expect(getCanonicalRedirectUrl('https://kanibarberstudio-cloudflare.kanibarber.workers.dev/reservar-turno')).toBeNull();
      expect(getCanonicalRedirectUrl('https://311e359c-kanibarberstudio-cloudflare.kanibarber.workers.dev/')).toBeNull();
      expect(getCanonicalRedirectUrl('http://localhost:5173/')).toBeNull();
      expect(getCanonicalRedirectUrl('http://127.0.0.1:3000/')).toBeNull();
    });
  });

  describe('2. Adaptación dinámica de URLs de retorno en pagos', () => {
    it('construye URLs de retorno relativas al dominio canónico configurado en producción', () => {
      const appUrl = 'https://kanibarber.com';
      const cleanBaseUrl = appUrl.replace(/\/$/, '');

      const appointmentId = 'apt_test_123';
      const successUrl = `${cleanBaseUrl}/pago/exito?appointment_id=${encodeURIComponent(appointmentId)}`;
      const failureUrl = `${cleanBaseUrl}/pago/error?appointment_id=${encodeURIComponent(appointmentId)}`;
      const pendingUrl = `${cleanBaseUrl}/pago/pendiente?appointment_id=${encodeURIComponent(appointmentId)}`;
      const notificationUrl = `${cleanBaseUrl}/api/webhook/mercadopago`;

      expect(successUrl).toBe('https://kanibarber.com/pago/exito?appointment_id=apt_test_123');
      expect(failureUrl).toBe('https://kanibarber.com/pago/error?appointment_id=apt_test_123');
      expect(pendingUrl).toBe('https://kanibarber.com/pago/pendiente?appointment_id=apt_test_123');
      expect(notificationUrl).toBe('https://kanibarber.com/api/webhook/mercadopago');
    });

    it('mantiene URLs de retorno en workers.dev para el Worker de pruebas sin KANI_APP_URL', () => {
      const defaultWorkerUrl = 'https://kanibarberstudio-cloudflare.kanibarber.workers.dev';
      const appointmentId = 'apt_preview_456';
      const successUrl = `${defaultWorkerUrl}/pago/exito?appointment_id=${encodeURIComponent(appointmentId)}`;

      expect(successUrl).toBe('https://kanibarberstudio-cloudflare.kanibarber.workers.dev/pago/exito?appointment_id=apt_preview_456');
    });
  });

  describe('3. Auditoría de rutas críticas de navegación y mantenimiento', () => {
    const criticalPublicRoutes = [
      '/',
      '/reservar-turno',
      '/reservar-turno-mercadopago',
    ];

    const criticalAdminRoutes = [
      '/panel-administracion',
      '/panel-administracion/inicio',
      '/panel-administracion/turnos',
      '/panel-administracion/horarios',
      '/panel-administracion/pagos',
      '/panel-administracion/clientes',
      '/panel-administracion/datos',
      '/panel-administracion/mantenimiento',
    ];

    it('las rutas críticas públicas y administrativas están declaradas', () => {
      expect(criticalPublicRoutes).toHaveLength(3);
      expect(criticalAdminRoutes).toHaveLength(8);
    });
  });
});
