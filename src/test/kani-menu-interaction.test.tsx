import { createContext, useContext, useState, type ReactNode } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const location = vi.hoisted(() => ({ pathname: "/reservar" }));
const MenuContext = createContext({
  mobileMenuOpen: false,
  setMobileMenuOpen: (_open: boolean) => {},
  theme: "light",
  toggleTheme: () => {},
});
vi.mock("@/components/kani/store", () => ({ useKani: () => useContext(MenuContext) }));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, children, ...props }: { to: string; children: ReactNode }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
  useNavigate: () => vi.fn(),
  useRouterState: ({ select }: { select: (value: unknown) => string }) => select({ location }),
}));
vi.mock("@/lib/kani-auth", () => ({ getAuthenticatedStaff: async () => null, signOut: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: { onAuthStateChange: () => ({ data: { subscription: { unsubscribe: vi.fn() } } }) },
  },
}));
import { SiteHeader } from "@/components/kani/site-header";

function Harness() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  return (
    <MenuContext.Provider
      value={{ mobileMenuOpen, setMobileMenuOpen, theme: "light", toggleTheme: () => {} }}
    >
      <SiteHeader />
    </MenuContext.Provider>
  );
}

describe("mobile navigation scroll and closing", () => {
  beforeEach(() => {
    location.pathname = "/reservar";
    window.history.replaceState({}, "", "/reservar");
    vi.stubGlobal("scrollY", 240);
    vi.stubGlobal("scrollTo", vi.fn());
    document.body.style.overflow = "clip";
  });
  afterEach(() => {
    document.body.removeAttribute("style");
    vi.unstubAllGlobals();
  });

  it("preserves the header and restores the previous scroll/styles across repeated open and close", async () => {
    render(<Harness />);
    for (let cycle = 0; cycle < 3; cycle++) {
      fireEvent.click(screen.getByRole("button", { name: "Abrir menú" }));
      expect(document.body.style.position).toBe("fixed");
      expect(document.body.style.top).toBe("-240px");
      expect(screen.getAllByAltText("Kani Barber Studio")[0]).toBeTruthy();
      expect(screen.getByRole("navigation", { name: "Menú principal" })).toBeTruthy();
      expect(screen.getByRole("button", { name: "Volver a la solicitud" })).toBeTruthy();
      fireEvent.keyDown(window, { key: "Escape" });
      await waitFor(() =>
        expect(screen.queryByRole("navigation", { name: "Menú principal" })).toBeNull(),
      );
      expect(document.body.style.position).toBe("");
      expect(document.body.style.overflow).toBe("clip");
      expect(window.scrollTo).toHaveBeenLastCalledWith({ top: 240, behavior: "instant" });
    }
  });

  it("does not restore an earlier route's scroll after navigation", async () => {
    const { rerender } = render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Abrir menú" }));
    location.pathname = "/estudio";
    window.history.replaceState({}, "", "/estudio");
    rerender(<Harness />);
    await waitFor(() =>
      expect(screen.queryByRole("navigation", { name: "Menú principal" })).toBeNull(),
    );
    expect(window.scrollTo).not.toHaveBeenCalled();
    expect(document.body.style.overflow).toBe("clip");
  });
});
