import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

describe('Liquid Glass V12.30 — Sistema Visual Unificado y Jerarquía de Acciones', () => {
  const root = process.cwd();
  const liquidCss = readFileSync(
    path.resolve(root, 'src/components/kani/experimental/liquid-glass.css'),
    'utf8',
  );
  const routesCss = readFileSync(
    path.resolve(root, 'src/components/kani/experimental/liquid-glass-routes.css'),
    'utf8',
  );
  const v1230Idx = liquidCss.indexOf('LIQUID GLASS V12.30');
  const v1230 = v1230Idx >= 0 ? liquidCss.slice(v1230Idx) : '';

  it('define tokens ópticos canónicos para Light (perla/champagne) y Dark (obsidiana/champagne)', () => {
    expect(v1230Idx).toBeGreaterThan(-1);
    expect(v1230).toContain('--lg-sys-btn-primary-bg:');
    expect(v1230).toContain('--lg-sys-btn-secondary-bg:');
    expect(v1230).toContain('--lg-sys-btn-disabled-bg:');
    expect(v1230).toContain('--lg-sys-glass-card:');
    expect(v1230).toContain('--lg-sys-border-champagne:');
    expect(v1230).toContain('--lg-sys-input-bg:');
  });

  it('unifica la jerarquía primaria (Continuar, Pagar seña, Volver a la reserva, Guardar/Confirmar)', () => {
    expect(v1230).toContain('.liquid-glass-reservation .booking-next-button:not(:disabled)');
    expect(v1230).toContain('.payway-checkout .payway-submit-btn:not(:disabled)');
    expect(v1230).toContain('.mobile-menu-cta .booking-menu-return:not(:disabled)');
    expect(v1230).toContain('.liquid-glass-reservation .confirmation .action-brand:not(:disabled)');
    expect(v1230).toContain('border: 1.5px solid var(--lg-sys-border-champagne) !important;');
  });

  it('unifica la jerarquía secundaria subordinada (Volver, Cancelar, acciones neutras) y estados disabled/focus', () => {
    expect(v1230).toContain('.liquid-glass-reservation .booking-back-button:not(:disabled)');
    expect(v1230).toContain('.liquid-glass-reservation .confirmation-secondary:not(:disabled)');
    expect(v1230).toContain(':focus-visible');
    expect(v1230).toContain(':disabled');
    expect(v1230).toContain('cursor: not-allowed !important;');
    expect(v1230).toContain('@media (prefers-reduced-transparency: reduce)');
  });

  it('unifica cards e inputs de rutas experimentales bajo los tokens compartidos sin tocar estilos globales base', () => {
    expect(routesCss).toContain('var(--lg-sys-glass-card');
    expect(routesCss).toContain('var(--lg-sys-border-champagne');
    expect(v1230).toContain('.booking-option.selected');
    expect(v1230).toContain('.calendar-glass-card');
    expect(v1230).toContain('.confirmation-details');
    expect(v1230).toContain('.booking-page .field-control input');
    expect(v1230).toContain('background-color: var(--lg-sys-input-bg) !important;');
  });
});
