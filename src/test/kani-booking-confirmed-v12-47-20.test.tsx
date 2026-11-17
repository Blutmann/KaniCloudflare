import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import {
  BookingConfirmedScreen,
  deriveConfirmedFinancials,
  type ConfirmedBookingData,
} from "@/components/kani/booking-confirmed-screen";
import { KANI_MAPS_URL, KANI_STUDIO_ADDRESS, KANI_STUDIO_NAME } from "@/lib/kani-constants";

describe("V12.47.20 — Booking Confirmation UX («¡Turno confirmado!»)", () => {
  beforeEach(() => {
    document.body.classList.add("liquid-glass-active");
  });

  afterEach(() => {
    cleanup();
    document.body.classList.remove("liquid-glass-active");
    vi.clearAllMocks();
  });

  it("1. Reserva con seña abonada ($25.000, seña $5.000 -> saldo $20.000) y acordeón cerrado por defecto", () => {
    const confirmed: ConfirmedBookingData = {
      appointmentId: "apt-1",
      serviceName: "Corte",
      barber: "Lautaro",
      date: "2026-11-16",
      time: "12:15",
      clientName: "Tomás Pérez",
      servicePriceArs: 25000,
      depositArs: 5000,
    };

    render(<BookingConfirmedScreen confirmed={confirmed} />);

    expect(screen.getByRole("heading", { name: "¡Turno confirmado!" })).toBeInTheDocument();
    expect(screen.getByText("Te enviamos los detalles por mail y WhatsApp.")).toBeInTheDocument();
    expect(screen.getAllByText("12:15 hs")[0]).toBeInTheDocument();
    expect(screen.getAllByText("Corte")[0]).toBeInTheDocument();
    expect(screen.getAllByText("Lautaro")[0]).toBeInTheDocument();
    expect(screen.getAllByText("$20.000")[0]).toBeInTheDocument();
    expect(screen.queryByText("Sin saldo pendiente")).not.toBeInTheDocument();

    // Acordeón cerrado inicialmente
    const toggle = screen.getByRole("button", { name: /Ver detalles de la reserva/i });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    const panelId = toggle.getAttribute("aria-controls")!;
    const panel = document.getElementById(panelId)!;
    expect(panel).toHaveAttribute("hidden");

    // Abrir acordeón y verificar detalles completos sin beneficios inexistentes
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(panel).not.toHaveAttribute("hidden");
    expect(screen.getByText("Tomás Pérez")).toBeInTheDocument();
    expect(screen.getByText("$25.000")).toBeInTheDocument();
    expect(screen.getByText("$5.000 abonada")).toBeInTheDocument();
    expect(screen.queryByText("Beneficio aplicado")).not.toBeInTheDocument();
    expect(screen.queryByText("Bonificación aplicada")).not.toBeInTheDocument();
  });

  it("2. Reserva sin seña (NO_DEPOSIT, $25.000 -> saldo $25.000)", () => {
    const confirmed: ConfirmedBookingData = {
      appointmentId: "apt-2",
      serviceName: "Corte",
      barber: "Gonzalo",
      date: "2026-11-18",
      time: "14:00",
      servicePriceArs: 25000,
      depositArs: 0,
      benefitType: "NO_DEPOSIT",
      inPersonBalanceArs: 25000,
    };

    render(<BookingConfirmedScreen confirmed={confirmed} />);
    expect(screen.getAllByText("$25.000")[0]).toBeInTheDocument();
    expect(screen.queryByText("Sin saldo pendiente")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Ver detalles de la reserva/i }));
    expect(screen.getByText("Reserva sin seña")).toBeInTheDocument();
    expect(screen.getByText("No requerida ($0)")).toBeInTheDocument();
  });

  it("3. Reserva con descuento del 10% ($25.000, seña $5.000 -> saldo $17.500)", () => {
    const confirmed: ConfirmedBookingData = {
      appointmentId: "apt-3",
      serviceName: "Corte",
      barber: "Valentín",
      date: "2026-11-19",
      time: "15:00",
      servicePriceArs: 25000,
      depositArs: 5000,
      benefitType: "PERCENT_10",
      originalPriceArs: 25000,
      discountAmountArs: 2500,
      finalPriceArs: 22500,
      onlineDepositArs: 5000,
      inPersonBalanceArs: 17500,
    };

    render(<BookingConfirmedScreen confirmed={confirmed} />);
    expect(screen.getAllByText("$17.500")[0]).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Ver detalles de la reserva/i }));
    expect(screen.getByText("Descuento del 10%")).toBeInTheDocument();
    expect(screen.getByText("−$2.500")).toBeInTheDocument();
    expect(screen.getByText("$22.500")).toBeInTheDocument();
  });

  it("4. Reserva con descuento del 50% ($25.000, seña $5.000 -> saldo $7.500)", () => {
    const fin = deriveConfirmedFinancials({
      serviceName: "Corte",
      barber: "Lautaro",
      date: "2026-11-20",
      time: "16:00",
      servicePriceArs: 25000,
      depositArs: 5000,
      benefitType: "PERCENT_50",
    });

    expect(fin.originalPriceArs).toBe(25000);
    expect(fin.discountAmountArs).toBe(12500);
    expect(fin.finalPriceArs).toBe(12500);
    expect(fin.depositPaidArs).toBe(5000);
    expect(fin.inPersonBalanceArs).toBe(7500);
  });

  it("5. Servicio completamente gratuito (FREE_SERVICE -> saldo $0 + 'Sin saldo pendiente')", () => {
    const confirmed: ConfirmedBookingData = {
      appointmentId: "apt-5",
      serviceName: "Barba",
      barber: "Gonzalo",
      date: "2026-11-21",
      time: "11:00",
      servicePriceArs: 15000,
      depositArs: 0,
      benefitType: "FREE_SERVICE",
      originalPriceArs: 15000,
      discountAmountArs: 15000,
      finalPriceArs: 0,
      onlineDepositArs: 0,
      inPersonBalanceArs: 0,
    };

    render(<BookingConfirmedScreen confirmed={confirmed} />);
    expect(screen.getByText("Sin saldo pendiente")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Ver detalles de la reserva/i }));
    expect(screen.getByText("Servicio 100% bonificado")).toBeInTheDocument();
    expect(screen.getByText("−$15.000")).toBeInTheDocument();
    expect(screen.getByText("No requerida ($0)")).toBeInTheDocument();
  });

  it("6. Bloque de ubicación '¿Dónde estamos?', 'Cómo llegar' y acción principal 'Reservar otro turno'", () => {
    const onHomeClick = vi.fn();
    render(
      <BookingConfirmedScreen
        confirmed={{
          appointmentId: "apt-6",
          serviceName: "Corte",
          barber: "Lautaro",
          date: "2026-11-22",
          time: "10:00",
          servicePriceArs: 25000,
          depositArs: 5000,
        }}
        onHomeClick={onHomeClick}
      />,
    );

    expect(screen.getByRole("heading", { name: "¿Dónde estamos?" })).toBeInTheDocument();
    expect(screen.getByText(KANI_STUDIO_NAME)).toBeInTheDocument();
    expect(screen.getByText(KANI_STUDIO_ADDRESS)).toBeInTheDocument();

    const mapsLink = screen.getByRole("link", { name: /Cómo llegar/i });
    expect(mapsLink).toHaveAttribute("href", KANI_MAPS_URL);

    const homeBtn = screen.getByRole("button", { name: "Reservar otro turno" });
    fireEvent.click(homeBtn);
    expect(onHomeClick).toHaveBeenCalledTimes(1);
  });
});
