import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ClientMembershipRecord } from "@/lib/kani-recurrences-memberships";

const mocks = vi.hoisted(() => ({
  role: "ADMIN" as "ADMIN" | "MANAGER" | "BARBER",
  refresh: vi.fn().mockResolvedValue(undefined),
  consumeMembershipSession: vi.fn().mockResolvedValue({
    remainingSessions: 2,
    isExhausted: false,
    membership: null,
  }),
  refundMembershipSession: vi.fn().mockResolvedValue({
    remainingSessions: 4,
  }),
  registerMembershipPayment: vi.fn().mockResolvedValue(undefined),
  updateClientMembershipDetails: vi.fn().mockResolvedValue(undefined),
  regenerateMembershipPublicToken: vi.fn().mockResolvedValue({
    publicToken: "new-token-999",
  }),
}));

vi.mock("@/lib/kani-admin-context", () => ({
  useAdminStaff: () => ({
    user: { id: "staff-1" },
    profile: {
      role: mocks.role,
      active: true,
      barber_id: mocks.role === "BARBER" ? "lautaro" : null,
      display_name: mocks.role === "BARBER" ? "Lautaro" : "Tomás",
    },
    barbers: [
      { id: "lautaro", name: "Lautaro", active: true },
      { id: "franco", name: "Franco", active: true },
    ],
  }),
}));

const sampleMemberships: ClientMembershipRecord[] = [
  {
    id: "mem-active-1",
    clientId: "client-1",
    clientName: "Juan Pérez",
    clientPhone: "1122334455",
    clientEmail: "juan@kani.com",
    barberId: "lautaro",
    barberName: "Lautaro",
    packageSize: 4,
    planName: "Membresía 4 servicios",
    status: "ACTIVE",
    subtotalArs: 90000,
    discountPercent: 20,
    discountAmountArs: 18000,
    totalPriceArs: 72000,
    totalSessions: 4,
    consumedSessions: 1,
    remainingSessions: 3,
    expiresAt: "2026-12-31",
    expiresUpdatedBy: null,
    expiresUpdatedAt: null,
    notes: "Cliente habitual",
    paidAt: "2026-11-01T10:00:00Z",
    paymentMethod: "Transferencia",
    paymentId: "pay-active-1",
    createdByUserId: "staff-1",
    createdByDisplayName: "Tomás",
    createdAt: "2026-11-01T10:00:00Z",
    updatedAt: "2026-11-05T14:00:00Z",
    publicToken: "tok-active-1",
    publicTokenCreatedAt: "2026-11-01T10:00:00Z",
    publicTokenRevokedAt: null,
    items: [
      {
        id: "item-corte",
        membershipId: "mem-active-1",
        serviceId: "srv-corte",
        serviceName: "Corte",
        unitPriceSnapshotArs: 25000,
        totalQuantity: 3,
        consumedQuantity: 1,
        remainingQuantity: 2,
      },
      {
        id: "item-barba",
        membershipId: "mem-active-1",
        serviceId: "srv-barba",
        serviceName: "Barba",
        unitPriceSnapshotArs: 19000,
        totalQuantity: 1,
        consumedQuantity: 0,
        remainingQuantity: 1,
      },
    ],
    consumptions: [
      {
        id: "cons-1",
        membershipId: "mem-active-1",
        itemId: "item-corte",
        clientId: "client-1",
        appointmentId: null,
        barberId: "lautaro",
        serviceId: "srv-corte",
        serviceName: "Corte",
        consumptionType: "SERVICE_COMPLETED",
        status: "CONSUMED",
        consumedAt: "2026-11-05T14:00:00Z",
        consumedByUserId: "staff-1",
        consumedByDisplayName: "Tomás",
        refundedAt: null,
        refundedByUserId: null,
        refundedByDisplayName: null,
        refundReason: null,
        notes: "Primer corte del pack",
      },
    ],
    events: [
      {
        id: "ev-1",
        membershipId: "mem-active-1",
        eventType: "CREATED",
        description: "Membresía creada con pago registrado",
        metadata: {},
        actorUserId: "staff-1",
        actorDisplayName: "Tomás",
        createdAt: "2026-11-01T10:00:00Z",
      },
    ],
  },
  {
    id: "mem-pending-2",
    clientId: "client-2",
    clientName: "Matías Gómez",
    clientPhone: "1133445566",
    clientEmail: "matias@kani.com",
    barberId: "franco",
    barberName: "Franco",
    packageSize: 4,
    planName: "Membresía 4 servicios",
    status: "PENDING_PAYMENT",
    subtotalArs: 100000,
    discountPercent: 20,
    discountAmountArs: 20000,
    totalPriceArs: 80000,
    totalSessions: 4,
    consumedSessions: 0,
    remainingSessions: 4,
    expiresAt: null,
    expiresUpdatedBy: null,
    expiresUpdatedAt: null,
    notes: null,
    paidAt: null,
    paymentMethod: null,
    paymentId: null,
    createdByUserId: "staff-1",
    createdByDisplayName: "Tomás",
    createdAt: "2026-11-10T11:00:00Z",
    updatedAt: "2026-11-10T11:00:00Z",
    publicToken: "tok-pending-2",
    publicTokenCreatedAt: "2026-11-10T11:00:00Z",
    publicTokenRevokedAt: null,
    items: [
      {
        id: "item-corte-2",
        membershipId: "mem-pending-2",
        serviceId: "srv-corte",
        serviceName: "Corte",
        unitPriceSnapshotArs: 25000,
        totalQuantity: 4,
        consumedQuantity: 0,
        remainingQuantity: 4,
      },
    ],
    consumptions: [],
    events: [],
  },
  {
    id: "mem-exhausted-3",
    clientId: "client-3",
    clientName: "Lucas Silva",
    clientPhone: "1144556677",
    clientEmail: "lucas@kani.com",
    barberId: "lautaro",
    barberName: "Lautaro",
    packageSize: 4,
    planName: "Membresía 4 servicios",
    status: "EXHAUSTED",
    subtotalArs: 100000,
    discountPercent: 20,
    discountAmountArs: 20000,
    totalPriceArs: 80000,
    totalSessions: 4,
    consumedSessions: 4,
    remainingSessions: 0,
    expiresAt: null,
    expiresUpdatedBy: null,
    expiresUpdatedAt: null,
    notes: null,
    paidAt: "2026-10-01T10:00:00Z",
    paymentMethod: "Efectivo",
    paymentId: "pay-exhausted-3",
    createdByUserId: "staff-1",
    createdByDisplayName: "Tomás",
    createdAt: "2026-10-01T10:00:00Z",
    updatedAt: "2026-11-01T10:00:00Z",
    publicToken: "tok-exhausted-3",
    publicTokenCreatedAt: "2026-10-01T10:00:00Z",
    publicTokenRevokedAt: null,
    items: [
      {
        id: "item-corte-3",
        membershipId: "mem-exhausted-3",
        serviceId: "srv-corte",
        serviceName: "Corte",
        unitPriceSnapshotArs: 25000,
        totalQuantity: 4,
        consumedQuantity: 4,
        remainingQuantity: 0,
      },
    ],
    consumptions: [],
    events: [],
  },
];

vi.mock("@/components/kani/v2/data", () => ({
  useV2: () => ({
    loading: false,
    error: "",
    refresh: mocks.refresh,
    refreshMemberships: mocks.refresh,
    appointments: [],
    payments: [],
    starts: [],
    services: [
      { id: "srv-corte", name: "Corte", durationMin: 40, priceArs: 25000 },
      { id: "srv-barba", name: "Barba", durationMin: 30, priceArs: 19000 },
    ],
    clients: [
      { id: "client-1", name: "Juan Pérez", phone: "1122334455", email: "juan@kani.com" },
      { id: "client-2", name: "Matías Gómez", phone: "1133445566", email: "matias@kani.com" },
      { id: "client-3", name: "Lucas Silva", phone: "1144556677", email: "lucas@kani.com" },
    ],
    memberships: sampleMemberships,
    membershipsError: "",
    depositSupported: true,
  }),
}));

vi.mock("@/lib/kani-recurrences-memberships", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/kani-recurrences-memberships")>();
  return {
    ...actual,
    consumeMembershipSession: (...args: any[]) => mocks.consumeMembershipSession(...args),
    refundMembershipSession: (...args: any[]) => mocks.refundMembershipSession(...args),
    registerMembershipPayment: (...args: any[]) => mocks.registerMembershipPayment(...args),
    updateClientMembershipDetails: (...args: any[]) => mocks.updateClientMembershipDetails(...args),
    regenerateMembershipPublicToken: (...args: any[]) =>
      mocks.regenerateMembershipPublicToken(...args),
  };
});

vi.mock("@/components/kani/admin-benefit-codes-section", () => ({
  BenefitCodesAdminSection: () => <div data-testid="mock-discounts-admin" />,
}));

vi.mock("@/components/kani/v2/discounts", () => ({
  V2Discounts: () => <div data-testid="mock-discounts-v2" />,
}));

import { V2MembershipsAndDiscounts } from "@/components/kani/v2/memberships-discounts";

describe("Restauración de cards de Membresías (/panel-administracion/membresias y Panel V2)", () => {
  beforeEach(() => {
    mocks.role = "ADMIN";
    vi.clearAllMocks();
    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
      configurable: true,
    });
  });

  it("renderiza la jerarquía visual restaurada y exactamente 3 CTAs por card", () => {
    render(<V2MembershipsAndDiscounts initialTab="MEMBRESIAS" />);

    const activeCard = screen.getByTestId("membership-card-mem-active-1");
    expect(within(activeCard).getByText("Membresía 4 servicios")).toBeInTheDocument();
    expect(within(activeCard).getByText("Activa")).toBeInTheDocument();
    expect(within(activeCard).getByText("Juan Pérez")).toBeInTheDocument();
    expect(within(activeCard).getByText("Barbero: Lautaro")).toBeInTheDocument();
    expect(within(activeCard).getByText("3")).toBeInTheDocument();
    expect(within(activeCard).getByText(/sesiones disponibles de 4/i)).toBeInTheDocument();
    expect(within(activeCard).getByText("Corte: 2/3 · Barba: 1/1")).toBeInTheDocument();
    expect(within(activeCard).getByText(/Vence:.*31 dic/i)).toBeInTheDocument();
    expect(within(activeCard).getByText("Progreso de sesiones")).toBeInTheDocument();
    expect(within(activeCard).getByText("1/4 utilizadas")).toBeInTheDocument();
    expect(within(activeCard).getByRole("progressbar")).toHaveAttribute("aria-valuenow", "1");

    // Card acciones: únicamente Editar, Ver tarjeta y Copiar enlace (botón chico con ícono)
    const buttons = within(activeCard).getAllByRole("button");
    expect(buttons).toHaveLength(2);
    expect(buttons[0]).toHaveAccessibleName("Editar");
    expect(buttons[1]).toHaveAccessibleName("Copiar enlace");

    const viewLink = within(activeCard).getByRole("link", { name: "Ver tarjeta" });
    expect(viewLink).toHaveAttribute("href", "/membresia/tok-active-1");

    // Ninguna acción ruidosa vieja debe aparecer en la superficie de la card
    expect(within(activeCard).queryByText("Registrar consumo")).toBeNull();
    expect(within(activeCard).queryByText("Detalle e historial")).toBeNull();
    expect(within(activeCard).queryByText("Vencimiento")).toBeNull();
    expect(within(activeCard).queryByText("Regenerar enlace")).toBeNull();
  });

  it("muestra correctamente la variante Pendiente de pago y Sin vencimiento", () => {
    render(<V2MembershipsAndDiscounts initialTab="MEMBRESIAS" standaloneTab="MEMBRESIAS" />);

    const pendingCard = screen.getByTestId("membership-card-mem-pending-2");
    expect(within(pendingCard).getByText("Pendiente de pago")).toBeInTheDocument();
    expect(within(pendingCard).getByText("Matías Gómez")).toBeInTheDocument();
    expect(within(pendingCard).getByText("Barbero: Franco")).toBeInTheDocument();
    expect(within(pendingCard).getByText("Sin vencimiento")).toBeInTheDocument();
    expect(within(pendingCard).getByText(/Pago pendiente · \$/)).toBeInTheDocument();
    expect(within(pendingCard).getByText("0/4 utilizadas")).toBeInTheDocument();
  });

  it("copia el enlace público al clickear el botón chico Copiar enlace", async () => {
    render(<V2MembershipsAndDiscounts initialTab="MEMBRESIAS" />);

    const activeCard = screen.getByTestId("membership-card-mem-active-1");
    fireEvent.click(within(activeCard).getByRole("button", { name: "Copiar enlace" }));

    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        expect.stringContaining("/membresia/tok-active-1"),
      );
    });
    expect(await screen.findByText(/Enlace de tarjeta digital copiado/i)).toBeInTheDocument();
  });

  it("concentra todas las acciones administrativas en el modal Editar y respeta permisos por rol", async () => {
    // 1) En rol ADMIN permite consumo, vigencia, reintegro y regenerar enlace
    const { unmount } = render(<V2MembershipsAndDiscounts initialTab="MEMBRESIAS" />);

    const activeCard = screen.getByTestId("membership-card-mem-active-1");
    fireEvent.click(within(activeCard).getByRole("button", { name: "Editar" }));

    expect(await screen.findByText("Registrar consumo de sesión")).toBeInTheDocument();
    expect(screen.getByText("Vigencia, vencimiento y notas")).toBeInTheDocument();
    expect(screen.getByText("Black Card del titular")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Regenerar enlace/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Confirmar consumo/i }));
    await waitFor(() => {
      expect(mocks.consumeMembershipSession).toHaveBeenCalledTimes(1);
    });

    fireEvent.click(screen.getByRole("button", { name: /Reintegrar sesión/i }));
    fireEvent.click(screen.getByRole("button", { name: /Sí, reintegrar sesión/i }));
    await waitFor(() => {
      expect(mocks.refundMembershipSession).toHaveBeenCalledTimes(1);
    });

    fireEvent.click(screen.getByRole("button", { name: /Guardar vigencia/i }));
    await waitFor(() => {
      expect(mocks.updateClientMembershipDetails).toHaveBeenCalledTimes(1);
    });
    unmount();

    // 2) En estado PENDIENTE DE PAGO permite confirmar pago desde Editar
    const { unmount: unmountPending } = render(<V2MembershipsAndDiscounts initialTab="MEMBRESIAS" />);
    const pendingCard = screen.getByTestId("membership-card-mem-pending-2");
    fireEvent.click(within(pendingCard).getByRole("button", { name: "Editar" }));
    fireEvent.click(await screen.findByRole("button", { name: /Confirmar pago y activar/i }));
    await waitFor(() => {
      expect(mocks.registerMembershipPayment).toHaveBeenCalledWith(
        "mem-pending-2",
        "Transferencia",
        expect.anything(),
      );
    });
    unmountPending();

    // 3) En rol BARBER solo muestra sus membresías y oculta Regenerar enlace
    mocks.role = "BARBER";
    render(<V2MembershipsAndDiscounts initialTab="MEMBRESIAS" />);
    expect(screen.getByTestId("membership-card-mem-active-1")).toBeInTheDocument();
    expect(screen.queryByTestId("membership-card-mem-pending-2")).toBeNull();
    fireEvent.click(within(screen.getByTestId("membership-card-mem-active-1")).getByRole("button", { name: "Editar" }));
    expect(await screen.findByText("Black Card del titular")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Regenerar enlace/i })).toBeNull();
  });
});
