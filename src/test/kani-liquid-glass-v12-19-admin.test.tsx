import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import path from 'node:path';

let mockPathname = '/admin-liquid/turnos';

vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children, onClick, activeProps, ...props }: any) => (
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

vi.mock('@/components/kani/v2/data', () => ({
  V2DataProvider: ({ children }: any) => <>{children}</>,
  useV2: () => ({ loading: false, error: '', refresh: vi.fn() }),
}));

vi.mock('@/components/kani/admin-activity-popover', () => ({
  AdminActivityPopover: ({ role }: { role: string }) => (
    <button type="button" data-testid="admin-notification-bell" data-role={role}>
      Notificaciones
    </button>
  ),
}));

import { KaniProvider } from '@/components/kani/store';
import { SiteHeader } from '@/components/kani/site-header';
import { V2Layout } from '@/components/kani/v2/layout';

describe('Liquid Glass V12.19 — Admin Visual Transformation & Isolation', () => {
  beforeEach(() => {
    document.body.className = '';
    delete document.body.dataset.lgAdmin;
    delete document.body.dataset.adminInternal;
  });

  it('elimina el botón Actualizar y renderiza la cápsula deslizante en /admin-liquid', async () => {
    mockPathname = '/admin-liquid/turnos';
    const { container, unmount } = render(<V2Layout basePath="/admin-liquid" liquidGlass />);

    await waitFor(() => {
      expect(screen.getByTestId('v2-outlet')).toBeTruthy();
    });

    expect(document.body.dataset.lgAdmin).toBe('true');
    expect(container.querySelector('.lg-admin-shell[data-lg-admin="true"]')).not.toBeNull();
    expect(container.querySelector('.admin-section-nav-refresh-btn')).toBeNull();
    expect(container.querySelector('.admin-section-nav-divider')).toBeNull();
    expect(container.querySelector('.lg-admin-nav-pill')).not.toBeNull();

    unmount();
    expect(document.body.dataset.lgAdmin).toBeUndefined();
  });

  it('preserva el botón Actualizar y no activa data-lg-admin en /panel-administracion', async () => {
    mockPathname = '/panel-administracion/turnos';
    const { container } = render(<V2Layout />);

    await waitFor(() => {
      expect(screen.getByTestId('v2-outlet')).toBeTruthy();
    });

    expect(document.body.dataset.lgAdmin).toBeUndefined();
    expect(container.querySelector('.lg-admin-shell')).toBeNull();
    expect(container.querySelector('.admin-section-nav-refresh-btn')).not.toBeNull();
    expect(container.querySelector('.admin-section-nav-divider')).not.toBeNull();
    expect(container.querySelector('.lg-admin-nav-pill')).toBeNull();
  });

  it('conserva la campanita de notificaciones en el header de /admin-liquid y la oculta en /reservar-turno-liquid', async () => {
    mockPathname = '/admin-liquid/turnos';
    const { unmount } = render(
      <KaniProvider>
        <SiteHeader />
      </KaniProvider>,
    );

    const bell = await screen.findByTestId('admin-notification-bell');
    expect(bell.getAttribute('data-role')).toBe('ADMIN');
    unmount();

    mockPathname = '/reservar-turno-liquid';
    render(
      <KaniProvider>
        <SiteHeader />
      </KaniProvider>,
    );

    await waitFor(() => {
      expect(screen.queryByTestId('admin-notification-bell')).toBeNull();
    });
  });

  it('aisla los estilos de V12.19 bajo body[data-lg-admin="true"] con soporte Light/Dark, estados no solo por color y reduced-motion', () => {
    const cssPath = path.resolve(
      process.cwd(),
      'src/components/kani/experimental/liquid-glass-admin.css',
    );
    const css = readFileSync(cssPath, 'utf8');

    expect(css).toContain('html[data-theme="light"] body[data-lg-admin="true"]');
    expect(css).toContain('html[data-theme="dark"] body[data-lg-admin="true"]');
    expect(css).toContain('backdrop-filter');
    expect(css).toContain('-webkit-backdrop-filter');
    expect(css).toContain('.v2-status-confirmed::before');
    expect(css).toContain('.v2-status-pending::before');
    expect(css).toContain('.v2-status-cancelled::before');
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
  });
});
