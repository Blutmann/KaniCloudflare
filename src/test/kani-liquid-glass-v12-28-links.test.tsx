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

describe('Liquid Glass V12.28 — Isolation of internal -liquid links', () => {
  it('mantiene enlaces legales y de retorno dentro de -liquid cuando backTo termina en -liquid', () => {
    const privLiquid = render(<PoliticaDePrivacidadPage backTo="/reservar-turno-liquid" />);
    const privHrefs = [...privLiquid.container.querySelectorAll('a')].map((a) =>
      a.getAttribute('href'),
    );
    expect(privHrefs).toContain('/reservar-turno-liquid');
    expect(privHrefs).toContain('/terminos-y-condiciones-liquid');
    expect(privHrefs).not.toContain('/reservar-turno');
    expect(privHrefs).not.toContain('/terminos-y-condiciones');
    privLiquid.unmount();

    const termsLiquid = render(<TerminosYCondicionesPage backTo="/reservar-turno-liquid" />);
    const termsHrefs = [...termsLiquid.container.querySelectorAll('a')].map((a) =>
      a.getAttribute('href'),
    );
    expect(termsHrefs).toContain('/reservar-turno-liquid');
    expect(termsHrefs).toContain('/politica-de-privacidad-liquid');
    expect(termsHrefs).not.toContain('/reservar-turno');
    expect(termsHrefs).not.toContain('/politica-de-privacidad');
    termsLiquid.unmount();
  });

  it('preserva los enlaces legales y de retorno tradicionales intactos', () => {
    const privStd = render(<PoliticaDePrivacidadPage />);
    const privHrefs = [...privStd.container.querySelectorAll('a')].map((a) =>
      a.getAttribute('href'),
    );
    expect(privHrefs).toContain('/reservar-turno');
    expect(privHrefs).toContain('/terminos-y-condiciones');
    privStd.unmount();

    const termsStd = render(<TerminosYCondicionesPage />);
    const termsHrefs = [...termsStd.container.querySelectorAll('a')].map((a) =>
      a.getAttribute('href'),
    );
    expect(termsHrefs).toContain('/reservar-turno');
    expect(termsHrefs).toContain('/politica-de-privacidad');
    termsStd.unmount();
  });

  it('mantiene los accesos directos de V2Home dentro de /admin-liquid y conserva /panel-administracion por defecto', () => {
    const liquidHome = render(<V2Home basePath="/admin-liquid" />);
    const liquidHrefs = [...liquidHome.container.querySelectorAll('a')].map((a) =>
      a.getAttribute('href'),
    );
    expect(liquidHrefs).toContain('/admin-liquid/turnos');
    expect(liquidHome.container.querySelectorAll('a[href="/panel-administracion/turnos"]')).toHaveLength(0);
    expect(liquidHome.container.querySelectorAll('a[href="/panel-administracion/horarios"]')).toHaveLength(0);
    expect(liquidHome.container.querySelectorAll('a[href="/panel-administracion/pagos"]')).toHaveLength(0);
    liquidHome.unmount();

    const stdHome = render(<V2Home />);
    const stdHrefs = [...stdHome.container.querySelectorAll('a')].map((a) =>
      a.getAttribute('href'),
    );
    expect(stdHrefs).toContain('/panel-administracion/turnos');
    expect(stdHrefs).toContain('/panel-administracion/pagos');
    stdHome.unmount();
  });
});
