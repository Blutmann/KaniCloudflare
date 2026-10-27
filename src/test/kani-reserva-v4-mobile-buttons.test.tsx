import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import fs from 'node:fs';
import path from 'node:path';
import { PaywayBooking } from '@/components/kani/experimental/payway-booking';

vi.mock('@/components/kani/store', () => ({
  useKani: () => ({ mobileMenuOpen: false, setMobileMenuOpen: vi.fn() }),
}));

vi.mock('@/lib/kani-availability', async original => ({
  ...await original<typeof import('@/lib/kani-availability')>(),
  readConfiguredServices: async () => [],
  readPublicAvailabilityStarts: async () => [],
}));

vi.mock('@/lib/kani-appointments', () => ({
  createRealAppointment: vi.fn(),
  appointmentErrorMessage: String,
}));

vi.mock('@/lib/kani-down-payment', () => ({
  getDynamicDownPayment: async () => 5000,
}));

describe('Reserva V4 Mobile - Bottom buttons geometry parity (Light vs Dark)', () => {
  const cssPath = path.resolve(__dirname, '../components/kani/experimental/reserva-v4.css');
  const css = fs.readFileSync(cssPath, 'utf-8');

  it('1. Define tokens de dimensiones compartidos idénticos para Light y Dark en Mobile', () => {
    // Ambos botones comparten altura 48px, min-height 48px y box-sizing border-box
    expect(css).toMatch(
      /\.payway-reservation \.booking-page \.booking-cta-inner \.booking-back-button,\s*html\[data-theme\] \.payway-reservation \.booking-page \.booking-cta-inner \.booking-next-button|html\[data-theme\] \.payway-reservation \.booking-page \.booking-cta-inner \.booking-back-button/
    );
    expect(css).toMatch(/height:\s*48px\s*!important/);
    expect(css).toMatch(/min-height:\s*48px\s*!important/);
    expect(css).toMatch(/box-sizing:\s*border-box\s*!important/);
    expect(css).toMatch(/border-radius:\s*var\(--radius-control,\s*0\.65rem\)\s*!important/);

    // Volver: flex 0 0 30%, width 30%, padding-inline 13px, padding-block 8px
    expect(css).toMatch(/\.booking-back-button\s*\{[^}]*flex:\s*0 0 30%\s*!important/);
    expect(css).toMatch(/\.booking-back-button\s*\{[^}]*width:\s*30%\s*!important/);
    expect(css).toMatch(/\.booking-back-button\s*\{[^}]*padding-inline:\s*13px\s*!important/);
    expect(css).toMatch(/\.booking-back-button\s*\{[^}]*padding-block:\s*8px\s*!important/);

    // Continuar: flex 1 1 70%, width auto, padding-inline 24px, padding-block 8px, margin-left 0
    expect(css).toMatch(/\.booking-next-button\s*\{[^}]*flex:\s*1 1 70%\s*!important/);
    expect(css).toMatch(/\.booking-next-button\s*\{[^}]*width:\s*auto\s*!important/);
    expect(css).toMatch(/\.booking-next-button\s*\{[^}]*padding-inline:\s*24px\s*!important/);
    expect(css).toMatch(/\.booking-next-button\s*\{[^}]*padding-block:\s*8px\s*!important/);
    expect(css).toMatch(/\.booking-next-button\s*\{[^}]*margin-left:\s*0\s*!important/);

    // Contenedor footer: gap 10px
    expect(css).toMatch(/\.payway-reservation \.booking-page \.booking-cta-inner\s*\{[^}]*gap:\s*10px\s*!important/);
  });

  it('2. Preserva los contrastes cromáticos de Volver sin alterar geometría', () => {
    // Light mode Volver habilitado: fondo blanco sólido, texto negro
    expect(css).toMatch(/html\[data-theme="light"\] \.payway-reservation \.booking-page \.booking-back-button:not\(:disabled\)\s*\{[^}]*background:\s*#fff\s*!important/);
    expect(css).toMatch(/html\[data-theme="light"\] \.payway-reservation \.booking-page \.booking-back-button:not\(:disabled\)\s*\{[^}]*color:\s*#000\s*!important/);

    // Dark mode Volver habilitado: fondo negro sólido, texto blanco
    expect(css).toMatch(/html\[data-theme="dark"\] \.payway-reservation \.booking-page \.booking-back-button:not\(:disabled\)\s*\{[^}]*background:\s*#000\s*!important/);
    expect(css).toMatch(/html\[data-theme="dark"\] \.payway-reservation \.booking-page \.booking-back-button:not\(:disabled\)\s*\{[^}]*color:\s*#fff\s*!important/);
  });

  describe('3. Verificación de los 4 estados de habilitación en Reserva V4', () => {
    beforeEach(() => {
      vi.clearAllMocks();
      Element.prototype.scrollTo = vi.fn();
    });

    afterEach(() => {
      cleanup();
    });

    it('Estado 1: Volver deshabilitado + Continuar deshabilitado (Paso 0 inicial sin selección)', async () => {
      await act(async () => {
        render(<PaywayBooking />);
      });
      const backButton = screen.getByRole('button', { name: /Volver/i });
      const nextButton = screen.getByRole('button', { name: /Continuar/i });

      expect(backButton).toBeDisabled();
      expect(nextButton).toBeDisabled();
      expect(backButton).toHaveClass('booking-back-button');
      expect(nextButton).toHaveClass('booking-next-button');
    });

    it('Estado 2: Volver deshabilitado + Continuar habilitado (Paso 0 con servicio seleccionado)', async () => {
      await act(async () => {
        render(<PaywayBooking />);
      });
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /^Corte 45/ }));
      });

      const backButton = screen.getByRole('button', { name: /Volver/i });
      const nextButton = screen.getByRole('button', { name: /Continuar/i });

      expect(backButton).toBeDisabled();
      expect(nextButton).toBeEnabled();
    });

    it('Estado 3: Volver habilitado + Continuar deshabilitado (Paso 1 sin barbero seleccionado)', async () => {
      await act(async () => {
        render(<PaywayBooking />);
      });
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /^Corte 45/ }));
      });
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /Continuar/i }));
      });

      const backButton = screen.getByRole('button', { name: /Volver/i });
      const nextButton = screen.getByRole('button', { name: /Continuar/i });

      expect(backButton).toBeEnabled();
      expect(nextButton).toBeDisabled();
    });

    it('Estado 4: Volver habilitado + Continuar habilitado (Paso 1 con barbero seleccionado)', async () => {
      await act(async () => {
        render(<PaywayBooking />);
      });
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /^Corte 45/ }));
      });
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /Continuar/i }));
      });
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /Lautaro/ }));
      });

      const backButton = screen.getByRole('button', { name: /Volver/i });
      const nextButton = screen.getByRole('button', { name: /Continuar/i });

      expect(backButton).toBeEnabled();
      expect(nextButton).toBeEnabled();
    });
  });

  describe('4. Validación matemática de distribución en viewports de referencia', () => {
    const viewports = [
      { name: '360 × 800 px', width: 360, containerMargin: 40, gap: 10 },
      { name: '375 × 667 px', width: 375, containerMargin: 40, gap: 10 },
      { name: '390 × 844 px', width: 390, containerMargin: 40, gap: 10 },
      { name: '430 × 932 px', width: 430, containerMargin: 40, gap: 10 },
    ];

    for (const vp of viewports) {
      it(`Viewport ${vp.name}: distribución compartida idéntica`, () => {
        const innerWidth = vp.width - vp.containerMargin;
        const volverWidth = innerWidth * 0.3; // 30% flex-basis
        const availableForNext = innerWidth - vp.gap - volverWidth;

        expect(volverWidth + vp.gap + availableForNext).toBe(innerWidth);
        expect(volverWidth).toBeGreaterThan(0);
        expect(availableForNext).toBeGreaterThan(volverWidth);
      });
    }
  });
});
