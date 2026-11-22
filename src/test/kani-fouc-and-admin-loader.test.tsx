import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const { mockUseReducedMotion } = vi.hoisted(() => ({
  mockUseReducedMotion: vi.fn(() => false),
}));

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to, ...props }: { children?: React.ReactNode; to?: string }) => (
    <a href={to ?? '#'} {...props}>
      {children}
    </a>
  ),
  Outlet: () => <div data-testid="outlet" />,
  useLocation: () => ({ pathname: '/panel-administracion', search: '' }),
  useRouterState: () => '/panel-administracion',
  useRouter: () => ({ invalidate: vi.fn() }),
  createRootRouteWithContext: () => () => ({}),
  HeadContent: () => null,
  Scripts: () => null,
}));

vi.mock('motion/react', async () => {
  const React = await import('react');
  const motionProxy = new Proxy(
    {},
    {
      get(_target, prop: string) {
        return React.forwardRef(
          (
            {
              children,
              animate: _animate,
              transition: _transition,
              initial: _initial,
              exit: _exit,
              ...rest
            }: Record<string, unknown>,
            ref,
          ) => React.createElement(prop, { ...rest, ref }, children as React.ReactNode),
        );
      },
    },
  );
  return {
    MotionConfig: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    motion: motionProxy,
    useReducedMotion: () => mockUseReducedMotion(),
  };
});

vi.mock('@/lib/kani-auth', () => ({
  clearStaffCache: vi.fn(),
  getAuthenticatedStaff: vi.fn(() => new Promise(() => {})),
}));

vi.mock('@/lib/kani-v2', () => ({
  isV2AdminEnvironment: vi.fn(() => true),
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    supabaseUrl: 'https://example.supabase.co',
    auth: {
      onAuthStateChange: vi.fn(() => ({
        data: { subscription: { unsubscribe: vi.fn() } },
      })),
    },
  },
}));

import {
  isClassicLegacyPath,
  isLiquidGlassAdminPath,
  isLiquidGlassPath,
} from '@/components/kani/experimental/liquid-glass-shell';
import { V2Layout } from '@/components/kani/v2/layout';

describe('Zero FOUC/FOUT en rutas Liquid Glass y Kani Loader en V2Layout', () => {
  const rootDir = process.cwd();
  const rootRouteCode = readFileSync(path.resolve(rootDir, 'src/routes/__root.tsx'), 'utf8');
  const stylesCss = readFileSync(path.resolve(rootDir, 'src/styles.css'), 'utf8');
  const v2Css = readFileSync(path.resolve(rootDir, 'src/components/kani/v2/v2.css'), 'utf8');

  beforeEach(() => {
    vi.clearAllMocks();
    mockUseReducedMotion.mockReturnValue(false);
    document.body.className = '';
    delete document.body.dataset.lgAdmin;
    delete document.documentElement.dataset.liquidGlass;
    delete document.documentElement.dataset.lgAdmin;
  });

  afterEach(() => {
    cleanup();
    document.body.className = '';
    delete document.body.dataset.lgAdmin;
    delete document.documentElement.dataset.liquidGlass;
    delete document.documentElement.dataset.lgAdmin;
  });

  it('1. isLiquidGlassPath / isLiquidGlassAdminPath / isClassicLegacyPath distinguen rutas Liquid Glass de -old y clásicas', () => {
    // Rutas públicas y admin Liquid Glass
    expect(isLiquidGlassPath('/')).toBe(true);
    expect(isLiquidGlassPath('/reservar')).toBe(true);
    expect(isLiquidGlassPath('/contacto')).toBe(true);
    expect(isLiquidGlassPath('/cancelar-turno')).toBe(true);
    expect(isLiquidGlassPath('/panel-administracion')).toBe(true);
    expect(isLiquidGlassPath('/panel-administracion/pagos')).toBe(true);
    expect(isLiquidGlassPath('/panel-membresias')).toBe(true);
    expect(isLiquidGlassPath('/admin-v2-liquid')).toBe(true);

    expect(isLiquidGlassAdminPath('/panel-administracion')).toBe(true);
    expect(isLiquidGlassAdminPath('/panel-administracion/turnos')).toBe(true);
    expect(isLiquidGlassAdminPath('/panel-membresias')).toBe(true);
    expect(isLiquidGlassAdminPath('/panel-descuentos')).toBe(true);
    expect(isLiquidGlassAdminPath('/panel-turnos')).toBe(true);
    expect(isLiquidGlassAdminPath('/panel-horarios')).toBe(true);
    expect(isLiquidGlassAdminPath('/admin-v2-liquid')).toBe(true);
    expect(isLiquidGlassAdminPath('/reservar')).toBe(false);
    expect(isLiquidGlassAdminPath('/contacto')).toBe(false);

    // Rutas -old y clásicas nunca activan Liquid Glass
    const classicPaths = [
      '/reservar-turno-old',
      '/contacto-old',
      '/panel-administracion-old',
      '/panel-administracion-old/pagos',
      '/admin',
      '/admin-v2',
      '/panel-v2',
      '/reserva-v2',
      '/reserva-v3',
      '/reserva-v5',
      '/reservar-turno-mercadopago',
    ];
    for (const classicPath of classicPaths) {
      expect(isClassicLegacyPath(classicPath)).toBe(true);
      expect(isLiquidGlassPath(classicPath)).toBe(false);
      expect(isLiquidGlassAdminPath(classicPath)).toBe(false);
    }
  });

  it('2. __root.tsx y styles.css aplican Liquid Glass e Inter Variable antes del primer paint sin afectar rutas clásicas', () => {
    expect(rootRouteCode).toContain("import \"@fontsource-variable/inter\";");
    expect(rootRouteCode).toContain('isLiquidGlassPath(pathname)');
    expect(rootRouteCode).toContain('isLiquidGlassAdminPath(pathname)');
    expect(rootRouteCode).toContain('className={isLiquidGlass ? "liquid-glass-active" : undefined}');
    expect(rootRouteCode).toContain('data-lg-admin={isLiquidGlassAdmin ? "true" : undefined}');
    expect(rootRouteCode).toContain('ROOT_PREPAINT_SCRIPT');

    expect(stylesCss).toContain('html[data-liquid-glass="true"]');
    expect(stylesCss).toContain("--lg-font-inter: 'Inter Variable'");
    expect(stylesCss).toContain('html[data-theme="light"][data-liquid-glass="true"]');
    expect(stylesCss).toContain('html[data-theme="dark"][data-liquid-glass="true"]');
    expect(stylesCss).toContain('html[data-liquid-glass="true"] body::before');
  });

  it('3. V2Layout muestra el loader de Kani con role="status" y texto accesible durante state.loading', () => {
    const { container } = render(<V2Layout basePath="/panel-administracion" liquidGlass />);

    const status = screen.getByRole('status');
    expect(status).toBeInTheDocument();
    expect(status).toHaveClass('v2-access', 'v2-access-loading');
    expect(screen.getByText('Verificando acceso…')).toBeInTheDocument();
    expect(container.querySelector('.v2-kani-loader-emblem')).toBeInTheDocument();
    expect(container.querySelector('.v2-kani-loader-ring')).toBeInTheDocument();
    expect(container.querySelector('.v2-kani-loader-kanji')?.textContent).toBe('蟹');
  });

  it('4. El loader de V2Layout respeta prefers-reduced-motion y useReducedMotion', () => {
    mockUseReducedMotion.mockReturnValue(true);
    const { container } = render(<V2Layout basePath="/panel-administracion" liquidGlass />);

    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(container.querySelector('.v2-kani-loader-kanji')?.textContent).toBe('蟹');
    expect(v2Css).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*\.v2-kani-loader-ring/);
  });
});
