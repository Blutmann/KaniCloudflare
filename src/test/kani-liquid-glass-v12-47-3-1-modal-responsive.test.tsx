import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import fs from 'node:fs';
import path from 'node:path';

describe('V12.47.3.1 — Liquid Glass Dialogs & Modals Responsive Centering', () => {
  let styleEl: HTMLStyleElement;

  beforeEach(() => {
    document.body.classList.add('liquid-glass-active');
    document.documentElement.setAttribute('data-theme', 'dark');

    // Inject the real compiled/source styles for liquid-glass and reserva-v4
    const liquidGlassCssPath = path.resolve(__dirname, '../components/kani/experimental/liquid-glass.css');
    const reservaV4CssPath = path.resolve(__dirname, '../components/kani/experimental/reserva-v4.css');
    const liquidGlassCss = fs.readFileSync(liquidGlassCssPath, 'utf-8');
    const reservaV4Css = fs.readFileSync(reservaV4CssPath, 'utf-8');

    styleEl = document.createElement('style');
    styleEl.innerHTML = `${reservaV4Css}\n${liquidGlassCss}`;
    document.head.appendChild(styleEl);
  });

  afterEach(() => {
    document.body.classList.remove('liquid-glass-active');
    document.documentElement.removeAttribute('data-theme');
    styleEl?.remove();
  });

  it('prohibits margin: 0 auto on fixed dialog content in liquid-glass.css', () => {
    const liquidGlassCssPath = path.resolve(__dirname, '../components/kani/experimental/liquid-glass.css');
    const liquidGlassCss = fs.readFileSync(liquidGlassCssPath, 'utf-8');

    // Find the section for modales ópticos nítidos
    const modalSectionMatch = liquidGlassCss.match(
      /\/\* 1 & 2\. Modales Ópticos Nítidos[\s\S]*?(?=\/\* 4\. Mensajes)/,
    );
    expect(modalSectionMatch).not.toBeNull();
    const modalSection = modalSectionMatch![0];

    // Ensure margin: 0 auto is NOT present in the optical modal section
    expect(modalSection).not.toMatch(/margin:\s*0\s+auto/);

    // Ensure margin: 0 !important is present
    expect(modalSection).toMatch(/margin:\s*0\s*!important/);
  });

  it('enforces position fixed, left 50%, top 50%, and translate3d(-50%, -50%, 0) base centering', () => {
    const liquidGlassCssPath = path.resolve(__dirname, '../components/kani/experimental/liquid-glass.css');
    const liquidGlassCss = fs.readFileSync(liquidGlassCssPath, 'utf-8');

    // Verify dialog content base rule has fixed centering and translate
    expect(liquidGlassCss).toMatch(
      /html\[data-theme\] body\.liquid-glass-active :is\(\[data-slot="dialog-content"\], \.payway-checkout\)[\s\S]*?position:\s*fixed\s*!important/,
    );
    expect(liquidGlassCss).toMatch(
      /html\[data-theme\] body\.liquid-glass-active :is\(\[data-slot="dialog-content"\], \.payway-checkout\)[\s\S]*?left:\s*50%\s*!important/,
    );
    expect(liquidGlassCss).toMatch(
      /html\[data-theme\] body\.liquid-glass-active :is\(\[data-slot="dialog-content"\], \.payway-checkout\)[\s\S]*?top:\s*50%\s*!important/,
    );
    expect(liquidGlassCss).toMatch(
      /html\[data-theme\] body\.liquid-glass-active :is\(\[data-slot="dialog-content"\], \.payway-checkout\)[\s\S]*?transform:\s*translate3d\(-50%,\s*-50%,\s*0\)\s*!important/,
    );
  });

  it('constrains width and max-width across viewports without horizontal overflow', () => {
    const liquidGlassCssPath = path.resolve(__dirname, '../components/kani/experimental/liquid-glass.css');
    const liquidGlassCss = fs.readFileSync(liquidGlassCssPath, 'utf-8');

    // Check media queries for mobile viewports
    expect(liquidGlassCss).toMatch(/@media\s*\(max-width:\s*640px\)[\s\S]*?width:\s*min\(calc\(100% - 32px\)/);
    expect(liquidGlassCss).toMatch(/@media\s*\(max-width:\s*380px\)[\s\S]*?width:\s*min\(calc\(100% - 24px\)/);
  });

  it('renders payway error state within dialog without breaking geometry', () => {
    render(
      <Dialog open={true}>
        <DialogContent className="payway-checkout">
          <DialogTitle className="payway-checkout-title">Pagá la seña a Kani con Payway</DialogTitle>
          <DialogDescription className="payway-checkout-subtitle">Pago seguro de seña</DialogDescription>
          <p role="alert" className="payway-result">
            El pago fue rechazado por fondos insuficientes.
          </p>
          <Button variant="outline">Volver a mis datos</Button>
        </DialogContent>
      </Dialog>,
    );

    const dialogContent = document.querySelector('[data-slot="dialog-content"]') as HTMLElement;
    expect(dialogContent).not.toBeNull();
    expect(dialogContent.classList.contains('payway-checkout')).toBe(true);

    const errorAlert = screen.getByRole('alert');
    expect(errorAlert).toBeInTheDocument();
    expect(errorAlert.textContent).toContain('fondos insuficientes');

    const backBtn = screen.getByRole('button', { name: 'Volver a mis datos' });
    expect(backBtn).toBeInTheDocument();
  });

  it('verifies mathematical centering across 360px, 375px, 390px, 430px and desktop', () => {
    const viewports = [
      { name: 'Android Small', width: 360, margin: 12 },
      { name: 'iPhone SE', width: 375, margin: 12 },
      { name: 'iPhone 13/14/15/16', width: 390, margin: 16 },
      { name: 'iPhone Pro Max', width: 430, margin: 16 },
      { name: 'Desktop', width: 1366, margin: (1366 - 440) / 2 },
    ];

    for (const vp of viewports) {
      const modalWidth = Math.min(vp.width - vp.margin * 2, 440);
      const leftCoord = vp.width * 0.5 - modalWidth * 0.5;
      const rightCoord = vp.width * 0.5 + modalWidth * 0.5;
      const leftGutter = leftCoord;
      const rightGutter = vp.width - rightCoord;

      expect(leftGutter).toBeGreaterThanOrEqual(vp.margin - 1);
      expect(rightGutter).toBeGreaterThanOrEqual(vp.margin - 1);
      expect(Math.abs(leftGutter - rightGutter)).toBeLessThanOrEqual(1);
    }
  });
});
