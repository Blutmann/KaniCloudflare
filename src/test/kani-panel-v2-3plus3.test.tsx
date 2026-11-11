import fs from "node:fs";
import path from "node:path";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  role: "ADMIN" as "ADMIN" | "MANAGER" | "BARBER",
  path: "/panel-v2/operacion/turnos",
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, children, activeProps, activeOptions, ...props }: any) => {
    const cleanTarget = String(to).replace(/\/+$/, "") || "/";
    const cleanPath = state.path.replace(/\/+$/, "") || "/";
    const isActive = activeOptions?.exact
      ? cleanPath === cleanTarget
      : cleanPath === cleanTarget || cleanPath.startsWith(`${cleanTarget}/`);
    const mergedClass = [props.className, isActive ? activeProps?.className : ""]
      .filter(Boolean)
      .join(" ");
    return (
      <a
        href={to}
        {...props}
        className={mergedClass}
        aria-current={isActive ? activeProps?.["aria-current"] : undefined}
      >
        {children}
      </a>
    );
  },
  Outlet: () => <div data-testid="panel-v2-outlet">Contenido Panel V2</div>,
  Navigate: ({ to }: { to: string }) => <div data-testid="panel-v2-redirect">{to}</div>,
  useLocation: () => state.path,
  useSearch: () => ({}),
}));

vi.mock("@/lib/kani-auth", () => ({
  clearStaffCache: vi.fn(),
  getAuthenticatedStaff: async () => ({
    user: { id: "staff-v2-1" },
    profile: {
      role: state.role,
      active: true,
      barber_id: state.role === "BARBER" ? "lautaro" : null,
      display_name: state.role === "BARBER" ? "Lautaro" : "Tomás",
    },
    barbers: [
      { id: "lautaro", name: "Lautaro", active: true },
      { id: "franco", name: "Franco", active: true },
    ],
  }),
}));

vi.mock("@/lib/kani-admin-context", () => ({
  AdminStaffProvider: ({ children }: any) => children,
  useAdminStaff: () => ({
    user: { id: "staff-v2-1" },
    profile: {
      role: state.role,
      active: true,
      barber_id: state.role === "BARBER" ? "lautaro" : null,
      display_name: state.role === "BARBER" ? "Lautaro" : "Tomás",
    },
    barbers: [
      { id: "lautaro", name: "Lautaro", active: true },
      { id: "franco", name: "Franco", active: true },
    ],
  }),
}));

vi.mock("@/components/kani/v2/data", () => ({
  V2DataProvider: ({ children }: any) => children,
  useV2: () => ({
    loading: false,
    error: "",
    refresh: vi.fn().mockResolvedValue(undefined),
    refreshMemberships: vi.fn().mockResolvedValue(undefined),
    appointments: [],
    payments: [
      {
        id: "pay-1",
        barberId: "lautaro",
        serviceName: "Corte",
        servicePriceArs: 25000,
        discountAmountArs: 0,
        finalAmountArs: 25000,
        collectedAmountArs: 25000,
        paymentMethod: "Efectivo",
        paymentDate: "2026-11-11",
        paymentTime: "12:00",
        isDepositMovement: false,
        appointmentId: null,
        clientId: null,
      },
    ],
    starts: [],
    clients: [],
    memberships: [
      {
        id: "mem-1",
        clientId: "cli-1",
        clientName: "Juan Pérez",
        clientPhone: "+5491112345678",
        clientEmail: "juan@test.com",
        barberId: "lautaro",
        barberName: "Lautaro",
        planName: "Membresía 4 servicios",
        packageSize: 4,
        discountPercent: 20,
        subtotalArs: 100000,
        discountAmountArs: 20000,
        totalPriceArs: 80000,
        totalSessions: 4,
        consumedSessions: 1,
        remainingSessions: 3,
        status: "ACTIVE",
        paymentMethod: "Transferencia",
        paymentId: "p-1",
        paidAt: "2026-11-01T10:00:00Z",
        expiresAt: "2026-12-31",
        expiresUpdatedBy: null,
        expiresUpdatedAt: null,
        notes: null,
        createdByUserId: "staff-v2-1",
        createdByDisplayName: "Tomás",
        createdAt: "2026-11-01T10:00:00Z",
        updatedAt: "2026-11-01T10:00:00Z",
        publicToken: "tok-0123456789abcdef",
        items: [
          {
            id: "item-1",
            membershipId: "mem-1",
            serviceId: "corte",
            serviceName: "Corte",
            unitPriceSnapshotArs: 25000,
            totalQuantity: 4,
            consumedQuantity: 1,
            remainingQuantity: 3,
          },
        ],
        consumptions: [
          {
            id: "cons-1",
            membershipId: "mem-1",
            itemId: "item-1",
            clientId: "cli-1",
            appointmentId: null,
            barberId: "lautaro",
            barberName: "Lautaro",
            serviceId: "corte",
            serviceName: "Corte",
            consumptionType: "SERVICE_COMPLETED",
            status: "CONSUMED",
            consumedAt: "2026-11-05T15:00:00Z",
            consumedByUserId: "staff-v2-1",
            consumedByDisplayName: "Lautaro",
            refundedAt: null,
            refundedByUserId: null,
            refundedByDisplayName: null,
            refundReason: null,
            notes: null,
          },
        ],
        events: [],
      },
    ],
    membershipsError: null,
    services: [{ id: "corte", name: "Corte", price: 25000, duration: 45 }],
    barberId: "ALL",
    setBarberId: vi.fn(),
    depositSupported: true,
  }),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    supabaseUrl: "https://iockpxtkflyjfagkvgnr.supabase.co",
    auth: { onAuthStateChange: () => ({ data: { subscription: { unsubscribe: vi.fn() } } }) },
    from: vi.fn(() => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: null, error: null }),
        }),
      }),
    })),
    rpc: vi.fn().mockResolvedValue({ data: [], error: null }),
  },
}));

vi.mock("@/components/kani/admin-benefit-codes-section", () => ({
  BenefitCodesAdminSection: () => <div data-testid="benefit-codes-admin">Descuentos ADMIN</div>,
}));

vi.mock("@/components/kani/v2/discounts", () => ({
  V2Discounts: () => <div data-testid="discounts-manager">Descuentos MANAGER</div>,
}));

vi.mock("@/components/kani/v2/payments", async () => {
  const actual = await vi.importActual<typeof import("@/components/kani/v2/payments")>(
    "@/components/kani/v2/payments",
  );
  return {
    ...actual,
    V2Payments: () => <div data-testid="v2-payments-movements">Formulario y movimientos de pagos</div>,
  };
});

import {
  PanelV2Layout,
  resolvePanelV2Section,
  resolvePanelV2Space,
} from "@/components/kani/v2-experimental/PanelV2Layout";
import { PanelV2Home } from "@/components/kani/v2-experimental/PanelV2Home";
import { PanelV2Payments } from "@/components/kani/v2-experimental/PanelV2Payments";
import { V2MembershipsAndDiscounts } from "@/components/kani/v2/memberships-discounts";

describe("KANI Panel V2 — Implementación experimental aislada 3 + 3 y protección del panel original", () => {
  const rootDir = path.resolve(__dirname, "..");

  beforeEach(() => {
    state.role = "ADMIN";
    state.path = "/panel-v2/operacion/turnos";
  });

  it("1. Resuelve espacios y secciones para todas las rutas /panel-v2/*", () => {
    expect(resolvePanelV2Space("/panel-v2")).toBe("inicio");
    expect(resolvePanelV2Space("/panel-v2/operacion")).toBe("operacion");
    expect(resolvePanelV2Space("/panel-v2/operacion/turnos")).toBe("operacion");
    expect(resolvePanelV2Space("/panel-v2/operacion/horarios")).toBe("operacion");
    expect(resolvePanelV2Space("/panel-v2/operacion/clientes")).toBe("operacion");
    expect(resolvePanelV2Space("/panel-v2/negocio")).toBe("negocio");
    expect(resolvePanelV2Space("/panel-v2/negocio/pagos")).toBe("negocio");
    expect(resolvePanelV2Space("/panel-v2/negocio/membresias")).toBe("negocio");
    expect(resolvePanelV2Space("/panel-v2/negocio/descuentos")).toBe("negocio");
    expect(resolvePanelV2Space("/panel-v2/estadisticas")).toBe("estadisticas");

    expect(resolvePanelV2Section("/panel-v2")).toBe("inicio");
    expect(resolvePanelV2Section("/panel-v2/operacion/turnos")).toBe("turnos");
    expect(resolvePanelV2Section("/panel-v2/operacion/horarios")).toBe("horarios");
    expect(resolvePanelV2Section("/panel-v2/operacion/clientes")).toBe("clientes");
    expect(resolvePanelV2Section("/panel-v2/negocio/pagos")).toBe("pagos");
    expect(resolvePanelV2Section("/panel-v2/negocio/membresias")).toBe("membresias");
    expect(resolvePanelV2Section("/panel-v2/negocio/descuentos")).toBe("descuentos");
    expect(resolvePanelV2Section("/panel-v2/estadisticas")).toBe("datos");
    expect(resolvePanelV2Section("/panel-v2/desconocida")).toBe("unknown");
  });

  it("2. Entrada /panel-v2 muestra dos tarjetas limpias (Operación y Negocio) + acceso a Estadísticas", () => {
    render(<PanelV2Home />);

    const opLink = screen.getByRole("link", { name: /Operación/i });
    expect(opLink).toHaveAttribute("href", "/panel-v2/operacion/turnos");
    expect(opLink).toHaveTextContent("Gestión diaria del salón.");

    const negLink = screen.getByRole("link", { name: /Negocio/i });
    expect(negLink).toHaveAttribute("href", "/panel-v2/negocio/pagos");
    expect(negLink).toHaveTextContent("Cobros, membresías y promociones.");

    expect(screen.getByRole("link", { name: /Abrir estadísticas/i })).toHaveAttribute(
      "href",
      "/panel-v2/estadisticas",
    );
  });

  it("3. Operación muestra barra horizontal Turnos | Horarios | Clientes | Actualizar sin Inicio adicional", async () => {
    state.path = "/panel-v2/operacion/turnos";
    render(<PanelV2Layout />);
    await screen.findByTestId("panel-v2-outlet");

    const nav = screen.getByRole("navigation", { name: "Navegación de Operación" });
    const links = within(nav).getAllByRole("link");
    expect(links.map((a) => a.textContent)).toEqual(["Turnos", "Horarios", "Clientes"]);
    expect(within(nav).queryByRole("link", { name: /Inicio/i })).toBeNull();
    expect(within(nav).getByRole("button", { name: "Actualizar datos" })).toBeInTheDocument();

    const switcher = screen.getByRole("group", { name: "Cambiar de espacio" });
    expect(within(switcher).getByRole("link", { name: "Operación" })).toHaveAttribute(
      "href",
      "/panel-v2/operacion/turnos",
    );
    expect(within(switcher).getByRole("link", { name: "Negocio" })).toHaveAttribute(
      "href",
      "/panel-v2/negocio/pagos",
    );
  });

  it("4. Negocio muestra barra horizontal Pagos | Membresías | Descuentos | Actualizar y respeta permisos BARBER", async () => {
    state.path = "/panel-v2/negocio/pagos";
    const { rerender } = render(<PanelV2Layout />);
    await screen.findByTestId("panel-v2-outlet");

    let nav = screen.getByRole("navigation", { name: "Navegación de Negocio" });
    expect(within(nav).getAllByRole("link").map((a) => a.textContent)).toEqual([
      "Pagos",
      "Membresías",
      "Descuentos",
    ]);

    // BARBER: no ve Descuentos en barra y se bloquea acceso directo a /panel-v2/negocio/descuentos
    state.role = "BARBER";
    state.path = "/panel-v2/negocio/descuentos";
    rerender(<PanelV2Layout />);
    expect(await screen.findByRole("alert")).toHaveTextContent("No tenés permisos");
    expect(screen.queryByTestId("panel-v2-outlet")).toBeNull();
    nav = screen.getByRole("navigation", { name: "Navegación de Negocio" });
    expect(within(nav).getAllByRole("link").map((a) => a.textContent)).toEqual([
      "Pagos",
      "Membresías",
    ]);
  });

  it("5. Pagos V2 abre en Movimientos por defecto y alterna a Resumen con totales reales", () => {
    render(<PanelV2Payments />);
    expect(screen.getByTestId("v2-payments-movements")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Movimientos/i })).toHaveAttribute("aria-selected", "true");

    fireEvent.click(screen.getByRole("tab", { name: /Resumen/i }));
    expect(screen.queryByTestId("v2-payments-movements")).toBeNull();
    expect(screen.getByRole("region", { name: "Resumen de pagos" })).toBeInTheDocument();
  });

  it("6. Regresión panel original: barra histórica, menú Membresías y descuentos, estilos y consumos intactos", async () => {
    // 6.1 Barra histórica de V2Layout sin cambios
    const layoutCode = fs.readFileSync(path.join(rootDir, "components/kani/v2/layout.tsx"), "utf8");
    expect(layoutCode).toContain('to: "/panel-administracion/inicio", title: "Inicio"');
    expect(layoutCode).toContain('to: "/panel-administracion/turnos", title: "Turnos"');
    expect(layoutCode).toContain('to: "/panel-administracion/horarios", title: "Horarios"');
    expect(layoutCode).toContain('to: "/panel-administracion/pagos", title: "Pagos"');
    expect(layoutCode).toContain('to: "/panel-administracion/clientes", title: "Clientes"');
    expect(layoutCode).toContain('to: "/panel-administracion/datos", title: "Datos"');

    // 6.2 Menú desplegable conserva accesos originales e incluye Panel V2 -> /panel-v2
    const headerCode = fs.readFileSync(path.join(rootDir, "components/kani/site-header.tsx"), "utf8");
    expect(headerCode).toContain('to="/panel-administracion"');
    expect(headerCode).toContain('to="/panel-administracion/membresias"');
    expect(headerCode).toContain('to="/panel-administracion/mantenimiento"');
    expect(headerCode).toContain('to="/panel-v2"');

    // 6.3 Módulo combinado «Membresías y descuentos» en panel original muestra membresías y consumos
    const { unmount } = render(<V2MembershipsAndDiscounts initialTab="MEMBRESIAS" />);
    expect(screen.getByRole("heading", { name: "Membresías y descuentos" })).toBeInTheDocument();
    expect(screen.getByRole("tablist", { name: "Pestañas de Membresías y descuentos" })).toBeInTheDocument();
    expect(screen.getByText("Juan Pérez")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Detalle e historial/i }));
    expect(await screen.findByText(/Historial de sesiones consumidas/i)).toBeInTheDocument();
    expect(screen.getByText(/Servicio realizado/i)).toBeInTheDocument();
    unmount();

    // 6.4 En Panel V2 Membresías se presenta aislada sin pestañas duplicadas
    render(<V2MembershipsAndDiscounts initialTab="MEMBRESIAS" standaloneTab="MEMBRESIAS" />);
    expect(screen.getByRole("heading", { name: "Membresías" })).toBeInTheDocument();
    expect(screen.queryByRole("tablist", { name: "Pestañas de Membresías y descuentos" })).toBeNull();
  });
});
