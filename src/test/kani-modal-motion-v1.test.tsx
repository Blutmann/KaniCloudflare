import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { BookingRecoveryModal } from "@/components/kani/booking-recovery-modal";
import { ManualAppointmentDialog } from "@/components/kani/v2/manual-appointment-dialog";

vi.mock("@/lib/kani-admin-context", () => ({
  useAdminStaff: () => ({
    profile: { role: "ADMIN", barber_id: "barber-1" },
    barbers: [{ id: "barber-1", name: "Lautaro" }],
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

describe("KANI Motion System v1.0 — Fase 1: Modal Motion Architecture", () => {
  const unifiedCss = fs.readFileSync(
    path.resolve(__dirname, "../components/kani/kani-unified-modals.css"),
    "utf-8",
  );
  const liquidGlassCss = fs.readFileSync(
    path.resolve(__dirname, "../components/kani/experimental/liquid-glass.css"),
    "utf-8",
  );
  const liquidGlassAdminCss = fs.readFileSync(
    path.resolve(__dirname, "../components/kani/experimental/liquid-glass-admin.css"),
    "utf-8",
  );
  const stylesCss = fs.readFileSync(
    path.resolve(__dirname, "../styles.css"),
    "utf-8",
  );

  it("1. Define tokens unificados de apertura/cierre y sincronización de backdrop en kani-unified-modals.css", () => {
    expect(unifiedCss).toContain("--kani-modal-enter-duration: 300ms;");
    expect(unifiedCss).toContain("--kani-modal-exit-duration: 220ms;");
    expect(unifiedCss).toContain("--kani-modal-enter-ease: cubic-bezier(0.22, 1, 0.36, 1);");
    expect(unifiedCss).toContain("--kani-modal-exit-ease: cubic-bezier(0.4, 0, 1, 1);");
    expect(unifiedCss).toContain("@keyframes kaniModalEnter");
    expect(unifiedCss).toContain("@keyframes kaniModalExit");
    expect(unifiedCss).toContain("@keyframes kaniModalOverlayEnter");
    expect(unifiedCss).toContain("@keyframes kaniModalOverlayExit");
    expect(unifiedCss).toContain("--kani-origin-x");
    expect(unifiedCss).toContain("--kani-origin-y");
    expect(unifiedCss).toContain("--kani-origin-scale");
    expect(unifiedCss).toContain("--kani-exit-scale");
    expect(unifiedCss).toContain("translate3d(-50%, -50%, 0) scale(1)");
    expect(unifiedCss).toContain("@media (prefers-reduced-motion: reduce)");
    expect(unifiedCss).toContain("@keyframes kaniModalEnterReduced");
  });

  it("2. Elimina la colisión de liquid-glass.css sobre .kani-modal-shell y la interpolación de box-shadow en lgModalOpticalEnter", () => {
    expect(liquidGlassCss).toContain(':is([data-slot="dialog-content"]:not(.kani-modal-shell), .payway-checkout)[data-state="open"]');
    expect(liquidGlassCss).toContain(':is([data-slot="dialog-content"]:not(.kani-modal-shell), .payway-checkout)[data-state="closed"]');

    const opticalEnterBlock = liquidGlassCss.match(/@keyframes lgModalOpticalEnter\s*\{[\s\S]*?\n\}/)?.[0] ?? "";
    expect(opticalEnterBlock).toBeTruthy();
    expect(opticalEnterBlock).not.toContain("box-shadow");
  });

  it("3. Excluye .kani-modal-shell de lgaDialogFadeIn/Out y elimina el override duplicado en styles.css", () => {
    expect(liquidGlassAdminCss).toContain('[role="dialog"]:not(.kani-modal-shell)[data-state="open"]');
    expect(liquidGlassAdminCss).toContain('[role="dialog"]:not(.kani-modal-shell)[data-state="closed"]');
    expect(stylesCss).not.toContain("@keyframes benefitDialogFadeIn");
    expect(stylesCss).not.toContain("@keyframes benefitDialogFadeOut");
  });

  it("4. ManualAppointmentDialog no hace return null temprano al cerrar y mantiene Radix [data-state='closed'] para animar la salida", () => {
    const { rerender } = render(
      <ManualAppointmentDialog
        open={true}
        mode="CREATE"
        initialDate="2026-04-10"
        onClose={vi.fn()}
        onSuccess={vi.fn()}
      />,
    );

    const dialogOpen = screen.getByRole("dialog");
    expect(dialogOpen.getAttribute("data-state")).toBe("open");

    rerender(
      <ManualAppointmentDialog
        open={false}
        mode="CREATE"
        initialDate="2026-04-10"
        onClose={vi.fn()}
        onSuccess={vi.fn()}
      />,
    );

    const dialogAfterClose = document.querySelector('[data-slot="dialog-content"]');
    if (dialogAfterClose) {
      expect(dialogAfterClose.getAttribute("data-state")).toBe("closed");
    }
  });

  it("5. BookingRecoveryModal conserva el diálogo montado en [data-state='closed'] incluso cuando draft pasa a null al cerrar", () => {
    const draft = {
      version: 1 as const,
      service: "corte",
      barber: "Lautaro",
      barberDeferred: false,
      date: "2026-04-10",
      time: "10:00",
      step: 3,
      clientName: "",
      clientPhone: "",
      clientEmail: "",
      updatedAt: Date.now(),
    };

    const { rerender } = render(
      <BookingRecoveryModal
        mode="prompt"
        draft={draft}
        onContinue={vi.fn()}
        onStartOver={vi.fn()}
        onDismiss={vi.fn()}
        onChooseAnotherTime={vi.fn()}
        onRetry={vi.fn()}
      />,
    );

    const dialogOpen = screen.getByRole("dialog");
    expect(dialogOpen.getAttribute("data-state")).toBe("open");

    rerender(
      <BookingRecoveryModal
        mode="closed"
        draft={null}
        onContinue={vi.fn()}
        onStartOver={vi.fn()}
        onDismiss={vi.fn()}
        onChooseAnotherTime={vi.fn()}
        onRetry={vi.fn()}
      />,
    );

    const dialogAfterClose = document.querySelector('[data-slot="dialog-content"]');
    if (dialogAfterClose) {
      expect(dialogAfterClose.getAttribute("data-state")).toBe("closed");
    }
  });
});
