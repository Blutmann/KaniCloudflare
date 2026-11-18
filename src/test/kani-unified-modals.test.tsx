import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("KANI — Sistema unificado de ventanas modales (CSS + estructura de 3 regiones)", () => {
  const unifiedCss = fs.readFileSync(
    path.resolve(__dirname, "../components/kani/kani-unified-modals.css"),
    "utf-8",
  );
  const dialogTsx = fs.readFileSync(
    path.resolve(__dirname, "../components/ui/dialog.tsx"),
    "utf-8",
  );

  it("1. Dialog importa kani-unified-modals.css", () => {
    expect(dialogTsx).toContain('@/components/kani/kani-unified-modals.css');
  });

  it("2. CSS unificado define altura adaptable al viewport con dvh, safe-area y visualViewport", () => {
    expect(unifiedCss).toContain("--kani-vv-height, 100dvh");
    expect(unifiedCss).toContain("env(safe-area-inset-top, 0px)");
    expect(unifiedCss).toContain("env(safe-area-inset-bottom, 0px)");
    expect(unifiedCss).toContain("height: auto !important");
    expect(unifiedCss).toContain("@media (max-height: 520px)");
  });

  it("3. CSS unificado define estructura de 3 regiones con paddings simétricos en header y footer", () => {
    expect(unifiedCss).toMatch(/\.kani-modal-shell\s*\{[\s\S]*?display:\s*flex\s*!important;[\s\S]*?flex-direction:\s*column\s*!important;[\s\S]*?overflow:\s*hidden\s*!important;/);
    expect(unifiedCss).toMatch(/\.kani-modal-shell\s+\.kani-modal-header\s*\{[\s\S]*?flex:\s*0\s+0\s+auto\s*!important;[\s\S]*?flex-direction:\s*row\s*!important;[\s\S]*?align-items:\s*center\s*!important;[\s\S]*?padding:\s*var\(--kani-modal-header-pad-y\)\s+var\(--kani-modal-pad-x\)\s*!important;/);
    expect(unifiedCss).toMatch(/\.kani-modal-shell\s+\.kani-modal-body\s*\{[\s\S]*?flex:\s*1\s+1\s+auto\s*!important;[\s\S]*?min-height:\s*0\s*!important;[\s\S]*?overflow-y:\s*auto\s*!important;/);
    expect(unifiedCss).toMatch(/\.kani-modal-shell\s+\.kani-modal-footer\s*\{[\s\S]*?flex:\s*0\s+0\s+auto\s*!important;[\s\S]*?padding:\s*var\(--kani-modal-footer-pad-y\)\s+var\(--kani-modal-pad-x\)\s*!important;/);
  });

  it("4. CSS unificado garantiza botón de cierre X sin círculo visible (44x44 px), botones de footer de 46px y sin halos", () => {
    expect(unifiedCss).toContain("width: 44px !important;");
    expect(unifiedCss).toContain("height: 44px !important;");
    expect(unifiedCss).toContain("border: none !important;");
    expect(unifiedCss).toContain("background: transparent !important;");
    expect(unifiedCss).toContain("height: 46px !important;");
    expect(unifiedCss).toContain("filter: none !important;");
    expect(dialogTsx).toContain("KaniModalClose");
  });

  it("5. Las seis ventanas modales implementan .kani-modal-shell, .kani-modal-header, .kani-modal-body y .kani-modal-footer", () => {
    const modalFiles = [
      "../components/kani/booking-recovery-modal.tsx",
      "../components/kani/admin-schedule-manager.tsx",
      "../components/kani/v2/manual-appointment-dialog.tsx",
      "../components/kani/v2/clients.tsx",
      "../components/kani/v2/memberships-discounts.tsx",
      "../components/kani/admin-benefit-codes-section.tsx",
    ];

    for (const rel of modalFiles) {
      const src = fs.readFileSync(path.resolve(__dirname, rel), "utf-8");
      expect(src).toContain("kani-modal-shell");
      expect(src).toContain("kani-modal-header");
      expect(src).toContain("kani-modal-body");
      expect(src).toContain("kani-modal-footer");
    }
  });
});
