import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import fs from 'node:fs';
import path from 'node:path';

let mockPathname = '/admin-liquid/membresias';

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
    path.resolve(root, 'src/routes/admin-liquid.membresias.tsx'),
    'utf8',
  );
  const descuentosRoute = fs.readFileSync(
    path.resolve(root, 'src/routes/admin-liquid.descuentos.tsx'),
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

  it('5. En /admin-liquid/membresias y /admin-liquid/descuentos muestra cápsula de 3 opciones y restaura 6 en /admin-liquid', async () => {
    mockPathname = '/admin-liquid/membresias';
    const { container, rerender } = render(<V2Layout basePath="/admin-liquid" liquidGlass />);

    await waitFor(() => {
      expect(container.querySelector('.lg-memberships-nav')).not.toBeNull();
    });

    const membershipsLinks = Array.from(
      container.querySelectorAll<HTMLAnchorElement>('.lg-memberships-nav .admin-section-nav-link'),
    );
    expect(membershipsLinks).toHaveLength(3);
    expect(membershipsLinks.map((a) => a.textContent?.trim())).toEqual([
      'Membresías',
      'Descuentos',
      'Panel de administración',
    ]);
    expect(membershipsLinks.map((a) => a.getAttribute('href'))).toEqual([
      '/admin-liquid/membresias',
      '/admin-liquid/descuentos',
      '/admin-liquid',
    ]);
    expect(membershipsLinks[0].getAttribute('aria-current')).toBe('page');
    expect(membershipsLinks[2].getAttribute('aria-current')).toBeNull();

    // Descuentos activo
    mockPathname = '/admin-liquid/descuentos';
    rerender(<V2Layout basePath="/admin-liquid" liquidGlass />);
    await waitFor(() => {
      const links = container.querySelectorAll('.lg-memberships-nav .admin-section-nav-link');
      expect(links[1].getAttribute('aria-current')).toBe('page');
      expect(links[0].getAttribute('aria-current')).toBeNull();
    });

    // Regreso a Panel de administración -> 6 secciones habituales
    mockPathname = '/admin-liquid';
    rerender(<V2Layout basePath="/admin-liquid" liquidGlass />);
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
});
