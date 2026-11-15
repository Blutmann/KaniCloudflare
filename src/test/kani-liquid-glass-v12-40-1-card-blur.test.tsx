import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const LIQUID_CSS_PATH = path.resolve(
  ROOT,
  "src/components/kani/experimental/liquid-glass.css"
);
const MOTION_TSX_PATH = path.resolve(
  ROOT,
  "src/components/kani/experimental/liquid-glass-motion.tsx"
);
const TRADITIONAL_CSS_PATH = path.resolve(ROOT, "src/styles.css");

function getHotfixSection(css: string): string {
  const marker = "LIQUID GLASS V12.40.1 — HOTFIX DESENFOQUE REAL EN TARJETAS DE RESERVAS";
  const idx = css.indexOf(marker);
  expect(idx).toBeGreaterThan(-1);
  return css.slice(idx);
}

describe("Kani Liquid Glass V12.40.1 — Desenfoque real en tarjetas de reservas", () => {
  const css = fs.readFileSync(LIQUID_CSS_PATH, "utf8");
  const hotfix = getHotfixSection(css);
  const motionSource = fs.readFileSync(MOTION_TSX_PATH, "utf8");

  it("mantiene transparente el contenedor raíz .liquid-glass-reservation y los wrappers intermedios", () => {
    expect(hotfix).toContain(".site-shell .liquid-glass-reservation");
    expect(hotfix).toContain("background: transparent !important;");
    expect(hotfix).toContain("background-color: transparent !important;");
    expect(hotfix).toContain("isolation: auto !important;");
    expect(hotfix).toContain("will-change: auto !important;");
    expect(hotfix).toContain(".booking-scroll-content");
    expect(hotfix).toContain(".liquid-glass-step-stage");
  });

  it("desactiva el pseudoelemento ::after en tarjetas para evitar artefactos de máscara XOR en WebKit/Chromium", () => {
    expect(hotfix).toMatch(/\.service-option[\s\S]*?\)::after\s*\{\s*content:\s*none\s*!important;\s*display:\s*none\s*!important;/);
  });

  it("usa superficies calibradas y desenfoque real backdrop-filter blur(11px) saturate(185%) en tarjetas sin seleccionar y seleccionadas", () => {
    expect(hotfix).toContain("rgba(255, 255, 255, 0.22) 0%");
    expect(hotfix).toContain("rgba(248, 246, 242, 0.08) 54%");
    expect(hotfix).toContain("rgba(255, 250, 236, 0.28) 0%");
    expect(hotfix).toContain("rgba(255, 252, 246, 0.095) 0%");
    expect(hotfix).toContain("rgba(224, 192, 122, 0.18) 0%");

    const lightBlurMatches = hotfix.match(/-webkit-backdrop-filter:\s*blur\(11px\)\s*saturate\(185%\)\s*!important;/g) ?? [];
    expect(lightBlurMatches.length).toBeGreaterThanOrEqual(2);

    const darkBlurMatches = hotfix.match(/-webkit-backdrop-filter:\s*blur\(11px\)\s*saturate\(185%\)\s*brightness\(1\.16\)\s*!important;/g) ?? [];
    expect(darkBlurMatches.length).toBeGreaterThanOrEqual(2);

    expect(hotfix).toContain(".service-option.selected");
    expect(hotfix).toContain(".booking-option.selected");
    expect(hotfix).toContain(".booking-time-slot.selected");
    expect(hotfix).toContain(".calendar-glass-card");
    expect(hotfix).toContain(".booking-summary-card");
  });

  it("refuerza contraste de texto en Light Mode y conserva fallbacks @supports not y prefers-reduced-transparency", () => {
    expect(hotfix).toContain("color: #141416 !important;");
    expect(hotfix).toContain("color: #3d3b37 !important;");
    expect(hotfix).toContain("@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px)))");
    expect(hotfix).toContain("@media (prefers-reduced-transparency: reduce)");
  });

  it("elimina transform persistente en reposo/selección dentro de InteractiveCard y preserva .lg-living-surface", () => {
    expect(motionSource).toContain("const animateState = undefined;");
    expect(motionSource).toContain("lg-living-surface");
  });

  it("mantiene aislada la hoja de estilos tradicional src/styles.css sin reglas V12.40.1", () => {
    const traditionalCss = fs.readFileSync(TRADITIONAL_CSS_PATH, "utf8");
    expect(traditionalCss).not.toContain("LIQUID GLASS V12.40.1");
    expect(traditionalCss).not.toContain("--lg-v36-card-bg");
  });
});
