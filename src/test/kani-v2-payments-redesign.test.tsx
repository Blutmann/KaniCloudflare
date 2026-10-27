import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  refresh: vi.fn(),
  role: "ADMIN",
  depositSupported: true,
}));

vi.mock("@tanstack/react-router", () => ({ useSearch: () => ({}) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: mocks.rpc } }));
vi.mock("@/lib/kani-admin-context", () => ({
  useAdminStaff: () => ({
    profile: { role: mocks.role, barber_id: "b1" },
    barbers: [
      { id: "b1", name: "Gonzalo" },
      { id: "b2", name: "Lucas" },
    ],
  }),
}));
vi.mock("@/components/kani/v2/data", () => ({
  useV2: () => ({
    appointments: [
      {
        id: "a1",
        name: "Carlos Gómez",
        serviceName: "Corte",
        servicePrice: 25000,
        barberId: "b1",
        barber: "Gonzalo",
        statusCode: "CONFIRMED",
        date: "2026-10-21",
        time: "10:00",
        depositPaid: true,
        depositAmountArs: 5000,
      },
    ],
    payments: [],
    services: [
      { id: "corte", name: "Corte", price: 25000 },
      { id: "barba", name: "Barba", price: 15000 },
    ],
    clients: [
      { id: "c1", name: "Matías", phone: "+5491112345678", draft: false, archived: false },
    ],
    barberId: "ALL",
    setBarberId: vi.fn(),
    refresh: mocks.refresh,
    loading: false,
    depositSupported: mocks.depositSupported,
  }),
}));

import { V2Payments } from "@/components/kani/v2/payments";

describe("Admin V2 — Rediseño de Registrar Pago Mobile y Desktop", () => {
  it("renders Importe ($ ARS) as a standard form field with default catalog price", () => {
    render(<V2Payments />);
    // Importe field exists directly without details/summary
    const importeInput = screen.getByLabelText(/Importe \(\$ ARS\)/i) as HTMLInputElement;
    expect(importeInput).toBeDefined();
    expect(importeInput.type).toBe("number");
    expect(importeInput.value).toBe("25000");

    // No details/summary for editing importe
    expect(screen.queryByText("Editar importe")).toBeNull();
  });

  it("eliminates redundant Buenos Aires footnote completely", () => {
    render(<V2Payments />);
    expect(
      screen.queryByText(/Fecha y hora actuales de Buenos Aires/i),
    ).toBeNull();
  });

  it("renders contextual secondary buttons for Asociar cliente and Agregar descuento", () => {
    render(<V2Payments />);
    const asociarBtn = screen.getByRole("button", { name: /Asociar cliente/i });
    const descuentoBtn = screen.getByRole("button", { name: /Agregar descuento/i });
    expect(asociarBtn).toBeDefined();
    expect(descuentoBtn).toBeDefined();

    // Inset client fields are not visible initially
    expect(screen.queryByLabelText(/Cliente existente/i)).toBeNull();

    // Toggle Asociar cliente
    fireEvent.click(asociarBtn);
    expect(screen.getByLabelText(/Cliente existente/i)).toBeDefined();
    expect(screen.getByRole("button", { name: /Ocultar cliente/i })).toBeDefined();

    // Toggle Agregar descuento
    fireEvent.click(descuentoBtn);
    expect(screen.getByLabelText(/Descuento en pesos/i)).toBeDefined();
    expect(screen.getByRole("button", { name: /Quitar descuento/i })).toBeDefined();
  });

  it("displays clear economic hierarchy in summary block", () => {
    render(<V2Payments />);
    // Initial summary: base price $25.000, total $25.000
    expect(screen.getByText("A cobrar ahora")).toBeDefined();
    expect(screen.getAllByText("$25.000").length).toBe(2);

    // Add discount
    fireEvent.click(screen.getByRole("button", { name: /Agregar descuento/i }));
    const discountInput = screen.getByLabelText(/Descuento en pesos/i);
    fireEvent.change(discountInput, { target: { value: "3000" } });

    // Now discount row is rendered and total updates
    expect(screen.getByText("- $3.000")).toBeDefined();
    expect(screen.getByText("$22.000")).toBeDefined();
  });

  it("calculates economic breakdown for appointment with deposit", () => {
    render(<V2Payments />);
    fireEvent.click(screen.getByRole("button", { name: "Con turno" }));
    fireEvent.change(screen.getByLabelText("Turno"), { target: { value: "a1" } });

    // Seña is displayed as deducted
    expect(screen.getByText("Seña abonada")).toBeDefined();
    expect(screen.getByText("- $5.000")).toBeDefined();

    // Total = $25.000 - $5.000 = $20.000
    expect(screen.getByText("$20.000")).toBeDefined();
  });
});
