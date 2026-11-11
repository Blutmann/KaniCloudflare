import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const state = vi.hoisted(() => ({
  role: 'ADMIN' as 'ADMIN' | 'MANAGER' | 'BARBER',
  path: '/panel-administracion/inicio',
  menuOpen: true,
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
  useV2: () => ({ loading: false, error: '', refresh: vi.fn() }),
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    supabaseUrl: 'https://iockpxtkflyjfagkvgnr.supabase.co',
    auth: {
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: vi.fn() } } }),
    },
  },
}));

import { V2Layout } from '@/components/kani/v2/layout';
import { SiteHeader } from '@/components/kani/site-header';

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

  it('4. Menú desplegable (hamburguesa) muestra «Descuentos» para ADMIN y MANAGER', async () => {
    state.role = 'ADMIN';
    state.menuOpen = true;
    const { unmount } = render(<SiteHeader />);
    await screen.findByText('Panel de administración');

    const discountLink = screen.getByRole('link', { name: 'Descuentos' });
    expect(discountLink).toBeInTheDocument();
    expect(discountLink).toHaveAttribute('href', '/panel-administracion/descuentos');
    unmount();

    state.role = 'MANAGER';
    render(<SiteHeader />);
    await screen.findByText('Panel de administración');
    expect(screen.getByRole('link', { name: 'Descuentos' })).toBeInTheDocument();
  });

  it('5. Menú desplegable (hamburguesa) NO muestra «Descuentos» para BARBER', async () => {
    state.role = 'BARBER';
    state.menuOpen = true;
    render(<SiteHeader />);
    await screen.findByText('Panel de administración');

    expect(screen.queryByRole('link', { name: 'Descuentos' })).toBeNull();
  });
});
