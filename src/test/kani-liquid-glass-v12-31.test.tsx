import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import fs from 'node:fs';
import path from 'node:path';

let mockPathname = '/admin-liquid/membresias';

vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children, onClick, activeProps, inactiveProps: _ip, activeOptions, className, ...props }: any) => {
    const href = typeof to === 'string' ? to : '#';
    const current = mockPathname.replace(/\/+$/, '') || '/';
    const target = href.replace(/\/+$/, '') || '/';
    const routerIsActive = activeOptions?.exact
      ? current === target
      : current === target || (target !== '/' && current.startsWith(`${target}/`));
    const mergedClassName = [className, routerIsActive ? activeProps?.className : undefined]
      .filter(Boolean)
      .join(' ');
    const routerActiveProps = routerIsActive
      ? {
          'data-status': 'active',
          'aria-current': activeProps?.['aria-current'] ?? 'page',
        }
      : {};
    return (
      <a
        href={href}
        onClick={onClick}
        className={mergedClassName || undefined}
        {...props}
        {...routerActiveProps}
      >
        {children}
      </a>
    );
  },
  Outlet: () => <div data-testid="v2-outlet" />,
  useNavigate: () => vi.fn(),
  useRouterState: ({ select }: any) => select({ location: { pathname: mockPathname } }),
  useLocation: ({ select }: any) => select({ pathname: mockPathname }),
  createFileRoute: () => () => ({}),
}));

const mockStaff = vi.hoisted(() => ({
  user: { id: 'admin-1', email: 'admin@kani.test' },
  profile: { role: 'ADMIN', barber_id: null, full_name: 'Admin Kani' },
  barbers: [
    { id: 'b1', name: 'Lautaro' },
    { id: 'b2', name: 'Gonzalo' },
  ],
  refreshCount: 0,
  setIsRefreshing: vi.fn(),
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

vi.mock('@/components/kani/v2/data', () => ({
  V2DataProvider: ({ children }: any) => <>{children}</>,
  useV2: () => ({
    loading: false,
    error: '',
    refresh: vi.fn(),
    barberId: 'ALL',
    setBarberId: vi.fn(),
    barbers: mockStaff.barbers,
    services: [
      { id: 'corte', dbId: 's1', name: 'Corte', price: 25000, duration: 45 },
      { id: 'barba', dbId: 's2', name: 'Barba', price: 15000, duration: 30 },
    ],
    depositSupported: true,
    appointments: [],
    payments: [],
    clients: [],
  }),
}));

vi.mock('@/lib/kani-appointments', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/kani-appointments')>();
  return {
    ...actual,
    createManualAppointment: vi.fn().mockResolvedValue({ id: 'new-apt-id' }),
    updateManualAppointment: vi.fn().mockResolvedValue({ id: 'updated-apt-id' }),
    readRealAppointments: vi.fn().mockResolvedValue([]),
  };
});

vi.mock('@/lib/kani-availability', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/kani-availability')>();
  return {
    ...actual,
    readAvailabilitySlotsForRange: vi.fn().mockResolvedValue([]),
    readAvailabilityStartsForRange: vi.fn().mockResolvedValue([]),
    createAvailabilitySlots: vi.fn(),
    updateAvailabilitySlot: vi.fn(),
  };
});

import { V2Layout } from '@/components/kani/v2/layout';
import { V2Clients } from '@/components/kani/v2/clients';
import { ManualAppointmentDialog } from '@/components/kani/v2/manual-appointment-dialog';
import { AdminScheduleManager } from '@/components/kani/admin-schedule-manager';

describe('Liquid Glass V12.31 — Correcciones de interfaz, modales y navegación administrativa', () => {
  const root = process.cwd();
  const liquidCss = fs.readFileSync(
    path.resolve(root, 'src/components/kani/experimental/liquid-glass.css'),
    'utf8',
  );
  const adminCss = fs.readFileSync(
    path.resolve(root, 'src/components/kani/experimental/liquid-glass-admin.css'),
    'utf8',
  );
  const membresiasRoute = fs.readFileSync(
    path.resolve(root, 'src/routes/panel-membresias.tsx'),
    'utf8',
  );
  const descuentosRoute = fs.readFileSync(
    path.resolve(root, 'src/routes/panel-descuentos.tsx'),
    'utf8',
  );

  beforeEach(() => {
    document.body.className = '';
    delete document.body.dataset.lgAdmin;
    delete document.body.dataset.adminInternal;
  });

  afterEach(() => {
    cleanup();
    delete document.body.dataset.lgAdmin;
    document.body.className = '';
  });

  it('1. Header mobile adopta el cristal translúcido del stepper, preserva altura 64px y permite scroll real por detrás', () => {
    const v1231Start = liquidCss.indexOf('LIQUID GLASS V12.31');
    expect(v1231Start).toBeGreaterThan(-1);
    const v1231 = liquidCss.slice(v1231Start);

    expect(v1231).toContain('rgba(255, 255, 255, 0.36) 0%, rgba(246, 244, 240, 0.22) 100%');
    expect(v1231).toContain('rgba(26, 27, 33, 0.44) 0%, rgba(15, 16, 21, 0.32) 100%');
    expect(v1231).toContain('-webkit-backdrop-filter: blur(22px) saturate(168%) !important;');
    expect(v1231).toContain('backdrop-filter: blur(22px) saturate(168%) !important;');
    expect(v1231).toContain('height: 64px !important;');
    expect(v1231).toContain('margin-top: -64px !important;');
    expect(v1231).toContain('padding-top: 135px !important;');

    expect(adminCss).toContain('.site-header.liquid-glass-header:not(.liquid-glass-header--scrolled)');
    expect(adminCss).toContain('height: 64px !important;');
  });

  it('2. Turnos /admin-liquid elimina la línea horizontal sobre WhatsApp y Mail', () => {
    const layer10 = adminCss.slice(adminCss.indexOf('LAYER 10 · V12.31'));
    expect(layer10).toContain('.v2-appointments-page .v2-appointment-actions');
    expect(layer10).toContain('.v2-appointments-page .v2-appointment-actions-grid');
    expect(layer10).toContain('border-top: none !important;');
    expect(layer10).toContain('text-decoration: none !important;');
  });

  it('3 & 6. Modal «Nuevo turno manual» enfoca el diálogo (sin desplegar barbero) y elimina el texto descriptivo en /admin-liquid', () => {
    document.body.dataset.lgAdmin = 'true';
    render(
      <ManualAppointmentDialog
        open={true}
        mode="CREATE"
        initialDate="2026-11-14"
        onClose={vi.fn()}
        onSuccess={vi.fn()}
      />,
    );

    const dialog = screen.getByRole('dialog');
    const barberSelect = screen.getByLabelText(/Barbero/i) as HTMLSelectElement;
    expect(document.activeElement).toBe(dialog);
    expect(document.activeElement).not.toBe(barberSelect);
    expect(barberSelect.disabled).toBe(false);
    expect(
      screen.queryByText(/Crea un turno operativo directamente confirmado sin limitaciones de horario comercial/i),
    ).toBeNull();
  });

  it('3. Modal «Agregar horario» enfoca el diálogo sin enfocar automáticamente el selector Agenda/Barbero', async () => {
    document.body.dataset.lgAdmin = 'true';
    render(<AdminScheduleManager />);

    const [addBtn] = await screen.findAllByRole('button', { name: /Agregar horario/i });
    fireEvent.click(addBtn);

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeTruthy();
    });

    const dialog = screen.getByRole('dialog');
    const agendaSelect = document.getElementById('schedule-manual-barber') as HTMLSelectElement;
    expect(agendaSelect).toBeTruthy();
    expect(document.activeElement).toBe(dialog);
    expect(document.activeElement).not.toBe(agendaSelect);
    expect(agendaSelect.disabled).toBe(false);
    expect(screen.queryByText(/Se habilitará el tramo de 45 minutos/i)).toBeNull();
  });

  it('4. Simplifica contenedores externos en Membresías y Descuentos y elimina tablist duplicada en rutas experimentales', () => {
    expect(membresiasRoute).toContain('standaloneTab="MEMBRESIAS"');
    expect(descuentosRoute).toContain('standaloneTab="DESCUENTOS"');

    const layer10 = adminCss.slice(adminCss.indexOf('LAYER 10 · V12.31'));
    expect(layer10).toContain('.v2-memberships-page > .v2-panel');
    expect(layer10).toContain('.v2-memberships-page .maintenance-section');
    expect(layer10).toContain('border: none !important;');
    expect(layer10).toContain('box-shadow: none !important;');
    expect(layer10).toContain('padding: 0 !important;');
  });

  it('5. En /panel-membresias y /panel-descuentos muestra cápsula de 3 opciones y restaura 6 en /panel-administracion', async () => {
    mockPathname = '/panel-membresias';
    const { container, rerender } = render(<V2Layout basePath="/panel-administracion" liquidGlass />);

    await waitFor(() => {
      expect(container.querySelector('.lg-memberships-nav')).not.toBeNull();
    });

    const membershipsLinks = Array.from(
      container.querySelectorAll<HTMLAnchorElement>('.lg-memberships-nav .admin-section-nav-link'),
    );
    expect(membershipsLinks).toHaveLength(3);
    expect(
      membershipsLinks.map((a) => {
        const desktopLabel = a.querySelector('.lg-admin-nav-label--desktop');
        return (desktopLabel ? desktopLabel.textContent : a.textContent)?.trim();
      }),
    ).toEqual([
      'Membresías',
      'Descuentos',
      'Panel de administración',
    ]);
    expect(
      membershipsLinks[2].querySelector('.lg-admin-nav-label--mobile')?.textContent?.trim(),
    ).toBe('Administración');
    expect(membershipsLinks.map((a) => a.getAttribute('href'))).toEqual([
      '/panel-membresias',
      '/panel-descuentos',
      '/panel-administracion',
    ]);
    expect(membershipsLinks[0].getAttribute('aria-current')).toBe('page');
    expect(membershipsLinks[2].getAttribute('aria-current')).toBeNull();

    // Descuentos activo
    mockPathname = '/panel-descuentos';
    rerender(<V2Layout basePath="/panel-administracion" forcedSectionSlug="descuentos" liquidGlass />);
    await waitFor(() => {
      const links = container.querySelectorAll('.lg-memberships-nav .admin-section-nav-link');
      expect(links[1].getAttribute('aria-current')).toBe('page');
      expect(links[0].getAttribute('aria-current')).toBeNull();
    });

    // Regreso a Panel de administración -> 6 secciones habituales
    mockPathname = '/panel-administracion';
    rerender(<V2Layout basePath="/panel-administracion" liquidGlass />);
    await waitFor(() => {
      expect(container.querySelector('.lg-memberships-nav')).toBeNull();
    });
    const adminLinks = Array.from(
      container.querySelectorAll<HTMLAnchorElement>('.admin-section-nav-link'),
    );
    expect(adminLinks.map((a) => a.textContent?.trim())).toEqual([
      'Inicio',
      'Turnos',
      'Horarios',
      'Pagos',
      'Clientes',
      'Datos',
    ]);
  });

  it('7. Rutas tradicionales mantienen el texto descriptivo del turno manual intacto', () => {
    delete document.body.dataset.lgAdmin;
    render(
      <ManualAppointmentDialog
        open={true}
        mode="CREATE"
        initialDate="2026-11-14"
        onClose={vi.fn()}
        onSuccess={vi.fn()}
      />,
    );
    expect(
      screen.getByText(/Crea un turno operativo directamente confirmado sin limitaciones de horario comercial/i),
    ).toBeTruthy();
  });

  it('8. V12.43.3 — Las tres pestañas inactivas mantienen jerarquía tipográfica uniforme sin negrita permanente en Administración', async () => {
    mockPathname = '/panel-administracion/membresias';
    const { container, rerender } = render(<V2Layout basePath="/panel-administracion" liquidGlass />);

    await waitFor(() => {
      expect(container.querySelector('.lg-memberships-nav')).not.toBeNull();
    });

    const checkInactiveUniformity = (expectedActiveSlug: string) => {
      const links = Array.from(
        container.querySelectorAll<HTMLAnchorElement>('.lg-memberships-nav .admin-section-nav-link'),
      );
      expect(links).toHaveLength(3);
      links.forEach((link) => {
        const slug = link.getAttribute('data-nav-slug');
        if (slug === expectedActiveSlug) {
          expect(link.classList.contains('is-active')).toBe(true);
          expect(link.getAttribute('aria-current')).toBe('page');
          expect(link.querySelector('.lg-admin-nav-pill')).not.toBeNull();
        } else {
          expect(link.classList.contains('is-active')).toBe(false);
          expect(link.getAttribute('aria-current')).toBeNull();
          expect(link.getAttribute('data-status')).toBeNull();
          expect(link.querySelector('.lg-admin-nav-pill')).toBeNull();
        }
      });
    };

    checkInactiveUniformity('membresias');

    mockPathname = '/panel-administracion/descuentos';
    rerender(<V2Layout basePath="/panel-administracion" liquidGlass />);
    await waitFor(() => {
      expect(
        container
          .querySelector('.lg-memberships-nav .admin-section-nav-link[data-nav-slug="descuentos"]')
          ?.classList.contains('is-active'),
      ).toBe(true);
    });

    checkInactiveUniformity('descuentos');

    const adminCss = fs.readFileSync(
      path.resolve(process.cwd(), 'src/components/kani/experimental/liquid-glass-admin.css'),
      'utf8',
    );
    expect(adminCss).toMatch(/\.admin-section-nav-link\s*\{[\s\S]*?font-weight:\s*500 !important;/);
    expect(adminCss).toMatch(
      /\.admin-section-nav-link :is\(svg, \.lg-admin-nav-icon, \.lg-admin-nav-label\)\s*\{[\s\S]*?font-weight:\s*500 !important;[\s\S]*?opacity:\s*1 !important;/,
    );
    expect(adminCss).toMatch(/\.lg-memberships-nav \.lg-admin-nav-label\s*\{[\s\S]*?font-weight:\s*inherit !important;/);
    expect(adminCss).toMatch(/\.lg-memberships-nav \.admin-section-nav-items\s*\{[\s\S]*?grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\) !important;/);
  });

  it('9. Modal de cliente en Clientes elimina el texto "Los datos se guardan de forma permanente en Supabase." conservando campos', async () => {
    render(<V2Clients />);

    fireEvent.click(screen.getByRole('button', { name: /Nuevo cliente/i }));

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeTruthy();
    });

    expect(screen.getByRole('heading', { name: 'Nuevo cliente' })).toBeTruthy();
    expect(screen.queryByText(/Los datos se guardan de forma permanente en Supabase\./i)).toBeNull();
    expect(screen.getByLabelText(/Nombre/i)).toBeTruthy();
    expect(screen.getByLabelText(/Celular/i)).toBeTruthy();
  });
});
