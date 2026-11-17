import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const mockGetAuthenticatedStaff = vi.fn();
const mockSignInWithPassword = vi.fn();
const mockSignOut = vi.fn();
const mockRequestPasswordReset = vi.fn();
const mockAuthListeners = new Set<(event: string, session: unknown) => void>();

let mockedToken = "tok-qr-auth-0123456789abcdef0123456789";

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => () => ({
    useParams: () => ({ token: mockedToken }),
  }),
  Link: ({ to, params, children, ...props }: any) => {
    const resolved =
      typeof to === "string" && params?.token ? to.replace("$token", params.token) : to;
    return (
      <a href={resolved} {...props}>
        {children}
      </a>
    );
  },
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      onAuthStateChange: (cb: (event: string, session: unknown) => void) => {
        mockAuthListeners.add(cb);
        return {
          data: {
            subscription: {
              unsubscribe: () => mockAuthListeners.delete(cb),
            },
          },
        };
      },
    },
  },
}));

vi.mock("@/lib/kani-auth", () => ({
  getAuthenticatedStaff: (...args: unknown[]) => mockGetAuthenticatedStaff(...args),
  signInWithPassword: (...args: unknown[]) => mockSignInWithPassword(...args),
  signOut: (...args: unknown[]) => mockSignOut(...args),
  requestPasswordReset: (...args: unknown[]) => mockRequestPasswordReset(...args),
}));

import * as membershipsLib from "@/lib/kani-recurrences-memberships";
import {
  buildMembershipCardUrl,
  buildMembershipVerificationUrl,
  getMembershipWorkerRedirectUrl,
  isSafeInternalMembershipReturnPath,
  sanitizeInternalMembershipReturnPath,
} from "@/lib/kani-membership-urls";
import { PublicMembershipCardPage } from "@/routes/membresia.$token";
import { SalonMembershipVerificationView } from "@/routes/verificar-membresia.$token";

function makeStaff(role: "ADMIN" | "MANAGER" | "BARBER", displayName = "Lautaro Barber") {
  return {
    user: { id: `user-${role.toLowerCase()}`, email: `${role.toLowerCase()}@kani.test` } as any,
    profile: {
      user_id: `user-${role.toLowerCase()}`,
      role,
      barber_id: role === "BARBER" ? "barber-lautaro" : null,
      display_name: displayName,
      active: true,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    },
    barbers: [{ id: "barber-lautaro", name: "Lautaro", active: true, created_at: "2026-01-01T00:00:00Z" }],
  } as any;
}

function makePublicCard(overrides: Partial<membershipsLib.PublicMembershipCardResult> = {}) {
  return {
    found: true,
    client_name: "Lucas Fernández",
    barber_name: "Lautaro",
    plan_name: "Membresía 4 servicios",
    package_size: 4,
    status: "ACTIVE",
    total_sessions: 4,
    consumed_sessions: 2,
    remaining_sessions: 2,
    expires_at: "2026-12-31",
    created_at: "2026-11-01T12:00:00Z",
    items: [
      {
        service_name: "Corte",
        total_quantity: 4,
        consumed_quantity: 2,
        remaining_quantity: 2,
      },
    ],
    consumptions: [
      {
        service_name: "Corte de cabello",
        consumption_type: "SERVICE_COMPLETED",
        status: "CONSUMED",
        consumed_at: "2026-11-05T15:30:00Z",
        refunded_at: null,
      },
    ],
    ...overrides,
  } satisfies membershipsLib.PublicMembershipCardResult;
}

function makeDetailedMembership(overrides: Partial<membershipsLib.ClientMembershipRecord> = {}) {
  return {
    id: "mem-123",
    clientId: "cli-123",
    clientName: "Lucas Fernández",
    barberId: "barber-lautaro",
    barberName: "Lautaro",
    planName: "Membresía 4 servicios",
    packageSize: 4,
    status: "ACTIVE",
    totalSessions: 4,
    consumedSessions: 2,
    remainingSessions: 2,
    expiresAt: "2026-12-31",
    publicToken: mockedToken,
    publicTokenRevokedAt: null,
    items: [
      {
        id: "item-1",
        serviceName: "Corte",
        totalQuantity: 4,
        consumedQuantity: 2,
        remainingQuantity: 2,
      },
    ],
    consumptions: [],
    ...overrides,
  } as unknown as membershipsLib.ClientMembershipRecord;
}

describe("KANI — Autenticación integrada en membresías, verificación QR y normalización de dominios", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockAuthListeners.clear();
    mockedToken = "tok-qr-auth-0123456789abcdef0123456789";
    mockGetAuthenticatedStaff.mockReset();
    mockSignInWithPassword.mockReset();
    mockSignOut.mockReset().mockResolvedValue({ error: null });
    mockRequestPasswordReset.mockReset();
    window.sessionStorage.clear();
  });

  describe("1. Credencial digital (/membresia/:token)", () => {
    it("usuario no autenticado conserva «RESERVAR TURNO», muestra «Iniciar sesión» secundario y no mete formulario dentro de la tarjeta", async () => {
      mockGetAuthenticatedStaff.mockResolvedValue(null);
      vi.spyOn(membershipsLib, "getPublicMembershipCard").mockResolvedValue(makePublicCard());

      render(<PublicMembershipCardPage />);
      expect(await screen.findByText("VIP CLIENT")).toBeInTheDocument();

      const bookLink = screen.getByRole("link", { name: /RESERVAR TURNO/i });
      expect(bookLink).toHaveAttribute("href", "https://www.kanibarber.com/reservar");
      expect(screen.getByRole("button", { name: /Iniciar sesión/i })).toBeInTheDocument();
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(screen.getByTestId("kani-card-3d-scene").querySelector("form")).toBeNull();
    });

    it("permite iniciar sesión desde la credencial, muestra nombre y rol (JEFE) sin mezclar con el titular, y cerrar sesión localmente", async () => {
      const managerStaff = makeStaff("MANAGER", "Valentín Jefe");
      mockGetAuthenticatedStaff.mockResolvedValueOnce(null).mockResolvedValueOnce(managerStaff);
      mockSignInWithPassword.mockResolvedValue({ data: { session: { access_token: "t" } }, error: null });
      vi.spyOn(membershipsLib, "getPublicMembershipCard").mockResolvedValue(makePublicCard());

      render(<PublicMembershipCardPage />);
      expect(await screen.findByText("VIP CLIENT")).toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: /Iniciar sesión/i }));
      const dialog = await screen.findByRole("dialog", { name: /Acceso de personal interno/i });
      expect(dialog).toBeInTheDocument();
      expect(window.sessionStorage.getItem("kani:membership-auth-return-to")).toBe(
        `/membresia/${mockedToken}`,
      );

      fireEvent.change(screen.getByLabelText(/Email/i), { target: { value: "jefe@kani.test" } });
      fireEvent.change(screen.getByLabelText(/Contraseña/i), { target: { value: "secret123" } });
      fireEvent.submit(dialog.querySelector("form")!);

      await waitFor(() => {
        expect(mockSignInWithPassword).toHaveBeenCalledWith("jefe@kani.test", "secret123");
      });
      await waitFor(() => {
        expect(screen.queryByRole("dialog")).toBeNull();
      });

      const sessionBadge = screen.getByTestId("membership-staff-session");
      expect(sessionBadge).toHaveTextContent("Valentín Jefe");
      expect(sessionBadge).toHaveTextContent("JEFE");
      // El titular sigue siendo Lucas Fernández y RESERVAR TURNO sigue intacto
      expect(screen.getByRole("heading", { level: 1, name: "Lucas Fernández" })).toBeInTheDocument();
      expect(screen.getByRole("link", { name: /RESERVAR TURNO/i })).toBeInTheDocument();
      expect(screen.getByText("HISTORIAL DE VISITAS")).toBeInTheDocument();

      // Cerrar sesión localmente sin salir de la credencial
      fireEvent.click(screen.getByRole("button", { name: /Cerrar sesión/i }));
      await waitFor(() => {
        expect(mockSignOut).toHaveBeenCalledWith({ scope: "local" });
        expect(screen.getByRole("button", { name: /Iniciar sesión/i })).toBeInTheDocument();
      });
      expect(screen.getByRole("heading", { level: 1, name: "Lucas Fernández" })).toBeInTheDocument();
    });

    it("rechaza cuentas sin perfil interno activo al intentar iniciar sesión", async () => {
      mockGetAuthenticatedStaff.mockResolvedValue(null);
      mockSignInWithPassword.mockResolvedValue({ data: { session: { access_token: "t" } }, error: null });
      vi.spyOn(membershipsLib, "getPublicMembershipCard").mockResolvedValue(makePublicCard());

      render(<PublicMembershipCardPage />);
      expect(await screen.findByText("VIP CLIENT")).toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: /Iniciar sesión/i }));
      const dialog = await screen.findByRole("dialog");

      fireEvent.change(screen.getByLabelText(/Email/i), { target: { value: "cliente@gmail.com" } });
      fireEvent.change(screen.getByLabelText(/Contraseña/i), { target: { value: "secret123" } });
      fireEvent.submit(dialog.querySelector("form")!);

      expect(
        await screen.findByText(/no tiene permisos de personal interno/i),
      ).toBeInTheDocument();
      expect(mockSignOut).toHaveBeenCalledWith({ scope: "local" });
    });
  });

  describe("2. Verificación QR — Control Salón (/verificar-membresia/:token)", () => {
    it("escaneo sin sesión muestra vista pública + botón «Iniciar sesión» y permite autenticar y operar sin salir", async () => {
      const barberStaff = makeStaff("BARBER", "Lautaro");
      mockGetAuthenticatedStaff.mockResolvedValueOnce(null).mockResolvedValueOnce(barberStaff);
      mockSignInWithPassword.mockResolvedValue({ data: { session: { access_token: "t" } }, error: null });
      vi.spyOn(membershipsLib, "getPublicMembershipCard").mockResolvedValue(makePublicCard());
      vi.spyOn(membershipsLib, "fetchMembershipForVerification").mockResolvedValue(
        makeDetailedMembership(),
      );

      render(<SalonMembershipVerificationView />);
      expect(await screen.findByText("CREDENCIAL VÁLIDA")).toBeInTheDocument();
      expect(screen.getByText("Vista pública de verificación")).toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: /Iniciar sesión/i }));
      const dialog = await screen.findByRole("dialog");
      fireEvent.change(screen.getByLabelText(/Email/i), { target: { value: "lautaro@kani.test" } });
      fireEvent.change(screen.getByLabelText(/Contraseña/i), { target: { value: "pass123" } });
      fireEvent.submit(dialog.querySelector("form")!);

      await waitFor(() => {
        expect(screen.queryByRole("dialog")).toBeNull();
      });

      const qrSession = await screen.findByTestId("qr-staff-session");
      expect(qrSession).toHaveTextContent("Lautaro");
      expect(qrSession).toHaveTextContent("BARBER");
      expect(qrSession).toHaveTextContent(/Sesión activa/i);
      expect(await screen.findByRole("button", { name: /Descontar sesión ahora/i })).toBeInTheDocument();
      // BARBER no ve el enlace Panel Admin
      expect(screen.queryByRole("link", { name: /Gestionar membresía en Panel Admin/i })).toBeNull();
    });

    it("descuenta una sesión, actualiza saldo inmediatamente y bloquea clics concurrentes duplicados", async () => {
      const adminStaff = makeStaff("ADMIN", "Tomás Admin");
      mockGetAuthenticatedStaff.mockResolvedValue(adminStaff);
      vi.spyOn(membershipsLib, "getPublicMembershipCard").mockResolvedValue(makePublicCard());
      vi.spyOn(membershipsLib, "fetchMembershipForVerification").mockResolvedValue(
        makeDetailedMembership(),
      );

      let resolveConsume: ((val: any) => void) | null = null;
      const consumeSpy = vi.spyOn(membershipsLib, "consumeMembershipSession").mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveConsume = resolve;
          }),
      );

      render(<SalonMembershipVerificationView />);
      const deductBtn = await screen.findByRole("button", { name: /Descontar sesión ahora/i });
      expect(screen.getByRole("link", { name: /Gestionar membresía en Panel Admin/i })).toBeInTheDocument();

      // Doble clic rápido: solo debe disparar 1 petición
      fireEvent.click(deductBtn);
      fireEvent.click(deductBtn);
      expect(consumeSpy).toHaveBeenCalledTimes(1);

      resolveConsume!({
        membership: makeDetailedMembership({
          consumedSessions: 3,
          remainingSessions: 1,
          items: [
            {
              id: "item-1",
              serviceName: "Corte",
              totalQuantity: 4,
              consumedQuantity: 3,
              remainingQuantity: 1,
            },
          ],
        }),
        consumption: { id: "c-3", serviceName: "Corte" },
        remainingSessions: 1,
        isExhausted: false,
      });

      expect(await screen.findByText(/¡Sesión descontada correctamente! Restan 1\./i)).toBeInTheDocument();
      expect(screen.getByText("1 de 4")).toBeInTheDocument();

      // Cerrar sesión mantiene vista pública de la misma membresía
      fireEvent.click(screen.getByRole("button", { name: /Cerrar sesión/i }));
      await waitFor(() => {
        expect(mockSignOut).toHaveBeenCalledWith({ scope: "local" });
        expect(screen.getByText("Vista pública de verificación")).toBeInTheDocument();
      });
      expect(screen.queryByRole("button", { name: /Descontar sesión ahora/i })).toBeNull();
    });

    it("rechaza operaciones si BARBER escanea una membresía que no le pertenece", async () => {
      const otherBarber = makeStaff("BARBER", "Gonzalo");
      mockGetAuthenticatedStaff.mockResolvedValue(otherBarber);
      vi.spyOn(membershipsLib, "getPublicMembershipCard").mockResolvedValue(makePublicCard());
      vi.spyOn(membershipsLib, "fetchMembershipForVerification").mockResolvedValue(null);

      render(<SalonMembershipVerificationView />);
      expect(
        await screen.findByText(/no tiene permisos para operar esta membresía/i),
      ).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /Descontar sesión ahora/i })).toBeNull();
    });

    it("maneja expiración de sesión (SIGNED_OUT) limpiando controles protegidos automáticamente", async () => {
      const adminStaff = makeStaff("ADMIN", "Tomás Admin");
      mockGetAuthenticatedStaff.mockResolvedValue(adminStaff);
      vi.spyOn(membershipsLib, "getPublicMembershipCard").mockResolvedValue(makePublicCard());
      vi.spyOn(membershipsLib, "fetchMembershipForVerification").mockResolvedValue(
        makeDetailedMembership(),
      );

      render(<SalonMembershipVerificationView />);
      expect(await screen.findByRole("button", { name: /Descontar sesión ahora/i })).toBeInTheDocument();

      for (const listener of mockAuthListeners) {
        listener("SIGNED_OUT", null);
      }

      await waitFor(() => {
        expect(screen.getByText("Vista pública de verificación")).toBeInTheDocument();
      });
      expect(screen.queryByRole("button", { name: /Descontar sesión ahora/i })).toBeNull();
    });
  });

  describe("3. Normalización de dominios, QR y validación de rutas de retorno", () => {
    it("genera URLs canónicas https://www.kanibarber.com en producción (y evita workers.dev)", () => {
      const originalLocation = window.location;
      Object.defineProperty(window, "location", {
        configurable: true,
        value: new URL("https://kanibarberstudio-cloudflare.kanibarber.workers.dev/membresia/abc"),
      });

      expect(buildMembershipVerificationUrl("tok1234567890abcdef")).toBe(
        "https://www.kanibarber.com/verificar-membresia/tok1234567890abcdef",
      );
      expect(buildMembershipCardUrl("tok1234567890abcdef")).toBe(
        "https://www.kanibarber.com/membresia/tok1234567890abcdef",
      );

      Object.defineProperty(window, "location", {
        configurable: true,
        value: originalLocation,
      });
    });

    it("redirige enlaces antiguos workers.dev de membresía/QR hacia https://www.kanibarber.com sin tokens en query", () => {
      expect(
        getMembershipWorkerRedirectUrl(
          "https://kanibarberstudio-cloudflare.kanibarber.workers.dev/verificar-membresia/tok1234567890abcdef",
          "www.kanibarber.com",
        ),
      ).toBe("https://www.kanibarber.com/verificar-membresia/tok1234567890abcdef");

      expect(
        getMembershipWorkerRedirectUrl(
          "https://kanibarberstudio-cloudflare.kanibarber.workers.dev/membresia/tok1234567890abcdef",
          "www.kanibarber.com",
        ),
      ).toBe("https://www.kanibarber.com/membresia/tok1234567890abcdef");

      expect(
        getMembershipWorkerRedirectUrl(
          "https://kanibarberstudio-cloudflare.kanibarber.workers.dev/reservar",
          "www.kanibarber.com",
        ),
      ).toBeNull();
    });

    it("valida rutas de retorno internas de membresía y bloquea redirecciones abiertas", () => {
      expect(isSafeInternalMembershipReturnPath("/membresia/tok1234567890abcdef")).toBe(true);
      expect(isSafeInternalMembershipReturnPath("/verificar-membresia/tok1234567890abcdef")).toBe(true);
      expect(sanitizeInternalMembershipReturnPath("https://evil.com/membresia/tok1234567890abcdef")).toBeNull();
      expect(sanitizeInternalMembershipReturnPath("//evil.com/verificar-membresia/tok1234567890abcdef")).toBeNull();
      expect(sanitizeInternalMembershipReturnPath("/panel-administracion/inicio")).toBeNull();
    });
  });
});
