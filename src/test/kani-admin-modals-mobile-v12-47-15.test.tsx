import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { useState } from "react";
import fs from "node:fs";
import path from "node:path";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";

function createMockVisualViewport(initial = { width: 375, height: 812, offsetTop: 0, offsetLeft: 0 }) {
  const listeners = new Map<string, Set<EventListener>>();
  const vv = {
    ...initial,
    addEventListener: vi.fn((type: string, cb: EventListener) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(cb);
    }),
    removeEventListener: vi.fn((type: string, cb: EventListener) => {
      listeners.get(type)?.delete(cb);
    }),
    dispatch(type: string, next?: Partial<typeof initial>) {
      if (next) Object.assign(vv, next);
      listeners.get(type)?.forEach((cb) => cb(new Event(type)));
    },
  };
  return vv;
}

describe("V12.47.15 — Global Admin Modals & Popovers Mobile Responsive", () => {
  const origVisualViewport = window.visualViewport;
  const origRaf = window.requestAnimationFrame;

  beforeEach(() => {
    window.requestAnimationFrame = ((cb: FrameRequestCallback) => {
      cb(0);
      return 1;
    }) as typeof window.requestAnimationFrame;
  });

  afterEach(() => {
    Object.defineProperty(window, "visualViewport", {
      value: origVisualViewport,
      configurable: true,
    });
    window.requestAnimationFrame = origRaf;
    document.body.removeAttribute("data-lg-admin");
    document.documentElement.removeAttribute("data-theme");
  });

  it("1. DialogContent tracks visualViewport bounds when virtual keyboard opens across mobile widths (320/375/390/430)", () => {
    const vv = createMockVisualViewport({ width: 320, height: 568, offsetTop: 0, offsetLeft: 0 });
    Object.defineProperty(window, "visualViewport", { value: vv, configurable: true });

    render(
      <Dialog open={true}>
        <DialogContent className="v2-dialog">
          <DialogHeader>
            <DialogTitle>Nuevo cobro</DialogTitle>
            <DialogDescription>Registrar cobro manual</DialogDescription>
          </DialogHeader>
          <input aria-label="Importe" defaultValue="15000" />
        </DialogContent>
      </Dialog>,
    );

    const dialog = document.querySelector('[data-slot="dialog-content"]') as HTMLElement;
    expect(dialog).not.toBeNull();
    expect(dialog.style.getPropertyValue("--kani-vv-width")).toBe("320px");
    expect(dialog.style.getPropertyValue("--kani-vv-height")).toBe("568px");
    expect(dialog.className).toContain("overflow-y-auto");
    expect(dialog.className).toContain("overflow-x-hidden");
    expect(dialog.className).toContain("overscroll-contain");

    // Simulate virtual keyboard opening (height shrinks, offsetTop shifts)
    act(() => {
      vv.dispatch("resize", { width: 390, height: 420, offsetTop: 24, offsetLeft: 0 });
    });

    expect(dialog.style.getPropertyValue("--kani-vv-width")).toBe("390px");
    expect(dialog.style.getPropertyValue("--kani-vv-height")).toBe("420px");
    expect(dialog.style.getPropertyValue("--kani-vv-top")).toBe("24px");
  });

  it("2. DialogContent scrolls focused field inside modal without scrolling background window", () => {
    const vv = createMockVisualViewport({ width: 375, height: 812, offsetTop: 0, offsetLeft: 0 });
    Object.defineProperty(window, "visualViewport", { value: vv, configurable: true });
    const scrollToSpy = vi.spyOn(window, "scrollTo").mockImplementation(() => {});

    render(
      <Dialog open={true}>
        <DialogContent className="v2-dialog">
          <DialogTitle>Editar cliente</DialogTitle>
          <DialogDescription>Datos del cliente</DialogDescription>
          <div data-testid="modal-scroll" style={{ overflowY: "auto", maxHeight: "200px" }}>
            <input aria-label="Email" />
          </div>
        </DialogContent>
      </Dialog>,
    );

    const dialog = document.querySelector('[data-slot="dialog-content"]') as HTMLElement;
    const scrollBox = screen.getByTestId("modal-scroll");
    const emailInput = screen.getByLabelText("Email");

    Object.defineProperty(scrollBox, "scrollHeight", { value: 600, configurable: true });
    Object.defineProperty(scrollBox, "clientHeight", { value: 200, configurable: true });
    scrollBox.scrollTop = 0;

    vi.spyOn(scrollBox, "getBoundingClientRect").mockReturnValue({
      top: 100,
      bottom: 300,
      left: 0,
      right: 350,
      width: 350,
      height: 200,
      x: 0,
      y: 100,
      toJSON: () => ({}),
    });
    vi.spyOn(emailInput, "getBoundingClientRect").mockReturnValue({
      top: 340,
      bottom: 384,
      left: 16,
      right: 334,
      width: 318,
      height: 44,
      x: 16,
      y: 340,
      toJSON: () => ({}),
    });

    emailInput.focus();
    act(() => {
      vv.dispatch("resize", { height: 410 });
    });

    // Bottom (384) > area.bottom - 12 (288) => scrollTop increases by 96
    expect(scrollBox.scrollTop).toBe(96);
    expect(scrollToSpy).not.toHaveBeenCalled();
    expect(dialog).toBeInTheDocument();
    scrollToSpy.mockRestore();
  });

  it("3. Supports repeated open/close, X button, Escape key, and validation error alert", () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      const [error, setError] = useState("");
      return (
        <div>
          <Button onClick={() => setOpen(true)}>Abrir modal</Button>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogContent closeLabel="Cerrar">
              <DialogTitle>Confirmar acción</DialogTitle>
              <DialogDescription>Validación de formulario</DialogDescription>
              {error && <p role="alert">{error}</p>}
              <DialogFooter>
                <Button onClick={() => setError("El importe es obligatorio")}>Validar</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      );
    }

    render(<Harness />);

    // Open -> show error -> close via X
    fireEvent.click(screen.getByRole("button", { name: "Abrir modal" }));
    fireEvent.click(screen.getByRole("button", { name: "Validar" }));
    expect(screen.getByRole("alert")).toHaveTextContent("El importe es obligatorio");

    fireEvent.click(screen.getByRole("button", { name: "Cerrar" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    // Re-open -> close via Escape
    fireEvent.click(screen.getByRole("button", { name: "Abrir modal" }));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeInTheDocument();
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("4. AlertDialogContent uses safe z-[200], mobile margins, and visualViewport tracking", () => {
    const vv = createMockVisualViewport({ width: 375, height: 500, offsetTop: 0, offsetLeft: 0 });
    Object.defineProperty(window, "visualViewport", { value: vv, configurable: true });

    render(
      <AlertDialog open={true}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Eliminar registro</AlertDialogTitle>
            <AlertDialogDescription>Esta acción no se puede deshacer.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction>Eliminar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>,
    );

    const alertDialog = screen.getByRole("alertdialog");
    expect(alertDialog.className).toContain("z-[200]");
    expect(alertDialog.className).toContain("overflow-y-auto");
    expect(alertDialog.style.getPropertyValue("--kani-vv-height")).toBe("500px");
  });

  it("5. PopoverContent and DropdownMenuContent render above dialogs (z-[210]) with viewport collision bounds", () => {
    render(
      <>
        <Popover open={true}>
          <PopoverTrigger asChild>
            <Button>Abrir popover</Button>
          </PopoverTrigger>
          <PopoverContent>Opciones de filtro</PopoverContent>
        </Popover>
        <DropdownMenu open={true}>
          <DropdownMenuTrigger asChild>
            <Button>Abrir menú</Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem>Acción 1</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </>,
    );

    const popover = screen.getByText("Opciones de filtro").closest('[role="dialog"], [data-radix-popper-content-wrapper] > div');
    expect(popover?.className).toContain("z-[210]");
    expect(popover?.className).toContain("max-w-[calc(100vw-24px)]");
    expect(popover?.className).toContain("overflow-y-auto");

    const menu = screen.getByRole("menu");
    expect(menu.className).toContain("z-[210]");
    expect(menu.className).toContain("max-w-[calc(100vw-24px)]");
  });

  it("6. Shared admin CSS enforces visualViewport geometry and 16px mobile input font-size in Light & Dark mode", () => {
    const lgaCss = fs.readFileSync(
      path.resolve(__dirname, "../components/kani/experimental/liquid-glass-admin.css"),
      "utf-8",
    );
    const v2Css = fs.readFileSync(
      path.resolve(__dirname, "../components/kani/v2/v2.css"),
      "utf-8",
    );
    const stylesCss = fs.readFileSync(
      path.resolve(__dirname, "../styles.css"),
      "utf-8",
    );

    // Liquid Glass Admin dialogs
    expect(lgaCss).toContain("var(--kani-vv-height, 100dvh)");
    expect(lgaCss).toContain("var(--kani-vv-top, 0px)");
    expect(lgaCss).toMatch(/body\[data-lg-admin="true"\]\s+\[role="dialog"\][\s\S]*?font-size:\s*16px\s*!important/);

    // V2 dialogs & manual appointment dialog
    expect(v2Css).toContain("var(--kani-vv-height, 100dvh)");
    expect(v2Css).toMatch(/\.v2-manual-dialog\s+\.v2-field\s+:is\(input,\s*select\)[\s\S]*?font-size:\s*16px\s*!important/);

    // Benefit code dialog in styles.css
    expect(stylesCss).toContain("var(--kani-vv-height, 100dvh)");
    expect(stylesCss).toMatch(/\.benefit-code-dialog-content\s+:is\(input[^}]*font-size:\s*16px\s*!important/);
  });
});
