import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("Admin V2 — Mobile Navigation Bar Horizontal Optimization", () => {
  const v2Css = fs.readFileSync(
    path.resolve(process.cwd(), "src/components/kani/v2/v2.css"),
    "utf8"
  );

  it("reduces Actualizar button width to 32px on mobile and provides accessible 44x44px touch target", () => {
    // Mobile query defines 32px column for refresh button
    expect(v2Css).toMatch(
      /@media\s*\(max-width:\s*767px\)\s*\{[\s\S]*?\.v2-nav\.admin-section-nav\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+1px\s+32px;/
    );

    // Refresh button is 32px wide on mobile with pseudo-element touch target
    expect(v2Css).toMatch(
      /@media\s*\(max-width:\s*767px\)\s*\{[\s\S]*?\.v2-nav\s+\.admin-section-nav-refresh-btn\s*\{[^}]*width:\s*32px;[^}]*min-width:\s*32px;/
    );

    expect(v2Css).toMatch(
      /\.v2-nav\s+\.admin-section-nav-refresh-btn::before\s*\{[^}]*min-width:\s*44px;[^}]*min-height:\s*44px;/
    );
  });

  it("preserves desktop navbar dimensions and 44x44px refresh button on desktop", () => {
    expect(v2Css).toMatch(
      /\.v2-nav\.admin-section-nav\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+1px\s+44px;/
    );
    expect(v2Css).toMatch(
      /\.v2-nav\s+\.admin-section-nav-refresh-btn\s*\{[^}]*width:\s*44px;\s*height:\s*44px;/
    );
  });

  it("distributes all 6 primary sections evenly with 1fr columns", () => {
    expect(v2Css).toMatch(
      /\.v2-nav\s+\.admin-section-nav-items\s*\{[^}]*grid-template-columns:\s*repeat\(6,\s*minmax\(0,\s*1fr\)\);/
    );
  });
});
