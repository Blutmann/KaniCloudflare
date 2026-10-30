import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const identity = vi.hoisted(() => ({ role: "ADMIN", barberId: null as string | null }));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: ReactNode }) => <a>{children}</a>,
}));
vi.mock("@/lib/kani-admin-context", () => ({
  useAdminStaff: () => ({
    profile: {
      role: identity.role,
      barber_id: identity.barberId,
      display_name: "Mismo nombre visible",
    },
    // Deliberately include every barber: the home must still enforce identity.
    barbers: [
      { id: "b1", name: "Gonzalo" },
      { id: "b2", name: "Lautaro" },
    ],
  }),
}));
vi.mock("@/lib/kani-mobile-appointments", () => ({
  businessDateToday: () => "2026-10-22",
  addCalendarDays: () => "2026-10-23",
}));
vi.mock("@/lib/kani-payments", () => ({ businessTimeNow: () => "09:00" }));
vi.mock("@/lib/kani-appointments", () => ({}));
vi.mock("@/components/kani/v2/data", () => ({
  useV2: () => ({
    // Simulate a filter left selected on another page and mixed data defensively.
    barberId: "b2",
    appointments: ["b1", "b2"].map((barberId, i) => ({
      id: `a${i}`,
      barberId,
      name: `Cliente ${barberId}`,
      barber: `Barbero ${barberId}`,
      date: "2026-10-22",
      time: `${10 + i}:00`,
      statusCode: "PENDING",
      serviceName: "Corte",
    })),
    payments: ["b1", "b2"].map((barberId, i) => ({
      id: `p-${i}`,
      barberId,
      paymentDate: "2026-10-22",
      collectedAmountArs: (i + 1) * 10000,
      finalAmountArs: (i + 1) * 10000,
      onlineDepositAmountArs: 0,
    })),
    starts: ["b1", "b2"].map((barber_id, i) => ({
      barber_id,
      slot_date: "2026-10-22",
      start_time: `${16 + i}:00`,
      compatible_services: ["Corte"],
    })),
  }),
}));
import { V2Home } from "@/components/kani/v2/agenda";

describe("V2 home follows authenticated identity", () => {
  beforeEach(() => {
    identity.role = "ADMIN";
    identity.barberId = null;
  });

  it("shows all Kani to ADMIN regardless of another section's filter", () => {
    const { container } = render(<V2Home />);
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(container.querySelectorAll(".v2-team article")).toHaveLength(2);
    expect(screen.getByText("Cliente b1")).toBeTruthy();
    expect(screen.getByText(/30.000/)).toBeTruthy();
  });

  it("switches between two BARBER identities without retaining the earlier activity", () => {
    identity.role = "BARBER";
    identity.barberId = "b1";
    const { container, rerender } = render(<V2Home />);
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.getByText("Cliente b1")).toBeTruthy();
    expect(screen.getByText(/10.000/)).toBeTruthy();
    expect(container.querySelector(".v2-team")?.textContent).not.toContain("Lautaro");
    expect(screen.getByText("Próximo espacio · 16:00")).toBeTruthy();

    identity.barberId = "b2";
    rerender(<V2Home />);
    expect(screen.queryByText("Cliente b1")).toBeNull();
    expect(screen.getByText("Cliente b2")).toBeTruthy();
    expect(screen.getByText(/20.000/)).toBeTruthy();
    expect(container.querySelector(".v2-team")?.textContent).not.toContain("Gonzalo");
    expect(screen.getByText("Próximo espacio · 17:00")).toBeTruthy();
  });

  it("does not expose operational data to a BARBER without an associated ID", () => {
    identity.role = "BARBER";
    identity.barberId = null;
    const { container } = render(<V2Home />);
    expect(screen.queryByText(/Cliente b/)).toBeNull();
    expect(container.querySelectorAll(".v2-team article")).toHaveLength(0);
  });
});
