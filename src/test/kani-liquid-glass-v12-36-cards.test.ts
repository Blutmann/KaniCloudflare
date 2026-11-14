import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

describe('Liquid Glass V12.36 — Unificación óptica del cristal en el flujo de reservas', () => {
  const root = process.cwd();
  const liquidCss = readFileSync(
    path.resolve(root, 'src/components/kani/experimental/liquid-glass.css'),
    'utf8',
  );
  const stylesCss = readFileSync(path.resolve(root, 'src/styles.css'), 'utf8');
  const v1236Idx = liquidCss.indexOf('LIQUID GLASS V12.36');
  const v1236 = v1236Idx >= 0 ? liquidCss.slice(v1236Idx) : '';

  it('elimina el Backdrop Root artificial en .liquid-glass-step-stage para permitir desenfoque real del fondo', () => {
    expect(v1236Idx).toBeGreaterThan(-1);
    expect(liquidCss).not.toMatch(/\.liquid-glass-step-stage\s*\{[^}]*will-change:\s*transform/);
    expect(v1236).toContain('.liquid-glass-step-stage');
    expect(v1236).toContain('will-change: auto !important;');
    expect(v1236).toContain('isolation: auto !important;');
  });

  it('replica la óptica de «Próximo espacio» (.v2-callout) en todas las cards del flujo de reservas', () => {
    for (const selector of [
      '.service-option',
      '.booking-option',
      '.booking-defer-option',
      '.barber-choice-list > button',
      '.booking-candidate-barber-btn',
      '.booking-time-slot:not(:disabled):not(.time-unavailable)',
      '.calendar-glass-card',
      '.booking-summary-card',
      '.booking-deposit-notice',
      '.summary-pending-notice',
      '.confirmation-details',
      '.confirmation-deposit-section',
    ]) {
      expect(v1236).toContain(selector);
    }

    expect(v1236).toContain('backdrop-filter: blur(18px) saturate(142%) !important;');
    expect(v1236).toContain('-webkit-backdrop-filter: blur(18px) saturate(142%) !important;');
  });

  it('conserva el desenfoque real y transparencia en el estado seleccionado sin volverse opaco', () => {
    expect(v1236).toContain('--lg-v36-card-selected-bg:');
    expect(v1236).toContain('rgba(255, 254, 250, 0.72)');
    expect(v1236).toContain('rgba(249, 245, 236, 0.58)');
    expect(v1236).toContain('rgba(54, 48, 40, 0.60)');
    expect(v1236).toContain('rgba(25, 23, 24, 0.48)');
    expect(v1236).toContain('border: 1.5px solid var(--lg-v36-border-selected) !important;');
  });

  it('elimina capas opacas/velos duplicados y define fallbacks sin romper rutas tradicionales', () => {
    expect(v1236).toContain('@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px)))');
    expect(v1236).toContain('@media (prefers-reduced-transparency: reduce)');
    expect(v1236).toContain('content: none !important;');
    expect(stylesCss).not.toContain('LIQUID GLASS V12.36');
    expect(stylesCss).not.toContain('--lg-v36-card-bg');
  });
});
