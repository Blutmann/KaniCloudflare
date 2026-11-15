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

  it('identifica correctamente rutas Liquid Glass oficiales vs rutas tradicionales -old', () => {
    expect(isLiquidGlassPath('/')).toBe(true);
    expect(isLiquidGlassPath('/reservar')).toBe(true);
    expect(isLiquidGlassPath('/contacto')).toBe(true);
    expect(isLiquidGlassPath('/panel-administracion')).toBe(true);
    expect(isLiquidGlassPath('/panel-administracion/turnos')).toBe(true);
    expect(isLiquidGlassPath('/panel-membresias')).toBe(true);
    expect(isLiquidGlassPath('/panel-descuentos')).toBe(true);
    expect(isLiquidGlassPath('/panel-turnos')).toBe(true);
    expect(isLiquidGlassPath('/panel-horarios')).toBe(true);
    expect(isLiquidGlassPath('/admin-v2-liquid')).toBe(true);
    expect(isLiquidGlassPath('/admin-v2-liquid/operacion/turnos')).toBe(true);
    expect(isLiquidGlassPath('/politica-de-privacidad')).toBe(true);
    expect(isLiquidGlassPath('/terminos-y-condiciones')).toBe(true);

    expect(isLiquidGlassPath('/reservar-turno-old')).toBe(false);
    expect(isLiquidGlassPath('/contacto-old')).toBe(false);
    expect(isLiquidGlassPath('/panel-administracion-old')).toBe(false);
    expect(isLiquidGlassPath('/panel-administracion-old/turnos')).toBe(false);
    expect(isLiquidGlassPath('/panel-v2')).toBe(false);
    expect(isLiquidGlassPath('/politica-de-privacidad-old')).toBe(false);
    expect(isLiquidGlassPath('/terminos-y-condiciones-old')).toBe(false);
    expect(isLiquidGlassPath('/reservar-turno-mercadopago')).toBe(false);
  });

  it('el menú de /reservar enlaza exclusivamente a rutas oficiales Liquid Glass', () => {
    mockPathname = '/reservar';
    render(
      <KaniProvider>
        <SiteHeader />
      </KaniProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Abrir menú' }));
    const nav = screen.getByRole('navigation', { name: 'Menú principal' });
    const hrefs = [...nav.querySelectorAll('a')].map((a) => a.getAttribute('href'));

    expect(hrefs).toEqual([
      '/reservar',
      '/contacto',
      '/panel-administracion',
      '/politica-de-privacidad',
      '/terminos-y-condiciones',
    ]);
    expect(screen.queryByRole('link', { name: /Panel V2/i })).toBeNull();

    // En /panel-administracion tampoco se muestra «Panel V2»
    mockPathname = '/panel-administracion';
    const adminHeader = render(
      <KaniProvider>
        <SiteHeader />
      </KaniProvider>,
    );
    expect(screen.queryByRole('link', { name: /Panel V2/i })).toBeNull();
    adminHeader.unmount();

    fireEvent.click(screen.getByRole('button', { name: /Volver a la reserva/i }));
    expect(mockNavigate).not.toHaveBeenCalled();

    mockPathname = '/contacto';
    render(
      <KaniProvider>
        <MobileMenuAction />
      </KaniProvider>,
    );
    const returnButtons = screen.getAllByRole('button', { name: /Volver a la reserva/i });
    fireEvent.click(returnButtons[returnButtons.length - 1]);
    expect(mockNavigate).toHaveBeenCalledWith({ to: '/reservar' });
  });

  it('el menú clásico en /reservar-turno-old mantiene sus rutas -old intactas', () => {
    mockPathname = '/reservar-turno-old';
    render(
      <KaniProvider>
        <SiteHeader />
      </KaniProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Abrir menú' }));
    const nav = screen.getByRole('navigation', { name: 'Menú principal' });
    const hrefs = [...nav.querySelectorAll('a')].map((a) => a.getAttribute('href'));

    expect(hrefs).toEqual([
      '/reservar-turno-old',
      '/contacto-old',
      '/panel-administracion-old',
      '/panel-v2',
      '/politica-de-privacidad-old',
      '/terminos-y-condiciones-old',
    ]);
  });

  it('bloquea acceso sin sesión administrativa en /panel-administracion y /panel-administracion-old', async () => {
    mockPathname = '/panel-administracion';
    const { unmount } = render(<V2Layout basePath="/panel-administracion" liquidGlass />);
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
