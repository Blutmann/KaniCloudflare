import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import fs from 'fs';
import path from 'path';
import { V2Appointments } from '@/components/kani/v2/agenda';
import { V2Payments } from '@/components/kani/v2/payments';
import { AdminV2SectionToolbar } from '@/components/kani/v2/shared';

const testState = vi.hoisted(() => ({
  role: 'ADMIN' as 'ADMIN' | 'BARBER',
  barberId: null as string | null,
  appointments: [] as any[],
}));

vi.mock('@/lib/kani-admin-context', () => ({
  useAdminStaff: () => ({
    barbers: [
      { id: 'b1', name: 'Lautaro' },
      { id: 'b2', name: 'Gonzalo' },
    ],
    profile: { role: testState.role, barber_id: testState.barberId },
  }),
}));

vi.mock('@/components/kani/v2/data', () => ({
  useV2: () => ({
    barberId: 'ALL',
    setBarberId: vi.fn(),
    barbers: [
      { id: 'b1', name: 'Lautaro' },
      { id: 'b2', name: 'Gonzalo' },
    ],
    services: [
      { id: 'corte', dbId: 's1', name: 'Corte', price: 25000, duration: 45 },
    ],
    depositSupported: true,
    refresh: vi.fn(),
    appointments: testState.appointments,
    payments: [],
    clients: [],
    loading: false,
  }),
}));

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to, className, search }: any) => (
    <a href={`${to}?turno=${search?.turno}`} className={className}>
      {children}
    </a>
  ),
  useNavigate: () => vi.fn(),
  useSearch: () => ({}),
}));

afterEach(() => {
  cleanup();
  testState.role = 'ADMIN';
  testState.barberId = null;
  testState.appointments = [];
});

describe('Admin V2 — Comprehensive Visual Consistency (Turnos & Pagos)', () => {
  const cssPath = path.resolve(__dirname, '../components/kani/v2/v2.css');
  const css = fs.readFileSync(cssPath, 'utf-8');

  describe('1. Turnos Action Labels and Sizing', () => {
    it('uses "WhatsApp" and "Mail" labels without "Enviar"', () => {
      const today = new Date().toISOString().slice(0, 10);
      testState.appointments = [
        {
          id: 'apt-1',
          barberId: 'b1',
          barber: 'Lautaro',
          date: today,
          time: '10:00',
          endTime: '10:45',
          name: 'Tomas Blutman',
          phone: '+5491122334455',
          email: 'tomas@example.com',
          statusCode: 'CONFIRMED',
          serviceName: 'Corte',
          servicePrice: 25000,
          depositPaid: true,
          depositAmountArs: 5000,
          isManual: false,
        },
      ];

      render(<V2Appointments />);

      const actions = document.querySelector('.v2-appointment-actions') as HTMLElement;
      expect(within(actions).getByRole('button', { name: 'WhatsApp' })).toBeInTheDocument();
      expect(within(actions).getByRole('link', { name: 'Mail' })).toBeInTheDocument();
      expect(screen.queryByText('Enviar WhatsApp')).toBeNull();
      expect(screen.queryByText('Enviar mail')).toBeNull();
    });

    it('defines 44px min-height for all appointment action buttons in mobile and desktop', () => {
      expect(css).toMatch(/\.v2-op-buttons > \*\s*\{[^}]*min-height:\s*44px\s*!important/);
      expect(css).toMatch(/\.v2-contact-buttons > \*\s*\{[^}]*min-height:\s*44px\s*!important/);
    });

    it('expands solo contact button to col-span-2 (grid-column: 1 / -1)', () => {
      expect(css).toMatch(/\.v2-contact-buttons:has\(>\s*:only-child\)\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s*!important/);
      expect(css).toMatch(/\.v2-contact-buttons > :only-child\s*\{[^}]*grid-column:\s*1\s*\/\s*-1\s*!important/);
    });

    it('unifies card spacing and removes extra top margin from .v2-note', () => {
      expect(css).toMatch(/\.v2-appointment-main\s*\{[^}]*gap:\s*6px\s*!important/);
      expect(css).toMatch(/\.v2-note\s*\{[^}]*margin:\s*0\s*!important/);
    });

    it('unifies "Agregar turno" into standard 44px primary button system', () => {
      expect(css).toMatch(/\.v2-toolbar-action,\s*\.v2-add-manual-btn\s*\{[^}]*min-height:\s*44px\s*!important/);
      expect(css).toMatch(/\.v2-toolbar-action,\s*\.v2-add-manual-btn\s*\{[^}]*height:\s*44px\s*!important/);
    });
  });

  describe('2. Pagos Dimensional Consistency', () => {
    it('"Agregar descuento" and "Asociar cliente" use 2 equal columns, 44px height, and nowrap', () => {
      expect(css).toMatch(/\.v2-payment-actions-strip\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
      expect(css).toMatch(/\.v2-payment-action-btn\s*\{[^}]*min-height:\s*44px/);
      expect(css).toMatch(/\.v2-payment-action-btn\s*\{[^}]*height:\s*44px/);
      expect(css).toMatch(/\.v2-payment-action-btn\s*\{[^}]*white-space:\s*nowrap/);
    });

    it('unifies Pagos form inputs and selects to 44px height', () => {
      expect(css).toMatch(/\.v2-payment-form :is\(input,\s*select\)\s*\{[^}]*height:\s*44px/);
      expect(css).toMatch(/\.v2-payment-form :is\(input,\s*select\)\s*\{[^}]*min-height:\s*44px/);
    });

    it('segmented control "Sin turno / Con turno" has equal 50/50 dimensions and pill styling', () => {
      expect(css).toMatch(/\.v2-segmented\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
      expect(css).toMatch(/\.v2-segmented\s*\{[^}]*border-radius:\s*var\(--radius-capsule/);
    });

    it('compact summary block avoids redundant highlighted card box when no discount or deposit exists', () => {
      expect(css).toMatch(/\.v2-payment-summary-block\.is-compact\s*\{[^}]*background:\s*transparent/);
      expect(css).toMatch(/\.v2-payment-summary-block\.is-compact\s*\{[^}]*border:\s*none/);
    });
  });

  describe('3. Shared Panel Elements and Icon Targets', () => {
    it('refresh button has consistent 44x44px square touch area', () => {
      expect(css).toMatch(/\.v2-nav \.admin-section-nav-refresh-btn\s*\{[^}]*width:\s*44px/);
      expect(css).toMatch(/\.v2-nav \.admin-section-nav-refresh-btn\s*\{[^}]*height:\s*44px/);
    });

    it('manual appointment dialog inputs and actions have uniform 44px height', () => {
      expect(css).toMatch(/\.v2-manual-dialog \.v2-field :is\(input,\s*select\)[^\{]*\{[^}]*height:\s*44px\s*!important/);
      expect(css).toMatch(/\.v2-manual-dialog-actions button[^\{]*\{[^}]*height:\s*44px\s*!important/);
    });
  });
});
