import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import React from 'react';
import { PaywayBooking } from '@/components/kani/experimental/payway-booking';

vi.mock('@/components/kani/store', () => ({
  useKani: () => ({ mobileMenuOpen: false, setMobileMenuOpen: vi.fn() }),
}));

vi.mock('@/lib/kani-availability', async original => ({
  ...await original<typeof import('@/lib/kani-availability')>(),
  readConfiguredServices: async () => [],
  readPublicBookingBarbers: async () => ['Lautaro', 'Gonzalo', 'Valentín'].map(name => ({ id: name, name })),
  readPublicAvailabilityStarts: async () => [],
}));

vi.mock('@/lib/kani-appointments', () => ({
  createRealAppointment: vi.fn(),
  appointmentErrorMessage: String,
}));

vi.mock('@/lib/kani-down-payment', () => ({
  getDynamicDownPayment: async () => 5000,
}));

describe('KANI Barber Studio — Refinamiento UX/UI Premium Mobile', () => {
  const reservaV4CssPath = path.resolve(__dirname, '../components/kani/experimental/reserva-v4.css');
  const reservaV4Css = fs.readFileSync(reservaV4CssPath, 'utf-8');
  const bookingTsxPath = path.resolve(__dirname, '../components/kani/booking.tsx');
  const bookingTsx = fs.readFileSync(bookingTsxPath, 'utf-8');

  beforeEach(() => {
    vi.clearAllMocks();
    Element.prototype.scrollTo = vi.fn();
  });

  afterEach(() => {
    cleanup();
  });

  describe('1. Tarjetas de servicio (.service-option) - Eliminación de Checkmark y Círculo', () => {
    it('elimina físicamente .selection-circle y el ícono Check de las tarjetas de servicio en booking.tsx', async () => {
      // 1. Verificación en JSX: dentro del botón de .service-option no debe haber selection-circle ni Check
      const serviceOptionBlock = bookingTsx.match(/className=\{`booking-option service-option[\s\S]*?<\/Button>/)?.[0] ?? '';
      expect(serviceOptionBlock).not.toContain('selection-circle');
      expect(serviceOptionBlock).not.toContain('<Check');

      // 2. Verificación en componente renderizado
      await act(async () => {
        render(<PaywayBooking />);
      });

      const serviceButtons = screen.getAllByRole('button', { name: /minutos/i });
      expect(serviceButtons.length).toBeGreaterThanOrEqual(3);

      serviceButtons.forEach(button => {
        const circle = button.querySelector('.selection-circle');
        expect(circle).toBeNull();
      });
    });

    it('preserva accesibilidad mediante aria-pressed y aria-label descriptivo al seleccionar servicio', async () => {
      await act(async () => {
        render(<PaywayBooking />);
      });

      const firstService = screen.getByRole('button', { name: /Corte · 45 min|Corte, 45 minutos/i });
      const secondService = screen.getByRole('button', { name: /Corte y barba|Corte y barba, 60 minutos/i });

      // Inicialmente ningún servicio está preseleccionado obligatoriamente
      expect(firstService).toHaveAttribute('aria-pressed', 'false');

      // Al seleccionar el primer servicio
      await act(async () => {
        fireEvent.click(firstService);
      });
      expect(firstService).toHaveAttribute('aria-pressed', 'true');
      expect(firstService.getAttribute('aria-label')).toContain('seleccionado');

      // Al cambiar al segundo servicio
      await act(async () => {
        fireEvent.click(secondService);
      });
      expect(secondService).toHaveAttribute('aria-pressed', 'true');
      expect(secondService.getAttribute('aria-label')).toContain('seleccionado');
      expect(firstService).toHaveAttribute('aria-pressed', 'false');
    });

    it('en reserva-v4.css oculta .selection-circle de .service-option por CSS con display: none !important', () => {
      expect(reservaV4Css).toMatch(
        /\.service-option\s+\.selection-circle[^{]*\{[^}]*display:\s*none\s*!important/
      );
    });
  });

  describe('2. Estilo Visual Modo Claro y Modo Oscuro para Tarjetas de Servicio', () => {
    it('Modo claro: tarjeta no seleccionada tiene fondo blanco sólido #ffffff, borde gris sutil y sombra mínima', () => {
      expect(reservaV4Css).toMatch(
        /html\[data-theme="light"\][^{]*\.service-option[^{]*\{[^}]*background:\s*#ffffff\s*!important/
      );
      expect(reservaV4Css).toMatch(
        /html\[data-theme="light"\][^{]*\.service-option[^{]*\{[^}]*border:\s*1px solid rgba\(0,\s*0,\s*0,\s*0\.08\)\s*!important/
      );
      expect(reservaV4Css).toMatch(
        /html\[data-theme="light"\][^{]*\.service-option[^{]*\{[^}]*box-shadow:\s*0 2px 8px rgba\(0,\s*0,\s*0,\s*0\.04\)\s*!important/
      );
      expect(reservaV4Css).toMatch(
        /html\[data-theme="light"\][^{]*\.service-option[^{]*\{[^}]*backdrop-filter:\s*none\s*!important/
      );
    });

    it('Modo claro: tarjeta seleccionada tiene fondo marfil suave #fff8f6, borde bordó var(--primary) y sombra refinada', () => {
      expect(reservaV4Css).toMatch(
        /html\[data-theme="light"\][^{]*\.service-option\.selected[^{]*\{[^}]*background:\s*#fff8f6\s*!important/
      );
      expect(reservaV4Css).toMatch(
        /html\[data-theme="light"\][^{]*\.service-option\.selected[^{]*\{[^}]*border:\s*2px solid var\(--primary\)\s*!important/
      );
      expect(reservaV4Css).toMatch(
        /html\[data-theme="light"\][^{]*\.service-option\.selected[^{]*\{[^}]*box-shadow:\s*0 4px 14px/
      );
    });

    it('Modo oscuro: tarjeta no seleccionada tiene fondo carbón sólido #1e1e1e, borde discreto y sin transparencia', () => {
      expect(reservaV4Css).toMatch(
        /html\[data-theme="dark"\][^{]*\.service-option[^{]*\{[^}]*background:\s*#1e1e1e\s*!important/
      );
      expect(reservaV4Css).toMatch(
        /html\[data-theme="dark"\][^{]*\.service-option[^{]*\{[^}]*border:\s*1px solid rgba\(255,\s*255,\s*255,\s*0\.08\)\s*!important/
      );
      expect(reservaV4Css).toMatch(
        /html\[data-theme="dark"\][^{]*\.service-option[^{]*\{[^}]*backdrop-filter:\s*none\s*!important/
      );
    });

    it('Modo oscuro: tarjeta seleccionada tiene superficie #282626, borde dorado champagne #C8A96B y sombra dorada', () => {
      expect(reservaV4Css).toMatch(
        /html\[data-theme="dark"\][^{]*\.service-option\.selected[^{]*\{[^}]*background:\s*#282626\s*!important/
      );
      expect(reservaV4Css).toMatch(
        /html\[data-theme="dark"\][^{]*\.service-option\.selected[^{]*\{[^}]*border:\s*2px solid #C8A96B\s*!important/
      );
      expect(reservaV4Css).toMatch(
        /html\[data-theme="dark"\][^{]*\.service-option\.selected[^{]*\{[^}]*box-shadow:\s*0 4px 14px rgba\(200,\s*169,\s*107/
      );
    });
  });

  describe('3. Jerarquía Tipográfica y Microinteracciones', () => {
    it('define pesos y jerarquías tipográficas elegantes (nombre 500, duración 400, precio 500 alineado a la derecha)', () => {
      expect(reservaV4Css).toMatch(
        /\.service-option\s+\.booking-option-name[^{]*\{[^}]*font-weight:\s*500\s*!important/
      );
      expect(reservaV4Css).toMatch(
        /\.service-option\s+\.booking-option-duration[^{]*\{[^}]*font-weight:\s*400\s*!important/
      );
      expect(reservaV4Css).toMatch(
        /\.service-option\s+\.booking-option-price[^{]*\{[^}]*font-weight:\s*500\s*!important/
      );
      expect(reservaV4Css).toMatch(
        /\.service-option\s+\.booking-option-price[^{]*\{[^}]*text-align:\s*right\s*!important/
      );
    });

    it('incorpora microinteracciones fluidas (180ms ease) y respeta prefers-reduced-motion', () => {
      expect(reservaV4Css).toMatch(
        /\.service-option[^{]*\{[^}]*transition:\s*background-color\s*180ms/
      );
      expect(reservaV4Css).toMatch(
        /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[^}]*transition:\s*none\s*!important/
      );
    });
  });

  describe('4. Navegación Inferior Mobile (Footer CTA)', () => {
    it('Continuar en modo claro utiliza bordó con texto blanco, y en modo oscuro champagne gold #C8A96B con texto oscuro #161515', () => {
      expect(reservaV4Css).toMatch(
        /html\[data-theme="light"\][^{]*\.booking-next-button:not\(:disabled\)[^{]*\{[^}]*background:\s*var\(--primary\)\s*!important/
      );
      expect(reservaV4Css).toMatch(
        /html\[data-theme="light"\][^{]*\.booking-next-button:not\(:disabled\)[^{]*\{[^}]*color:\s*#ffffff\s*!important/
      );
      expect(reservaV4Css).toMatch(
        /html\[data-theme="dark"\][^{]*\.booking-next-button:not\(:disabled\)[^{]*\{[^}]*background:\s*var\(--gold,\s*#C8A96B\)\s*!important/
      );
      expect(reservaV4Css).toMatch(
        /html\[data-theme="dark"\][^{]*\.booking-next-button:not\(:disabled\)[^{]*\{[^}]*color:\s*#161515\s*!important/
      );
    });
  });
});
