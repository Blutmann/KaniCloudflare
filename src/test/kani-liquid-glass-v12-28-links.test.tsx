import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';

vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children, ...props }: any) => (
    <a href={typeof to === 'string' ? to : '#'} {...props}>
      {children}
    </a>
  ),
  createFileRoute: () => () => ({}),
  useNavigate: () => vi.fn(),
  useSearch: () => ({}),
  useLocation: ({ select }: any) => select({ pathname: '/admin-liquid/inicio' }),
}));

vi.mock('@/components/kani/v2/data', () => ({
  useV2: () => ({
    appointments: [],
    payments: [],
    starts: [],
    services: [],
    clients: [],
    barberId: 'ALL',
    setBarberId: vi.fn(),
    refresh: vi.fn(),
    loading: false,
    depositSupported: true,
  }),
  scopeV2: (items: any[]) => items,
  money: (value: number) => `$${value}`,
  businessDateToday: () => '2026-11-14',
  businessTimeNow: () => '10:00',
  clientDisplay: (name: string) => name,
}));

vi.mock('@/lib/kani-admin-context', () => ({
  useAdminStaff: () => ({
    profile: { role: 'ADMIN', barber_id: null },
    barbers: [{ id: 'b1', name: 'Lautaro' }],
  }),
}));

import { PoliticaDePrivacidadPage } from '@/routes/politica-de-privacidad';
import { TerminosYCondicionesPage } from '@/routes/terminos-y-condiciones';
import { V2Home } from '@/components/kani/v2/agenda';

describe('Liquid Glass V12.28 — Isolation of internal -old vs official links (V12.47)', () => {
  it('mantiene enlaces legales y de retorno oficiales cuando no es ruta -old', () => {
    const privOfficial = render(<PoliticaDePrivacidadPage backTo="/reservar" />);
    const privHrefs = [...privOfficial.container.querySelectorAll('a')].map((a) =>
      a.getAttribute('href'),
    );
    expect(privHrefs).toContain('/reservar');
    expect(privHrefs).toContain('/terminos-y-condiciones');
    expect(privHrefs).not.toContain('/reservar-turno-old');
    expect(privHrefs).not.toContain('/terminos-y-condiciones-old');
    privOfficial.unmount();

    const termsOfficial = render(<TerminosYCondicionesPage backTo="/reservar" />);
    const termsHrefs = [...termsOfficial.container.querySelectorAll('a')].map((a) =>
      a.getAttribute('href'),
    );
    expect(termsHrefs).toContain('/reservar');
    expect(termsHrefs).toContain('/politica-de-privacidad');
    expect(termsHrefs).not.toContain('/reservar-turno-old');
    expect(termsHrefs).not.toContain('/politica-de-privacidad-old');
    termsOfficial.unmount();
  });

  it('preserva los enlaces legales y de retorno clásicos bajo rutas -old aisladas', () => {
    const privOld = render(<PoliticaDePrivacidadPage backTo="/reservar-turno-old" />);
    const privHrefs = [...privOld.container.querySelectorAll('a')].map((a) =>
      a.getAttribute('href'),
    );
    expect(privHrefs).toContain('/reservar-turno-old');
    expect(privHrefs).toContain('/terminos-y-condiciones-old');
    privOld.unmount();

    const termsOld = render(<TerminosYCondicionesPage backTo="/reservar-turno-old" />);
    const termsHrefs = [...termsOld.container.querySelectorAll('a')].map((a) =>
      a.getAttribute('href'),
    );
    expect(termsHrefs).toContain('/reservar-turno-old');
    expect(termsHrefs).toContain('/politica-de-privacidad-old');
    termsOld.unmount();
  });

  it('mantiene los accesos directos de V2Home en /panel-administracion oficial y aísla /panel-administracion-old', () => {
    const officialHome = render(<V2Home />);
    const officialHrefs = [...officialHome.container.querySelectorAll('a')].map((a) =>
      a.getAttribute('href'),
    );
    expect(officialHrefs).toContain('/panel-administracion/turnos');
    expect(officialHrefs).toContain('/panel-administracion/pagos');
    officialHome.unmount();

    const oldHome = render(<V2Home basePath="/panel-administracion-old" />);
    const oldHrefs = [...oldHome.container.querySelectorAll('a')].map((a) =>
      a.getAttribute('href'),
    );
    expect(oldHrefs).toContain('/panel-administracion-old/turnos');
    expect(oldHome.container.querySelectorAll('a[href="/panel-administracion/turnos"]')).toHaveLength(0);
    expect(oldHome.container.querySelectorAll('a[href="/panel-administracion/horarios"]')).toHaveLength(0);
    expect(oldHome.container.querySelectorAll('a[href="/panel-administracion/pagos"]')).toHaveLength(0);
    oldHome.unmount();
  });
});
