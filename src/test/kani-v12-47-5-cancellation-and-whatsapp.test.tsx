import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  KANI_PUBLIC_WHATSAPP_NUMBER,
  KANI_PUBLIC_WHATSAPP_URL,
} from '@/lib/kani-constants';
import {
  isLiquidGlassPath,
} from '@/components/kani/experimental/liquid-glass-shell';
import {
  getHoursUntilAppointment,
} from '@/lib/kani-cancellation.functions';
import { buildConfirmedEmail, buildCancelledEmail } from '@/lib/kani-notifications.functions';

describe('KANI BARBER STUDIO — V12.47.5: Cancelación Liquid Glass y Actualización Global WhatsApp', () => {
  const root = process.cwd();
  const siteHeaderTsx = fs.readFileSync(path.join(root, 'src/components/kani/site-header.tsx'), 'utf-8');
  const contactoTsx = fs.readFileSync(path.join(root, 'src/routes/contacto.tsx'), 'utf-8');
  const cancelarTsx = fs.readFileSync(path.join(root, 'src/routes/cancelar-turno.tsx'), 'utf-8');
  const storeTsx = fs.readFileSync(path.join(root, 'src/components/kani/store.tsx'), 'utf-8');
  const rootTsx = fs.readFileSync(path.join(root, 'src/routes/__root.tsx'), 'utf-8');
  const routesCss = fs.readFileSync(path.join(root, 'src/components/kani/experimental/liquid-glass-routes.css'), 'utf-8');

  describe('1. Fuente Única de Verdad de WhatsApp y Presencia Global', () => {
    it('define la constante oficial internacional como 5491162840974 y URL canónica https://wa.me/5491162840974', () => {
      expect(KANI_PUBLIC_WHATSAPP_NUMBER).toBe('5491162840974');
      expect(KANI_PUBLIC_WHATSAPP_URL).toBe('https://wa.me/5491162840974');
      // No contiene caracteres especiales, espacios, guiones ni símbolo +
      expect(KANI_PUBLIC_WHATSAPP_NUMBER).toMatch(/^[0-9]+$/);
    });

    it('Header incorpora el enlace oficial de WhatsApp para desktop y mobile con target="_blank" rel="noopener noreferrer"', () => {
      expect(siteHeaderTsx).toContain('export function HeaderWhatsApp()');
      expect(siteHeaderTsx).toContain('KANI_PUBLIC_WHATSAPP_URL');
      expect(siteHeaderTsx).toContain('target="_blank"');
      expect(siteHeaderTsx).toContain('rel="noopener noreferrer"');
    });

    it('Menú móvil (mobile-menu) contiene enlace directo a WhatsApp', () => {
      expect(siteHeaderTsx).toContain('<a href={KANI_PUBLIC_WHATSAPP_URL} target="_blank" rel="noopener noreferrer"');
    });

    it('Footer (SiteFooter) contiene enlace oficial a WhatsApp con apertura en nueva pestaña', () => {
      expect(siteHeaderTsx).toContain('<a href={KANI_PUBLIC_WHATSAPP_URL} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 hover:text-foreground">');
      expect(siteHeaderTsx).toContain('WhatsApp</a>');
    });

    it('Página de Contacto (/contacto) utiliza KANI_PUBLIC_WHATSAPP_URL', () => {
      expect(contactoTsx).toContain('KANI_PUBLIC_WHATSAPP_URL');
      expect(contactoTsx).toContain('href={whatsAppUrl}');
      expect(contactoTsx).toContain('target="_blank"');
      expect(contactoTsx).toContain('rel="noreferrer"');
    });

    it('Plantilla de email de confirmación incluye el WhatsApp oficial 5491162840974', () => {
      const email = buildConfirmedEmail({
        barberName: 'Lautaro',
        clientName: 'Martín',
        serviceName: 'Corte',
        bookingDate: '2026-11-20',
        startTime: '15:00:00',
        endTime: '15:45:00',
        servicePriceArs: 20000,
        downPaymentArs: 5000,
      } as any);

      expect(email.html).toContain('https://wa.me/5491162840974');
      expect(email.text).toContain('https://wa.me/5491162840974');
      expect(email.html).not.toContain('https://wa.me/5491128436014');
      expect(email.html).not.toContain('https://wa.me/5491155616438');
    });

    it('Plantilla de email de turno cancelado incluye el WhatsApp oficial 5491162840974', () => {
      const email = buildCancelledEmail({
        barberName: 'Lautaro',
        clientName: 'Martín',
        serviceName: 'Corte',
        bookingDate: '2026-11-20',
        startTime: '15:00:00',
        servicePriceArs: 20000,
        downPaymentArs: 5000,
      } as any);

      expect(email.html).toContain('https://wa.me/5491162840974');
      expect(email.text).toContain('https://wa.me/5491162840974');
      expect(email.html).not.toContain('https://wa.me/5491128436014');
      expect(email.html).not.toContain('https://wa.me/5491155616438');
    });

    it('Interfaz de cancelación de turnos ofrece enlace a WhatsApp ante restricciones o consultas', () => {
      expect(cancelarTsx).toContain('KANI_PUBLIC_WHATSAPP_URL');
      expect(cancelarTsx).toContain('whatsAppHelpUrl');
      expect(cancelarTsx).toContain('target="_blank"');
      expect(cancelarTsx).toContain('rel="noopener noreferrer"');
    });
  });

  describe('2. Experiencia Liquid Glass de Cancelación (/cancelar-turno)', () => {
    it('/cancelar-turno es reconocida como ruta Liquid Glass oficial', () => {
      expect(isLiquidGlassPath('/cancelar-turno')).toBe(true);
      expect(isLiquidGlassPath('/cancelar-turno/')).toBe(true);
    });

    it('Utiliza el shell compartido LiquidGlassShell con section="cancellation"', () => {
      expect(cancelarTsx).toContain('<LiquidGlassShell section="cancellation">');
    });

    it('Define estilos Liquid Glass para [data-lg-section="cancellation"] en Light y Dark mode', () => {
      expect(routesCss).toContain('[data-lg-section="cancellation"] .cancellation-page-wrap');
      expect(routesCss).toContain('[data-lg-section="cancellation"] .cancellation-card');
      expect(routesCss).toContain('html[data-theme="light"] .site-shell .liquid-glass-page[data-lg-section="cancellation"]');
      expect(routesCss).toContain('html[data-theme="dark"] .site-shell .liquid-glass-page[data-lg-section="cancellation"]');
      expect(routesCss).toContain('backdrop-filter: blur(24px)');
    });

    it('Incorpora modal explícito de confirmación previo a ejecutar la cancelación', () => {
      expect(cancelarTsx).toContain('<Dialog open={showConfirmModal}');
      expect(cancelarTsx).toContain('¿Confirmar cancelación?');
      expect(cancelarTsx).toContain('Sí, cancelar turno');
      expect(cancelarTsx).toContain('No, conservar turno');
    });

    it('Redirige 301 desde /cancelar-turno-old a /cancelar-turno server-side', async () => {
      const { getLegacyRouteRedirectUrl } = await import('@/lib/kani-seo-routing.server');
      expect(getLegacyRouteRedirectUrl('https://www.kanibarber.com/cancelar-turno-old?id=1&token=abc')).toBe(
        'https://www.kanibarber.com/cancelar-turno?id=1&token=abc',
      );
    });
  });

  describe('3. Restricción Horaria de 24 Horas y Reglas de Negocio', () => {
    it('calcula con precisión las horas restantes en huso horario de Argentina (UTC-3)', () => {
      // 2026-11-20 18:00 UTC (15:00 UTC-3)
      const now = new Date(Date.UTC(2026, 10, 20, 18, 0, 0));

      // Turno a las 18:00 UTC-3 del mismo día (3 horas después)
      const hoursSameDay = getHoursUntilAppointment('2026-11-20', '18:00:00', now);
      expect(Math.round(hoursSameDay)).toBe(3);

      // Turno al día siguiente a las 15:00 UTC-3 (exactamente 24 horas después)
      const hoursNextDay = getHoursUntilAppointment('2026-11-21', '15:00:00', now);
      expect(Math.round(hoursNextDay)).toBe(24);

      // Turno a los 3 días (72 horas)
      const hoursThreeDays = getHoursUntilAppointment('2026-11-23', '15:00:00', now);
      expect(Math.round(hoursThreeDays)).toBe(72);
    });
  });

  describe('4. Detección Nativa de Modo Claro y Oscuro (sin forzar light)', () => {
    it('RootShell detecta prefers-color-scheme en el script inline cuando no hay preferencia guardada', () => {
      expect(rootTsx).toContain("window.matchMedia('(prefers-color-scheme: dark)').matches");
      expect(rootTsx).not.toContain('<html lang="es" data-theme="light"');
    });

    it('KaniProvider inicializa el tema respetando prefers-color-scheme y escucha cambios del sistema', () => {
      expect(storeTsx).toContain("window.matchMedia('(prefers-color-scheme: dark)').matches");
      expect(storeTsx).toContain("mediaQuery.addEventListener?.('change', handler)");
    });
  });
});
