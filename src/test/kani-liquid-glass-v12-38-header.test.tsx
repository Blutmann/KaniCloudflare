// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import fs from 'node:fs';
import path from 'node:path';

let mockPathname = '/reservar-turno-liquid';

vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children, onClick, activeProps: _ap, ...props }: any) => (
    <a href={typeof to === 'string' ? to : '#'} onClick={onClick} {...props}>
      {children}
    </a>
  ),
  useNavigate: () => vi.fn(),
  useRouterState: ({ select }: any) => select({ location: { pathname: mockPathname } }),
  useLocation: ({ select }: any) => select({ pathname: mockPathname }),
}));

vi.mock('@/lib/kani-auth', () => ({
  getAuthenticatedStaff: vi.fn().mockResolvedValue(null),
  clearStaffCache: vi.fn(),
  signOut: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    auth: {
      onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
    },
  },
}));

import { KaniProvider } from '@/components/kani/store';
import { SiteHeader } from '@/components/kani/site-header';

async function flushAnimationFrame() {
  await act(async () => {
    await new Promise((resolve) => window.setTimeout(resolve, 30));
  });
}

describe('Liquid Glass V12.38 — Header adaptativo (transparente en reposo / cristal esmerilado con scroll)', () => {
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
    mockPathname = '/reservar-turno-liquid';
    Object.defineProperty(window, 'scrollY', { value: 0, writable: true, configurable: true });
    Object.defineProperty(window, 'pageYOffset', { value: 0, writable: true, configurable: true });
    Object.defineProperty(document.documentElement, 'scrollTop', { value: 0, writable: true, configurable: true });
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
    document.body.removeAttribute('style');
  });

  it('1. Inicia transparente en todas las rutas Liquid Glass cuando el desplazamiento está en reposo', async () => {
    const liquidRoutes = [
      '/reservar',
      '/panel-administracion/inicio',
      '/panel-membresias',
      '/contacto',
      '/politica-de-privacidad',
      '/terminos-y-condiciones',
    ];

    for (const route of liquidRoutes) {
      mockPathname = route;
      const { container, unmount } = render(
        <KaniProvider>
          <div className="site-shell">
            <SiteHeader />
          </div>
        </KaniProvider>,
      );

      await flushAnimationFrame();
      const header = container.querySelector('header.site-header')!;
      expect(header.classList.contains('liquid-glass-header')).toBe(true);
      expect(header.classList.contains('liquid-glass-header--scrolled')).toBe(false);
      expect(header.getAttribute('data-scrolled')).toBe('false');
      unmount();
    }
  });

  it('2. Detecta scroll del documento, respeta umbral/rebote negativo en iOS y vuelve a transparente al regresar arriba', async () => {
    mockPathname = '/terminos-y-condiciones-liquid';
    const { container } = render(
      <KaniProvider>
        <div className="site-shell">
          <SiteHeader />
        </div>
      </KaniProvider>,
    );

    const header = container.querySelector('header.site-header')!;

    // Rebote iOS negativo o micro-desplazamiento debajo del umbral no activa cristal
    (window as any).scrollY = -12;
    fireEvent.scroll(window);
    await flushAnimationFrame();
    expect(header.getAttribute('data-scrolled')).toBe('false');

    (window as any).scrollY = 4;
    fireEvent.scroll(window);
    await flushAnimationFrame();
    expect(header.getAttribute('data-scrolled')).toBe('false');

    // Scroll efectivo activa header esmerilado
    (window as any).scrollY = 48;
    fireEvent.scroll(window);
    await waitFor(() => {
      expect(header.classList.contains('liquid-glass-header--scrolled')).toBe(true);
      expect(header.getAttribute('data-scrolled')).toBe('true');
    });

    // Regresar al principio restaura estado transparente
    (window as any).scrollY = 0;
    fireEvent.scroll(window);
    await waitFor(() => {
      expect(header.classList.contains('liquid-glass-header--scrolled')).toBe(false);
      expect(header.getAttribute('data-scrolled')).toBe('false');
    });
  });

  it('3. Detecta contenedores internos con overflow (ej. .booking-scroll-content en mobile /reservar-turno-liquid) sin Window scroll', async () => {
    mockPathname = '/reservar-turno-liquid';
    const { container } = render(
      <KaniProvider>
        <div className="site-shell">
          <SiteHeader />
          <div className="liquid-glass-reservation">
            <div className="booking-scroll-content" data-testid="booking-scroll" />
          </div>
        </div>
      </KaniProvider>,
    );

    const header = container.querySelector('header.site-header')!;
    const scrollBox = container.querySelector('[data-testid="booking-scroll"]') as HTMLElement;
    Object.defineProperty(scrollBox, 'scrollTop', { value: 64, writable: true, configurable: true });

    fireEvent.scroll(scrollBox);
    await waitFor(() => {
      expect(header.classList.contains('liquid-glass-header--scrolled')).toBe(true);
      expect(header.getAttribute('data-scrolled')).toBe('true');
    });

    (scrollBox as any).scrollTop = 0;
    fireEvent.scroll(scrollBox);
    await waitFor(() => {
      expect(header.classList.contains('liquid-glass-header--scrolled')).toBe(false);
    });
  });

  it('4. Ignora scroll dentro de notificaciones/diálogos, mantiene menú abierto sin barra y no altera rutas tradicionales', async () => {
    mockPathname = '/admin-liquid/inicio';
    const { container, rerender } = render(
      <KaniProvider>
        <div className="site-shell">
          <SiteHeader />
          <div className="notification-popover">
            <div className="notification-list" data-testid="notif-scroll" />
          </div>
        </div>
      </KaniProvider>,
    );

    const header = container.querySelector('header.site-header')!;
    const notifScroll = container.querySelector('[data-testid="notif-scroll"]') as HTMLElement;
    Object.defineProperty(notifScroll, 'scrollTop', { value: 90, writable: true, configurable: true });

    fireEvent.scroll(notifScroll);
    await flushAnimationFrame();
    expect(header.getAttribute('data-scrolled')).toBe('false');

    // Al abrir menú incluso estando scrolleado, mantiene .site-header transparente (sin --scrolled)
    (window as any).scrollY = 80;
    fireEvent.scroll(window);
    await waitFor(() => expect(header.getAttribute('data-scrolled')).toBe('true'));

    const menuTrigger = container.querySelector('.mobile-menu-trigger') as HTMLButtonElement;
    fireEvent.click(menuTrigger);
    await waitFor(() => {
      expect(header.classList.contains('menu-open')).toBe(true);
      expect(header.classList.contains('liquid-glass-header--scrolled')).toBe(false);
    });

    // Ruta tradicional (-old) sin clase ni listeners Liquid Glass
    mockPathname = '/reservar-turno-old';
    rerender(
      <KaniProvider>
        <div className="site-shell">
          <SiteHeader />
        </div>
      </KaniProvider>,
    );
    await flushAnimationFrame();
    const tradHeader = container.querySelector('header.site-header')!;
    expect(tradHeader.classList.contains('liquid-glass-header')).toBe(false);
    expect(tradHeader.getAttribute('data-scrolled')).toBeNull();
  });

  it('5. Especificación CSS V12.38: reposo transparente, transición suave Light (perla) / Dark (obsidiana), fallback y accesibilidad', () => {
    const v1238Idx = liquidCss.indexOf('LIQUID GLASS V12.38');
    expect(v1238Idx).toBeGreaterThan(-1);
    const section = liquidCss.slice(v1238Idx);

    expect(section).toContain('backdrop-filter: none !important;');
    expect(section).toContain('transition: opacity 220ms cubic-bezier(0.22, 1, 0.36, 1);');
    expect(section).toContain('.liquid-glass-header--scrolled:not(.menu-open)::before');
    expect(section).toContain('rgba(255, 255, 255, 0.56)');
    expect(section).toContain('rgba(8, 8, 12, 0.72)');
    expect(section).toContain('@supports not (backdrop-filter: blur(1px))');
    expect(section).toContain('prefers-reduced-transparency: reduce');
    expect(section).toContain('prefers-reduced-motion: reduce');
    expect(adminCss).toContain('.site-header.liquid-glass-header:not(.liquid-glass-header--scrolled)');
  });
});
