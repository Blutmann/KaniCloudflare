import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import {
  computeOriginTransformOffsets,
  installModalOriginListeners,
  resetModalOriginForTests,
  resolveActiveOrigin,
} from "@/lib/kani-modal-origin";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const paymentMocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  refresh: vi.fn(),
  payments: [] as any[],
}));

vi.mock("@tanstack/react-router", () => ({
  useSearch: () => ({}),
  useLocation: () => "/admin/cobros",
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: paymentMocks.rpc } }));
vi.mock("@/lib/kani-admin-context", () => ({
  useAdminStaff: () => ({
    profile: { role: "ADMIN", barber_id: "b1" },
    barbers: [
      { id: "b1", name: "Gonzalo" },
      { id: "b2", name: "Lautaro" },
    ],
  }),
}));
vi.mock("@/components/kani/v2/data", () => ({
  useV2: () => ({
    appointments: [],
    payments: paymentMocks.payments,
    services: [{ id: "corte", name: "Corte de cabello", price: 25000 }],
    clients: [],
    barberId: "ALL",
    setBarberId: vi.fn(),
    refresh: paymentMocks.refresh,
    loading: false,
    depositSupported: true,
  }),
}));

import { V2Payments } from "@/components/kani/v2/payments";

describe("KANI Motion System v1.1 — Origin-Based Transitions & Regression Fixes", () => {
  beforeEach(() => {
    resetModalOriginForTests();
    paymentMocks.rpc.mockReset();
    paymentMocks.refresh.mockReset();
    paymentMocks.payments = [];
    vi.restoreAllMocks();
  });

  it("1. Calcula offsets FLIP desde el centro geométrico del botón activador y aplica clamp dentro del viewport", () => {
    const modalRect = { left: 440, top: 200, width: 400, height: 400 }; // centro (640, 400)
    const topRightButton = { left: 1080, top: 40, width: 120, height: 40 }; // centro (1140, 60)

    const result = computeOriginTransformOffsets(topRightButton, modalRect, {
      width: 1280,
      height: 800,
    });

    expect(result.hasOrigin).toBe(true);
    expect(result.dx).toBe(500);
    expect(result.dy).toBe(-336); // clamped a -maxDy (-336 para 800*0.42)
    expect(result.enterScale).toBeGreaterThanOrEqual(0.82);
    expect(result.enterScale).toBeLessThanOrEqual(0.92);
    expect(result.exitScale).toBeGreaterThanOrEqual(0.85);
    expect(result.exitScale).toBeLessThanOrEqual(0.95);
  });

  it("2. Usa fallback centrado seguro cuando el origen es nulo, inválido o está fuera del viewport", () => {
    const modalRect = { left: 440, top: 200, width: 400, height: 400 };

    expect(computeOriginTransformOffsets(null, modalRect)).toEqual({
      dx: 0,
      dy: 0,
      enterScale: 0.92,
      exitScale: 0.94,
      hasOrigin: false,
    });

    expect(
      computeOriginTransformOffsets(
        { left: 200, top: -200, width: 100, height: 40 },
        modalRect,
        { width: 1280, height: 800 },
      ),
    ).toEqual({
      dx: 0,
      dy: 0,
      enterScale: 0.92,
      exitScale: 0.94,
      hasOrigin: false,
    });
  });

  it("3. Captura el elemento activador por puntero o teclado e ignora clics internos del modal", () => {
    installModalOriginListeners();

    const trigger = document.createElement("button");
    trigger.textContent = "Nuevo turno";
    vi.spyOn(trigger, "getBoundingClientRect").mockReturnValue({
      left: 300,
      top: 500,
      width: 140,
      height: 44,
      right: 440,
      bottom: 544,
      x: 300,
      y: 500,
      toJSON: () => ({}),
    });
    document.body.appendChild(trigger);

    fireEvent.pointerDown(trigger);
    const active = resolveActiveOrigin();
    expect(active?.element).toBe(trigger);
    expect(active?.rect).toEqual({ left: 300, top: 500, width: 140, height: 44 });

    // Clic interno dentro de [data-slot="dialog-content"] no sobreescribe el origen
    const dialogShell = document.createElement("div");
    dialogShell.setAttribute("data-slot", "dialog-content");
    const innerButton = document.createElement("button");
    dialogShell.appendChild(innerButton);
    document.body.appendChild(dialogShell);
    fireEvent.click(innerButton);

    expect(resolveActiveOrigin()?.element).toBe(trigger);

    // Captura por teclado (Enter)
    resetModalOriginForTests();
    fireEvent.keyDown(trigger, { key: "Enter" });
    expect(resolveActiveOrigin()?.element).toBe(trigger);

    trigger.remove();
    dialogShell.remove();
  });

  it("4. DialogContent inyecta variables CSS --kani-origin-* al abrir desde un botón y respeta prefers-reduced-motion", () => {
    const triggerRect = {
      left: 900,
      top: 40,
      width: 160,
      height: 40,
      right: 1060,
      bottom: 80,
      x: 900,
      y: 40,
      toJSON: () => ({}),
    };

    const mockDialogRect = {
      left: 440,
      top: 200,
      width: 400,
      height: 400,
      right: 840,
      bottom: 600,
      x: 440,
      y: 200,
      toJSON: () => ({}),
    };

    const originalGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
      this: HTMLElement,
    ) {
      if (this.getAttribute("data-slot") === "dialog-content") {
        return mockDialogRect as DOMRect;
      }
      if (this.dataset.testid === "origin-trigger") {
        return triggerRect as DOMRect;
      }
      return originalGetBoundingClientRect.call(this);
    });

    const { rerender } = render(
      <div>
        <button type="button" data-testid="origin-trigger">
          Abrir
        </button>
        <Dialog open={false}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Modal de prueba</DialogTitle>
            </DialogHeader>
          </DialogContent>
        </Dialog>
      </div>,
    );

    fireEvent.pointerDown(screen.getByTestId("origin-trigger"));

    rerender(
      <div>
        <button type="button" data-testid="origin-trigger">
          Abrir
        </button>
        <Dialog open={true}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Modal de prueba</DialogTitle>
            </DialogHeader>
          </DialogContent>
        </Dialog>
      </div>,
    );

    const dialog = screen.getByRole("dialog");
    expect(dialog.style.getPropertyValue("--kani-origin-x")).not.toBe("0px");
    expect(dialog.style.getPropertyValue("--kani-origin-y")).not.toBe("0px");
    expect(dialog.style.getPropertyValue("--kani-origin-scale")).toBeTruthy();
    expect(dialog.style.getPropertyValue("--kani-exit-scale")).toBeTruthy();

    // Con prefers-reduced-motion: reduce no debe haber desplazamiento espacial
    vi.spyOn(window, "matchMedia").mockImplementation((query: string) => ({
      matches: query.includes("prefers-reduced-motion"),
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));

    rerender(
      <div>
        <button type="button" data-testid="origin-trigger">
          Abrir
        </button>
        <Dialog open={false}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Modal de prueba</DialogTitle>
            </DialogHeader>
          </DialogContent>
        </Dialog>
      </div>,
    );

    rerender(
      <div>
        <button type="button" data-testid="origin-trigger">
          Abrir
        </button>
        <Dialog open={true}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Modal de prueba</DialogTitle>
            </DialogHeader>
          </DialogContent>
        </Dialog>
      </div>,
    );

    const reducedDialog = screen.getByRole("dialog");
    expect(reducedDialog.style.getPropertyValue("--kani-origin-x")).toBe("0px");
    expect(reducedDialog.style.getPropertyValue("--kani-origin-y")).toBe("0px");
    expect(reducedDialog.style.getPropertyValue("--kani-origin-scale")).toBe("1");
  });

  it("5. Regresión «Crear código»: usa clase action-positive (no action-brand) y conserva estilos dorados en .kani-modal-footer", () => {
    const benefitSectionSrc = fs.readFileSync(
      path.resolve(__dirname, "../components/kani/admin-benefit-codes-section.tsx"),
      "utf-8",
    );
    const liquidGlassAdminCss = fs.readFileSync(
      path.resolve(__dirname, "../components/kani/experimental/liquid-glass-admin.css"),
      "utf-8",
    );

    const submitMatch = benefitSectionSrc.match(
      /<Button[\s\S]{0,220}className="([^"]+)"[\s\S]{0,220}Crear código/,
    );
    expect(submitMatch?.[1]).toBeTruthy();
    expect(submitMatch?.[1]).toContain("action-positive");
    expect(submitMatch?.[1]).not.toContain("action-brand");

    expect(liquidGlassAdminCss).toContain(".kani-modal-footer,");
    expect(liquidGlassAdminCss).toContain(".benefit-code-dialog-footer");
    expect(liquidGlassAdminCss).toContain("button:is(.action-positive, .v2-primary, [type=\"submit\"]):not(.v2-destructive):not(.v2-danger):not(.action-brand)");
    expect(liquidGlassAdminCss).toContain("var(--lga-btn-primary-bg)");
  });

  it("6. Regresión «Editar cobro registrado»: al abrir el modal NO auto-enfoca el select de Barbero, pero lo mantiene operable", () => {
    const today = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Argentina/Buenos_Aires",
    }).format(new Date());

    paymentMocks.payments = [
      {
        id: "p1",
        barberId: "b1",
        barberName: "Gonzalo",
        serviceName: "Corte",
        servicePriceArs: 25000,
        discountArs: 0,
        finalAmountArs: 25000,
        collectedAmountArs: 25000,
        paymentDate: today,
        paymentTime: "10:00",
        paymentMethod: "Efectivo",
        onlineDepositPaid: false,
        onlineDepositAmountArs: 0,
        appointmentId: null,
      },
    ];

    render(<V2Payments />);

    fireEvent.click(screen.getAllByRole("button", { name: "Editar cobro" })[0]!);

    const dialogEl = screen.getByRole("dialog");
    const barberSelect = within(dialogEl).getByLabelText("Barbero") as HTMLSelectElement;

    expect(barberSelect).toBeEnabled();
    expect(document.activeElement).not.toBe(barberSelect);
    expect(document.activeElement).toBe(dialogEl);

    // El usuario o la navegación por teclado puede enfocar y cambiar Barbero explícitamente
    barberSelect.focus();
    expect(document.activeElement).toBe(barberSelect);
    fireEvent.change(barberSelect, { target: { value: "b2" } });
    expect(barberSelect.value).toBe("b2");
  });
});
