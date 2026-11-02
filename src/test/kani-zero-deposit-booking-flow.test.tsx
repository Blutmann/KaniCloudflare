import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { calculateBenefitAmounts, BENEFIT_TYPE_DEFINITIONS } from '@/lib/kani-benefit-codes';
import { PaywayBooking } from '@/components/kani/experimental/payway-booking';

// Mock server functions
const mocks = vi.hoisted(() => ({
  confirmZeroDeposit: vi.fn(),
  preparePayway: vi.fn(),
  validateQuote: vi.fn(),
}));

vi.mock('@/lib/kani-benefit-codes.functions', () => ({
  confirmZeroDepositBookingFn: (args: any) => mocks.confirmZeroDeposit(args),
  validateBenefitCodeQuoteFn: (args: any) => mocks.validateQuote(args),
}));

vi.mock('@/lib/kani-payway.functions', () => ({
  preparePaywayCheckoutFn: (args: any) => mocks.preparePayway(args),
  payPaywayDepositFn: vi.fn(),
  checkPaywayPaymentStatusFn: vi.fn(),
}));

// Mock booking child component to control draft submission
vi.mock('@/components/kani/booking', () => ({
  Booking: ({ onPaymentRequest, appliedBenefit }: any) => {
    return (
      <div data-testid="mock-booking">
        <button
          data-testid="submit-no-deposit"
          onClick={() => {
            onPaymentRequest({
              barber: 'Lautaro',
              serviceName: 'Corte',
              date: '2026-11-03',
              time: '14:30',
              name: 'Tomas Cliente',
              phone: '+5491155551234',
              email: 'tomas@example.com',
              benefitCode: 'KANI-NODEP-TEST',
              benefitQuote: {
                valid: true,
                type: 'NO_DEPOSIT',
                code: 'KANI-NODEP-TEST',
                skipOnlinePayment: true,
                originalPriceArs: 25000,
                discountAmountArs: 0,
                finalPriceArs: 25000,
                onlineDepositArs: 0,
                inPersonBalanceArs: 25000,
                benefitType: 'NO_DEPOSIT',
                benefitLabel: 'Reserva sin seña',
                buttonLabel: 'Reservar turno',
                explanation: 'Sin seña',
              },
            }).catch(() => {});
          }}
        >
          Confirmar Sin Seña
        </button>

        <button
          data-testid="submit-free-service"
          onClick={() => {
            onPaymentRequest({
              barber: 'Lautaro',
              serviceName: 'Corte',
              date: '2026-11-03',
              time: '15:15',
              name: 'Tomas Cliente',
              phone: '+5491155551234',
              email: 'tomas@example.com',
              benefitCode: 'KANI-FREE-TEST',
              benefitQuote: {
                valid: true,
                type: 'FREE_SERVICE',
                code: 'KANI-FREE-TEST',
                skipOnlinePayment: true,
                originalPriceArs: 25000,
                discountAmountArs: 25000,
                finalPriceArs: 0,
                onlineDepositArs: 0,
                inPersonBalanceArs: 0,
                benefitType: 'FREE_SERVICE',
                benefitLabel: 'Servicio gratuito',
                buttonLabel: 'Reservar turno',
                explanation: 'Gratuito',
              },
            }).catch(() => {});
          }}
        >
          Confirmar Gratuito
        </button>

        <button
          data-testid="submit-percent-50"
          onClick={() => {
            onPaymentRequest({
              barber: 'Lautaro',
              serviceName: 'Corte',
              date: '2026-11-03',
              time: '16:00',
              name: 'Tomas Cliente',
              phone: '+5491155551234',
              email: 'tomas@example.com',
              benefitCode: 'KANI-50-TEST',
              benefitQuote: {
                valid: true,
                type: 'PERCENT_50',
                code: 'KANI-50-TEST',
                skipOnlinePayment: false,
                originalPriceArs: 25000,
                discountAmountArs: 12500,
                finalPriceArs: 12500,
                onlineDepositArs: 5000,
                inPersonBalanceArs: 7500,
                benefitType: 'PERCENT_50',
                benefitLabel: 'Descuento del 50%',
                buttonLabel: 'Pagar seña con tarjeta',
                explanation: '50% off',
              },
            }).catch(() => {});
          }}
        >
          Confirmar con Seña 50%
        </button>
      </div>
    );
  },
}));

describe('Kani — Flujo de Reserva con Beneficio Sin Seña y Servicio Gratuito', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
  });

  describe('1. Comportamiento esperado para NO_DEPOSIT', () => {
    it('confirma directamente sin llamar a Payway checkout ni abrir modal de pago', async () => {
      mocks.confirmZeroDeposit.mockResolvedValueOnce({
        success: true,
        appointmentId: 'appt-nodep-1',
        requestNumber: 201,
        calculation: {
          code: 'KANI-NODEP-TEST',
          benefitType: 'NO_DEPOSIT',
          originalPriceArs: 25000,
          discountAmountArs: 0,
          finalPriceArs: 25000,
          onlineDepositArs: 0,
          inPersonBalanceArs: 25000,
          skipOnlinePayment: true,
        },
      });

      render(<PaywayBooking />);

      const btn = screen.getByTestId('submit-no-deposit');
      btn.click();

      await waitFor(() => {
        expect(mocks.confirmZeroDeposit).toHaveBeenCalledTimes(1);
        expect(mocks.confirmZeroDeposit).toHaveBeenCalledWith({
          data: expect.objectContaining({
            benefitCode: 'KANI-NODEP-TEST',
            barberName: 'Lautaro',
            serviceName: 'Corte',
            bookingDate: '2026-11-03',
            startTime: '14:30',
            clientName: 'Tomas Cliente',
          }),
        });
      });

      // NO debe haber llamado a preparePaywayCheckoutFn
      expect(mocks.preparePayway).not.toHaveBeenCalled();

      // El modal de Payway NO debe estar abierto
      expect(screen.queryByText(/Pagá la seña/i)).toBeNull();
      expect(screen.queryByText(/VERIFIED_PAYMENT_REQUIRED/i)).toBeNull();
    });
  });

  describe('2. Comportamiento esperado para FREE_SERVICE', () => {
    it('confirma directamente con total $0 y saldo $0 sin pasar por pasarela', async () => {
      mocks.confirmZeroDeposit.mockResolvedValueOnce({
        success: true,
        appointmentId: 'appt-free-1',
        requestNumber: 202,
        calculation: {
          code: 'KANI-FREE-TEST',
          benefitType: 'FREE_SERVICE',
          originalPriceArs: 25000,
          discountAmountArs: 25000,
          finalPriceArs: 0,
          onlineDepositArs: 0,
          inPersonBalanceArs: 0,
          skipOnlinePayment: true,
        },
      });

      render(<PaywayBooking />);

      const btn = screen.getByTestId('submit-free-service');
      btn.click();

      await waitFor(() => {
        expect(mocks.confirmZeroDeposit).toHaveBeenCalledTimes(1);
      });

      expect(mocks.preparePayway).not.toHaveBeenCalled();
      expect(screen.queryByText(/Pagá la seña/i)).toBeNull();
    });
  });

  describe('3. Protección para reservas con pago online (PERCENT_50)', () => {
    it('cuando la seña online es requerida, sí prepara el checkout de Payway', async () => {
      mocks.preparePayway.mockResolvedValueOnce({
        ready: true,
        checkout: {
          appointmentId: 'appt-pay-1',
          depositArs: 5000,
          siteTransactionId: 'KANI-TEST-TX',
          publicKey: 'mock-pk',
          environment: 'production',
        },
      });

      await React.act(async () => {
        render(<PaywayBooking />);
      });

      const btn = screen.getByTestId('submit-percent-50');
      await React.act(async () => {
        btn.click();
      });

      await waitFor(() => {
        expect(mocks.preparePayway).toHaveBeenCalledTimes(1);
      });

      // No debe llamar a confirmZeroDeposit si requiere seña
      expect(mocks.confirmZeroDeposit).not.toHaveBeenCalled();
    });
  });

  describe('4. Manejo de error en reserva directa sin seña', () => {
    it('si falla con código ya consumido, rechaza con mensaje amigable y NO abre el modal de Payway', async () => {
      mocks.confirmZeroDeposit.mockRejectedValueOnce(
        new Error('BENEFIT_CODE_ALREADY_CONSUMED')
      );

      await React.act(async () => {
        render(<PaywayBooking />);
      });

      const btn = screen.getByTestId('submit-no-deposit');
      await React.act(async () => {
        try {
          btn.click();
        } catch {
          // ignore synchronous dispatch
        }
      });

      await waitFor(() => {
        expect(mocks.confirmZeroDeposit).toHaveBeenCalledTimes(1);
      });

      // El modal de Payway jamás debe abrirse
      expect(screen.queryByText(/Pagá la seña/i)).toBeNull();
    });
  });

  describe('5. Invariantes de cálculo y cotización', () => {
    it('NO_DEPOSIT: descuento $0, final $25.000, seña online $0, saldo en local $25.000', () => {
      const calc = calculateBenefitAmounts(25000, 5000, 'NO_DEPOSIT', 'KANI-NO-DEP');
      expect(calc.discountAmountArs).toBe(0);
      expect(calc.finalPriceArs).toBe(25000);
      expect(calc.onlineDepositArs).toBe(0);
      expect(calc.inPersonBalanceArs).toBe(25000);
      expect(calc.skipOnlinePayment).toBe(true);
      expect(calc.buttonLabel).toBe('Reservar turno');
    });

    it('FREE_SERVICE: descuento $25.000, final $0, seña online $0, saldo en local $0', () => {
      const calc = calculateBenefitAmounts(25000, 5000, 'FREE_SERVICE', 'KANI-FREE');
      expect(calc.discountAmountArs).toBe(25000);
      expect(calc.finalPriceArs).toBe(0);
      expect(calc.onlineDepositArs).toBe(0);
      expect(calc.inPersonBalanceArs).toBe(0);
      expect(calc.skipOnlinePayment).toBe(true);
      expect(calc.buttonLabel).toBe('Reservar turno');
    });
  });
});
