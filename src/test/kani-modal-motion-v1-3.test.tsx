import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { resetModalOriginForTests } from "@/lib/kani-modal-origin";
import { ManualAppointmentDialog } from "@/components/kani/v2/manual-appointment-dialog";
import { V2Payments } from "@/components/kani/v2/payments";

vi.mock("@tanstack/react-router", () => ({
  useSearch: () => ({}),
  useNavigate: () => vi.fn(),
  useLocation: () => "/admin/pagos",
}));

vi.mock("@/lib/kani-admin-context", () => ({
  useAdminStaff: () => ({
    profile: { role: "ADMIN", barber_id: "b1" },
    barbers: [
      { id: "b1", name: "Gonzalo" },
      { id: "b2", name: "Mateo" },
    ],
  }),
}));

vi.mock("@/components/kani/v2/data", () => ({
  useV2: () => ({
    services: [
      { id: "corte", dbId: "svc-1", name: "Corte", duration: 45, price: 25000 },
      { id: "barba", dbId: "svc-2", name: "Barba", duration: 30, price: 15000 },
    ],
    clients: [],
    appointments: [],
    payments: [
      {
        id: "pay-1",
        appointmentId: "apt-1",
        clientId: "cli-1",
        clientName: "Juan Pérez",
        barberId: "b1",
        barberName: "Gonzalo",
        serviceName: "Corte",
        servicePriceArs: 25000,
        finalAmountArs: 25000,
        collectedAmountArs: 25000,
        onlineDepositArs: 0,
        inPersonAmountArs: 25000,
        paymentMethod: "CASH",
        paymentStatus: "PAID",
        collectedAt: new Date().toISOString(),
        paymentDate: new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }).format(new Date()),
        paymentTime: "14:00",
        bookingDate: "2026-11-18",
        startTime: "14:00",
        notes: "",
      },
    ],
    barberId: "ALL",
    setBarberId: vi.fn(),
    date: "2026-04-10",
    setDate: vi.fn(),
    today: "2026-04-10",
    period: "TODAY",
    setPeriod: vi.fn(),
    customFrom: "2026-04-10",
    setCustomFrom: vi.fn(),
    customTo: "2026-04-10",
    setCustomTo: vi.fn(),
    refresh: vi.fn(),
  }),
}));

vi.mock("@/lib/kani-admin-notifications.functions", () => ({
  fetchPaymentNotificationsServer: vi.fn().mockResolvedValue({ items: [] }),
}));

describe("KANI Motion System v1.3 — Extensión a modales accionables", () => {
  beforeEach(() => {
    resetModalOriginForTests();
    vi.restoreAllMocks();
  });

  it("1. Extiende container-transform a todos los modales accionables (Categoría A) y preserva excepciones (B y C)", () => {
    const read = (rel: string) => fs.readFileSync(path.resolve(__dirname, "..", rel), "utf-8");

    // Categoría A (Accionables)
    expect(read("components/kani/v2/manual-appointment-dialog.tsx")).toContain('transitionMode="container-transform"');
    expect(read("components/kani/admin-schedule-manager.tsx")).toContain('transitionMode="container-transform"');
    expect(read("components/kani/v2/clients.tsx").match(/transitionMode="container-transform"/g)?.length).toBe(3);
    expect(read("components/kani/v2/memberships-discounts.tsx").match(/transitionMode="container-transform"/g)?.length).toBe(1);
    expect(read("components/kani/v2/MembershipCard.tsx")).toContain('transitionMode="container-transform"');
    expect(read("components/kani/admin-benefit-codes-section.tsx").match(/transitionMode="container-transform"/g)?.length).toBe(4);
    expect(read("components/kani/v2/payments.tsx").match(/transitionMode="container-transform"/g)?.length).toBe(2);
    expect(read("components/kani/v2/agenda.tsx").match(/transitionMode="container-transform"/g)?.length).toBe(2);
    expect(read("components/kani/admin-clients.tsx").match(/transitionMode="container-transform"/g)?.length).toBe(2);
    expect(read("components/kani/admin-mobile-appointments.tsx").match(/transitionMode="container-transform"/g)?.length).toBe(3);
    expect(read("components/kani/admin-activity-popover.tsx")).toContain('transitionMode="container-transform"');
    expect(read("routes/cancelar-turno.tsx")).toContain('transitionMode="container-transform"');

    // Categoría B y C (Automáticos y Sensibles — preservan comportamiento actual)
    expect(read("components/kani/booking-recovery-modal.tsx")).not.toContain('transitionMode="container-transform"');
    expect(read("components/kani/admin-maintenance.tsx")).not.toContain('transitionMode="container-transform"');
    expect(read("components/kani/experimental/payway-booking.tsx")).not.toContain('transitionMode="container-transform"');
    expect(read("components/kani/experimental/payway-booking-v5.tsx")).not.toContain('transitionMode="container-transform"');
  });

  it("2. ManualAppointmentDialog en mode='EDIT' también activa container-transform desde su botón origen", () => {
    const triggerRect = {
      left: 720,
      top: 220,
      width: 96,
      height: 36,
      right: 816,
      bottom: 256,
      x: 720,
      y: 220,
      toJSON: () => ({}),
    };
    const modalRect = {
      left: 262,
      top: 140,
      width: 500,
      height: 520,
      right: 762,
      bottom: 660,
      x: 262,
      y: 140,
      toJSON: () => ({}),
    };

    const originalGetRect = HTMLElement.prototype.getBoundingClientRect;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      if (this.getAttribute("data-slot") === "dialog-content") return modalRect as DOMRect;
      if (this.dataset.testid === "edit-apt-btn") return triggerRect as DOMRect;
      return originalGetRect.call(this);
    });

    const { rerender } = render(
      <div>
        <button type="button" data-testid="edit-apt-btn">
          Editar
        </button>
        <ManualAppointmentDialog
          open={false}
          mode="EDIT"
          initialDate="2026-04-10"
          appointment={{
            id: "apt-1",
            name: "Juan",
            phone: "+5491112345678",
            service: "corte",
            serviceName: "Corte",
            barberId: "b1",
            barber: "Gonzalo",
            date: "2026-04-10",
            time: "14:00",
            status: "CONFIRMED",
          } as any}
          onClose={vi.fn()}
          onSuccess={vi.fn()}
        />
      </div>,
    );

    fireEvent.pointerDown(screen.getByTestId("edit-apt-btn"));
    rerender(
      <div>
        <button type="button" data-testid="edit-apt-btn">
          Editar
        </button>
        <ManualAppointmentDialog
          open={true}
          mode="EDIT"
          initialDate="2026-04-10"
          appointment={{
            id: "apt-1",
            name: "Juan",
            phone: "+5491112345678",
            service: "corte",
            serviceName: "Corte",
            barberId: "b1",
            barber: "Gonzalo",
            date: "2026-04-10",
            time: "14:00",
            status: "CONFIRMED",
          } as any}
          onClose={vi.fn()}
          onSuccess={vi.fn()}
        />
      </div>,
    );

    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("data-kani-transition")).toBe("container-transform");
    expect(dialog.style.getPropertyValue("--kani-ct-inset-x")).toMatch(/px$/);
  });

  it("3. Regresión «Editar cobro» en mobile: abre con container-transform sin auto-enfocar el selector de barbero", () => {
    Object.defineProperty(window, "innerWidth", { value: 390, configurable: true });
    Object.defineProperty(window, "innerHeight", { value: 844, configurable: true });

    render(<V2Payments />);

    const editBtn = screen.getAllByRole("button", { name: "Editar cobro" })[0];
    fireEvent.pointerDown(editBtn);
    fireEvent.click(editBtn);

    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("data-kani-transition")).toBe("container-transform");

    const barberSelect = within(dialog).getByLabelText("Barbero") as HTMLSelectElement;
    expect(document.activeElement).not.toBe(barberSelect);
    expect(barberSelect.value).toBe("b1");

    fireEvent.change(barberSelect, { target: { value: "b2" } });
    expect(barberSelect.value).toBe("b2");
  });
});
