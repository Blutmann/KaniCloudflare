import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AdminMaintenance } from '@/components/kani/admin-maintenance';
import { BENEFIT_TYPE_DEFINITIONS, calculateBenefitAmounts } from '@/lib/kani-benefit-codes';

// Mock staff as ADMIN
vi.mock('@/lib/kani-admin-context', () => ({
  useAdminStaff: () => ({
    profile: {
      id: 'admin-1',
      displayName: 'Administrador Kani',
      role: 'ADMIN',
      email: 'admin@kanibarber.com',
    },
  }),
}));

// Mock countAvailabilityNotifications
vi.mock('@/lib/kani-maintenance', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/kani-maintenance')>();
  return {
    ...actual,
    countAvailabilityNotifications: vi.fn().mockResolvedValue(0),
  };
});

describe('Mantenimiento -> Encabezado y Modal de Generar Código de Descuento', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    // Mock fetch for benefit codes list
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/api/admin/benefit-codes')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            ok: true,
            items: [],
          }),
        });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({}),
      });
    }) as any;
  });

  describe('1. Encabezado de Mantenimiento', () => {
    it('muestra únicamente el título "Mantenimiento." y elimina eyebrow y descripción previa', async () => {
      let container: HTMLElement;
      await React.act(async () => {
        const res = render(<AdminMaintenance />);
        container = res.container;
      });

      const heading = container!.querySelector('h1#maintenance-title');
      expect(heading).not.toBeNull();
      expect(heading?.textContent).toBe('Mantenimiento.');

      // Verificar que NO existe la etiqueta MANTENIMIENTO ni la descripción previa
      const pageTitleBlock = container!.querySelector('.v2-page-title');
      expect(pageTitleBlock?.textContent).toContain('Mantenimiento.');
      expect(pageTitleBlock?.textContent).not.toContain('Limpieza de registros e historial de disponibilidad.');
      expect(pageTitleBlock?.querySelector('.v2-eyebrow')).toBeNull();
    });
  });

  describe('2. Descripciones breves en BENEFIT_TYPE_DEFINITIONS', () => {
    it('contiene las descripciones breves exactas solicitadas', () => {
      expect(BENEFIT_TYPE_DEFINITIONS.NO_DEPOSIT.label).toBe('Reserva sin seña');
      expect(BENEFIT_TYPE_DEFINITIONS.NO_DEPOSIT.description).toBe(
        'Sin descuento, pero permite reservar sin pagar seña.'
      );

      expect(BENEFIT_TYPE_DEFINITIONS.FREE_SERVICE.label).toBe('Servicio gratuito');
      expect(BENEFIT_TYPE_DEFINITIONS.FREE_SERVICE.description).toBe(
        'Bonificación del 100% de la seña y del servicio.'
      );

      expect(BENEFIT_TYPE_DEFINITIONS.PERCENT_10.label).toBe('Descuento del 10%');
      expect(BENEFIT_TYPE_DEFINITIONS.PERCENT_10.description).toBe(
        'Bonificación del 10% del servicio. Se abona la seña completa.'
      );

      expect(BENEFIT_TYPE_DEFINITIONS.PERCENT_50.label).toBe('Descuento del 50%');
      expect(BENEFIT_TYPE_DEFINITIONS.PERCENT_50.description).toBe(
        'Bonificación del 50% del servicio. Se abona la seña completa.'
      );
    });

    it('conserva la regla de cálculo que limita la seña al total final si este es menor', () => {
      // Caso 1: Servicio 10.000, seña 4.000, sin descuento -> seña 0, saldo 10.000
      const quoteNoDeposit = calculateBenefitAmounts(10000, 4000, 'NO_DEPOSIT', 'TEST-NO-DEP');
      expect(quoteNoDeposit.skipOnlinePayment).toBe(true);
      expect(quoteNoDeposit.onlineDepositArs).toBe(0);
      expect(quoteNoDeposit.inPersonBalanceArs).toBe(10000);

      // Caso 2: Servicio 10.000, seña 4.000, 50% desc -> total 5.000, seña min(4000, 5000)=4000, saldo 1000
      const quote50 = calculateBenefitAmounts(10000, 4000, 'PERCENT_50', 'TEST-50');
      expect(quote50.discountAmountArs).toBe(5000);
      expect(quote50.finalPriceArs).toBe(5000);
      expect(quote50.onlineDepositArs).toBe(4000);
      expect(quote50.inPersonBalanceArs).toBe(1000);

      // Caso 3: Servicio 5.000, seña 4.000, 50% desc -> total 2.500, seña min(4000, 2500) = 2.500, saldo 0!
      const quote50Capped = calculateBenefitAmounts(5000, 4000, 'PERCENT_50', 'TEST-50-CAP');
      expect(quote50Capped.discountAmountArs).toBe(2500);
      expect(quote50Capped.finalPriceArs).toBe(2500);
      expect(quote50Capped.onlineDepositArs).toBe(2500); // Se limita al total
      expect(quote50Capped.inPersonBalanceArs).toBe(0);
    });
  });

  describe('3. Ventana modal Generar código de descuento', () => {
    it('al abrir la ventana, tiene el nuevo título, no tiene el párrafo largo y tiene la etiqueta opcional', async () => {
      let container: HTMLElement;
      await React.act(async () => {
        const res = render(<AdminMaintenance />);
        container = res.container;
      });

      // Click en botón "Generar código"
      const generateBtn = screen.getByRole('button', { name: /generar código/i });
      expect(generateBtn).not.toBeNull();

      await React.act(async () => {
        fireEvent.click(generateBtn);
      });

      // Título de la modal
      const modalTitle = screen.getByRole('heading', { name: /generar código de descuento/i });
      expect(modalTitle).not.toBeNull();

      // Párrafo eliminado
      const oldParagraph = screen.queryByText(/Los códigos son de un solo uso y quedan vinculados estrictamente/i);
      expect(oldParagraph).toBeNull();

      // Etiqueta de código personalizado
      const customCodeLabel = screen.getByText(/^Código personalizado \(opcional\)$/i);
      expect(customCodeLabel).not.toBeNull();

      // Verificar que están las 4 descripciones en la modal
      expect(screen.getByText('Sin descuento, pero permite reservar sin pagar seña.')).not.toBeNull();
      expect(screen.getByText('Bonificación del 100% de la seña y del servicio.')).not.toBeNull();
      expect(screen.getByText('Bonificación del 10% del servicio. Se abona la seña completa.')).not.toBeNull();
      expect(screen.getByText('Bonificación del 50% del servicio. Se abona la seña completa.')).not.toBeNull();

      // Verificar estructura de scroll mobile-safe
      const dialogContent = document.querySelector('.benefit-code-dialog-content');
      expect(dialogContent).not.toBeNull();
      expect(dialogContent?.querySelector('.benefit-code-dialog-header')).not.toBeNull();
      expect(dialogContent?.querySelector('.benefit-code-dialog-scroll-body')).not.toBeNull();
      expect(dialogContent?.querySelector('.benefit-code-dialog-footer')).not.toBeNull();

      // Botones accesibles
      expect(screen.getByRole('button', { name: /cancelar/i })).not.toBeNull();
      expect(screen.getByRole('button', { name: /crear código/i })).not.toBeNull();
    });
  });
});
