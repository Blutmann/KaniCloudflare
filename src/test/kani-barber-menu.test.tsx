import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import fs from 'node:fs';
import path from 'node:path';
import type { ReactNode } from 'react';

const { mockGetAuthenticatedStaff, mockSignOut, mockNavigate } = vi.hoisted(() => ({
  mockGetAuthenticatedStaff: vi.fn(),
  mockSignOut: vi.fn(),
  mockNavigate: vi.fn(),
}));

vi.mock('@/lib/kani-auth', () => ({
  getAuthenticatedStaff: mockGetAuthenticatedStaff,
  signOut: mockSignOut,
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    auth: {
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: vi.fn() } } }),
    },
  },
}));

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    to,
    children,
    onClick,
    className,
    ...rest
  }: {
    to: string;
    children: ReactNode;
    onClick?: (e: unknown) => void;
    className?: string;
    [key: string]: unknown;
  }) => (
    <a href={to} onClick={onClick} className={className} {...rest}>
      {children}
    </a>
  ),
  useNavigate: () => mockNavigate,
  useRouterState: ({ select }: { select: (s: { location: { pathname: string } }) => unknown }) =>
    select({ location: { pathname: '/reservar' } }),
}));

vi.mock('@/components/kani/store', () => ({
  useKani: () => {
    const React = require('react');
    const [mobileMenuOpen, setMobileMenuOpen] = React.useState(false);
    return {
      mobileMenuOpen,
      setMobileMenuOpen,
      theme: 'dark',
      toggleTheme: vi.fn(),
    };
  },
}));

vi.mock('@/components/kani/admin-activity-popover', () => ({
  AdminActivityPopover: () => null,
}));

import { SiteHeader } from '@/components/kani/site-header';

describe('Kani — Optimización del menú desplegable BARBER', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSignOut.mockResolvedValue({ error: null });
  });

  afterEach(() => {
    cleanup();
  });

  it('renders the exact compact BARBER menu items in order, without WhatsApp or Panel de administración', async () => {
    mockGetAuthenticatedStaff.mockResolvedValue({
      user: { id: 'b-1', email: 'lautaro@kani.ar' },
      profile: {
        user_id: 'b-1',
        display_name: 'Lautaro',
        role: 'BARBER',
        barber_id: 'lautaro',
        is_active: true,
      },
    });

    render(<SiteHeader />);

    await waitFor(() => {
      expect(mockGetAuthenticatedStaff).toHaveBeenCalled();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Abrir menú' }));

    const nav = screen.getByRole('navigation', { name: 'Menú principal' });
    expect(nav.className).toContain('mobile-menu--barber');
    expect(nav.className).toContain('mobile-menu--liquid');

    const links = Array.from(nav.querySelectorAll('a')).map((a) => a.textContent?.trim());
    expect(links).toEqual([
      'Reservar turno',
      'Contacto',
      'Turnos',
      'Horarios',
      'Pagos',
      'Clientes',
      'Datos',
      'Membresías',
      'Descuentos',
      'Política de privacidad',
      'Términos y condiciones',
    ]);

    expect(nav.textContent).not.toContain('WhatsApp');
    expect(nav.textContent).not.toContain('Panel de administración');
    expect(nav.textContent).not.toContain('Panel de mantenimiento');
    expect(nav.textContent).not.toContain('Volver a la reserva');

    const separators = nav.querySelectorAll('[role="separator"]');
    expect(separators.length).toBe(2);

    expect(nav.textContent).toContain('Lautaro');
    expect(nav.textContent).toContain('BARBER');
    const signoutBtn = screen.getByRole('button', { name: /Cerrar sesión/i });
    expect(signoutBtn).toBeTruthy();

    fireEvent.click(signoutBtn);
    await waitFor(() => {
      expect(mockSignOut).toHaveBeenCalledTimes(1);
    });
  });

  it('dynamically displays the authenticated barber name in the footer', async () => {
    mockGetAuthenticatedStaff.mockResolvedValue({
      user: { id: 'b-2', email: 'tomas@kani.ar' },
      profile: {
        user_id: 'b-2',
        display_name: 'Tomás',
        role: 'BARBER',
        barber_id: 'tomas',
        is_active: true,
      },
    });

    render(<SiteHeader />);
    await waitFor(() => expect(mockGetAuthenticatedStaff).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: 'Abrir menú' }));
    const nav = screen.getByRole('navigation', { name: 'Menú principal' });
    expect(nav.textContent).toContain('Tomás');
    expect(nav.textContent).toContain('BARBER');
  });

  it('preserves ADMIN menu structure with Panel de administración, Mantenimiento, and WhatsApp', async () => {
    mockGetAuthenticatedStaff.mockResolvedValue({
      user: { id: 'a-1', email: 'admin@kani.ar' },
      profile: {
        user_id: 'a-1',
        display_name: 'KANI Admin',
        role: 'ADMIN',
        barber_id: null,
        is_active: true,
      },
    });

    render(<SiteHeader />);
    await waitFor(() => expect(mockGetAuthenticatedStaff).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: 'Abrir menú' }));
    const nav = screen.getByRole('navigation', { name: 'Menú principal' });
    expect(nav.className).not.toContain('mobile-menu--barber');
    expect(nav.textContent).toContain('Panel de administración');
    expect(nav.textContent).toContain('Panel de mantenimiento');
    expect(nav.textContent).toContain('WhatsApp');
  });

  it('defines full-screen Desktop and Mobile Liquid Glass styles for .mobile-menu--barber', () => {
    const lgCss = fs.readFileSync(
      path.resolve(__dirname, '../components/kani/experimental/liquid-glass.css'),
      'utf-8',
    );
    const barberBlockStart = lgCss.indexOf('MENÚ DESPLEGABLE BARBER');
    expect(barberBlockStart).toBeGreaterThan(-1);
    const barberBlock = lgCss.slice(barberBlockStart);

    expect(barberBlock).toContain('nav.mobile-menu.mobile-menu--liquid.mobile-menu--barber .mobile-menu-divider');
    expect(barberBlock).toContain('inset: 0 !important;');
    expect(barberBlock).toContain('width: 100dvw !important;');
    expect(barberBlock).toContain('height: 100dvh !important;');
    expect(barberBlock).toContain('min-height: 100dvh !important;');
    expect(barberBlock).toContain('flex: 1 1 auto;');
    expect(barberBlock).toContain('min-height: 44px !important;');
    expect(barberBlock).toContain('env(safe-area-inset-bottom, 0px)');
    expect(barberBlock).not.toContain('bottom: auto !important;');
  });

  it('locks background scroll when BARBER menu is open and closes via Escape or close button', async () => {
    render(<SiteHeader />);
    await waitFor(() => expect(mockGetAuthenticatedStaff).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: 'Abrir menú' }));
    expect(screen.getByRole('navigation', { name: 'Menú principal' })).toBeTruthy();
    expect(document.body.style.overflow).toBe('hidden');

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('navigation', { name: 'Menú principal' })).toBeNull();
    expect(document.body.style.overflow).not.toBe('hidden');
  });
});
