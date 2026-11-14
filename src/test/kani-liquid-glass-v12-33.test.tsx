import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import fs from 'node:fs';
import path from 'node:path';

let mockPathname = '/admin-liquid/turnos';
const authListeners: Array<(event: string, session: unknown) => void> = [];

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
  profile: {
    user_id: 'admin-1',
    role: 'ADMIN' as const,
    barber_id: null,
    display_name: 'Admin Kani',
    active: true,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  },
  barbers: [
    { id: 'b1', name: 'Lautaro', active: true, created_at: '2026-01-01T00:00:00.000Z' },
  ],
}));

const mockGetAuthenticatedStaff = vi.hoisted(() => vi.fn().mockResolvedValue(mockStaff));
const mockClearStaffCache = vi.hoisted(() => vi.fn());
const mockReadAdminActivityNotifications = vi.hoisted(() => vi.fn());

vi.mock('@/lib/kani-auth', () => ({
  getAuthenticatedStaff: mockGetAuthenticatedStaff,
  clearStaffCache: mockClearStaffCache,
  signOut: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/kani-admin-activity', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/kani-admin-activity')>();
  return {
    ...actual,
    readAdminActivityNotifications: mockReadAdminActivityNotifications,
  };
});

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    supabaseUrl: 'https://example.supabase.co',
    auth: {
      onAuthStateChange: (cb: (event: string, session: unknown) => void) => {
        authListeners.push(cb);
        return { data: { subscription: { unsubscribe: vi.fn() } } };
      },
    },
  },
}));

vi.mock('@/lib/kani-v2', () => ({
  isV2AdminEnvironment: () => true,
}));

vi.mock('@/components/kani/v2/data', () => ({
  V2DataProvider: ({ children }: any) => <>{children}</>,
  useV2: () => ({
    loading: false,
    error: '',
    refresh: vi.fn(),
  }),
}));

import { KaniProvider } from '@/components/kani/store';
import { SiteHeader } from '@/components/kani/site-header';
import { V2Layout } from '@/components/kani/v2/layout';
import { AdminActivityPopover } from '@/components/kani/admin-activity-popover';

describe('Liquid Glass V12.33 — Auth Immediate Controls, Independent Notifications & Capsule Unification', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authListeners.length = 0;
    mockPathname = '/admin-liquid/turnos';
    mockGetAuthenticatedStaff.mockResolvedValue(mockStaff);
    mockReadAdminActivityNotifications.mockResolvedValue([]);
    document.body.className = '';
    delete document.body.dataset.lgAdmin;
    delete document.body.dataset.adminInternal;
  });

  afterEach(() => {
    cleanup();
  });

  it('no invalida caché en INITIAL_SESSION y renderiza controles de admin sin demora junto al dashboard', async () => {
    render(
      <KaniProvider>
        <SiteHeader />
        <V2Layout basePath="/admin-liquid" liquidGlass />
      </KaniProvider>,
    );

    // Simular evento INITIAL_SESSION inmediato de Supabase como ocurre tras montar en browser
    act(() => {
      for (const listener of authListeners) {
        listener('INITIAL_SESSION', { user: mockStaff.user });
      }
    });

    await waitFor(() => {
      expect(screen.getByTestId('v2-outlet')).toBeTruthy();
      expect(screen.getByRole('button', { name: /notificaciones/i })).toBeTruthy();
    });

    // INITIAL_SESSION no debe haber llamado clearStaffCache() ni forzado bypassCache en el montaje inicial
    expect(mockClearStaffCache).not.toHaveBeenCalled();
    expect(mockGetAuthenticatedStaff).toHaveBeenCalledWith(undefined);

    // Abrir el menú móvil y verificar que Membresías y descuentos, sesión y Cerrar sesión ya estén disponibles
    fireEvent.click(screen.getByRole('button', { name: /abrir menú/i }));
    expect(screen.getByText('Membresías y descuentos')).toBeTruthy();
    expect(screen.getByText('KANI Admin')).toBeTruthy();
    expect(screen.getByRole('button', { name: /cerrar sesión/i })).toBeTruthy();
  });

  it('sincroniza SiteHeader inmediatamente mediante kani:staff-auth-changed aunque su estado inicial fuera null', async () => {
    mockGetAuthenticatedStaff.mockResolvedValueOnce(null);

    render(
      <KaniProvider>
        <SiteHeader />
      </KaniProvider>,
    );

    await waitFor(() => {
      expect(mockGetAuthenticatedStaff).toHaveBeenCalledTimes(1);
    });
    expect(screen.queryByRole('button', { name: /notificaciones/i })).toBeNull();

    // Otro consumidor resuelve autenticación (e.g. V2Layout) y kani-auth emite evento reactivo
    act(() => {
      window.dispatchEvent(
        new CustomEvent('kani:staff-auth-changed', { detail: { staff: mockStaff } }),
      );
    });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /notificaciones/i })).toBeTruthy();
    });
  });

  it('muestra estado de carga independiente en AdminActivityPopover y reusa userId', async () => {
    let resolveNotifications!: (value: any[]) => void;
    mockReadAdminActivityNotifications.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveNotifications = resolve;
        }),
    );

    render(<AdminActivityPopover role="ADMIN" userId="admin-1" />);

    expect(mockReadAdminActivityNotifications).toHaveBeenCalledWith('admin-1');
    const bell = screen.getByRole('button', { name: /notificaciones/i });
    fireEvent.click(bell);

    // Mientras carga no debe mostrar falsamente "No hay novedades recientes."
    await waitFor(() => {
      expect(screen.getAllByText('Cargando novedades...').length).toBeGreaterThan(0);
    });
    expect(screen.queryByText('No hay novedades recientes.')).toBeNull();

    await act(async () => {
      resolveNotifications([]);
    });

    await waitFor(() => {
      expect(screen.getByText('No hay novedades recientes.')).toBeTruthy();
    });
  });

  it('unifica la altura y alineación de ambas cápsulas mobile y compacta el espaciado vertical de membresías/descuentos', () => {
    const css = fs.readFileSync(
      path.resolve(process.cwd(), 'src/components/kani/experimental/liquid-glass-admin.css'),
      'utf8',
    );

    // Ambas cápsulas mobile comparten altura fija de link (48px) => cápsula externa consistente de 58px
    expect(css).toMatch(/\.v2-navigation \.admin-section-nav-link[\s\S]*?height:\s*48px !important;/);
    expect(css).toMatch(/\.lg-memberships-nav \.admin-section-nav-link[\s\S]*?height:\s*48px !important;/);

    // Compactación de espaciado vertical exclusivamente mobile para /admin-liquid/membresias y /descuentos
    expect(css).toContain('.lg-admin-shell:has(.v2-memberships-page) .v2-navigation');
    expect(css).toContain('.v2-page.v2-memberships-page');
  });
});
