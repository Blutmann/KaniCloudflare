import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import type { ReactNode } from 'react';

const {
  mockStaffState,
  mockReadOnlyFn,
  mockRpc,
  mockGetSession,
} = vi.hoisted(() => ({
  mockStaffState: {
    role: 'BARBER',
    barber_id: 'lautaro',
    display_name: 'Lautaro',
    active: true,
    path: '/panel-administracion/turnos',
  },
  mockReadOnlyFn: vi.fn(),
  mockRpc: vi.fn(),
  mockGetSession: vi.fn(),
}));

vi.mock('@/lib/kani-admin-context', () => ({
  useAdminStaff: () => ({
    profile: {
      user_id: 'u-1',
      role: mockStaffState.role,
      barber_id: mockStaffState.barber_id,
      display_name: mockStaffState.display_name,
      active: mockStaffState.active,
    },
    barbers: [{ id: 'lautaro', name: 'Lautaro' }],
  }),
  AdminStaffProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock('@/lib/kani-benefit-codes.functions', () => ({
  staffListBenefitCodesReadOnlyFn: mockReadOnlyFn,
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    supabaseUrl: 'https://iockpxtkflyjfagkvgnr.supabase.co',
    auth: {
      getSession: mockGetSession,
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: vi.fn() } } }),
    },
    rpc: mockRpc,
  },
}));

vi.mock('@/lib/kani-auth', () => ({
  clearStaffCache: vi.fn(),
  getAuthenticatedStaff: vi.fn(async () => ({
    user: { id: 'u-1', email: 'lautaro@kani.ar' },
    profile: {
      user_id: 'u-1',
      role: mockStaffState.role,
      barber_id: mockStaffState.barber_id,
      display_name: mockStaffState.display_name,
      active: mockStaffState.active,
      is_active: true,
    },
    barbers: [{ id: 'lautaro', name: 'Lautaro' }],
  })),
}));

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    to,
    children,
    className,
    activeOptions: _activeOptions,
    activeProps: _activeProps,
    ...rest
  }: {
    to: string;
    children: ReactNode;
    className?: string;
    activeOptions?: unknown;
    activeProps?: unknown;
    [key: string]: unknown;
  }) => (
    <a href={to} className={className} {...rest}>
      {children}
    </a>
  ),
  Outlet: () => <div data-testid="outlet" />,
  useLocation: (opts?: { select?: (loc: { pathname: string }) => unknown }) =>
    opts?.select ? opts.select({ pathname: mockStaffState.path }) : { pathname: mockStaffState.path },
}));

vi.mock('@/components/kani/v2/data', () => ({
  V2DataProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  useV2: () => ({
    loading: false,
    error: '',
    refresh: vi.fn(),
    appointments: [],
    payments: [],
    clients: [],
    memberships: [],
    barberId: 'lautaro',
    setBarberId: vi.fn(),
  }),
}));

vi.mock('@/components/kani/experimental/liquid-glass-shell', () => ({
  LiquidGlassShell: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

import { V2Layout } from '@/components/kani/v2/layout';
import { V2Discounts } from '@/components/kani/v2/discounts';

describe('Kani — Navegación y permisos BARBER', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStaffState.role = 'BARBER';
    mockStaffState.barber_id = 'lautaro';
    mockStaffState.display_name = 'Lautaro';
    mockStaffState.path = '/panel-administracion/turnos';
    mockGetSession.mockResolvedValue({ data: { session: { access_token: 'tok-barber' } } });
  });

  afterEach(() => {
    cleanup();
  });

  it('renders 7-section BARBER top navigation in exact order without empty slot for Inicio', async () => {
    render(<V2Layout basePath="/panel-administracion" liquidGlass />);

    const nav = await screen.findByRole('navigation', { name: 'Administración' });
    expect(nav.getAttribute('data-nav-count')).toBe('7');
    expect(nav.getAttribute('data-nav-scrollable')).toBe('true');

    const links = Array.from(nav.querySelectorAll('a'));
    expect(links.map((l) => l.textContent?.trim())).toEqual([
      'Turnos',
      'Horarios',
      'Pagos',
      'Clientes',
      'Datos',
      'Membresías',
      'Descuentos',
    ]);
    expect(links.map((l) => l.getAttribute('href'))).toEqual([
      '/panel-administracion/turnos',
      '/panel-administracion/horarios',
      '/panel-administracion/pagos',
      '/panel-administracion/clientes',
      '/panel-administracion/datos',
      '/panel-membresias',
      '/panel-descuentos',
    ]);
    expect(nav.textContent).not.toContain('Inicio');
  });

  it('keeps unified 7-section BARBER navigation even on Membresías and Descuentos routes', async () => {
    mockStaffState.path = '/panel-descuentos';
    render(<V2Layout basePath="/panel-administracion" liquidGlass forcedSectionSlug="descuentos" />);

    const nav = await screen.findByRole('navigation', { name: 'Administración' });
    const links = Array.from(nav.querySelectorAll('a'));
    expect(links.map((l) => l.textContent?.trim())).toEqual([
      'Turnos',
      'Horarios',
      'Pagos',
      'Clientes',
      'Datos',
      'Membresías',
      'Descuentos',
    ]);
  });

  it('allows BARBER read-only access to V2Discounts, distinguishes total uses vs unique clients, and excludes CANCELLED', async () => {
    mockReadOnlyFn.mockResolvedValue([
      {
        id: 'c-1',
        code: 'KANI10',
        type: 'PERCENT_10',
        status: 'ACTIVE',
        validUntil: '2026-12-31',
        usages: [
          {
            appointmentId: 'a-1',
            clientId: 'cli-1',
            clientName: 'Marcos Díaz',
            bookingDate: '2026-11-10',
            barberName: 'Lautaro',
            appointmentStatus: 'CONFIRMED',
            isAppointmentCancelled: false,
          },
          {
            appointmentId: 'a-2',
            clientId: 'cli-1',
            clientName: 'Marcos Díaz',
            bookingDate: '2026-11-12',
            barberName: 'Tomás',
            appointmentStatus: 'CONFIRMED',
            isAppointmentCancelled: false,
          },
          {
            appointmentId: 'a-3',
            clientId: 'cli-2',
            clientName: 'Cancelado Test',
            bookingDate: '2026-11-13',
            barberName: 'Lautaro',
            appointmentStatus: 'CANCELLED',
            isAppointmentCancelled: true,
          },
        ],
      },
      {
        id: 'c-2',
        code: 'KANI50',
        type: 'PERCENT_50',
        status: 'DISABLED',
        timesUsed: 0,
        usages: [],
      },
    ]);

    render(<V2Discounts />);

    await waitFor(() => {
      expect(screen.getByText('KANI10')).toBeTruthy();
      expect(screen.getByText('KANI50')).toBeTruthy();
    });

    expect(screen.getByText('Activo')).toBeTruthy();
    expect(screen.getByText('Inactivo')).toBeTruthy();
    expect(screen.getByText('10% de descuento')).toBeTruthy();
    expect(screen.getByText('50% de descuento')).toBeTruthy();
    expect(screen.getByText('Hasta 31/12/2026')).toBeTruthy();

    // Same client used KANI10 twice (cancelled one excluded): 2 utilizaciones, 1 cliente
    expect(screen.getByText('2 utilizaciones')).toBeTruthy();
    expect(screen.getByText('1 cliente')).toBeTruthy();
    expect(screen.queryByText('Cancelado Test')).toBeNull();

    // Usage history includes client, date, and barber
    expect(screen.getByText(/10\/11\/2026/)).toBeTruthy();
    expect(screen.getByText(/Barbero: Lautaro/)).toBeTruthy();
    expect(screen.getByText(/Barbero: Tomás/)).toBeTruthy();

    // Strictly read-only: no create/edit/delete/toggle buttons
    expect(screen.queryByRole('button', { name: /Crear|Editar|Eliminar|Desactivar|Activar/i })).toBeNull();
  });

  it('renders standalone /panel-descuentos as read-only for BARBER and MANAGER without breaking ADMIN', async () => {
    const { V2MembershipsAndDiscounts } = await import('@/components/kani/v2/memberships-discounts');
    mockReadOnlyFn.mockResolvedValue([
      { id: 'c-1', code: 'BARBER10', type: 'PERCENT_10', status: 'ACTIVE', timesUsed: 0, usages: [] },
    ]);

    mockStaffState.role = 'BARBER';
    const { unmount } = render(
      <V2MembershipsAndDiscounts initialTab="DESCUENTOS" standaloneTab="DESCUENTOS" />,
    );
    await waitFor(() => {
      expect(screen.getByText('BARBER10')).toBeTruthy();
    });
    expect(screen.queryByText('Membresías activas')).toBeNull();
    unmount();

    mockStaffState.role = 'MANAGER';
    const mgrRender = render(
      <V2MembershipsAndDiscounts initialTab="DESCUENTOS" standaloneTab="DESCUENTOS" />,
    );
    await waitFor(() => {
      expect(screen.getByText('BARBER10')).toBeTruthy();
    });
    mgrRender.unmount();
  });

  it('never exposes raw OPERATOR_REQUIRED error to BARBER and recovers via Reintentar button', async () => {
    const { fireEvent } = await import('@testing-library/react');
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockReadOnlyFn.mockRejectedValueOnce(new Error('OPERATOR_REQUIRED'));
    mockReadOnlyFn.mockResolvedValueOnce([
      { id: 'c-1', code: 'RECUPERADO', type: 'PERCENT_10', status: 'ACTIVE', timesUsed: 0, usages: [] },
    ]);

    render(<V2Discounts />);

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).not.toContain('OPERATOR_REQUIRED');
    expect(alert.textContent).toContain('No pudimos cargar los códigos de descuento');
    expect(mockRpc).not.toHaveBeenCalled();

    const retryBtn = screen.getByRole('button', { name: 'Reintentar' });
    fireEvent.click(retryBtn);

    await waitFor(() => {
      expect(screen.getByText('RECUPERADO')).toBeTruthy();
    });
    expect(screen.queryByRole('alert')).toBeNull();
    errSpy.mockRestore();
  });
});
