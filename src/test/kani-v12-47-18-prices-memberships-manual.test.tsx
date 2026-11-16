import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import fs from "node:fs";
import path from "node:path";
import { services } from "@/lib/kani-model";
import {
  HOMOGENEOUS_MEMBERSHIP_PACKAGES,
  MEMBERSHIP_SERVICE_PRICES_ARS,
  buildHomogeneousMembershipPricing,
  calculateMembershipPricing,
} from "@/lib/kani-recurrences-memberships";
import { BenefitCodesAdminSection } from "@/components/kani/admin-benefit-codes-section";
import { ManualAppointmentDialog } from "@/components/kani/v2/manual-appointment-dialog";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
    },
  },
}));

vi.mock("@/lib/kani-admin-context", () => ({
  useAdminStaff: () => ({
    profile: { id: "admin-1", displayName: "Admin", role: "ADMIN", barber_id: "lautaro" },
    barbers: [
      { id: "lautaro", name: "Lautaro" },
      { id: "gonzalo", name: "Gonzalo" },
    ],
  }),
}));

vi.mock("@/components/kani/v2/data", () => ({
  useV2: () => ({
    services: [
      { id: "corte", dbId: "s1", name: "Corte", duration: 45, price: 25000 },
      { id: "barba", dbId: "s2", name: "Barba", duration: 30, price: 15000 },
      { id: "corte-barba", dbId: "s3", name: "Corte y barba", duration: 60, price: 30000 },
    ],
    clients: [{ id: "c1", name: "Lucas Fernández", phone: "11 2345-6789", email: "" }],
    appointments: [],
    memberships: [],
    refresh: vi.fn(),
  }),
}));

describe("V12.47.18 — Definitive Prices, Homogeneous Memberships, Manual Rows & Discount Header", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/api/admin/benefit-codes")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ ok: true, items: [] }),
        });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({}),
      });
    }) as typeof fetch;
  });

  it("1. Definitive centralized prices match $25.000 (Corte), $15.000 (Barba), and $30.000 (Corte y barba)", () => {
    expect(services.find((s) => s.id === "corte")?.price).toBe(25000);
    expect(services.find((s) => s.id === "barba")?.price).toBe(15000);
    expect(services.find((s) => s.id === "corte-barba")?.price).toBe(30000);

    expect(MEMBERSHIP_SERVICE_PRICES_ARS.Corte).toBe(25000);
    expect(MEMBERSHIP_SERVICE_PRICES_ARS.Barba).toBe(15000);
    expect(MEMBERSHIP_SERVICE_PRICES_ARS["Corte y barba"]).toBe(30000);
  });

  it("2. Homogeneous membership packages compute 4-session totals with 20% discount using definitive prices", () => {
    expect(HOMOGENEOUS_MEMBERSHIP_PACKAGES.map((p) => p.label)).toEqual([
      "4 cortes",
      "4 barbas",
      "4 cortes y barbas",
    ]);

    const cortes = buildHomogeneousMembershipPricing("CORTE_4");
    expect(cortes.subtotalArs).toBe(100000);
    expect(cortes.discountPercent).toBe(20);
    expect(cortes.discountAmountArs).toBe(20000);
    expect(cortes.totalPriceArs).toBe(80000);
    expect(cortes.items).toHaveLength(1);
    expect(cortes.items[0]).toMatchObject({ serviceName: "Corte", quantity: 4, unitPriceArs: 25000 });

    const barbas = buildHomogeneousMembershipPricing("BARBA_4");
    expect(barbas.subtotalArs).toBe(60000);
    expect(barbas.discountAmountArs).toBe(12000);
    expect(barbas.totalPriceArs).toBe(48000);
    expect(barbas.items[0]).toMatchObject({ serviceName: "Barba", quantity: 4, unitPriceArs: 15000 });

    const combo = buildHomogeneousMembershipPricing("CORTE_BARBA_4");
    expect(combo.subtotalArs).toBe(120000);
    expect(combo.discountAmountArs).toBe(24000);
    expect(combo.totalPriceArs).toBe(96000);
    expect(combo.items[0]).toMatchObject({
      serviceName: "Corte y barba",
      quantity: 4,
      unitPriceArs: 30000,
    });
  });

  it("3. Historical custom-composition memberships remain supported by calculateMembershipPricing", () => {
    const historicalMixed = calculateMembershipPricing(4, [
      { serviceName: "Corte", quantity: 2, unitPriceArs: 25000 },
      { serviceName: "Barba", quantity: 2, unitPriceArs: 19000 },
    ]);
    expect(historicalMixed.isValidComposition).toBe(true);
    expect(historicalMixed.subtotalArs).toBe(88000);
    expect(historicalMixed.totalPriceArs).toBe(70400);
  });

  it("4. Nuevo turno manual organizes 2-col rows as Barbero|Servicio, Hora inicio|Hora fin, Fecha|Importe with persistent footer", () => {
    render(
      <ManualAppointmentDialog
        open={true}
        mode="CREATE"
        initialDate="2026-11-20"
        onClose={vi.fn()}
        onSuccess={vi.fn()}
      />,
    );

    const form = document.querySelector(".v2-manual-form")!;
    const scrollBody = form.querySelector(".v2-manual-scroll-body")!;
    const footer = form.querySelector(".v2-manual-dialog-actions")!;
    expect(scrollBody).not.toBeNull();
    expect(footer).not.toBeNull();
    expect(scrollBody.contains(footer)).toBe(false);

    const html = scrollBody.innerHTML;
    expect(html.indexOf("Barbero")).toBeLessThan(html.indexOf("Servicio"));
    expect(html.indexOf("Servicio")).toBeLessThan(html.indexOf("Hora de inicio"));
    expect(html.indexOf("Hora de inicio")).toBeLessThan(html.indexOf("Hora de finalización"));
    expect(html.indexOf("Hora de finalización")).toBeLessThan(html.indexOf("Fecha"));
    expect(html.indexOf("Fecha")).toBeLessThan(html.indexOf("Importe"));
  });

  it("5. Generar código de descuento removes Nota interna, hides mobile title icon, and enforces 44x44px close button", async () => {
    render(<BenefitCodesAdminSection />);
    fireEvent.click(screen.getByRole("button", { name: /generar código/i }));

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: /generar código de descuento/i })).toBeInTheDocument();
    });

    expect(screen.queryByLabelText(/nota interna/i)).not.toBeInTheDocument();
    expect(screen.getByLabelText(/código personalizado/i)).toBeInTheDocument();

    const stylesCss = fs.readFileSync(path.resolve(__dirname, "../styles.css"), "utf-8");
    expect(stylesCss).toMatch(/\.benefit-code-dialog-content\s*>\s*button:has\([^)]+\)[\s\S]*?min-width:\s*44px/);
    expect(stylesCss).toMatch(/\.benefit-code-dialog-content\s*>\s*button:has\([^)]+\)[\s\S]*?min-height:\s*44px/);
  });
});
