import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const auth = vi.hoisted(() => ({ verifyOtp: vi.fn(), exchangeCodeForSession: vi.fn(), getUser: vi.fn(), updateUser: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { auth } }));
vi.mock("@tanstack/react-router", () => ({ createFileRoute: () => (config: unknown) => config }));
import { ActivateAccount } from "@/routes/activar-cuenta";
beforeEach(() => {
  vi.resetAllMocks();
  window.history.replaceState({}, "", "/activar-cuenta");
  auth.verifyOtp.mockResolvedValue({ error: null });
  auth.exchangeCodeForSession.mockResolvedValue({ error: null });
  auth.getUser.mockResolvedValue({ data: { user: { id: "existing-admin-session" } }, error: null });
});
afterEach(cleanup);
describe("Individual account activation", () => {
  it.each(["token_hash=invalid&type=invite", "code=invalid"])("rejects an invalid invitation without using an existing ADMIN session: %s", async (query) => {
    auth.verifyOtp.mockResolvedValue({ error: new Error("expired") });
    auth.exchangeCodeForSession.mockResolvedValue({ error: new Error("expired") });
    window.history.replaceState({}, "", `/activar-cuenta?${query}`);
    render(<ActivateAccount />);
    expect(await screen.findByRole("alert")).toHaveTextContent("La invitación venció");
    expect(auth.getUser).not.toHaveBeenCalled();
    expect(auth.updateUser).not.toHaveBeenCalled();
    expect(screen.queryByLabelText(/^Contraseña$/)).toBeNull();
    expect(window.location.search).toBe("");
  });
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
    fireEvent.change(await screen.findByLabelText(/^Contraseña$/), { target: { value: "synthetic-password" } });
    fireEvent.change(screen.getByLabelText("Confirmar contraseña"), { target: { value: "different-password" } });
    fireEvent.submit(screen.getByRole("button", { name: "Guardar y entrar" }).closest("form")!);
    expect(await screen.findByRole("alert")).toHaveTextContent("confirmá la misma contraseña");
    expect(auth.updateUser).not.toHaveBeenCalled();
  });
});
