import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const state = vi.hoisted(() => ({
  role: 'ADMIN' as 'ADMIN' | 'MANAGER' | 'BARBER',
  path: '/panel-administracion/inicio',
  menuOpen: true,
  memberships: [] as any[],
}));

vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children, ...props }: any) => <a href={to} {...props}>{children}</a>,
  Outlet: () => <div data-testid="private-child">Contenido de sección</div>,
  useLocation: () => state.path,
  useRouterState: () => state.path,
  useNavigate: () => vi.fn(),
}));

vi.mock('@/lib/kani-auth', () => ({
  clearStaffCache: vi.fn(),
  signOut: vi.fn().mockResolvedValue(undefined),
  getAuthenticatedStaff: async () => ({
    user: { id: 'verified-id' },
    profile: {
      role: state.role,
      active: true,
      display_name: 'Test Staff',
      barber_id: state.role === 'BARBER' ? 'barber-1' : null,
    },
    barbers: [],
  }),
}));

vi.mock('@/lib/kani-admin-context', () => ({
  AdminStaffProvider: ({ children }: any) => children,
  useAdminStaff: () => ({
    profile: {
      role: state.role,
      active: true,
      display_name: 'Test Staff',
      barber_id: state.role === 'BARBER' ? 'barber-1' : null,
    },
    barbers: [],
    refreshCount: 0,
    setIsRefreshing: vi.fn(),
  }),
}));

vi.mock('@/components/kani/store', () => ({
  useKani: () => ({
    mobileMenuOpen: state.menuOpen,
    setMobileMenuOpen: vi.fn(),
  }),
}));

vi.mock('@/components/kani/v2/data', () => ({
  V2DataProvider: ({ children }: any) => children,
  useV2: () => ({
    loading: false,
    error: '',
    refresh: vi.fn(),
    services: [
      { id: 'service-corte', name: 'Corte', price_ars: 25000, duration_minutes: 45 },
    ],
    clients: [
      { id: 'client-1', name: 'Carlos Gardel', phone: '1122334455' },
    ],
    appointments: [],
    payments: [],
    starts: [],
    memberships: state.memberships,
    barberId: 'ALL',
    setBarberId: vi.fn(),
    setClients: vi.fn(),
  }),
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    supabaseUrl: 'https://iockpxtkflyjfagkvgnr.supabase.co',
    auth: {
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: vi.fn() } } }),
    },
    from: () => ({
      select: () => ({
        order: () => Promise.resolve({ data: [], error: null }),
        eq: () => ({
          order: () => Promise.resolve({ data: [], error: null }),
        }),
      }),
    }),
  },
}));

import { V2Layout } from '@/components/kani/v2/layout';
import { SiteHeader } from '@/components/kani/site-header';
import { mayAccessStaffSection } from '@/lib/kani-permissions';
import { V2MembershipsAndDiscounts } from '@/components/kani/v2/memberships-discounts';

describe('KANI — Regresión de navegación en panel original y hamburguesa', () => {
  const rootDir = path.resolve(__dirname, '..');

  it('1. La barra de navegación de /panel-administracion/* contiene exactamente 6 enlaces más Actualizar', async () => {
    state.role = 'ADMIN';
    state.path = '/panel-administracion/inicio';
    const { container } = render(<V2Layout />);
    await screen.findByTestId('private-child');

    const nav = container.querySelector('nav.admin-section-nav');
    expect(nav).not.toBeNull();

    const links = nav!.querySelectorAll('.admin-section-nav-link');
    expect(links).toHaveLength(6);

    const expectedSections = ['Inicio', 'Turnos', 'Horarios', 'Pagos', 'Clientes', 'Datos'];
    links.forEach((link, idx) => {
      expect(link.textContent).toContain(expectedSections[idx]);
    });

    // Botón actualizar presente
    const refreshBtn = nav!.querySelector('.admin-section-nav-refresh-btn');
    expect(refreshBtn).not.toBeNull();
  });

  it('2. «Descuentos» está absolutamente ausente de la barra de navegación de /panel-administracion/*', async () => {
    state.role = 'ADMIN';
    state.path = '/panel-administracion/inicio';
    const { container } = render(<V2Layout />);
    await screen.findByTestId('private-child');

    const nav = container.querySelector('nav.admin-section-nav');
    const links = nav!.querySelectorAll('.admin-section-nav-link');
    const linkTexts = Array.from(links).map((l) => l.textContent?.trim());

    expect(linkTexts).not.toContain('Descuentos');
    expect(linkTexts).not.toContain('Negocio');
    expect(linkTexts).not.toContain('Operación');
  });

  it('3. CSS garantiza layout de una sola fila con 6 columnas en desktop y mobile', () => {
    const v2Css = fs.readFileSync(path.join(rootDir, 'components', 'kani', 'v2', 'v2.css'), 'utf8');

    // 6 columnas fijas en la barra
    expect(v2Css).toContain('grid-template-columns: repeat(6, minmax(0, 1fr));');

    // Comportamiento responsive en mobile de 50px de altura y columna
    expect(v2Css).toMatch(/\.v2-nav \.admin-section-nav-link\s*\{[^}]*flex-direction:\s*column;/);
  });

  it('4. Menú desplegable (hamburguesa) recupera «Membresías y descuentos» para ADMIN, MANAGER y BARBER', async () => {
    state.role = 'ADMIN';
    state.menuOpen = true;
    const { unmount } = render(<SiteHeader />);
    await screen.findByText('Panel de administración');

    const linkAdmin = screen.getByRole('link', { name: 'Membresías y descuentos' });
    expect(linkAdmin).toBeInTheDocument();
    expect(linkAdmin).toHaveAttribute('href', '/panel-administracion/membresias');
    expect(screen.queryByRole('link', { name: /^Descuentos$/ })).toBeNull();
    unmount();

    state.role = 'MANAGER';
    const resManager = render(<SiteHeader />);
    await screen.findByText('Panel de administración');
    const linkManager = screen.getByRole('link', { name: 'Membresías y descuentos' });
    expect(linkManager).toBeInTheDocument();
    expect(linkManager).toHaveAttribute('href', '/panel-administracion/membresias');
    resManager.unmount();

    state.role = 'BARBER';
    render(<SiteHeader />);
    await screen.findByText('Panel de administración');
    const linkBarber = screen.getByRole('link', { name: 'Membresías y descuentos' });
    expect(linkBarber).toBeInTheDocument();
    expect(linkBarber).toHaveAttribute('href', '/panel-administracion/membresias');
  });

  it('5. mayAccessStaffSection autoriza «membresias» para todos los roles y restringe «descuentos» a operadores', () => {
    const admin = { role: 'ADMIN', barber_id: null, active: true };
    const manager = { role: 'MANAGER', barber_id: null, active: true };
    const barber = { role: 'BARBER', barber_id: 'barber-1', active: true };

    expect(mayAccessStaffSection(admin, 'membresias')).toBe(true);
    expect(mayAccessStaffSection(manager, 'membresias')).toBe(true);
    expect(mayAccessStaffSection(barber, 'membresias')).toBe(true);

    expect(mayAccessStaffSection(admin, 'descuentos')).toBe(true);
    expect(mayAccessStaffSection(manager, 'descuentos')).toBe(true);
    expect(mayAccessStaffSection(barber, 'descuentos')).toBe(false);
  });

  it('6. Componente unificado V2MembershipsAndDiscounts renderiza pestañas Membresías y Descuentos con KPIs y creación', async () => {
    state.role = 'ADMIN';
    const { unmount } = render(<V2MembershipsAndDiscounts initialTab="MEMBRESIAS" />);

    expect(await screen.findByText('Membresías y descuentos')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Membresías' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Descuentos' })).toBeInTheDocument();
    expect(screen.getByText('Membresías activas')).toBeInTheDocument();
    expect(screen.getByText('Sesiones restantes')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Nueva membresía/i })).toBeInTheDocument();
    unmount();
  });

  it('7. Componente unificado restringe la pestaña Descuentos para BARBER', async () => {
    state.role = 'BARBER';
    render(<V2MembershipsAndDiscounts initialTab="DESCUENTOS" />);

    // Si un barbero intenta ingresar con initialTab="DESCUENTOS", el componente lo fuerza a "MEMBRESIAS"
    expect(await screen.findByText('Membresías y descuentos')).toBeInTheDocument();
    expect(screen.getByText('Membresías activas')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Membresías' })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Descuentos' })).toBeNull();
  });

  it('8. Recupera y visualiza la membresía preexistente de «Membresia Prueba» (4 servicios, 1 consumida, 3 restantes)', async () => {
    state.role = 'ADMIN';
    state.memberships = [
      {
        id: 'mem-test-prueba-1',
        clientId: 'client-prueba-1',
        clientName: 'Membresia Prueba',
        clientPhone: '+5491122334455',
        clientEmail: 'prueba@kanibarber.com',
        barberId: null,
        barberName: 'Todo Kani',
        planName: 'Membresía 4 servicios',
        packageSize: 4,
        discountPercent: 10,
        subtotalArs: 100000,
        discountAmountArs: 10000,
        totalPriceArs: 90000,
        totalSessions: 4,
        consumedSessions: 1,
        remainingSessions: 3,
        status: 'ACTIVE',
        paymentMethod: 'Transferencia',
        paymentId: 'pay-1',
        paidAt: '2026-11-01T12:00:00Z',
        expiresAt: null,
        notes: 'Membresía de prueba inicial',
        items: [
          {
            id: 'item-1',
            membershipId: 'mem-test-prueba-1',
            serviceId: 'service-corte',
            serviceName: 'Corte',
            unitPriceSnapshotArs: 25000,
            totalQuantity: 4,
            consumedQuantity: 1,
            remainingQuantity: 3,
          },
        ],
        consumptions: [
          {
            id: 'con-1',
            membershipId: 'mem-test-prueba-1',
            itemId: 'item-1',
            clientId: 'client-prueba-1',
            appointmentId: null,
            barberId: null,
            serviceId: 'service-corte',
            serviceName: 'Corte',
            consumptionType: 'SERVICE_COMPLETED',
            status: 'CONSUMED',
            consumedAt: '2026-11-05T14:00:00Z',
            notes: 'Consumo de prueba inicial',
          },
        ],
        events: [],
      },
    ];

    const { unmount } = render(<V2MembershipsAndDiscounts initialTab="MEMBRESIAS" />);

    expect(await screen.findByText('Membresia Prueba')).toBeInTheDocument();
    expect(screen.getByText('3 de 4')).toBeInTheDocument();
    expect(screen.getAllByText('Activa').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('Corte: 3/4')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Registrar consumo/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Detalle e historial/i })).toBeInTheDocument();

    unmount();
  });
});
