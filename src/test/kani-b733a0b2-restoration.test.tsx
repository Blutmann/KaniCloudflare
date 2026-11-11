import { describe, it, expect, vi } from "vitest";
import {
  calculateMembershipPricing,
  getPublicMembershipCard,
  regenerateMembershipPublicToken,
  fetchMembershipForVerification,
  type ClientMembershipRecord,
} from "@/lib/kani-recurrences-memberships";
import type { AuthenticatedStaff } from "@/lib/kani-auth";

describe("KANI — Restauración Integral b733a0b2", () => {
  const mockAdminStaff: AuthenticatedStaff = {
    user: { id: "user_admin_1", email: "admin@kanibarber.com" },
    profile: {
      id: "prof_admin_1",
      role: "ADMIN",
      display_name: "Administrador KANI",
      barber_id: null,
    },
    barbers: [
      { id: "lautaro", name: "Lautaro" },
      { id: "franco", name: "Franco" },
    ],
  };

  it("1. Reglas comerciales exactas de b733a0b2: 4 servicios = 20% OFF ($80.000 ARS)", () => {
    // 4 cortes a $25.000 = $100.000 subtotal -> 20% desc ($20.000) -> $80.000 total
    const pricing4 = calculateMembershipPricing(4, [
      { serviceName: "Corte", quantity: 4, unitPriceArs: 25000 },
    ]);

    expect(pricing4.packageSize).toBe(4);
    expect(pricing4.discountPercent).toBe(20);
    expect(pricing4.subtotalArs).toBe(100000);
    expect(pricing4.discountAmountArs).toBe(20000);
    expect(pricing4.totalPriceArs).toBe(80000);
    expect(pricing4.isValidComposition).toBe(true);
  });

  it("2. Reglas comerciales exactas de b733a0b2: 10 servicios = 30% OFF", () => {
    // 10 cortes a $25.000 = $250.000 subtotal -> 30% desc ($75.000) -> $175.000 total
    const pricing10 = calculateMembershipPricing(10, [
      { serviceName: "Corte", quantity: 10, unitPriceArs: 25000 },
    ]);

    expect(pricing10.packageSize).toBe(10);
    expect(pricing10.discountPercent).toBe(30);
    expect(pricing10.subtotalArs).toBe(250000);
    expect(pricing10.discountAmountArs).toBe(75000);
    expect(pricing10.totalPriceArs).toBe(175000);
    expect(pricing10.isValidComposition).toBe(true);
  });

  it("3. getPublicMembershipCard valida longitud y formato de token", async () => {
    const invalidShort = await getPublicMembershipCard("short");
    expect(invalidShort.found).toBe(false);
    expect(invalidShort.error).toBe("INVALID_TOKEN");

    const nonExistent = await getPublicMembershipCard("0123456789abcdef0123456789abcdef");
    expect(nonExistent.found).toBe(false);
  });

  it("4. regenerateMembershipPublicToken requiere rol de operador (ADMIN o MANAGER)", async () => {
    const barberStaff: AuthenticatedStaff = {
      user: { id: "user_barber_1", email: "barbero@kanibarber.com" },
      profile: {
        id: "prof_barber_1",
        role: "BARBER",
        display_name: "Barbero KANI",
        barber_id: "lautaro",
      },
      barbers: [{ id: "lautaro", name: "Lautaro" }],
    };

    await expect(
      regenerateMembershipPublicToken("mem_test_123", barberStaff),
    ).rejects.toThrow("ACCESS_DENIED");
  });
});
