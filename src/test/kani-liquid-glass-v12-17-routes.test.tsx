import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

let mockPathname = '/reservar-turno-liquid';
const mockNavigate = vi.fn();

vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children, onClick, ...props }: any) => (
    <a href={typeof to === 'string' ? to : '#'} onClick={onClick} {...props}>
      {children}
    </a>
  ),
  Outlet: () => <div data-testid="mock-outlet" />,
  useNavigate: () => mockNavigate,
  useRouterState: ({ select }: any) => select({ location: { pathname: mockPathname } }),
  useLocation: ({ select }: any) => select({ pathname: mockPathname }),
  createFileRoute: () => () => ({}),
}));

vi.mock('@/lib/kani-auth', () => ({
  getAuthenticatedStaff: vi.fn().mockResolvedValue(null),
  clearStaffCache: vi.fn(),
  signOut: vi.fn().mockResolvedValue(undefined),
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

vi.mock('@/components/kani/admin-access', () => ({
  AdminAccess: () => <div data-testid="admin-access-gate">Acceso restringido</div>,
}));

import { KaniProvider } from '@/components/kani/store';
import { SiteHeader, MobileMenuAction } from '@/components/kani/site-header';
import { isLiquidGlassPath } from '@/components/kani/experimental/liquid-glass-shell';
import { V2Layout } from '@/components/kani/v2/layout';
import { PanelV2Layout } from '@/components/kani/v2-experimental/PanelV2Layout';

describe('Liquid Glass V12.17 — Parallel Routes & Menu Isolation', () => {
  beforeEach(() => {
    mockNavigate.mockReset();
    document.body.className = '';
  });

  it('identifica correctamente rutas Liquid Glass vs rutas tradicionales', () => {
    expect(isLiquidGlassPath('/reservar-turno-liquid')).toBe(true);
    expect(isLiquidGlassPath('/contacto-liquid')).toBe(true);
    expect(isLiquidGlassPath('/admin-liquid')).toBe(true);
    expect(isLiquidGlassPath('/admin-liquid/turnos')).toBe(true);
    expect(isLiquidGlassPath('/admin-v2-liquid')).toBe(true);
    expect(isLiquidGlassPath('/admin-v2-liquid/operacion/turnos')).toBe(true);
    expect(isLiquidGlassPath('/politica-de-privacidad-liquid')).toBe(true);
    expect(isLiquidGlassPath('/terminos-y-condiciones-liquid')).toBe(true);

    expect(isLiquidGlassPath('/')).toBe(false);
    expect(isLiquidGlassPath('/reservar-turno')).toBe(false);
    expect(isLiquidGlassPath('/contacto')).toBe(false);
    expect(isLiquidGlassPath('/panel-administracion')).toBe(false);
    expect(isLiquidGlassPath('/panel-v2')).toBe(false);
    expect(isLiquidGlassPath('/politica-de-privacidad')).toBe(false);
    expect(isLiquidGlassPath('/terminos-y-condiciones')).toBe(false);
  });

  it('el menú de /reservar-turno-liquid enlaza exclusivamente a rutas Liquid Glass', () => {
    mockPathname = '/reservar-turno-liquid';
    render(
      <KaniProvider>
        <SiteHeader />
      </KaniProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Abrir menú' }));
    const nav = screen.getByRole('navigation', { name: 'Menú principal' });
    const hrefs = [...nav.querySelectorAll('a')].map((a) => a.getAttribute('href'));

    expect(hrefs).toEqual([
      '/reservar-turno-liquid',
      '/contacto-liquid',
      '/admin-liquid',
      '/admin-v2-liquid',
      '/politica-de-privacidad-liquid',
      '/terminos-y-condiciones-liquid',
    ]);

    fireEvent.click(screen.getByRole('button', { name: /Volver a la reserva/i }));
    expect(mockNavigate).not.toHaveBeenCalled();

    mockPathname = '/contacto-liquid';
    render(
      <KaniProvider>
        <MobileMenuAction />
      </KaniProvider>,
    );
    const returnButtons = screen.getAllByRole('button', { name: /Volver a la reserva/i });
    fireEvent.click(returnButtons[returnButtons.length - 1]);
    expect(mockNavigate).toHaveBeenCalledWith({ to: '/reservar-turno-liquid' });
  });

  it('el menú tradicional en /reservar-turno mantiene sus rutas originales intactas', () => {
    mockPathname = '/reservar-turno';
    render(
      <KaniProvider>
        <SiteHeader />
      </KaniProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Abrir menú' }));
    const nav = screen.getByRole('navigation', { name: 'Menú principal' });
    const hrefs = [...nav.querySelectorAll('a')].map((a) => a.getAttribute('href'));

    expect(hrefs).toEqual([
      '/reservar-turno',
      '/contacto',
      '/panel-administracion',
      '/panel-v2',
      '/politica-de-privacidad',
      '/terminos-y-condiciones',
    ]);
  });

  it('bloquea acceso sin sesión administrativa en /admin-liquid y /admin-v2-liquid', async () => {
    mockPathname = '/admin-liquid';
    const { unmount } = render(<V2Layout basePath="/admin-liquid" liquidGlass />);
    await waitFor(() => {
      expect(screen.getByTestId('admin-access-gate')).toBeTruthy();
    });
    expect(screen.queryByTestId('mock-outlet')).toBeNull();
    unmount();

    mockPathname = '/admin-v2-liquid';
    render(<PanelV2Layout basePath="/admin-v2-liquid" liquidGlass />);
    await waitFor(() => {
      expect(screen.getByTestId('admin-access-gate')).toBeTruthy();
    });
    expect(screen.queryByTestId('mock-outlet')).toBeNull();
  });
});
