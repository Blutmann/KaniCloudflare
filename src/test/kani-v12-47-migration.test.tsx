import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import fs from 'node:fs';
import path from 'node:path';

const routerState = vi.hoisted(() => ({
  pathname: '/panel-descuentos',
}));

const authState = vi.hoisted(() => ({
  role: 'BARBER' as 'ADMIN' | 'MANAGER' | 'BARBER',
  staff: null as any,
}));

vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children, activeProps, activeOptions, ...props }: any) => (
    <a href={typeof to === 'string' ? to : '#'} {...props}>
      {children}
    </a>
  ),
  Outlet: () => <div data-testid="v12-47-outlet" />,
  Navigate: ({ to }: { to: string }) => <div data-testid="v12-47-navigate">{to}</div>,
  useNavigate: () => vi.fn(),
  useLocation: ({ select }: any) => select({ pathname: routerState.pathname }),
  useRouterState: ({ select }: any) => select({ location: { pathname: routerState.pathname } }),
  useSearch: () => ({}),
  createFileRoute: () => (opts: any) => opts,
  redirect: (opts: any) => Object.assign(new Error('REDIRECT'), { redirectOpts: opts }),
}));

vi.mock('@/lib/kani-auth', () => ({
  getAuthenticatedStaff: vi.fn(async () => authState.staff),
  signInWithPassword: vi.fn(),
  clearStaffCache: vi.fn(),
  signOut: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    supabaseUrl: 'https://iockpxtkflyjfagkvgnr.supabase.co',
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
  AdminActivityPopover: ({ isLiquid }: { isLiquid?: boolean }) => (
    <button type="button" data-testid="notif-bell" data-liquid={String(Boolean(isLiquid))}>
      Notificaciones
    </button>
  ),
}));

import { V2Layout } from '@/components/kani/v2/layout';
import { KaniProvider } from '@/components/kani/store';
import { SiteHeader } from '@/components/kani/site-header';
import { readConfirmationSoundEnabled } from '@/components/kani/experimental/liquid-glass-feedback';
import { isLiquidGlassPath, isClassicLegacyPath } from '@/components/kani/experimental/liquid-glass-shell';

describe('KANI Barber Studio — V12.47 | Liquid Glass como experiencia principal', () => {
  const srcRoot = path.resolve(__dirname, '..');
  const routesDir = path.join(srcRoot, 'routes');

  beforeEach(() => {
    vi.clearAllMocks();
    routerState.pathname = '/panel-descuentos';
    authState.role = 'BARBER';
    authState.staff = {
      user: { id: 'staff-1', email: 'barber@kanibarber.com' },
      profile: {
        role: authState.role,
        active: true,
        barber_id: 'lautaro',
        display_name: 'Lautaro',
      },
      barbers: [{ id: 'lautaro', name: 'Lautaro', active: true }],
    };
    document.body.className = '';
    delete document.body.dataset.lgAdmin;
    delete document.body.dataset.adminInternal;
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('1. Redirecciones heredadas preservan query params y apuntan a las rutas oficiales Liquid Glass', () => {
    const redirectPairs: Array<[string, string]> = [
      ['index.tsx', '/reservar'],
      ['reservar-turno.tsx', '/reservar'],
      ['reservar-turno-liquid.tsx', '/reservar'],
      ['reserva-v4.tsx', '/reservar'],
      ['contacto-liquid.tsx', '/contacto'],
      ['politica-de-privacidad-liquid.tsx', '/politica-de-privacidad'],
      ['terminos-y-condiciones-liquid.tsx', '/terminos-y-condiciones'],
      ['admin-liquid.index.tsx', '/panel-administracion'],
      ['admin-liquid.inicio.tsx', '/panel-administracion/inicio'],
      ['admin-liquid.turnos.tsx', '/panel-administracion/turnos'],
      ['admin-liquid.horarios.tsx', '/panel-administracion/horarios'],
      ['admin-liquid.pagos.tsx', '/panel-administracion/pagos'],
      ['admin-liquid.clientes.tsx', '/panel-administracion/clientes'],
      ['admin-liquid.datos.tsx', '/panel-administracion/datos'],
      ['admin-liquid.membresias.tsx', '/panel-administracion/membresias'],
      ['admin-liquid.descuentos.tsx', '/panel-administracion/descuentos'],
      ['admin-liquid.mantenimiento.tsx', '/panel-administracion/mantenimiento'],
    ];

    for (const [fileName, targetTo] of redirectPairs) {
      const code = fs.readFileSync(path.join(routesDir, fileName), 'utf8');
      expect(code, `${fileName} debe redirigir a ${targetTo}`).toContain(`to: '${targetTo}'`);
      expect(code, `${fileName} debe preservar search`).toContain('search');
    }

    // El layout padre /admin-liquid debe delegar al Outlet sin absorber subrutas /admin-liquid/*
    const adminLiquidParent = fs.readFileSync(path.join(routesDir, 'admin-liquid.tsx'), 'utf8');
    expect(adminLiquidParent).toContain('component: Outlet');
    expect(adminLiquidParent).not.toContain('beforeLoad');
  });

  it('2. Las rutas -old clásicas existen y quedan aisladas de Liquid Glass', () => {
    const oldFiles = [
      'reservar-turno-old.tsx',
      'contacto-old.tsx',
      'politica-de-privacidad-old.tsx',
      'terminos-y-condiciones-old.tsx',
      'panel-administracion-old.tsx',
      'panel-administracion-old.index.tsx',
      'panel-administracion-old.inicio.tsx',
      'panel-administracion-old.turnos.tsx',
      'panel-administracion-old.horarios.tsx',
      'panel-administracion-old.pagos.tsx',
      'panel-administracion-old.clientes.tsx',
      'panel-administracion-old.datos.tsx',
      'panel-administracion-old.membresias.tsx',
      'panel-administracion-old.descuentos.tsx',
      'panel-administracion-old.mantenimiento.tsx',
    ];

    for (const fileName of oldFiles) {
      expect(fs.existsSync(path.join(routesDir, fileName)), `Falta ruta clásica ${fileName}`).toBe(true);
    }

    const reservarOld = fs.readFileSync(path.join(routesDir, 'reservar-turno-old.tsx'), 'utf8');
    expect(reservarOld).toContain('PaywayBooking');
    expect(reservarOld).toContain('homeUrl="/reservar-turno-old"');

    const adminOld = fs.readFileSync(path.join(routesDir, 'panel-administracion-old.tsx'), 'utf8');
    expect(adminOld).toContain('basePath="/panel-administracion-old"');
    expect(adminOld).toContain('liquidGlass={false}');

    expect(isClassicLegacyPath('/reservar-turno-old')).toBe(true);
    expect(isClassicLegacyPath('/panel-administracion-old/turnos')).toBe(true);
    expect(isLiquidGlassPath('/reservar-turno-old')).toBe(false);
    expect(isLiquidGlassPath('/panel-administracion-old')).toBe(false);
    expect(isLiquidGlassPath('/reservar')).toBe(true);
    expect(isLiquidGlassPath('/panel-administracion')).toBe(true);
    expect(isLiquidGlassPath('/panel-membresias')).toBe(true);
    expect(isLiquidGlassPath('/panel-descuentos')).toBe(true);
    expect(isLiquidGlassPath('/panel-turnos')).toBe(true);
    expect(isLiquidGlassPath('/panel-horarios')).toBe(true);
  });

  it('3. Las rutas independientes /panel-membresias, /panel-descuentos, /panel-turnos y /panel-horarios existen', () => {
    const standaloneSpecs: Array<[string, string]> = [
      ['panel-membresias.tsx', '/panel-membresias'],
      ['panel-descuentos.tsx', '/panel-descuentos'],
      ['panel-turnos.tsx', '/panel-turnos'],
      ['panel-horarios.tsx', '/panel-horarios'],
    ];

    for (const [fileName, routePath] of standaloneSpecs) {
      const code = fs.readFileSync(path.join(routesDir, fileName), 'utf8');
      expect(code).toContain(`createFileRoute('${routePath}')`);
      expect(code).toContain('V2Layout');
    }
  });

  it('4. Gating de roles y barra 3 tabs en V2Layout: BARBER bloqueado en /panel-descuentos sin filtrar tab ni outlet', async () => {
    routerState.pathname = '/panel-descuentos';
    authState.staff.profile.role = 'BARBER';

    const { container } = render(
      <V2Layout basePath="/panel-administracion" forcedSectionSlug="descuentos" liquidGlass />,
    );

    expect(await screen.findByText('No tenés permisos para acceder a esta sección.')).toBeInTheDocument();
    expect(screen.queryByTestId('v12-47-outlet')).toBeNull();
    expect(container.querySelector('.lg-memberships-nav')).toBeNull();
  });

  it('5. BARBER en /panel-membresias ve Membresías y Panel de administración sin enlace a Descuentos', async () => {
    routerState.pathname = '/panel-membresias';
    authState.staff.profile.role = 'BARBER';

    const { container } = render(
      <V2Layout basePath="/panel-administracion" forcedSectionSlug="membresias" liquidGlass />,
    );

    await waitFor(() => {
      expect(container.querySelector('.lg-memberships-nav')).not.toBeNull();
    });

    const hrefs = Array.from(
      container.querySelectorAll<HTMLAnchorElement>('.lg-memberships-nav .admin-section-nav-link'),
    ).map((a) => a.getAttribute('href'));

    expect(hrefs).toEqual(['/panel-membresias', '/panel-administracion']);
    expect(hrefs).not.toContain('/panel-descuentos');
  });

  it('6. Login en /panel-* preserva pathname + query string y tolera mocks sin location.pathname', async () => {
    authState.staff = null;
    const assignSpy = vi.fn();
    vi.spyOn(window, 'location', 'get').mockReturnValue({
      hostname: 'kanibarber.com',
      pathname: '/panel-administracion/turnos',
      search: '?barber=lautaro',
      assign: assignSpy,
    } as unknown as Location);

    render(<V2Layout basePath="/panel-administracion" />);
    expect(await screen.findByRole('button', { name: /iniciar sesión/i })).toBeInTheDocument();

    const layoutCode = fs.readFileSync(path.join(srcRoot, 'components', 'kani', 'v2', 'layout.tsx'), 'utf8');
    expect(layoutCode).toContain('window.location?.pathname ?? ""');
    expect(layoutCode).toContain('window.location?.search ?? ""');
    expect(layoutCode).toContain('window.location.assign(returnTo)');
  });

  it('7. Header en rutas oficiales Liquid Glass vs -old mantiene aislamiento de clase y notificaciones', async () => {
    routerState.pathname = '/reservar';
    const official = render(
      <KaniProvider>
        <SiteHeader />
      </KaniProvider>,
    );
    await waitFor(() => {
      expect(official.container.querySelector('header.site-header')?.classList.contains('liquid-glass-header')).toBe(
        true,
      );
      expect(screen.getByTestId('notif-bell').getAttribute('data-liquid')).toBe('true');
    });
    official.unmount();

    routerState.pathname = '/reservar-turno-old';
    const classic = render(
      <KaniProvider>
        <SiteHeader />
      </KaniProvider>,
    );
    await waitFor(() => {
      expect(classic.container.querySelector('header.site-header')?.classList.contains('liquid-glass-header')).toBe(
        false,
      );
      expect(screen.getByTestId('notif-bell').getAttribute('data-liquid')).toBe('false');
    });
    classic.unmount();
  });

  it('8. Sonido al confirmar eliminado de UI y activo por defecto', () => {
    expect(readConfirmationSoundEnabled()).toBe(true);

    const paywayCode = fs.readFileSync(
      path.join(srcRoot, 'components', 'kani', 'experimental', 'payway-booking.tsx'),
      'utf8',
    );
    const confirmedCode = fs.readFileSync(
      path.join(srcRoot, 'components', 'kani', 'booking-confirmed-screen.tsx'),
      'utf8',
    );
    expect(paywayCode).not.toContain('Sonido al confirmar');
    expect(paywayCode).not.toContain('writeConfirmationSoundEnabled');
    expect(confirmedCode).not.toContain('soundPreferenceControl');
  });
});
