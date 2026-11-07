import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
const mocks = vi.hoisted(() => ({ signOut: vi.fn() }));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, children, ...props }: any) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
}));
vi.mock("@/lib/kani-auth", () => ({ signOut: mocks.signOut }));
import {
  StaffRecoveryRequest,
  StaffPasswordReset,
} from "../components/kani/staff-password-recovery";
import { STAFF_RECOVERY_MESSAGE } from "../lib/kani-staff-recovery";
const fakeHash = "a".repeat(56);
beforeEach(() => {
  vi.restoreAllMocks();
  window.history.replaceState(
    {},
    "",
    "/restablecer-contrasena#token_hash=" + fakeHash + "&type=recovery",
  );
  mocks.signOut.mockResolvedValue(undefined);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
describe("Staff recovery forms", () => {
  for (const result of ["accepted", "suppressed", "limited", "unavailable"])
    it(`keeps the same public message for ${result}`, async () => {
      const fetchMock = vi.fn(
        result === "unavailable"
          ? () => Promise.reject(new Error("controlled offline"))
          : () => Promise.resolve(new Response("{}")),
      );
      vi.stubGlobal("fetch", fetchMock);
      render(<StaffRecoveryRequest />);
      fireEvent.change(screen.getByLabelText("Email"), {
        target: { value: "controlled@example.invalid" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Enviar enlace" }));
      expect(await screen.findByRole("status")).toHaveTextContent(STAFF_RECOVERY_MESSAGE);
      expect(screen.getByRole("button", { name: "Enviar enlace" })).toBeDisabled();
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock.mock.calls[0][0]).toBe("/api/staff/password-recovery");
      expect(screen.getByRole("link", { name: "Volver al inicio de sesión" })).toHaveAttribute(
        "href",
        "/panel-administracion",
      );
    });
  it("removes the token fragment without verifying or sending a request merely by opening the page", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<StaffPasswordReset />);
    await screen.findByLabelText("Nueva contraseña");
    expect(window.location.hash).toBe("");
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("offers independent accessible password visibility controls and rejects mismatched confirmation", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<StaffPasswordReset />);
    const first = await screen.findByLabelText("Nueva contraseña"),
      second = screen.getByLabelText("Confirmar contraseña");
    fireEvent.click(screen.getByRole("button", { name: "Mostrar nueva contraseña" }));
    expect(first).toHaveAttribute("type", "text");
    expect(second).toHaveAttribute("type", "password");
    fireEvent.change(first, { target: { value: "controlled-password-first" } });
    fireEvent.change(second, { target: { value: "controlled-password-other" } });
    fireEvent.submit(first.closest("form")!);
    expect(screen.getByRole("alert")).toHaveTextContent("Las contraseñas no coinciden.");
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("saves through the server, clears the local session and returns to login without granting permissions", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true })));
    vi.stubGlobal("fetch", fetchMock);
    render(<StaffPasswordReset />);
    const first = await screen.findByLabelText("Nueva contraseña");
    fireEvent.change(first, { target: { value: "controlled-password-only" } });
    fireEvent.change(screen.getByLabelText("Confirmar contraseña"), {
      target: { value: "controlled-password-only" },
    });
    fireEvent.submit(first.closest("form")!);
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Tu contraseña se actualizó correctamente",
    );
    expect(mocks.signOut).toHaveBeenCalledWith("local");
    expect(screen.queryByLabelText("Nueva contraseña")).not.toBeInTheDocument();
    expect(fetchMock.mock.calls[0][0]).toBe("/api/staff/password-reset");
    expect(screen.getByRole("link", { name: "Volver al inicio de sesión" })).toHaveAttribute(
      "href",
      "/panel-administracion",
    );
  });
  for (const fragment of [
    "",
    "#token_hash=invalid&type=recovery",
    "#token_hash=" + fakeHash + "&type=invite",
  ])
    it("rejects a missing, malformed or wrong-purpose link without using the current session", async () => {
      window.history.replaceState({}, "", "/restablecer-contrasena" + fragment);
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);
      render(<StaffPasswordReset />);
      expect(await screen.findByRole("alert")).toHaveTextContent(
        "El enlace venció, ya fue utilizado o no es válido.",
      );
      expect(screen.queryByLabelText("Nueva contraseña")).not.toBeInTheDocument();
      expect(fetchMock).not.toHaveBeenCalled();
      expect(screen.getByRole("link", { name: "Solicitar un nuevo enlace" })).toBeVisible();
    });
  it("explains expired or reused links returned by the provider and offers a fresh request", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: false, code: "INVALID_LINK" }))),
    );
    render(<StaffPasswordReset />);
    const first = await screen.findByLabelText("Nueva contraseña");
    for (const label of ["Nueva contraseña", "Confirmar contraseña"])
      fireEvent.change(screen.getByLabelText(label), {
        target: { value: "controlled-password-only" },
      });
    fireEvent.submit(first.closest("form")!);
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "El enlace venció, ya fue utilizado o no es válido.",
      ),
    );
    expect(screen.queryByLabelText("Nueva contraseña")).not.toBeInTheDocument();
  });
});
