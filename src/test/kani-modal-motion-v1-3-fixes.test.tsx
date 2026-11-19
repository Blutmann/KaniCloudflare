import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { resetModalOriginForTests } from "@/lib/kani-modal-origin";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { V2Clients } from "@/components/kani/v2/clients";
import { EditMembershipModal } from "@/components/kani/v2/MembershipCard";

vi.mock("@/lib/kani-admin-context", () => ({
  useAdminStaff: () => ({
    profile: { role: "ADMIN", barber_id: "b1" },
    barbers: [{ id: "b1", name: "Gonzalo" }],
  }),
}));

vi.mock("@/components/kani/v2/data", () => ({
  useV2: () => ({
    services: [
      { id: "corte", dbId: "svc-1", name: "Corte", duration: 45, price: 25000 },
      { id: "barba", dbId: "svc-2", name: "Barba", duration: 30, price: 15000 },
    ],
    clients: [
      {
        id: "cli-1",
        name: "Juan Pérez",
        phone: "+5491112345678",
        email: "juan@example.com",
        created_at: "2026-01-10T10:00:00.000Z",
      },
    ],
    appointments: [],
    payments: [],
    barberId: "ALL",
    refresh: vi.fn(),
  }),
}));

describe("KANI Motion System v1.3 — Correcciones de persistencia visual y selectores", () => {
  beforeEach(() => {
    resetModalOriginForTests();
    vi.restoreAllMocks();
  });

  it("1. Nuevo cliente: el botón activador permanece montado y visible detrás del overlay y conserva sticky sin overflow:hidden", () => {
    const lgAdminCss = fs.readFileSync(
      path.resolve(__dirname, "../components/kani/experimental/liquid-glass-admin.css"),
      "utf-8",
    );
    const v2Css = fs.readFileSync(
      path.resolve(__dirname, "../components/kani/v2/v2.css"),
      "utf-8",
    );

    expect(lgAdminCss).toMatch(/body\[data-lg-admin="true"\]\[data-scroll-locked\][^}]*overflow:\s*clip\s*!important/);
    expect(v2Css).toMatch(/body\[data-scroll-locked\]:has\(\.v2-clients-page\)[^}]*overflow:\s*clip\s*!important/);

    render(<V2Clients />);

    const addButtons = screen.getAllByRole("button", { name: /Nuevo cliente/i });
    expect(addButtons).toHaveLength(2);

    fireEvent.pointerDown(addButtons[0]!);
    fireEvent.click(addButtons[0]!);

    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeInTheDocument();
    expect(dialog.getAttribute("data-kani-transition")).toBe("container-transform");

    // Ambos botones activadores (desktop y mobile sticky) permanecen en el DOM sin ocultamiento
    for (const btn of addButtons) {
      expect(btn.isConnected).toBe(true);
    }

    // Cerrar con Escape y volver a abrir funciona correctamente
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(addButtons[0]!);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("2. Editar membresía: el selector «Servicio a descontar» no recibe autofocus al abrir y funciona por interacción", () => {
    render(
      <EditMembershipModal
        membership={{
          id: "mem-1",
          clientId: "cli-1",
          clientName: "Juan Pérez",
          barberId: "b1",
          barberName: "Gonzalo",
          planName: "Pack Corte + Barba",
          status: "ACTIVE",
          totalSessions: 4,
          remainingSessions: 3,
          subtotalArs: 100000,
          discountPercent: 10,
          totalPriceArs: 90000,
          publicToken: "tok-1",
          expiresAt: null,
          notes: null,
          createdAt: "2026-04-01T10:00:00.000Z",
          items: [
            { id: "it-1", serviceName: "Corte", totalQuantity: 2, remainingQuantity: 2, unitPriceSnapshotArs: 25000 },
            { id: "it-2", serviceName: "Barba", totalQuantity: 2, remainingQuantity: 1, unitPriceSnapshotArs: 15000 },
          ],
          consumptions: [],
          events: [],
        } as any}
        clientName="Juan Pérez"
        barberName="Gonzalo"
        appointments={[]}
        isOperator={true}
        busy={false}
        isRegenerating={false}
        copied={false}
        onClose={vi.fn()}
        onCopyLink={vi.fn()}
        onRegenerateToken={vi.fn()}
        onRegisterPayment={vi.fn()}
        onConsumeSession={vi.fn()}
        onRefundSession={vi.fn()}
        onUpdateDetails={vi.fn()}
        onRenew={vi.fn()}
      />,
    );

    const dialog = screen.getByRole("dialog");
    expect(dialog.contains(document.activeElement)).toBe(true);

    const consumeTrigger = within(dialog).getByRole("button", { name: /Registrar consumo/i });
    fireEvent.click(consumeTrigger);

    const serviceSelect = within(dialog).getByLabelText("Servicio a descontar") as HTMLSelectElement;
    expect(document.activeElement).not.toBe(serviceSelect);

    fireEvent.change(serviceSelect, { target: { value: "Barba" } });
    expect(serviceSelect.value).toBe("Barba");
  });

  it("3. Editar vigencia: el selector «Opción de vigencia» no recibe autofocus al abrir y permite cambiar opción", () => {
    render(
      <Dialog open={true} onOpenChange={vi.fn()}>
        <DialogContent transitionMode="container-transform" className="benefit-code-dialog-content sm:max-w-md">
          <DialogTitle>Editar vigencia · KANI10</DialogTitle>
          <DialogDescription>Modificá las fechas de vigencia.</DialogDescription>
          <label htmlFor="edit-validity-type">Opción de vigencia:</label>
          <select id="edit-validity-type" defaultValue="NO_EXPIRATION">
            <option value="NO_EXPIRATION">Sin vencimiento</option>
            <option value="ONE_WEEK">Durante una semana (7 días)</option>
          </select>
        </DialogContent>
      </Dialog>,
    );

    const dialog = screen.getByRole("dialog");
    const validitySelect = within(dialog).getByLabelText("Opción de vigencia:") as HTMLSelectElement;

    expect(document.activeElement).not.toBe(validitySelect);
    expect(document.activeElement).toBe(dialog);

    fireEvent.change(validitySelect, { target: { value: "ONE_WEEK" } });
    expect(validitySelect.value).toBe("ONE_WEEK");
  });

  it("4. Modales cuyo primer control es un <input> conservan el autofocus normal de Radix", () => {
    render(
      <Dialog open={true} onOpenChange={vi.fn()}>
        <DialogContent transitionMode="container-transform">
          <DialogTitle>Verificar identidad</DialogTitle>
          <DialogDescription>Ingresá tu contraseña</DialogDescription>
          <label htmlFor="pw-input">Contraseña</label>
          <input id="pw-input" type="password" />
        </DialogContent>
      </Dialog>,
    );

    const input = screen.getByLabelText("Contraseña");
    expect(document.activeElement).toBe(input);
  });
});
