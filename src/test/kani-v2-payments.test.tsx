import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  refresh: vi.fn(),
  role: "BARBER",
  depositSupported: true,
}));
vi.mock("@tanstack/react-router", () => ({ useSearch: () => ({}) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: mocks.rpc } }));
vi.mock("@/lib/kani-admin-context", () => ({
  useAdminStaff: () => ({
    profile: { role: mocks.role, barber_id: "b1" },
    barbers: [{ id: "b1", name: "Gonzalo" }],
  }),
}));
vi.mock("@/components/kani/v2/data", () => ({
  useV2: () => ({
    appointments: [
      {
        id: "a1",
        name: "Juan",
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
    services: [{ id: "corte", name: "Corte", price: 25000 }],
    clients: [],
    barberId: "ALL",
    setBarberId: vi.fn(),
    refresh: mocks.refresh,
    loading: false,
    depositSupported: mocks.depositSupported,
  }),
}));
import { V2Payments } from "@/components/kani/v2/payments";

describe("V2 quick collection", () => {
  beforeEach(() => {
    mocks.rpc.mockReset();
    mocks.refresh.mockReset();
    mocks.role = "BARBER";
    mocks.depositSupported = true;
  });
  it("registers an anonymous walk-in using the authenticated barber and server clock", async () => {
    mocks.rpc.mockResolvedValue({ data: [{ payment_id: "p1" }], error: null });
    render(<V2Payments />);
    fireEvent.click(screen.getByRole("button", { name: "Registrar cobro" }));
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledTimes(1));
    expect(mocks.rpc.mock.calls[0]?.[1]).toMatchObject({
      p_barber_id: "b1",
      p_service_price_ars: 25000,
      p_appointment_id: null,
      p_online_deposit_paid: false,
    });
    expect(mocks.rpc.mock.calls[0]?.[1]).not.toHaveProperty("p_payment_date");
    expect(await screen.findByText("Cobro registrado en pruebas.")).toBeTruthy();
  });
  it("preserves the form and exposes a failure without trying another insert", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "FORBIDDEN_BARBER_SCOPE" } });
    render(<V2Payments />);
    fireEvent.click(screen.getByRole("button", { name: "Registrar cobro" }));
    expect(await screen.findByText(/No se confirmó el cobro/)).toBeTruthy();
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
  it("does not permit collecting an appointment with unverifiable deposit information", () => {
    mocks.depositSupported = false;
    render(<V2Payments />);
    fireEvent.click(screen.getByRole("button", { name: "Con turno" }));
    fireEvent.change(screen.getByLabelText("Turno"), { target: { value: "a1" } });
    expect(screen.getByRole("button", { name: "Registrar cobro" })).toBeDisabled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
