import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

describe('Liquid Glass — Unificación Tipográfica con Inter Variable', () => {
  const root = process.cwd();
  const typoCss = readFileSync(
    path.resolve(root, 'src/components/kani/experimental/liquid-glass-typography.css'),
    'utf8',
  );
  const bookingRoute = readFileSync(
    path.resolve(root, 'src/routes/reservar-turno-liquid.tsx'),
    'utf8',
  );
  const shellCode = readFileSync(
    path.resolve(root, 'src/components/kani/experimental/liquid-glass-shell.tsx'),
    'utf8',
  );

  it('carga @fontsource-variable/inter localmente en todas las rutas experimentales', () => {
    expect(bookingRoute).toContain("@fontsource-variable/inter");
    expect(bookingRoute).toContain("liquid-glass-typography.css");
    expect(shellCode).toContain("@fontsource-variable/inter");
    expect(shellCode).toContain("liquid-glass-typography.css");
  });

  it('define Inter Variable, optical-sizing y tabular-nums exclusivamente bajo body.liquid-glass-active', () => {
    expect(typoCss).toContain("--lg-font-inter: 'Inter Variable'");
    expect(typoCss).toContain('font-optical-sizing: auto');
    expect(typoCss).toContain('font-variant-numeric: tabular-nums');
    expect(typoCss).toContain('font-weight: 400');
    expect(typoCss).toContain('font-weight: 500');
    expect(typoCss).toContain('font-weight: 600');
    expect(typoCss).toContain('font-weight: 700');
    expect(typoCss).not.toMatch(/^body\s*\{/m);
    expect(typoCss).not.toMatch(/^html\s*\{/m);
  });
});
