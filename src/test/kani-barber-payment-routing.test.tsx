import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { isMercadoPagoBarber, resolveBookingPaymentGateway } from "@/lib/kani-payment-routing";
import type { BookingPaymentDraft } from "@/components/kani/booking";

const mocks = vi.hoisted(() => ({
  preparePaywayCheckoutFn: vi.fn(),
  createBookingOrderFn: vi.fn(),
  getAppointmentPaymentStatusFn: vi.fn(),
  createRealAppointment: vi.fn(),
  confirmZeroDepositBookingFn: vi.fn(),
  lastBookingProps: null as null | { onPaymentRequest?: (draft: BookingPaymentDraft) => Promise<void> },
}));

vi.mock("@/lib/kani-payway.functions", () => ({
  preparePaywayCheckoutFn: (...args: unknown[]) => mocks.preparePaywayCheckoutFn(...args),
  payPaywayDepositFn: vi.fn(),
  checkPaywayPaymentStatusFn: vi.fn(),
}));

vi.mock("@/lib/kani-mercadopago.functions", () => ({
  createBookingOrderFn: (...args: unknown[]) => mocks.createBookingOrderFn(...args),
  getAppointmentPaymentStatusFn: (...args: unknown[]) => mocks.getAppointmentPaymentStatusFn(...args),
}));

vi.mock("@/lib/kani-appointments", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/kani-appointments")>();
  return {
    ...actual,
    createRealAppointment: (...args: unknown[]) => mocks.createRealAppointment(...args),
  };
});

vi.mock("@/lib/kani-benefit-codes.functions", () => ({
  validateBenefitCodeQuoteFn: vi.fn(),
  confirmZeroDepositBookingFn: (...args: unknown[]) => mocks.confirmZeroDepositBookingFn(...args),
}));

vi.mock("@/lib/kani-availability", () => ({
  readConfiguredServices: vi.fn(async () => [
    { id: "corte", name: "Corte", price: 25000, duration: 45, description: "", number: "01" },
  ]),
}));

vi.mock("@/components/kani/booking", () => ({
  mapBenefitErrorMessage: (e: unknown) => String(e ?? "Error"),
  Booking: (props: { onPaymentRequest?: (draft: BookingPaymentDraft) => Promise<void> }) => {
    mocks.lastBookingProps = props;
    return <div data-testid="mock-booking">Mock Booking</div>;
  },
}));

import { PaywayBooking } from "@/components/kani/experimental/payway-booking";

const baseDraft: Omit<BookingPaymentDraft, "barber"> = {
  serviceName: "Corte",
  date: "2026-12-05",
  time: "15:00",
  name: "Juan Cliente",
  phone: "+5491122334455",
  email: "juan@example.com",
  notes: "",
};

describe("Ruteo de pasarela por barbero (/reservar)", () => {
  let assignMock: ReturnType<typeof vi.fn>;
  const originalLocation = window.location;

  beforeEach(() => {
    vi.clearAllMocks();
    window.sessionStorage.clear();
    assignMock = vi.fn();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...originalLocation, assign: assignMock },
    });
  });

  afterEach(() => {
    cleanup();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: originalLocation,
    });
  });

  describe("resolveBookingPaymentGateway (reglas puras)", () => {
    it("rutea Gonzalo con seña > 0 a MERCADO_PAGO", () => {
      expect(isMercadoPagoBarber("Gonzalo")).toBe(true);
      expect(isMercadoPagoBarber("  gonzalo ")).toBe(true);
      expect(
        resolveBookingPaymentGateway({ barberName: "Gonzalo", onlineDepositArs: 5000 }),
      ).toBe("MERCADO_PAGO");
    });

    it("mantiene Valentín y Lautaro con seña > 0 en PAYWAY", () => {
      expect(isMercadoPagoBarber("Valentín")).toBe(false);
      expect(isMercadoPagoBarber("Lautaro")).toBe(false);
      expect(
        resolveBookingPaymentGateway({ barberName: "Valentín", onlineDepositArs: 5000 }),
      ).toBe("PAYWAY");
      expect(
        resolveBookingPaymentGateway({ barberName: "Lautaro", onlineDepositArs: 5000 }),
      ).toBe("PAYWAY");
    });

    it("rutea beneficios de seña $0 (NO_DEPOSIT, FREE_SERVICE, onlineDepositArs === 0) a DIRECT_ZERO_DEPOSIT para cualquier barbero", () => {
      for (const barberName of ["Gonzalo", "Valentín", "Lautaro"]) {
        expect(
          resolveBookingPaymentGateway({ barberName, benefitType: "NO_DEPOSIT", skipOnlinePayment: true, onlineDepositArs: 0 }),
        ).toBe("DIRECT_ZERO_DEPOSIT");
        expect(
          resolveBookingPaymentGateway({ barberName, benefitType: "FREE_SERVICE", skipOnlinePayment: true, onlineDepositArs: 0 }),
        ).toBe("DIRECT_ZERO_DEPOSIT");
        expect(
          resolveBookingPaymentGateway({ barberName, onlineDepositArs: 0 }),
        ).toBe("DIRECT_ZERO_DEPOSIT");
      }
    });

    it("rutea Gonzalo con PERCENT_10 / PERCENT_50 y seña > 0 a MERCADO_PAGO", () => {
      expect(
        resolveBookingPaymentGateway({
          barberName: "Gonzalo",
          benefitType: "PERCENT_50",
          skipOnlinePayment: false,
          onlineDepositArs: 5000,
        }),
      ).toBe("MERCADO_PAGO");
    });
  });

  describe("Integración en PaywayBooking (/reservar)", () => {
    it("Gonzalo con seña > 0 crea orden en Mercado Pago y redirige a Checkout Pro sin abrir Payway", async () => {
      mocks.createRealAppointment.mockResolvedValueOnce({ appointment_id: "apt-gonza-1" });
      mocks.createBookingOrderFn.mockResolvedValueOnce({
        success: true,
        orderId: "ORD-GONZA-1",
        checkoutUrl: "https://www.mercadopago.com.ar/checkout/v1/redirect?order_id=ORD-GONZA-1",
        depositAmount: 5000,
      });

      render(<PaywayBooking homeUrl="/reservar" />);
      expect(mocks.lastBookingProps?.onPaymentRequest).toBeDefined();

      await act(async () => {
        await mocks.lastBookingProps!.onPaymentRequest!({
          ...baseDraft,
          barber: "Gonzalo",
        });
      });

      expect(mocks.createRealAppointment).toHaveBeenCalledWith(
        expect.objectContaining({ barber: "Gonzalo", serviceName: "Corte" }),
      );
      expect(mocks.createBookingOrderFn).toHaveBeenCalledWith({
        data: expect.objectContaining({
          appointmentId: "apt-gonza-1",
          barberName: "Gonzalo",
        }),
      });
      expect(assignMock).toHaveBeenCalledWith(
        "https://www.mercadopago.com.ar/checkout/v1/redirect?order_id=ORD-GONZA-1",
      );
      expect(mocks.preparePaywayCheckoutFn).not.toHaveBeenCalled();
    });

    it("Gonzalo con código PERCENT_50 pasa benefitCode a createBookingOrderFn y redirige a Mercado Pago", async () => {
      mocks.createRealAppointment.mockResolvedValueOnce({ appointment_id: "apt-gonza-50" });
      mocks.createBookingOrderFn.mockResolvedValueOnce({
        success: true,
        orderId: "ORD-GONZA-50",
        checkoutUrl: "https://www.mercadopago.com.ar/checkout/v1/redirect?order_id=ORD-GONZA-50",
        depositAmount: 5000,
      });

      render(<PaywayBooking homeUrl="/reservar" />);

      await act(async () => {
        await mocks.lastBookingProps!.onPaymentRequest!({
          ...baseDraft,
          barber: "Gonzalo",
          benefitCode: "KANI-50-OFF",
          benefitQuote: {
            valid: true,
            code: "KANI-50-OFF",
            type: "PERCENT_50",
            benefitType: "PERCENT_50",
            benefitLabel: "50%",
            label: "50%",
            originalPriceArs: 25000,
            discountAmountArs: 12500,
            finalPriceArs: 12500,
            onlineDepositArs: 5000,
            inPersonBalanceArs: 7500,
            skipOnlinePayment: false,
            buttonLabel: "Pagar seña",
            explanation: "",
            calculation: {
              code: "KANI-50-OFF",
              benefitType: "PERCENT_50",
              benefitLabel: "50%",
              originalPriceArs: 25000,
              discountAmountArs: 12500,
              finalPriceArs: 12500,
              onlineDepositArs: 5000,
              inPersonBalanceArs: 7500,
              skipOnlinePayment: false,
              buttonLabel: "Pagar seña",
              explanation: "",
            },
          },
        });
      });

      expect(mocks.createBookingOrderFn).toHaveBeenCalledWith({
        data: expect.objectContaining({
          appointmentId: "apt-gonza-50",
          barberName: "Gonzalo",
          benefitCode: "KANI-50-OFF",
        }),
      });
      expect(assignMock).toHaveBeenCalledWith(
        "https://www.mercadopago.com.ar/checkout/v1/redirect?order_id=ORD-GONZA-50",
      );
      expect(mocks.preparePaywayCheckoutFn).not.toHaveBeenCalled();
    });

    it.each(["Valentín", "Lautaro"] as const)(
      "%s con seña > 0 mantiene el flujo de Payway sin invocar Mercado Pago",
      async (barber) => {
        mocks.preparePaywayCheckoutFn.mockResolvedValueOnce({
          ready: true,
          checkout: {
            appointmentId: `apt-${barber}`,
            attemptId: "att-1234",
            accessToken: "tok-1234",
            depositArs: 5000,
            publicKey: "pk_test",
            apiBaseUrl: "https://developers.decidir.com/api/v2",
            methods: [{ id: 1, label: "Visa" }],
          },
        });

        render(<PaywayBooking homeUrl="/reservar" />);

        await act(async () => {
          await mocks.lastBookingProps!.onPaymentRequest!({
            ...baseDraft,
            barber,
          });
        });

        expect(mocks.preparePaywayCheckoutFn).toHaveBeenCalledWith({
          data: expect.objectContaining({ barber }),
        });
        expect(mocks.createBookingOrderFn).not.toHaveBeenCalled();
        expect(assignMock).not.toHaveBeenCalled();

        await waitFor(() => {
          expect(screen.getByText(/Pagá la seña con Payway/i)).toBeInTheDocument();
        });
      },
    );

    it("Gonzalo con beneficio NO_DEPOSIT ($0) confirma directo sin pasar por Mercado Pago ni Payway", async () => {
      mocks.confirmZeroDepositBookingFn.mockResolvedValueOnce({
        success: true,
        appointmentId: "apt-zero-gonza",
        calculation: {
          code: "SIN-SENA",
          benefitType: "NO_DEPOSIT",
          benefitLabel: "Sin seña",
          originalPriceArs: 25000,
          discountAmountArs: 0,
          finalPriceArs: 25000,
          onlineDepositArs: 0,
          inPersonBalanceArs: 25000,
          skipOnlinePayment: true,
          buttonLabel: "Reservar turno",
          explanation: "",
        },
      });

      render(<PaywayBooking homeUrl="/reservar" />);

      await act(async () => {
        await mocks.lastBookingProps!.onPaymentRequest!({
          ...baseDraft,
          barber: "Gonzalo",
          benefitCode: "SIN-SENA",
          benefitQuote: {
            valid: true,
            code: "SIN-SENA",
            type: "NO_DEPOSIT",
            benefitType: "NO_DEPOSIT",
            benefitLabel: "Sin seña",
            label: "Sin seña",
            originalPriceArs: 25000,
            discountAmountArs: 0,
            finalPriceArs: 25000,
            onlineDepositArs: 0,
            inPersonBalanceArs: 25000,
            skipOnlinePayment: true,
            buttonLabel: "Reservar turno",
            explanation: "",
            calculation: {
              code: "SIN-SENA",
              benefitType: "NO_DEPOSIT",
              benefitLabel: "Sin seña",
              originalPriceArs: 25000,
              discountAmountArs: 0,
              finalPriceArs: 25000,
              onlineDepositArs: 0,
              inPersonBalanceArs: 25000,
              skipOnlinePayment: true,
              buttonLabel: "Reservar turno",
              explanation: "",
            },
          },
        });
      });

      expect(mocks.confirmZeroDepositBookingFn).toHaveBeenCalledWith({
        data: expect.objectContaining({
          barberName: "Gonzalo",
          benefitCode: "SIN-SENA",
        }),
      });
      expect(mocks.createBookingOrderFn).not.toHaveBeenCalled();
      expect(mocks.preparePaywayCheckoutFn).not.toHaveBeenCalled();
      expect(assignMock).not.toHaveBeenCalled();
    });
  });
});
