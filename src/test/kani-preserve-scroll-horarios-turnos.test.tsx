import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdminScheduleManager } from "@/components/kani/admin-schedule-manager";
import { V2DataProvider, useV2 } from "@/components/kani/v2/data";
import { V2Appointments } from "@/components/kani/v2/agenda";
import * as appointmentsModule from "@/lib/kani-appointments";
import * as availabilityModule from "@/lib/kani-availability";
import * as paymentsModule from "@/lib/kani-payments";
import * as membershipsModule from "@/lib/kani-recurrences-memberships";

const today = "2026-11-21";

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    to,
    className,
  }: {
    children: React.ReactNode;
    to: string;
    className?: string;
  }) => (
    <a href={to} className={className}>
      {children}
    </a>
  ),
  useRouter: () => ({ invalidate: vi.fn() }),
}));

const mockStaffBase = {
  profile: {
    id: "u1",
    user_id: "u1",
    role: "ADMIN",
    barber_id: null,
    display_name: "Admin",
    active: true,
  },
  barbers: [{ id: "b1", name: "Lautaro", active: true }],
  refreshCount: 0,
  setIsRefreshing: vi.fn(),
};
const mockStaff = { ...mockStaffBase, staff: mockStaffBase };

vi.mock("@/lib/kani-admin-context", () => ({
  useAdminStaff: () => mockStaff,
}));

vi.mock("@/lib/kani-mobile-appointments", async () => {
  const actual = await vi.importActual<typeof import("@/lib/kani-mobile-appointments")>(
    "@/lib/kani-mobile-appointments",
  );
  return {
    ...actual,
    businessDateToday: () => today,
  };
});

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        limit: vi.fn().mockResolvedValue({ data: [], error: null }),
        order: vi.fn().mockResolvedValue({ data: [], error: null }),
      })),
    })),
  },
}));

vi.mock("@/lib/kani-appointments", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/kani-appointments")>("@/lib/kani-appointments");
  return {
    ...actual,
    readRealAppointments: vi.fn().mockResolvedValue([]),
    readStaffAppointments: vi.fn().mockResolvedValue([]),
    updateRealAppointmentStatus: vi.fn().mockResolvedValue("CANCELLED"),
  };
});

vi.mock("@/lib/kani-availability", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/kani-availability")>("@/lib/kani-availability");
  return {
    ...actual,
    readAvailabilitySlotsForRange: vi.fn().mockResolvedValue([]),
    readAvailabilityStartsForRange: vi.fn().mockResolvedValue([]),
    readConfiguredServices: vi.fn().mockResolvedValue([]),
    updateAvailabilitySlot: vi.fn(),
    createAvailabilitySlots: vi.fn().mockResolvedValue([]),
  };
});

vi.mock("@/lib/kani-payments", async () => {
  const actual = await vi.importActual<typeof import("@/lib/kani-payments")>("@/lib/kani-payments");
  return {
    ...actual,
    fetchServicePayments: vi.fn().mockResolvedValue([]),
  };
});

vi.mock("@/lib/kani-recurrences-memberships", async () => {
  const actual = await vi.importActual<typeof import("@/lib/kani-recurrences-memberships")>(
    "@/lib/kani-recurrences-memberships",
  );
  return {
    ...actual,
    fetchClientMemberships: vi.fn().mockResolvedValue([]),
  };
});

describe("Preservar scroll, recarga silenciosa in-place y feedback visible en Horarios y Turnos", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    window.localStorage.clear();
  });

  it("AdminScheduleManager: mutar un horario no desmonta la grilla ni muestra Cargando horarios y expone toast visible", async () => {
    let currentSlot = {
      id: "slot-1",
      barber_id: "b1",
      slot_date: today,
      start_time: "10:00:00",
      end_time: "10:45:00",
      status: "AVAILABLE" as "AVAILABLE" | "UNAVAILABLE",
      internal_note: null,
    };

    vi.mocked(availabilityModule.readAvailabilitySlotsForRange).mockImplementation(async () => [
      currentSlot,
    ]);
    vi.mocked(availabilityModule.updateAvailabilitySlot).mockImplementation(async () => {
      currentSlot = { ...currentSlot, status: "UNAVAILABLE" };
      return currentSlot;
    });

    render(<AdminScheduleManager />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /10:00/i })).toBeInTheDocument();
    });

    const gridBefore = document.querySelector(".v2-schedule-cards-grid");
    expect(gridBefore).not.toBeNull();

    // Mutar el slot (Disponible -> No disponible)
    fireEvent.click(screen.getByRole("button", { name: /10:00/i }));

    // Nunca debe volver a aparecer "Cargando horarios…" ni desmontarse el contenedor de grilla
    expect(screen.queryByText(/Cargando horarios/i)).not.toBeInTheDocument();

    await waitFor(() => {
      expect(availabilityModule.updateAvailabilitySlot).toHaveBeenCalledTimes(1);
      expect(document.querySelector(".kani-v2-toast.is-success")).toHaveTextContent(
        /10:00 actualizado/i,
      );
    });

    const gridAfter = document.querySelector(".v2-schedule-cards-grid");
    expect(gridAfter).toBe(gridBefore);
    expect(screen.getByRole("button", { name: /10:00/i })).toHaveTextContent(/No disponible/i);
  });

  it("AdminScheduleManager: ante error de RPC conserva el estado previo del slot y muestra toast de error", async () => {
    const initialSlot = {
      id: "slot-1",
      barber_id: "b1",
      slot_date: today,
      start_time: "10:00:00",
      end_time: "10:45:00",
      status: "AVAILABLE" as const,
      internal_note: null,
    };

    vi.mocked(availabilityModule.readAvailabilitySlotsForRange).mockResolvedValue([initialSlot]);
    vi.mocked(availabilityModule.updateAvailabilitySlot).mockRejectedValueOnce(
      new Error("Fallo de red simulado"),
    );

    render(<AdminScheduleManager />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /10:00/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /10:00/i }));

    await waitFor(() => {
      const toast = document.querySelector(".kani-v2-toast.is-error");
      expect(toast).toBeInTheDocument();
      expect(toast).toHaveAttribute("role", "alert");
      expect(toast).toHaveTextContent("Fallo de red simulado");
    });

    expect(screen.getByRole("button", { name: /10:00/i })).toHaveTextContent(/Disponible/i);
  });

  it("V2Appointments + V2DataProvider: cancelar un turno realiza refresh silencioso sin activar loading=true y muestra toast", async () => {
    const mockApt: appointmentsModule.RealAppointment = {
      id: "apt-1",
      barberId: "b1",
      barber: "Lautaro",
      date: today,
      time: "19:00",
      endTime: "19:45",
      serviceDuration: 45,
      statusCode: "CONFIRMED",
      name: "Matías Zárate",
      phone: "+5491155551111",
      email: "matias@ejemplo.com",
      serviceName: "Corte",
      price: 25000,
      depositRequired: true,
      depositPaid: true,
      depositAmountArs: 5000,
      balancePaid: false,
      isManual: false,
    };

    let currentAppointments = [mockApt];
    vi.mocked(appointmentsModule.readStaffAppointments).mockImplementation(
      async () => currentAppointments,
    );
    vi.mocked(appointmentsModule.updateRealAppointmentStatus).mockImplementationOnce(async () => {
      currentAppointments = [{ ...mockApt, statusCode: "CANCELLED" }];
      return "CANCELLED";
    });

    function LoadingSpyAppointments() {
      const { loading, error, appointments } = useV2();
      return (
        <>
          <span data-testid="v2-loading">{String(loading)}</span>
          <span data-testid="v2-count">{appointments.length}</span>
          {error && <span data-testid="v2-error">{error}</span>}
          {!loading ? <V2Appointments /> : <div>Cargando…</div>}
        </>
      );
    }

    render(
      <V2DataProvider>
        <LoadingSpyAppointments />
      </V2DataProvider>,
    );

    await waitFor(() => {
      expect(screen.queryByTestId("v2-error")?.textContent).toBeUndefined();
      expect(screen.getByTestId("v2-count")).toHaveTextContent("1");
      expect(screen.getByText("Matías Zárate")).toBeInTheDocument();
      expect(screen.getByTestId("v2-loading")).toHaveTextContent("false");
    });

    const cardBefore = document.querySelector(".v2-appointment");
    expect(cardBefore).not.toBeNull();

    // Abrir confirmación y cancelar turno
    fireEvent.click(screen.getByRole("button", { name: "Cancelar turno" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancelar turno" }));

    // loading nunca debe volver a true durante el refresh silencioso
    expect(screen.getByTestId("v2-loading")).toHaveTextContent("false");

    await waitFor(() => {
      expect(appointmentsModule.updateRealAppointmentStatus).toHaveBeenCalledWith(
        "apt-1",
        "CANCELLED",
      );
      expect(document.querySelector(".kani-v2-toast.is-success")).toHaveTextContent(
        "Turno actualizado.",
      );
    });

    expect(screen.getByTestId("v2-loading")).toHaveTextContent("false");
    expect(document.querySelector(".v2-status-cancelled")).toHaveTextContent("Cancelado");
  });

  it("Clientes, Pagos y Membresías usan data.refresh({ silent: true }) y Reintentar tiene minHeight 44px", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");

    for (const relPath of [
      "src/components/kani/v2/clients.tsx",
      "src/components/kani/v2/payments.tsx",
      "src/components/kani/v2/memberships-discounts.tsx",
    ]) {
      const code = fs.readFileSync(path.resolve(process.cwd(), relPath), "utf-8");
      expect(code).toContain("data.refresh({ silent: true })");
      expect(code).not.toMatch(/data\.refresh\(\)/);
    }

    const membershipsCode = fs.readFileSync(
      path.resolve(process.cwd(), "src/components/kani/v2/memberships-discounts.tsx"),
      "utf-8",
    );
    const retryMinHeights = membershipsCode.match(/minHeight:\s*"44px"/g) ?? [];
    expect(retryMinHeights.length).toBeGreaterThanOrEqual(2);
  });
});
