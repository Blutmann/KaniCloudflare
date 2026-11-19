import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

const { mockStaffRole } = vi.hoisted(() => ({
  mockStaffRole: { role: "ADMIN" as "ADMIN" | "BARBER", barber_id: null as string | null },
}));

vi.mock("@/lib/kani-admin-context", () => ({
  useAdminStaff: () => ({
    profile: {
      user_id: "u-1",
      role: mockStaffRole.role,
      barber_id: mockStaffRole.barber_id,
      display_name: "Admin",
      active: true,
    },
    barbers: [
      { id: "lautaro", name: "Lautaro" },
      { id: "gonzalo", name: "Gonzalo" },
    ],
  }),
}));

vi.mock("@/lib/kani-clients-export.functions", () => ({
  staffExportClientsFn: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: { getSession: vi.fn() },
    rpc: vi.fn().mockResolvedValue({ error: null }),
  },
}));

vi.mock("@/components/kani/v2/data", () => ({
  useV2: () => ({
    loading: false,
    error: "",
    refresh: vi.fn(),
    clients: [
      {
        id: "cli-full",
        name: "Martín Echeverría",
        phone: "+54 9 11 5842-9104",
        email: "martin.echeverria.extremadamente.largo@estudio-barberia.com.ar",
        created_at: "2025-03-14T12:00:00Z",
        updated_at: "2026-11-11T12:00:00Z",
      },
      {
        id: "cli-empty",
        name: "Lucas Gómez",
        phone: "",
        email: "",
        created_at: "2026-10-01T12:00:00Z",
        updated_at: "2026-10-01T12:00:00Z",
      },
    ],
    appointments: [
      {
        id: "apt-1",
        clientId: "cli-full",
        name: "Martín Echeverría",
        serviceName: "Corte",
        barber: "Gonzalo",
        barberId: "gonzalo",
        date: "2026-10-21",
        time: "18:00",
        statusCode: "COMPLETED",
      },
      {
        id: "apt-2",
        clientId: "cli-full",
        name: "Martín Echeverría",
        serviceName: "Corte y barba",
        barber: "Lautaro",
        barberId: "lautaro",
        date: "2026-11-11",
        time: "17:30",
        statusCode: "COMPLETED",
      },
    ],
    payments: [
      {
        id: "pay-1",
        clientId: "cli-full",
        appointmentId: "apt-1",
        serviceName: "Corte",
        collectedAmountArs: 28000,
        finalAmountArs: 28000,
        paymentDate: "2026-10-21",
      },
      {
        id: "pay-2",
        clientId: "cli-full",
        appointmentId: "apt-2",
        serviceName: "Corte y barba",
        collectedAmountArs: 36000,
        finalAmountArs: 36000,
        paymentDate: "2026-11-11",
      },
    ],
    memberships: [
      {
        id: "mem-1",
        clientId: "cli-full",
        planName: "Plan Black Corte",
        status: "ACTIVE",
        remainingSessions: 3,
        totalSessions: 4,
        expiresAt: "2026-12-15",
        totalPriceArs: 84000,
        items: [{ serviceName: "Corte", remainingQuantity: 3, totalQuantity: 4 }],
      },
    ],
  }),
}));

import { V2Clients } from "@/components/kani/v2/clients";

afterEach(() => {
  cleanup();
  mockStaffRole.role = "ADMIN";
  mockStaffRole.barber_id = null;
});

describe("KANI UX Optimization v1.0 — Detalles del cliente (Mobile Redesign)", () => {
  it("renders two full-width contact rows with tel:/mailto:, two-tier summary surface, DD/MM/YYYY history dates, and integrated frequency", () => {
    render(<V2Clients />);

    const detailButtons = screen.getAllByRole("button", { name: "Detalles" });
    fireEvent.click(detailButtons[1]);

    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("data-kani-transition", "container-transform");

    // Header includes client creation date and computed frequency (21 days between 2026-10-21 and 2026-11-11)
    expect(screen.getByText(/Cliente desde 14\/03\/2025 · Frecuencia: 21 días/)).toBeInTheDocument();

    // Two independent full-width contact rows with tel: and mailto:
    const phoneLink = screen.getByRole("link", { name: /Celular/i });
    expect(phoneLink).toHaveAttribute("href", "tel:+5491158429104");
    expect(phoneLink).toHaveTextContent("+54 9 11 5842-9104");

    const emailLink = screen.getByRole("link", { name: /Email/i });
    expect(emailLink).toHaveAttribute(
      "href",
      "mailto:martin.echeverria.extremadamente.largo@estudio-barberia.com.ar",
    );
    expect(emailLink).toHaveTextContent(
      "martin.echeverria.extremadamente.largo@estudio-barberia.com.ar",
    );

    // Single flat summary surface with 2-level hierarchy
    const summary = dialog.querySelector(".v2-client-summary-surface");
    expect(summary).not.toBeNull();
    expect(dialog.querySelectorAll(".v2-metric")).toHaveLength(0);

    expect(screen.getByText("Visitas")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("Última visita")).toBeInTheDocument();
    expect(screen.getByText("11/11/2026")).toBeInTheDocument();
    expect(screen.getByText("Total en servicios")).toBeInTheDocument();
    expect(screen.getByText("$64.000")).toBeInTheDocument();
    expect(screen.getByText("Cancelaciones")).toBeInTheDocument();
    expect(screen.getByText("0")).toBeInTheDocument();

    // Membresías & Historial headings without uppercase or redundant words
    expect(screen.getByRole("heading", { name: "Membresías" })).toBeInTheDocument();
    expect(screen.getByText(/3 de 4 sesiones · Vence 15\/12\/2026/)).toBeInTheDocument();

    expect(screen.getByRole("heading", { name: "Historial" })).toBeInTheDocument();
    // History rows do not repeat client name and format dates as DD/MM/YYYY
    expect(screen.getByText("Corte y barba · Lautaro")).toBeInTheDocument();
    expect(screen.getByText("11/11/2026 · 17:30 hs")).toBeInTheDocument();
    expect(screen.queryByText("Martín Echeverría · Corte y barba · Lautaro")).not.toBeInTheDocument();

    // Admin sees both Editar and Eliminar
    expect(screen.getByRole("button", { name: "Editar cliente" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Eliminar cliente" })).toBeInTheDocument();
  });

  it("renders static Sin celular / Sin email without links and hides frequency when uncomputable", () => {
    mockStaffRole.role = "BARBER";
    mockStaffRole.barber_id = "lautaro";
    render(<V2Clients />);

    const detailButtons = screen.getAllByRole("button", { name: "Detalles" });
    fireEvent.click(detailButtons[0]);

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Cliente desde 01/10/2026")).toBeInTheDocument();
    expect(within(dialog).queryByText(/Frecuencia:/i)).not.toBeInTheDocument();

    expect(within(dialog).getByText("Sin celular")).toBeInTheDocument();
    expect(within(dialog).getByText("Sin email")).toBeInTheDocument();
    expect(within(dialog).queryByRole("link")).not.toBeInTheDocument();

    // Barber sees Editar but not Eliminar
    expect(within(dialog).getByRole("button", { name: "Editar cliente" })).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "Eliminar cliente" })).not.toBeInTheDocument();
  });
});
