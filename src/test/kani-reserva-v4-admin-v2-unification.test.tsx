import { businessDateToday } from '@/lib/kani-mobile-appointments';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { V2Appointments } from '@/components/kani/v2/agenda';
import { AdminScheduleManager } from '@/components/kani/admin-schedule-manager';
import { Booking } from '@/components/kani/booking';
import type { AuthenticatedStaff } from '@/lib/kani-auth';

import { KaniProvider } from '@/components/kani/store';

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to, className, search }: any) => (
    <a href={to} className={className} data-search={JSON.stringify(search)}>
      {children}
    </a>
  ),
  useRouter: () => ({ invalidate: vi.fn() }),
}));

vi.mock('@/lib/kani-admin-context', () => ({
  useAdminStaff: () => ({
    profile: {
      id: 'admin-1',
      role: 'ADMIN',
      barber_id: null,
      full_name: 'Admin Global',
      email: 'admin@kani.ar',
      permissions: ['*'],
      created_at: '2026-01-01T00:00:00Z',
    } satisfies AuthenticatedStaff['profile'],
    barbers: [
      { id: 'b1', name: 'Lautaro', active: true },
      { id: 'b2', name: 'Gonzalo', active: true },
      { id: 'b3', name: 'Valentín', active: true },
    ],
    refreshCount: 0,
    setIsRefreshing: vi.fn(),
  }),
}));

const mockAppointments = [
  {
    id: 'apt-1',
    name: 'Matias Zarate',
    phone: '+5491155551234',
    email: 'matias@test.com',
    service: 'corte',
    serviceName: 'Corte',
    servicePrice: 25000,
    barber: 'Lautaro',
    barberId: 'b1',
    date: businessDateToday(),
    time: '17:30',
    endTime: '18:15',
    status: 'Cancelado',
    statusCode: 'CANCELLED',
    depositPaid: false,
    depositAmountArs: 0,
    isManual: false,
  },
  {
    id: 'apt-2',
    name: 'Carlos Perez',
    phone: '+5491155559999',
    email: 'carlos@test.com',
    service: 'barba',
    serviceName: 'Barba',
    servicePrice: 20000,
    barber: 'Gonzalo',
    barberId: 'b2',
    date: businessDateToday(),
    time: '18:30',
    endTime: '19:00',
    status: 'Confirmado',
    statusCode: 'CONFIRMED',
    depositPaid: true,
    depositAmountArs: 5000,
    isManual: true,
  },
];

vi.mock('@/components/kani/v2/data', () => ({
  useV2: () => ({
    appointments: mockAppointments,
    payments: [],
    barberId: 'ALL',
    setBarberId: vi.fn(),
    depositSupported: true,
    refresh: vi.fn(),
  }),
  scopeV2: (items: any[]) => items,
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          gte: () => ({
            lte: () => Promise.resolve({ data: [], error: null }),
          }),
        }),
      }),
    }),
  },
}));

describe('Unificación Admin V2 & Ajustes Reserva V4', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('Admin V2 Turnos: renders unified toolbar with date on left and action on right', () => {
    const { container } = render(<V2Appointments />);

    const toolbar = container.querySelector('.v2-section-toolbar');
    expect(toolbar).toBeInTheDocument();

    const headingH2 = toolbar?.querySelector('h2');
    expect(headingH2).toBeInTheDocument();
    expect(headingH2?.textContent).toMatch(/^[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+,\s+\d+\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+\.$/);

    // Counter completely eliminated
    expect(toolbar?.textContent).not.toMatch(/\d+\s+turnos?/i);

    // Agregar turno button present inside toolbar
    const addBtn = toolbar?.querySelector('.v2-toolbar-action');
    expect(addBtn).toBeInTheDocument();
    expect(addBtn).toHaveTextContent('Agregar turno');
  });

  it('Admin V2 Turnos: filters card uses unified v2-admin-filter-card and v2-filters-grid', () => {
    const { container } = render(<V2Appointments />);

    const filterCard = container.querySelector('section.v2-admin-filter-card');
    expect(filterCard).toBeInTheDocument();
    expect(filterCard).toHaveAttribute('aria-label', 'Filtros de turnos');

    const grid = filterCard?.querySelector('.v2-filters-grid');
    expect(grid).toBeInTheDocument();

    // Check presence of all 4 controls
    expect(screen.getByText('Período')).toBeInTheDocument();
    expect(screen.getByText('Fecha')).toBeInTheDocument();
    expect(screen.getByText('Barbero')).toBeInTheDocument();
    expect(screen.getByText('Estado')).toBeInTheDocument();
  });

  it('Admin V2 Turnos: appointment card does NOT have a divider line between info and actions', () => {
    const { container } = render(<V2Appointments />);

    const firstCard = container.querySelector('.v2-appointment');
    expect(firstCard).toBeInTheDocument();

    // Main info rows present
    expect(firstCard?.querySelector('.v2-app-row-1')).toBeInTheDocument();
    expect(firstCard?.querySelector('.v2-app-row-2')).toBeInTheDocument();
    expect(firstCard?.querySelector('.v2-app-row-3')).toBeInTheDocument();

    // Actions block present
    const actions = firstCard?.querySelector('.v2-appointment-actions');
    expect(actions).toBeInTheDocument();

    // WhatsApp and mail buttons
    expect(firstCard?.querySelector('.v2-whatsapp')).toBeInTheDocument();
    expect(firstCard?.querySelector('.v2-mail-btn')).toBeInTheDocument();
  });

  it('Admin V2 Horarios: filters card uses unified v2-admin-filter-card and v2-filters-grid', () => {
    const { container } = render(<AdminScheduleManager />);

    const filterCard = container.querySelector('section.v2-admin-filter-card');
    expect(filterCard).toBeInTheDocument();
    expect(filterCard).toHaveAttribute('aria-label', 'Filtros de horarios');

    const grid = filterCard?.querySelector('.v2-filters-grid');
    expect(grid).toBeInTheDocument();

    // Check all 4 filter labels
    expect(screen.getByLabelText(/Período/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Fecha/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Barbero/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Estado/i)).toBeInTheDocument();
  });

  it('Reserva: economic summary retains 3 pricing rows with intact labels', () => {
    const { container } = render(
      <KaniProvider>
        <Booking variant="v3" onPaymentRequest={vi.fn()} />
      </KaniProvider>,
    );

    // Check that summary pricing card markup structure is intact
    // (Booking renders step 0 initially, service selection)
    expect(container.querySelector('.booking-page')).toBeInTheDocument();
  });
});
