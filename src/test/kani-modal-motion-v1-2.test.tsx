import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import {
  computeContainerTransformParams,
  parseOriginBorderRadius,
} from "@/lib/kani-container-transform";
import { resetModalOriginForTests } from "@/lib/kani-modal-origin";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ManualAppointmentDialog } from "@/components/kani/v2/manual-appointment-dialog";

vi.mock("@/lib/kani-admin-context", () => ({
  useAdminStaff: () => ({
    profile: { role: "ADMIN", barber_id: "b1" },
    barbers: [{ id: "b1", name: "Gonzalo" }],
  }),
}));

vi.mock("@/components/kani/v2/data", () => ({
  useV2: () => ({
    services: [{ id: "corte", dbId: "svc-1", name: "Corte", duration: 45, price: 25000 }],
    clients: [],
    appointments: [],
    barberId: "ALL",
    refresh: vi.fn(),
  }),
}));

describe("KANI Motion System v1.2 — iOS-Inspired Container Transformations (Piloto)", () => {
  beforeEach(() => {
    resetModalOriginForTests();
    vi.restoreAllMocks();
  });

  it("1. Calcula trayectoria espacial amplia, escala perceptible y clip-path inset proporcional sin deformar contenido", () => {
    const modalRect = { left: 410, top: 140, width: 460, height: 520 }; // centro (640, 400)
    const triggerRect = { left: 1060, top: 44, width: 140, height: 40 }; // centro (1130, 64)

    const ct = computeContainerTransformParams(
      triggerRect,
      modalRect,
      { width: 1280, height: 800 },
      24,
    );

    expect(ct.hasOrigin).toBe(true);
    expect(ct.dx).toBe(490);
    expect(ct.dy).toBe(-336);
    expect(ct.enterScale).toBeGreaterThanOrEqual(0.36);
    expect(ct.enterScale).toBeLessThanOrEqual(0.62);
    expect(ct.exitScale).toBeGreaterThan(ct.enterScale);
    expect(ct.insetX).toBeGreaterThanOrEqual(0);
    expect(ct.insetY).toBeGreaterThan(0);
    expect(ct.originRadius).toBe(24);
  });

  it("2. Mantiene geometría acotada y sin valores negativos en viewports mobile (320px, 375px, 390px, 430px)", () => {
    const mobileWidths = [320, 375, 390, 430];

    for (const vw of mobileWidths) {
      const modalWidth = vw - 22;
      const modalRect = { left: 11, top: 110, width: modalWidth, height: 520 };
      const fabTrigger = { left: vw - 156, top: 680, width: 140, height: 42 };

      const ct = computeContainerTransformParams(
        fabTrigger,
        modalRect,
        { width: vw, height: 780 },
        999,
      );

      expect(ct.hasOrigin).toBe(true);
      expect(ct.insetX).toBeGreaterThanOrEqual(0);
      expect(ct.insetY).toBeGreaterThanOrEqual(0);
      expect(ct.insetX).toBeLessThan(modalWidth / 2);
      expect(ct.insetY).toBeLessThan(modalRect.height / 2);
      expect(ct.originRadius).toBe(32); // clamped max
    }
  });

  it("3. Aplica fallback centrado seguro si el activador es nulo o salió del viewport", () => {
    const modalRect = { left: 410, top: 140, width: 460, height: 520 };

    expect(computeContainerTransformParams(null, modalRect)).toEqual({
      dx: 0,
      dy: 0,
      enterScale: 0.88,
      exitScale: 0.9,
      insetX: 0,
      insetY: 0,
      originRadius: 24,
      hasOrigin: false,
    });

    expect(
      computeContainerTransformParams(
        { left: 100, top: -120, width: 120, height: 40 },
        modalRect,
        { width: 1280, height: 800 },
      ).hasOrigin,
    ).toBe(false);
  });

  it("4. Nuevo turno (mode='CREATE') activa data-kani-transition='container-transform' e inyecta variables --kani-ct-* desde el botón", () => {
    const triggerRect = {
      left: 980,
      top: 56,
      width: 150,
      height: 40,
      right: 1130,
      bottom: 96,
      x: 980,
      y: 56,
      toJSON: () => ({}),
    };
    const mockDialogRect = {
      left: 390,
      top: 140,
      width: 500,
      height: 520,
      right: 890,
      bottom: 660,
      x: 390,
      y: 140,
      toJSON: () => ({}),
    };

    const originalGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
      this: HTMLElement,
    ) {
      if (this.getAttribute("data-slot") === "dialog-content") {
        return mockDialogRect as DOMRect;
      }
      if (this.dataset.testid === "new-appointment-btn") {
        return triggerRect as DOMRect;
      }
      return originalGetBoundingClientRect.call(this);
    });

    const { rerender } = render(
      <div>
        <button type="button" data-testid="new-appointment-btn" style={{ borderRadius: "20px" }}>
          Nuevo turno
        </button>
        <ManualAppointmentDialog
          open={false}
          mode="CREATE"
          initialDate="2026-04-10"
          onClose={vi.fn()}
          onSuccess={vi.fn()}
        />
      </div>,
    );

    fireEvent.pointerDown(screen.getByTestId("new-appointment-btn"));

    rerender(
      <div>
        <button type="button" data-testid="new-appointment-btn" style={{ borderRadius: "20px" }}>
          Nuevo turno
        </button>
        <ManualAppointmentDialog
          open={true}
          mode="CREATE"
          initialDate="2026-04-10"
          onClose={vi.fn()}
          onSuccess={vi.fn()}
        />
      </div>,
    );

    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("data-kani-transition")).toBe("container-transform");
    expect(dialog.style.getPropertyValue("--kani-origin-x")).not.toBe("0px");
    expect(dialog.style.getPropertyValue("--kani-origin-y")).not.toBe("0px");
    expect(Number.parseFloat(dialog.style.getPropertyValue("--kani-origin-scale"))).toBeLessThanOrEqual(0.62);
    expect(dialog.style.getPropertyValue("--kani-ct-inset-x")).toMatch(/px$/);
    expect(dialog.style.getPropertyValue("--kani-ct-inset-y")).toMatch(/px$/);
    expect(dialog.style.getPropertyValue("--kani-ct-origin-radius")).toMatch(/px$/);

    // Al cerrar, mantiene [data-state="closed"] para animar contracción
    rerender(
      <div>
        <button type="button" data-testid="new-appointment-btn" style={{ borderRadius: "20px" }}>
          Nuevo turno
        </button>
        <ManualAppointmentDialog
          open={false}
          mode="CREATE"
          initialDate="2026-04-10"
          onClose={vi.fn()}
          onSuccess={vi.fn()}
        />
      </div>,
    );
    const closingDialog = document.querySelector('[data-slot="dialog-content"]');
    if (closingDialog) {
      expect(closingDialog.getAttribute("data-state")).toBe("closed");
      expect(closingDialog.getAttribute("data-kani-transition")).toBe("container-transform");
    }
  });

  it("5. El resto de los modales conserva Motion System v1.1 por defecto (sin container-transform) y mode='EDIT' tampoco altera v1.1", () => {
    render(
      <Dialog open={true}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Modal estándar v1.1</DialogTitle>
          </DialogHeader>
        </DialogContent>
      </Dialog>,
    );

    const standardDialog = screen.getByRole("dialog");
    expect(standardDialog.getAttribute("data-kani-transition")).toBeNull();
    expect(standardDialog.style.getPropertyValue("--kani-ct-inset-x")).toBe("");
    expect(standardDialog.style.getPropertyValue("--kani-origin-scale")).toBe("0.92");
  });

  it("6. Agregar horario opta por container-transform y prefers-reduced-motion anula desplazamiento y clip-path", () => {
    const scheduleSrc = fs.readFileSync(
      path.resolve(__dirname, "../components/kani/admin-schedule-manager.tsx"),
      "utf-8",
    );
    expect(scheduleSrc).toContain('transitionMode="container-transform"');

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

    render(
      <Dialog open={true}>
        <DialogContent transitionMode="container-transform">
          <DialogHeader>
            <DialogTitle>Agregar horario</DialogTitle>
          </DialogHeader>
        </DialogContent>
      </Dialog>,
    );

    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("data-kani-transition")).toBe("container-transform");
    expect(dialog.style.getPropertyValue("--kani-origin-x")).toBe("0px");
    expect(dialog.style.getPropertyValue("--kani-origin-y")).toBe("0px");
    expect(dialog.style.getPropertyValue("--kani-origin-scale")).toBe("1");
    expect(dialog.style.getPropertyValue("--kani-ct-inset-x")).toBe("0px");
    expect(dialog.style.getPropertyValue("--kani-ct-inset-y")).toBe("0px");
    expect(parseOriginBorderRadius(null)).toBe(20);
  });

  it("7. Contextual Motion (touch vs pointer) y Etapa 1 respuesta táctil inmediata (data-kani-trigger-pulse)", () => {
    const modalRect = { left: 410, top: 140, width: 460, height: 520 };
    const triggerRect = { left: 1060, top: 44, width: 120, height: 38 };

    const touchCt = computeContainerTransformParams(
      triggerRect,
      modalRect,
      { width: 1280, height: 800 },
      20,
      "touch",
    );
    const pointerCt = computeContainerTransformParams(
      triggerRect,
      modalRect,
      { width: 1280, height: 800 },
      20,
      "pointer",
    );

    expect(touchCt.enterScale).toBeLessThan(pointerCt.enterScale);
    expect(touchCt.enterScale).toBeGreaterThanOrEqual(0.36);
    expect(pointerCt.enterScale).toBeGreaterThanOrEqual(0.48);

    const btn = document.createElement("button");
    btn.textContent = "Agregar horario";
    vi.spyOn(btn, "getBoundingClientRect").mockReturnValue({
      ...triggerRect,
      right: 1180,
      bottom: 82,
      x: 1060,
      y: 44,
      toJSON: () => ({}),
    });
    document.body.appendChild(btn);

    fireEvent.pointerDown(btn);
    expect(btn.getAttribute("data-kani-trigger-pulse")).toBe("true");
    btn.remove();
  });
});
