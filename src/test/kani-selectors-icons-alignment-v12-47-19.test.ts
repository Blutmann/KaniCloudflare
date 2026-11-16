import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { chromium, type Browser } from "playwright-core";
import fs from "node:fs";
import path from "node:path";

const EDGE_PATH = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";

describe("V12.47.19 — Real Browser Geometry Audit for Selectors, Search, Date/Time & Inner Icons", () => {
  let browser: Browser | null = null;
  let combinedCss = "";

  beforeAll(async () => {
    if (!fs.existsSync(EDGE_PATH)) {
      throw new Error(`Edge browser not found at ${EDGE_PATH}`);
    }
    const v2Css = fs.readFileSync(
      path.resolve(__dirname, "../components/kani/v2/v2.css"),
      "utf-8",
    );
    const lgaCss = fs.readFileSync(
      path.resolve(__dirname, "../components/kani/experimental/liquid-glass-admin.css"),
      "utf-8",
    );
    const stylesCss = fs.readFileSync(
      path.resolve(__dirname, "../styles.css"),
      "utf-8",
    );
    combinedCss = `${stylesCss}\n${v2Css}\n${lgaCss}`;
    browser = await chromium.launch({ executablePath: EDGE_PATH, headless: true });
  }, 20000);

  afterAll(async () => {
    await browser?.close();
  });

  const viewports = [
    { width: 320, height: 568 },
    { width: 375, height: 812 },
    { width: 390, height: 844 },
    { width: 430, height: 932 },
    { width: 1280, height: 800 },
  ];

  for (const vp of viewports) {
    for (const theme of ["light", "dark"] as const) {
      it(`Viewport ${vp.width}x${vp.height} (${theme}): native <select>, .v2-search, date/time, and combobox icons align optically without overflow`, async () => {
        const context = await browser!.newContext({
          viewport: vp,
          isMobile: vp.width < 768,
          hasTouch: vp.width < 768,
        });
        const page = await context.newPage();

        await page.setContent(`
          <!DOCTYPE html>
          <html data-theme="${theme}">
            <head>
              <style>${combinedCss}</style>
            </head>
            <body data-lg-admin="true" class="liquid-glass-active" style="margin:0;padding:12px;">
              <div class="v2-shell" style="width:100%;max-width:540px;">
                <div class="v2-manual-row" style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;">
                  <label class="v2-field">
                    Servicio
                    <select id="test-select">
                      <option value="1">Membresía 10 servicios personalizada muy larga para truncar</option>
                    </select>
                  </label>
                  <label class="v2-field">
                    Fecha
                    <input id="test-date" type="date" value="2026-11-20" />
                  </label>
                </div>
                <div class="v2-manual-row" style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin-top:8px;">
                  <label class="v2-field">
                    Hora
                    <input id="test-time" type="time" value="16:00" />
                  </label>
                  <div class="v2-field">
                    <span>Cliente</span>
                    <button id="test-combo" type="button" style="display:flex;align-items:center;justify-content:space-between;min-height:44px;width:100%;padding:0 11px 0 12px;border:1px solid #ccc;border-radius:12px;">
                      <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">Lucas Fernández</span>
                      <svg id="combo-chevron" width="16" height="16" viewBox="0 0 24 24" style="flex-shrink:0;"><path d="m6 9 6 6 6-6"/></svg>
                    </button>
                  </div>
                </div>
                <div class="v2-client-quick-search v2-search" style="margin-top:8px;">
                  <svg id="search-icon" width="16" height="16" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/></svg>
                  <input id="test-search" type="text" placeholder="Buscar cliente..." />
                </div>
              </div>
            </body>
          </html>
        `);

        const metrics = await page.evaluate(() => {
          const sel = document.getElementById("test-select")!;
          const selCs = window.getComputedStyle(sel);
          const selRect = sel.getBoundingClientRect();

          const dateEl = document.getElementById("test-date")!;
          const dateCs = window.getComputedStyle(dateEl);
          const dateRect = dateEl.getBoundingClientRect();

          const timeEl = document.getElementById("test-time")!;
          const timeCs = window.getComputedStyle(timeEl);
          const timeRect = timeEl.getBoundingClientRect();

          const searchSvg = document.getElementById("search-icon")!;
          const searchInput = document.getElementById("test-search")!;
          const searchSvgRect = searchSvg.getBoundingClientRect();
          const searchInputRect = searchInput.getBoundingClientRect();
          const searchSvgCs = window.getComputedStyle(searchSvg);
          const searchInputCs = window.getComputedStyle(searchInput);

          const comboBtn = document.getElementById("test-combo")!;
          const comboSvg = document.getElementById("combo-chevron")!;
          const comboBtnRect = comboBtn.getBoundingClientRect();
          const comboSvgRect = comboSvg.getBoundingClientRect();

          return {
            docScrollWidth: document.documentElement.scrollWidth,
            innerWidth: window.innerWidth,
            select: {
              appearance: selCs.appearance,
              paddingRight: parseFloat(selCs.paddingRight),
              textOverflow: selCs.textOverflow,
              bgImage: selCs.backgroundImage,
              bgPos: selCs.backgroundPosition,
              height: selRect.height,
            },
            date: {
              display: dateCs.display,
              alignItems: dateCs.alignItems,
              height: dateRect.height,
              right: dateRect.right,
            },
            time: {
              display: timeCs.display,
              alignItems: timeCs.alignItems,
              height: timeRect.height,
              right: timeRect.right,
            },
            search: {
              pointerEvents: searchSvgCs.pointerEvents,
              paddingLeft: parseFloat(searchInputCs.paddingLeft),
              svgCenterY: (searchSvgRect.top + searchSvgRect.bottom) / 2,
              inputCenterY: (searchInputRect.top + searchInputRect.bottom) / 2,
              svgRight: searchSvgRect.right,
              inputLeft: searchInputRect.left,
            },
            combo: {
              svgCenterY: (comboSvgRect.top + comboSvgRect.bottom) / 2,
              btnCenterY: (comboBtnRect.top + comboBtnRect.bottom) / 2,
              rightOffset: comboBtnRect.right - comboSvgRect.right,
            },
          };
        });

        expect(metrics.docScrollWidth).toBeLessThanOrEqual(metrics.innerWidth);
        expect(metrics.select.appearance).toBe("none");
        expect(metrics.select.paddingRight).toBeGreaterThanOrEqual(32);
        expect(metrics.select.textOverflow).toBe("ellipsis");
        expect(metrics.select.bgImage).toContain("data:image/svg+xml");
        expect(metrics.select.height).toBeGreaterThanOrEqual(44);

        expect(metrics.date.display).toBe("flex");
        expect(metrics.date.alignItems).toBe("center");
        expect(metrics.date.height).toBeGreaterThanOrEqual(44);
        expect(metrics.date.right).toBeLessThanOrEqual(metrics.innerWidth);

        expect(metrics.time.display).toBe("flex");
        expect(metrics.time.alignItems).toBe("center");
        expect(metrics.time.height).toBeGreaterThanOrEqual(44);
        expect(metrics.time.right).toBeLessThanOrEqual(metrics.innerWidth);

        expect(metrics.search.pointerEvents).toBe("none");
        expect(metrics.search.paddingLeft).toBeGreaterThanOrEqual(36);
        expect(Math.abs(metrics.search.svgCenterY - metrics.search.inputCenterY)).toBeLessThanOrEqual(2);
        expect(metrics.search.svgRight).toBeLessThanOrEqual(metrics.search.inputLeft + metrics.search.paddingLeft);

        expect(Math.abs(metrics.combo.svgCenterY - metrics.combo.btnCenterY)).toBeLessThanOrEqual(2);
        expect(metrics.combo.rightOffset).toBeGreaterThanOrEqual(10);
        expect(metrics.combo.rightOffset).toBeLessThanOrEqual(14);

        await context.close();
      });
    }
  }
});
