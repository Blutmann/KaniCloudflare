import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const auth = vi.hoisted(() => ({
  verifyOtp: vi.fn(),
  exchangeCodeForSession: vi.fn(),
  getUser: vi.fn(),
  updateUser: vi.fn(),
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { auth } }));
vi.mock("@tanstack/react-router", () => ({ createFileRoute: () => (config: unknown) => config }));
import { ActivateAccount } from "@/routes/activar-cuenta";
const originalLocation = Object.getOwnPropertyDescriptor(window, "location")!;
beforeEach(() => {
  vi.resetAllMocks();
  window.history.replaceState({}, "", "/activar-cuenta");
  auth.verifyOtp.mockResolvedValue({ error: null });
  auth.exchangeCodeForSession.mockResolvedValue({ error: null });
  auth.getUser.mockResolvedValue({ data: { user: { id: "existing-admin-session" } }, error: null });
});
afterEach(() => {
  cleanup();
  Object.defineProperty(window, "location", originalLocation);
});

// The real SDK processes the implicit recovery callback used by the production
// ConfirmationURL template. The Auth HTTP server below is entirely synthetic.
function recoverySession(updateStatus = 200) {
  const user = {
    id: "10000000-0000-0000-0000-000000000001",
    aud: "authenticated",
    role: "authenticated",
    email: "recovery@example.invalid",
    email_confirmed_at: "2026-11-04T00:00:00Z",
    app_metadata: {},
    user_metadata: {},
    created_at: "2026-11-04T00:00:00Z",
  };
  const encode = (value: unknown) =>
    btoa(JSON.stringify(value)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const now = Math.floor(Date.now() / 1000);
  const token = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ sub: user.id, aud: "authenticated", role: "authenticated", iat: now, exp: now + 3600 })}.synthetic`;
  window.history.replaceState(
    {},
    "",
    `/activar-cuenta#access_token=${token}&refresh_token=synthetic-refresh&expires_in=3600&token_type=bearer&type=recovery`,
  );
  const requests: Array<{ method: string; body: Record<string, unknown> | null }> = [];
  const client = createClient("https://auth.example.invalid", "synthetic-public-key", {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: true },
    global: {
      fetch: vi.fn(async (input, init) => {
        if (!String(input).endsWith("/auth/v1/user"))
          throw new Error("Unexpected synthetic Auth request");
        const method = init?.method ?? "GET";
        requests.push({
          method,
          body: typeof init?.body === "string" ? JSON.parse(init.body) : null,
        });
        const status = method === "PUT" ? updateStatus : 200;
        return new Response(
          JSON.stringify(status === 200 ? user : { msg: "Password policy rejected" }),
          {
            status,
            headers: { "content-type": "application/json" },
          },
        );
      }),
    },
  });
  const events: string[] = [];
  const subscription = client.auth.onAuthStateChange((event) => {
    events.push(event);
  }).data.subscription;
  auth.getUser.mockImplementation(() => client.auth.getUser());
  auth.updateUser.mockImplementation((attributes) => client.auth.updateUser(attributes));
  return { requests, events, subscription };
}
describe("Individual account activation", () => {
  it("processes a real SDK recovery callback and saves the new password before navigating", async () => {
    const { requests, events, subscription } = recoverySession();
    const navigate = vi.fn();
    try {
      render(<ActivateAccount />);
      fireEvent.change(await screen.findByLabelText(/^Contraseña$/), {
        target: { value: "synthetic-new-password" },
      });
      fireEvent.change(screen.getByLabelText("Confirmar contraseña"), {
        target: { value: "synthetic-new-password" },
      });
      Object.defineProperty(window, "location", {
        configurable: true,
        value: { href: window.location.href, assign: navigate },
      });
      fireEvent.submit(screen.getByRole("button", { name: "Guardar y entrar" }).closest("form")!);
      await waitFor(() => expect(navigate).toHaveBeenCalledWith("/panel-administracion/turnos"));
      expect(events).toContain("PASSWORD_RECOVERY");
      expect(requests.filter((r) => r.method === "PUT")).toMatchObject([
        { method: "PUT", body: { password: "synthetic-new-password" } },
      ]);
    } finally {
      subscription.unsubscribe();
    }
  });
  it("keeps the recovery form available when Auth rejects a password update", async () => {
    const { subscription } = recoverySession(422);
    try {
      render(<ActivateAccount />);
      fireEvent.change(await screen.findByLabelText(/^Contraseña$/), {
        target: { value: "synthetic-new-password" },
      });
      fireEvent.change(screen.getByLabelText("Confirmar contraseña"), {
        target: { value: "synthetic-new-password" },
      });
      fireEvent.submit(screen.getByRole("button", { name: "Guardar y entrar" }).closest("form")!);
      expect(await screen.findByRole("alert")).toHaveTextContent(
        "No pudimos establecer la contraseña",
      );
      expect(screen.getByRole("button", { name: "Guardar y entrar" })).toBeEnabled();
    } finally {
      subscription.unsubscribe();
    }
  });
  it.each(["token_hash=invalid&type=invite", "code=invalid"])(
    "rejects an invalid invitation without using an existing ADMIN session: %s",
    async (query) => {
      auth.verifyOtp.mockResolvedValue({ error: new Error("expired") });
      auth.exchangeCodeForSession.mockResolvedValue({ error: new Error("expired") });
      window.history.replaceState({}, "", `/activar-cuenta?${query}`);
      render(<ActivateAccount />);
      expect(await screen.findByRole("alert")).toHaveTextContent("La invitación venció");
      expect(auth.getUser).not.toHaveBeenCalled();
      expect(auth.updateUser).not.toHaveBeenCalled();
      expect(screen.queryByLabelText(/^Contraseña$/)).toBeNull();
      expect(window.location.search).toBe("");
    },
  );
  it("rejects a failed implicit callback even if another account is signed in", async () => {
    window.history.replaceState({}, "", "/activar-cuenta#error=access_denied");
    render(<ActivateAccount />);
    expect(await screen.findByRole("alert")).toHaveTextContent("La invitación venció");
    expect(auth.getUser).not.toHaveBeenCalled();
    expect(window.location.hash).toBe("");
  });
  it("verifies a valid invitation before showing the password form and removes the token URL", async () => {
    window.history.replaceState({}, "", "/activar-cuenta?token_hash=synthetic&type=invite");
    render(<ActivateAccount />);
    expect(await screen.findByLabelText(/^Contraseña$/)).toBeInTheDocument();
    expect(auth.verifyOtp).toHaveBeenCalledWith({ token_hash: "synthetic", type: "invite" });
    expect(auth.updateUser).not.toHaveBeenCalled();
    expect(window.location.search).toBe("");
  });
  it("handles network failures without showing a password form", async () => {
    auth.getUser.mockRejectedValue(new Error("network"));
    render(<ActivateAccount />);
    expect(await screen.findByRole("alert")).toHaveTextContent("La invitación venció");
    expect(screen.queryByLabelText(/^Contraseña$/)).toBeNull();
  });
  it("rejects mismatched passwords without changing credentials", async () => {
    render(<ActivateAccount />);
    fireEvent.change(await screen.findByLabelText(/^Contraseña$/), {
      target: { value: "synthetic-password" },
    });
    fireEvent.change(screen.getByLabelText("Confirmar contraseña"), {
      target: { value: "different-password" },
    });
    fireEvent.submit(screen.getByRole("button", { name: "Guardar y entrar" }).closest("form")!);
    expect(await screen.findByRole("alert")).toHaveTextContent("confirmá la misma contraseña");
    expect(auth.updateUser).not.toHaveBeenCalled();
  });
});
