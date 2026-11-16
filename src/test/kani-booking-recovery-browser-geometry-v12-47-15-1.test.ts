import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { chromium, type Browser } from "playwright-core";
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const EDGE_PATH = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PREVIEW_PORT = 4189;
const PREVIEW_URL = `http://127.0.0.1:${PREVIEW_PORT}`;

async function waitForServer(url: string, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok || res.status === 200) return;
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Preview server did not start at ${url} within ${timeoutMs}ms`);
}

describe("V12.47.15.1 — Smart Booking Recovery Modal Real Browser Geometry", () => {
  let serverProc: ChildProcess | null = null;
  let browser: Browser | null = null;

  beforeAll(async () => {
    if (!fs.existsSync(EDGE_PATH)) {
      throw new Error(`Edge browser not found at ${EDGE_PATH}`);
    }
    const repoRoot = path.resolve(__dirname, "../..");
    serverProc = spawn(
      process.platform === "win32" ? "npx.cmd" : "npx",
      ["vite", "--host", "127.0.0.1", "--port", String(PREVIEW_PORT), "--strictPort"],
      { cwd: repoRoot, stdio: "ignore", shell: process.platform === "win32" },
    );
    await waitForServer(`${PREVIEW_URL}/reservar`, 25000);
    browser = await chromium.launch({
      executablePath: EDGE_PATH,
      headless: true,
    });
  }, 30000);

  afterAll(async () => {
    await browser?.close();
    if (serverProc && !serverProc.killed) {
      serverProc.kill("SIGTERM");
    }
  });

  const draft = {
    version: 1,
    service: "CORTE",
    barber: "Gonzalo",
    barberDeferred: false,
    date: "2099-12-20",
    time: "16:00",
    name: "Tomás Pérez",
    phone: "11 5555-6666",
    phoneCountry: "AR",
    email: "tomas@gmail.com",
    benefitCode: null,
    lastMeaningfulActivityAt: Date.now(),
    expiresAt: Date.now() + 60 * 60 * 1000,
  };

  const mobileViewports = [
    { width: 320, height: 568 },
    { width: 375, height: 812 },
    { width: 390, height: 844 },
    { width: 430, height: 932 },
  ];

  const desktopViewports = [
    { width: 1280, height: 800 },
    { width: 1440, height: 900 },
    { width: 1920, height: 1080 },
  ];

  for (const vp of mobileViewports) {
    it(`Mobile ${vp.width}x${vp.height}: centered inside viewport with ~16px margins, no horizontal overflow, stacked full-width buttons`, async () => {
      const context = await browser!.newContext({
        viewport: vp,
        isMobile: true,
        hasTouch: true,
      });
      const page = await context.newPage();
      await page.addInitScript((d) => {
        window.localStorage.setItem("kani:booking:recovery-draft:v1", JSON.stringify(d));
      }, draft);

      await page.goto(`${PREVIEW_URL}/reservar`, { waitUntil: "networkidle" });
      await page.waitForSelector('[data-slot="dialog-content"].booking-recovery-modal');
      await page.waitForTimeout(300);

      const metrics = await page.evaluate(() => {
        const dlg = document.querySelector('[data-slot="dialog-content"].booking-recovery-modal') as HTMLElement;
        const rect = dlg.getBoundingClientRect();
        const cs = window.getComputedStyle(dlg);
        const closeBtn = dlg.querySelector('button[aria-label="Cerrar"]')!.getBoundingClientRect();
        const btns = Array.from(dlg.querySelectorAll("button")).filter(
          (b) => b.getAttribute("aria-label") !== "Cerrar",
        );
        const btnRects = btns.map((b) => b.getBoundingClientRect());
        return {
          docScrollWidth: document.documentElement.scrollWidth,
          innerWidth: window.innerWidth,
          innerHeight: window.innerHeight,
          rect: {
            left: rect.left,
            right: rect.right,
            top: rect.top,
            bottom: rect.bottom,
            width: rect.width,
            height: rect.height,
          },
          translate: cs.translate,
          closeBtn: { left: closeBtn.left, right: closeBtn.right, top: closeBtn.top, bottom: closeBtn.bottom },
          btnRects: btnRects.map((r) => ({ left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width })),
        };
      });

      expect(metrics.docScrollWidth).toBeLessThanOrEqual(metrics.innerWidth);
      expect(metrics.rect.left).toBeGreaterThanOrEqual(12);
      expect(metrics.rect.right).toBeLessThanOrEqual(metrics.innerWidth - 12);
      expect(metrics.rect.top).toBeGreaterThanOrEqual(12);
      expect(metrics.rect.bottom).toBeLessThanOrEqual(metrics.innerHeight - 12);

      // Horizontally centered
      const center = (metrics.rect.left + metrics.rect.right) / 2;
      expect(Math.abs(center - metrics.innerWidth / 2)).toBeLessThanOrEqual(2);

      // Close button & action buttons inside viewport and stacked vertically
      expect(metrics.closeBtn.right).toBeLessThanOrEqual(metrics.innerWidth - 12);
      expect(metrics.btnRects.length).toBe(2);
      expect(Math.abs(metrics.btnRects[0].width - metrics.btnRects[1].width)).toBeLessThanOrEqual(2);
      expect(metrics.btnRects[0].width).toBeGreaterThan(200);
      expect(metrics.btnRects[1].bottom).toBeLessThanOrEqual(metrics.btnRects[0].top + 1);

      await context.close();
    }, 20000);
  }

  for (const vp of desktopViewports) {
    it(`Desktop ${vp.width}x${vp.height} (Light & Dark): ~500px width, centered, horizontal buttons`, async () => {
      for (const theme of ["light", "dark"] as const) {
        const context = await browser!.newContext({ viewport: vp });
        const page = await context.newPage();
        await page.addInitScript(
          ({ d, t }) => {
            window.localStorage.setItem("kani:booking:recovery-draft:v1", JSON.stringify(d));
            window.localStorage.setItem("kani-theme", t);
            document.documentElement.setAttribute("data-theme", t);
          },
          { d: draft, t: theme },
        );

        await page.goto(`${PREVIEW_URL}/reservar`, { waitUntil: "networkidle" });
        await page.waitForSelector('[data-slot="dialog-content"].booking-recovery-modal');
        await page.waitForTimeout(300);

        const metrics = await page.evaluate(() => {
          const dlg = document.querySelector('[data-slot="dialog-content"].booking-recovery-modal') as HTMLElement;
          const rect = dlg.getBoundingClientRect();
          const cs = window.getComputedStyle(dlg);
          const btns = Array.from(dlg.querySelectorAll("button")).filter(
            (b) => b.getAttribute("aria-label") !== "Cerrar",
          );
          const btnRects = btns.map((b) => b.getBoundingClientRect());
          return {
            innerWidth: window.innerWidth,
            innerHeight: window.innerHeight,
            docScrollWidth: document.documentElement.scrollWidth,
            backdropFilter: cs.backdropFilter,
            textContent: dlg.textContent || "",
            rect: { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width },
            btnRects: btnRects.map((r) => ({ top: r.top, left: r.left, right: r.right, width: r.width })),
          };
        });

        expect(metrics.docScrollWidth).toBeLessThanOrEqual(metrics.innerWidth);
        expect(metrics.rect.width).toBeGreaterThanOrEqual(500);
        expect(metrics.rect.width).toBeLessThanOrEqual(540);
        const centerX = (metrics.rect.left + metrics.rect.right) / 2;
        expect(Math.abs(centerX - metrics.innerWidth / 2)).toBeLessThanOrEqual(16);
        expect(metrics.rect.top).toBeGreaterThanOrEqual(16);
        expect(metrics.rect.bottom).toBeLessThanOrEqual(metrics.innerHeight - 16);
        expect(metrics.backdropFilter).toContain("blur(24px)");
        expect(metrics.textContent).toContain("Retomá tu reserva donde la dejaste.");
        expect(metrics.textContent).toContain("20 de Dic.");

        // Horizontal equal-width 2-column buttons on desktop
        expect(metrics.btnRects.length).toBe(2);
        expect(Math.abs(metrics.btnRects[0].top - metrics.btnRects[1].top)).toBeLessThanOrEqual(2);
        expect(Math.abs(metrics.btnRects[0].width - metrics.btnRects[1].width)).toBeLessThanOrEqual(2);

        await context.close();
      }
    }, 25000);
  }
});
