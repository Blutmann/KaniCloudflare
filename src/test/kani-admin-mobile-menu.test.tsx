import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

let mockPathname = "/panel-administracion/turnos";
const mockGetAuthenticatedStaff = vi.fn();
const mockSignOut = vi.fn().mockResolvedValue({ error: null });
const mockNavigate = vi.fn();
const mockSetMobileMenuOpen = vi.fn();

vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, children, ...props }: any) => (
    <a href={typeof to === "string" ? to : "#"} {...props}>
      {children}
    </a>
  ),
  useNavigate: () => mockNavigate,
  useRouterState: ({ select }: any) => select({ location: { pathname: mockPathname } }),
}));

vi.mock("@/lib/kani-auth", () => ({
  getAuthenticatedStaff: (...args: unknown[]) => mockGetAuthenticatedStaff(...args),
  signOut: (...args: unknown[]) => mockSignOut(...args),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: vi.fn() } } }),
    },
  },
}));

vi.mock("@/components/kani/admin-activity-popover", () => ({
  AdminActivityPopover: () => <div data-testid="activity-popover" />,
}));

vi.mock("@/components/kani/store", () => ({
  useKani: () => {
    const React = require("react");
    const [mobileMenuOpen, setOpen] = React.useState(false);
    const setMobileMenuOpen = React.useCallback((next: boolean) => {
      mockSetMobileMenuOpen(next);
      setOpen(next);
    }, []);
    return {
      mobileMenuOpen,
      setMobileMenuOpen,
      theme: "dark",
      toggleTheme: vi.fn(),
    };
  },
}));

import { SiteHeader } from "@/components/kani/site-header";

function makeRoleStaff(role: "ADMIN" | "MANAGER" | "BARBER") {
  return {
    user: { id: `u-${role}`, email: `${role.toLowerCase()}@kani.test` },
    profile: {
      user_id: `u-${role}`,
      role,
      barber_id: role === "BARBER" ? "b-lautaro" : null,
      display_name: role === "ADMIN" ? "KANI Admin" : role === "MANAGER" ? "Jefe KANI" : "Lautaro",
      active: true,
    },
    barbers: [{ id: "b-lautaro", name: "Lautaro", active: true }],
  };
}

describe("KANI — Reorganización del menú desplegable ADMIN (Mobile)", () => {
  beforeEach(() => {
    mockPathname = "/panel-administracion/turnos";
    mockGetAuthenticatedStaff.mockReset();
    mockSignOut.mockClear();
    mockNavigate.mockClear();
    mockSetMobileMenuOpen.mockClear();
  });

  afterEach(() => {
    cleanup();
  });

  it("1. Menú ADMIN muestra exactamente los 5 grupos en orden obligatorio y sin WhatsApp duplicado en el listado", async () => {
    mockGetAuthenticatedStaff.mockResolvedValue(makeRoleStaff("ADMIN"));
    render(<SiteHeader />);

    await waitFor(() => {
      expect(mockGetAuthenticatedStaff).toHaveBeenCalled();
    });

    fireEvent.click(screen.getByRole("button", { name: "Abrir menú" }));

    const nav = await screen.findByRole("navigation", { name: "Menú principal" });
    expect(nav).toHaveClass("mobile-menu--liquid", "mobile-menu--admin");
    expect(nav).not.toHaveClass("mobile-menu--barber");

    // El acceso a WhatsApp permanece en el header, pero NO dentro del listado del menú
    expect(screen.getByRole("link", { name: "Consultas por WhatsApp" })).toBeInTheDocument();
    expect(within(nav).queryByRole("link", { name: /WhatsApp/i })).toBeNull();

    // Grupo 1, 2 y 3 dentro de mobile-menu-scroll separados por divisores
    const scrollContainer = nav.querySelector(".mobile-menu-scroll")!;
    expect(scrollContainer).not.toBeNull();

    const groups = scrollContainer.querySelectorAll(".mobile-menu-group");
    expect(groups).toHaveLength(3);
    expect(scrollContainer.querySelectorAll('[role="separator"]')).toHaveLength(2);

    const group1Links = [...groups[0]!.querySelectorAll("a")].map((a) => a.textContent?.trim());
    const group2Links = [...groups[1]!.querySelectorAll("a")].map((a) => a.textContent?.trim());
    const group3Links = [...groups[2]!.querySelectorAll("a")].map((a) => a.textContent?.trim());

    expect(group1Links).toEqual(["Reservar turno", "Contacto"]);
    expect(group2Links).toEqual([
      "Panel de administración",
      "Membresías y descuentos",
      "Panel de mantenimiento",
    ]);
    expect(group3Links).toEqual(["Política de privacidad", "Términos y condiciones"]);

    // Grupo 4 (Sesión) y Grupo 5 (Volver a la reserva) en mobile-menu-dock
    const dock = nav.querySelector(".mobile-menu-dock")!;
    expect(dock).not.toBeNull();
    expect(within(dock).getByText("KANI Admin")).toBeInTheDocument();
    expect(within(dock).getByText("Administrador")).toBeInTheDocument();
    expect(within(dock).getByRole("button", { name: /Cerrar sesión/i })).toBeInTheDocument();
    expect(within(dock).getByRole("button", { name: /Volver a la reserva/i })).toBeInTheDocument();

    // Orden global exacto dentro de nav
    const navText = nav.textContent || "";
    const orderedLabels = [
      "Reservar turno",
      "Contacto",
      "Panel de administración",
      "Membresías y descuentos",
      "Panel de mantenimiento",
      "Política de privacidad",
      "Términos y condiciones",
      "KANI Admin",
      "Cerrar sesión",
      "Volver a la reserva",
    ];
    let prevIndex = -1;
    for (const label of orderedLabels) {
      const idx = navText.indexOf(label);
      expect(idx).toBeGreaterThan(prevIndex);
      prevIndex = idx;
    }
  });

  it("2. Botón «Cerrar sesión» funciona y conserva identidad ADMIN", async () => {
    mockGetAuthenticatedStaff.mockResolvedValue(makeRoleStaff("ADMIN"));
    render(<SiteHeader />);

    await waitFor(() => {
      expect(mockGetAuthenticatedStaff).toHaveBeenCalled();
    });

    fireEvent.click(screen.getByRole("button", { name: "Abrir menú" }));
    mockSetMobileMenuOpen.mockClear();

    const nav = await screen.findByRole("navigation", { name: "Menú principal" });
    fireEvent.click(within(nav).getByRole("button", { name: /Cerrar sesión/i }));

    await waitFor(() => {
      expect(mockSetMobileMenuOpen).toHaveBeenCalledWith(false);
      expect(mockSignOut).toHaveBeenCalledTimes(1);
    });
  });

  it("3. No altera JEFE y agrega «Volver a la reserva» en BARBER conservando todas sus opciones", async () => {
    mockGetAuthenticatedStaff.mockResolvedValue(makeRoleStaff("MANAGER"));
    const { unmount } = render(<SiteHeader />);

    await waitFor(() => {
      expect(mockGetAuthenticatedStaff).toHaveBeenCalled();
    });

    fireEvent.click(screen.getByRole("button", { name: "Abrir menú" }));
    const managerNav = await screen.findByRole("navigation", { name: "Menú principal" });
    expect(managerNav).not.toHaveClass("mobile-menu--admin");
    expect(within(managerNav).queryByText("Panel de mantenimiento")).toBeNull();
    unmount();

    mockGetAuthenticatedStaff.mockResolvedValue(makeRoleStaff("BARBER"));
    render(<SiteHeader />);

    await waitFor(() => {
      expect(mockGetAuthenticatedStaff).toHaveBeenCalledTimes(2);
    });

    fireEvent.click(screen.getByRole("button", { name: "Abrir menú" }));
    const barberNav = await screen.findByRole("navigation", { name: "Menú principal" });
    expect(barberNav).toHaveClass("mobile-menu--barber");
    expect(barberNav).not.toHaveClass("mobile-menu--admin");
    const barberDock = barberNav.querySelector(".mobile-menu-dock")!;
    expect(within(barberDock).getByText("Lautaro")).toBeInTheDocument();
    expect(within(barberDock).getByText("BARBER")).toBeInTheDocument();
    expect(within(barberDock).getByRole("button", { name: /Cerrar sesión/i })).toBeInTheDocument();
    expect(within(barberDock).getByRole("button", { name: /Volver a la reserva/i })).toBeInTheDocument();
  });

  it("4. CSS Liquid Glass de ADMIN y BARBER garantiza pantalla completa, inicio superior en Desktop y espaciados consistentes", () => {
    const css = fs.readFileSync(
      path.resolve(__dirname, "../components/kani/experimental/liquid-glass.css"),
      "utf-8",
    );
    const barberAndAdminSection = css.slice(css.indexOf("MENÚ DESPLEGABLE BARBER"));
    expect(barberAndAdminSection).toContain("nav.mobile-menu.mobile-menu--liquid.mobile-menu--admin");
    expect(barberAndAdminSection).toMatch(/\.mobile-menu--admin\s*\{[^}]*height:\s*100dvh\s*!important/);
    expect(barberAndAdminSection).toMatch(/\.mobile-menu--admin\s+\.mobile-menu-scroll\s*\{[^}]*overflow-y:\s*auto/);
    expect(barberAndAdminSection).toMatch(/\.mobile-menu--admin\s+\.mobile-menu-scroll\s*\{[^}]*justify-content:\s*flex-start\s*!important/);
    expect(barberAndAdminSection).toMatch(/\.mobile-menu--barber\s+\.mobile-menu-scroll\s*\{[^}]*justify-content:\s*flex-start\s*!important/);
    expect(barberAndAdminSection).not.toContain("justify-content: center");
    expect(barberAndAdminSection).toMatch(/padding:\s*28px\s+4px\s+20px/);
    expect(barberAndAdminSection).toMatch(/\.mobile-menu--admin\s+\.mobile-menu-dock\s*\{[^}]*safe-area-inset-bottom/);
    expect(barberAndAdminSection).toMatch(/\.mobile-menu--admin\s+\.mobile-menu-cta--inline[\s\S]*?width:\s*100%\s*!important/);
    expect(barberAndAdminSection).toMatch(/\.mobile-menu--barber\s+\.mobile-menu-cta--inline[\s\S]*?width:\s*100%\s*!important/);
  });
});
