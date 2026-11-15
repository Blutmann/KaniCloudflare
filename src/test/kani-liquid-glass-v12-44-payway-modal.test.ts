import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

describe('Liquid Glass V12.44 — Hotfix modal de pago Payway nítido sobre backdrop', () => {
  const root = process.cwd();
  const reservaV4Css = readFileSync(
    path.resolve(root, 'src/components/kani/experimental/reserva-v4.css'),
    'utf8',
  );
  const liquidCss = readFileSync(
    path.resolve(root, 'src/components/kani/experimental/liquid-glass.css'),
    'utf8',
  );
  const dialogTsx = readFileSync(
    path.resolve(root, 'src/components/ui/dialog.tsx'),
    'utf8',
  );

  it('mantiene .payway-checkout en z-index >= 200 en reserva-v4.css por encima de DialogOverlay (z-[190])', () => {
    const match = reservaV4Css.match(/\.payway-checkout\s*\{[\s\S]*?z-index:\s*(\d+)/);
    expect(match).not.toBeNull();
    const zIndex = Number(match?.[1]);
    expect(zIndex).toBeGreaterThanOrEqual(200);
    expect(dialogTsx).toContain('z-[190]');
    expect(dialogTsx).toContain('z-[200]');
    expect(dialogTsx).toContain('<DialogPortal>');
  });

  it('garantiza en liquid-glass.css V12.44 que el backdrop desenfocado quede en z-index 190 y .payway-checkout en z-index 200 sin filter', () => {
    const v1244Idx = liquidCss.indexOf('LIQUID GLASS V12.44');
    expect(v1244Idx).toBeGreaterThan(-1);
    const v1244 = liquidCss.slice(v1244Idx);

    expect(v1244).toContain('[data-slot="dialog-overlay"]');
    expect(v1244).toContain('z-index: 190 !important;');
    expect(v1244).toContain('.payway-checkout');
    expect(v1244).toContain('[data-slot="dialog-content"]');
    expect(v1244).toContain('z-index: 200 !important;');
    expect(v1244).toContain('filter: none !important;');
  });
});
