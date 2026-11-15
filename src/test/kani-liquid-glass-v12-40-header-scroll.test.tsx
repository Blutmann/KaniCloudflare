// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import fs from 'node:fs';
import path from 'node:path';

let mockPathname = '/admin-liquid/inicio';

vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children, onClick, activeProps: _ap, ...props }: any) => (
    <a href={typeof to === 'string' ? to : '#'} onClick={onClick} {...props}>
      {children}
    </a>
  ),
  Outlet: () => <div data-testid="v2-outlet" />,
  useNavigate: () => vi.fn(),
  useRouterState: ({ select }: any) => select({ location: { pathname: mockPathname } }),
  useLocation: ({ select }: any) => select({ pathname: mockPathname }),
  createFileRoute: () => () => ({}),
}));

const mockStaff = vi.hoisted(() => ({
  user: { id: 'admin-1', email: 'admin@kani.test' },
  profile: { role: 'ADMIN', barber_id: null, full_name: 'Admin Kani' },
  barbers: [{ id: 'b1', name: 'Lautaro' }],
}));

vi.mock('@/lib/kani-auth', () => ({
  getAuthenticatedStaff: vi.fn().mockResolvedValue(mockStaff),
  clearStaffCache: vi.fn(),
  signOut: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/kani-admin-context', () => ({
  AdminStaffProvider: ({ children }: any) => <>{children}</>,
  useAdminStaff: () => mockStaff,
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    supabaseUrl: 'https://example.supabase.co',
    auth: {
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: vi.fn() } } }),
    },
  },
}));

vi.mock('@/lib/kani-v2', () => ({
  isV2AdminEnvironment: () => true,
}));

import { KaniProvider } from '@/components/kani/store';
import { SiteHeader } from '@/components/kani/site-header';
import { V2Layout } from '@/components/kani/v2/layout';

describe('Liquid Glass V12.40 — Regresión de scroll móvil, slot estático y header adaptativo', () => {
  const root = process.cwd();
  const liquidCss = fs.readFileSync(
    path.resolve(root, 'src/components/kani/experimental/liquid-glass.css'),
    'utf8',
  );
  const adminCss = fs.readFileSync(
    path.resolve(root, 'src/components/kani/experimental/liquid-glass-admin.css'),
    'utf8',
  );

  beforeEach(() => {
    mockPathname = '/admin-liquid/inicio';
    Object.defineProperty(window, 'scrollY', { value: 0, writable: true, configurable: true });
    Object.defineProperty(window, 'pageYOffset', { value: 0, writable: true, configurable: true });
    Object.defineProperty(document.documentElement, 'scrollTop', { value: 0, writable: true, configurable: true });
    Object.defineProperty(document.body, 'scrollTop', { value: 0, writable: true, configurable: true });
    vi.spyOn(window, 'scrollTo').mockImplementation(((opts: any) => {
      const top = typeof opts === 'object' && opts ? Number(opts.top ?? 0) : 0;
      (window as any).scrollY = top;
      (document.documentElement as any).scrollTop = top;
      (document.body as any).scrollTop = top;
    }) as any);
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb: FrameRequestCallback) => {
      return window.setTimeout(() => cb(performance.now()), 0) as unknown as number;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id: number) => {
      window.clearTimeout(id);
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
    document.body.className = '';
    document.body.removeAttribute('style');
    delete document.body.dataset.lgAdmin;
    delete document.body.dataset.adminInternal;
  });

  it('1. Reglas CSS V12.40 fijan el header mobile arriba con espaciador estático 64px (sin sticky drift ni salto 72->64)', () => {
    const v1240Liquid = liquidCss.slice(liquidCss.indexOf('LIQUID GLASS V12.40'));
    const v1240Admin = adminCss.slice(adminCss.indexOf('LAYER 12 · V12.40'));

    expect(v1240Liquid).toContain('body:has(.site-shell .liquid-glass-header)');
    expect(v1240Liquid).toContain('position: static !important;');
    expect(v1240Liquid).toContain('position: fixed !important;');
    expect(v1240Liquid).toContain('height: 64px !important;');
    expect(v1240Liquid).toContain('scroll-padding-top: 80px !important;');
    expect(v1240Liquid).toContain('@media (min-width: 768px)');
    expect(v1240Liquid).toContain('height: 0 !important;');

    expect(v1240Admin).toContain('position: static !important;');
    expect(v1240Admin).toContain('position: fixed !important;');
    expect(v1240Admin).toContain('scroll-margin-top: 84px !important;');

    // Mantiene intacto el tratamiento adaptativo V12.38
    expect(liquidCss).toContain('.liquid-glass-header--scrolled:not(.menu-open)::before');
  });

  it('2. SiteHeader sincroniza estado inicial restaurado, visualViewport/pageshow e ignora scroll horizontal de .v2-nav', async () => {
    (window as any).scrollY = 48;

    const vvListeners: Record<string, Set<EventListener>> = {
      resize: new Set(),
      scroll: new Set(),
    };
    const origVV = window.visualViewport;
    Object.defineProperty(window, 'visualViewport', {
      value: {
        height: 844,
        offsetTop: 0,
        addEventListener: (ev: string, fn: EventListener) => vvListeners[ev]?.add(fn),
        removeEventListener: (ev: string, fn: EventListener) => vvListeners[ev]?.delete(fn),
      },
      configurable: true,
    });

    try {
      const { container, unmount } = render(
        <KaniProvider>
          <div className="site-shell">
            <SiteHeader />
            <nav className="v2-navigation">
              <div className="v2-nav admin-section-nav" data-testid="horiz-nav" />
            </nav>
          </div>
        </KaniProvider>,
      );

      const header = container.querySelector('header.site-header')!;
      // Sincroniza inmediatamente sin quedar atascado en transparente si ya viene scrolleado
      expect(header.getAttribute('data-scrolled')).toBe('true');

      // Regreso arriba detectado vía visualViewport scroll
      (window as any).scrollY = 0;
      await act(async () => {
        vvListeners.scroll.forEach((fn) => fn(new Event('scroll')));
        await new Promise((r) => setTimeout(r, 25));
      });
      expect(header.getAttribute('data-scrolled')).toBe('false');

      // Contenedor horizontal (.v2-nav con overflow-y: hidden) NO debe activar estado scrolled
      const horizNav = container.querySelector('[data-testid="horiz-nav"]') as HTMLElement;
      horizNav.style.overflowY = 'hidden';
      Object.defineProperty(horizNav, 'scrollTop', { value: 30, writable: true, configurable: true });
      Object.defineProperty(horizNav, 'scrollHeight', { value: 44, configurable: true });
      Object.defineProperty(horizNav, 'clientHeight', { value: 44, configurable: true });
      fireEvent.scroll(horizNav);
      await act(async () => {
        await new Promise((r) => setTimeout(r, 25));
      });
      expect(header.getAttribute('data-scrolled')).toBe('false');

      // Regresa por pageshow (bfcache / navegación)
      (window as any).scrollY = 64;
      await act(async () => {
        fireEvent(window, new Event('pageshow'));
        await new Promise((r) => setTimeout(r, 25));
      });
      expect(header.getAttribute('data-scrolled')).toBe('true');

      unmount();
      expect(vvListeners.resize.size).toBe(0);
      expect(vvListeners.scroll.size).toBe(0);
    } finally {
      Object.defineProperty(window, 'visualViewport', { value: origVV, configurable: true });
    }
  });

  it('3. V2Layout reinicia el scroll en recarga (/admin-liquid) para evitar stepper oculto tras reload y restaura scrollRestoration al desmontar', async () => {
    (window as any).scrollY = 72;
    (document.documentElement as any).scrollTop = 72;
    const origScrollRestoration = window.history.scrollRestoration;
    Object.defineProperty(window.history, 'scrollRestoration', {
      value: 'auto',
      writable: true,
      configurable: true,
    });
    const perfSpy = vi.spyOn(window.performance, 'getEntriesByType').mockReturnValue([
      { type: 'reload' } as any,
    ]);

    try {
      const { unmount } = render(
        <KaniProvider>
          <V2Layout basePath="/admin-liquid" liquidGlass />
        </KaniProvider>,
      );

      await waitFor(() => {
        expect(window.scrollTo).toHaveBeenCalledWith({ top: 0, left: 0, behavior: 'instant' });
        expect(window.scrollY).toBe(0);
      });
      expect(window.history.scrollRestoration).toBe('manual');

      unmount();
      expect(window.history.scrollRestoration).toBe('auto');
    } finally {
      perfSpy.mockRestore();
      Object.defineProperty(window.history, 'scrollRestoration', {
        value: origScrollRestoration,
        writable: true,
        configurable: true,
      });
    }
  });
});
