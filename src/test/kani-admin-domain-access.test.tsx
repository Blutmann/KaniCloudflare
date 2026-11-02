import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  getStaff: vi.fn(),
  subscribe: vi.fn(),
  dataProvider: vi.fn(),
}));

vi.mock("@/lib/kani-auth", () => ({
  getAuthenticatedStaff: auth.getStaff,
  signInWithPassword: vi.fn(),
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { onAuthStateChange: auth.subscribe } },
}));
vi.mock("@tanstack/react-router", () => ({ Link: () => null, Outlet: () => null }));
vi.mock("@/components/kani/v2/data", () => ({
  V2DataProvider: auth.dataProvider,
  useV2: () => ({ loading: false, error: "", refresh: vi.fn() }),
}));

import { V2Layout } from "@/components/kani/v2/layout";

describe("admin login on the connected custom domain", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("VITE_SUPABASE_URL", "https://iockpxtkflyjfagkvgnr.supabase.co");
    auth.getStaff.mockResolvedValue(null);
    auth.subscribe.mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it.each(["kanibarber.com", "www.kanibarber.com"])(
    "shows the real login form on %s and keeps private data behind authentication",
    async (hostname) => {
      vi.spyOn(window, "location", "get").mockReturnValue({ hostname } as Location);
      render(<V2Layout />);
      expect(await screen.findByRole("button", { name: /iniciar sesión/i })).toBeVisible();
      expect(screen.getByLabelText("Email")).toBeRequired();
      expect(screen.getByLabelText("Contraseña")).toBeRequired();
      expect(auth.getStaff).toHaveBeenCalledWith({ bypassCache: true });
      expect(auth.dataProvider).not.toHaveBeenCalled();
      expect(screen.queryByText("Este panel no está disponible en este entorno.")).toBeNull();
    },
  );

  it.each([
    ["www.kanibarber.com.attacker.example", "https://iockpxtkflyjfagkvgnr.supabase.co"],
    ["www.kanibarber.com", "https://production.supabase.co"],
  ])(
    "blocks the wrong host or database (%s, %s) before reading staff data",
    async (hostname, url) => {
      vi.spyOn(window, "location", "get").mockReturnValue({ hostname } as Location);
      vi.stubEnv("VITE_SUPABASE_URL", url);
      render(<V2Layout />);
      expect(await screen.findByRole("alert")).toHaveTextContent(
        "Este panel no está disponible en este entorno.",
      );
      expect(auth.getStaff).not.toHaveBeenCalled();
      expect(auth.dataProvider).not.toHaveBeenCalled();
    },
  );
});
