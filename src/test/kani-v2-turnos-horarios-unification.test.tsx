import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { V2Appointments } from '@/components/kani/v2/agenda';
import { AdminScheduleManager } from '@/components/kani/admin-schedule-manager';
import { businessDateToday } from '@/lib/kani-mobile-appointments';
import { formatAdminV2Date, formatAdminV2Range } from '@/lib/kani-model';

const testState = {
  profile: { role: 'ADMIN', barber_id: null },
  barbers: [
    { id: 'b1', name: 'Lautaro' },
    { id: 'b2', name: 'Gonzalo' },
  ],
  barberId: 'ALL',
  appointments: [] as any[],
  starts: [] as any[],
  payments: [] as any[],
  loading: false,
  error: '',
  refresh: vi.fn(),
  setBarberId: vi.fn(),
};

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
    profile: testState.profile,
    barbers: testState.barbers,
    refreshCount: 0,
    setIsRefreshing: vi.fn(),
  }),
}));

vi.mock('@/components/kani/v2/data', () => ({
  useV2: () => testState,
}));

vi.mock('@/lib/kani-appointments', () => ({
  appointmentErrorMessage: (e: any) => e?.message || 'Error',
  updateRealAppointmentStatus: vi.fn(),
  readRealAppointments: vi.fn().mockResolvedValue([]),
}));

vi.mock('@/lib/kani-availability', () => ({
  readAvailabilitySlotsForRange: vi.fn().mockResolvedValue([
    {
      id: 'slot-1',
      barber_id: 'b1',
      slot_date: '2026-10-28',
      start_time: '10:00:00',
      end_time: '11:00:00',
      status: 'AVAILABLE',
      is_manual: false,
    },
  ]),
  readAvailabilityStartsForRange: vi.fn().mockResolvedValue([]),
  createAvailabilitySlots: vi.fn(),
  updateAvailabilitySlot: vi.fn(),
  FIXED_BOOKING_START_TIMES: ['10:00', '11:00'],
}));

describe('Admin V2 — Turnos & Horarios Upper Layout Unification', () => {
  beforeEach(() => {
    const today = businessDateToday();
    testState.appointments = [
      {
        id: 'apt-1',
        name: 'Matias Zarate',
        phone: '+5491122334455',
        email: 'matias@test.com',
        serviceId: 'corte',
        serviceName: 'Corte',
        barberId: 'b1',
        barberName: 'Lautaro',
        date: today,
        time: '17:30',
        endTime: '18:15',
        price: 25000,
        depositAmount: 0,
        status: 'CONFIRMED',
        statusCode: 'CONFIRMED',
        paymentStatus: 'COMPLETED',
        paymentType: 'SEÑA',
        isManual: false,
        notes: '',
      },
    ];
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('Date formatting matches exact spec: Miércoles, 28 Oct.', () => {
    const formatted = formatAdminV2Date('2026-10-28');
    expect(formatted).toBe('Miércoles, 28 Oct.');

    const rangeSameMonth = formatAdminV2Range('2026-10-26', '2026-10-31');
    expect(rangeSameMonth).toBe('26 — 31 Oct.');

    const rangeCrossMonth = formatAdminV2Range('2026-10-26', '2026-11-01');
    expect(rangeCrossMonth).toBe('26 Oct. — 1 Nov.');
  });

  it('Turnos renders unified AdminV2FiltersPanel and AdminV2SectionToolbar', () => {
    const { container } = render(<V2Appointments />);

    // 1. Filter card
    const filterCard = container.querySelector('section.v2-admin-filter-card');
    expect(filterCard).toBeInTheDocument();
    expect(filterCard).toHaveAttribute('aria-label', 'Filtros de turnos');

    const grid = filterCard?.querySelector('.v2-filters-grid');
    expect(grid).toBeInTheDocument();

    const fields = grid?.querySelectorAll('.v2-field');
    expect(fields).toHaveLength(4);

    // 2. Toolbar
    const toolbar = container.querySelector('.v2-section-toolbar');
    expect(toolbar).toBeInTheDocument();

    const heading = toolbar?.querySelector('.v2-toolbar-date');
    expect(heading).toBeInTheDocument();
    expect(heading?.textContent).toMatch(/^[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+,\s+\d+\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+\.$/);

    // 3. Counter eliminated
    expect(toolbar?.textContent).not.toMatch(/\d+\s+turnos?/i);

    // 4. Action button
    const actionBtn = toolbar?.querySelector('.v2-toolbar-action');
    expect(actionBtn).toBeInTheDocument();
    expect(actionBtn).toHaveTextContent('Agregar turno');
  });

  it('Horarios renders unified AdminV2FiltersPanel and AdminV2SectionToolbar', async () => {
    const { container } = render(<AdminScheduleManager />);

    // 1. Filter card
    const filterCard = container.querySelector('section.v2-admin-filter-card');
    expect(filterCard).toBeInTheDocument();
    expect(filterCard).toHaveAttribute('aria-label', 'Filtros de horarios');

    const grid = filterCard?.querySelector('.v2-filters-grid');
    expect(grid).toBeInTheDocument();

    const fields = grid?.querySelectorAll('.v2-field');
    expect(fields).toHaveLength(4);

    // 2. Toolbar exists with formatted date and action button
    await waitFor(() => {
      const actionBtn = container.querySelector('.v2-section-toolbar .v2-toolbar-action');
      expect(actionBtn).toBeInTheDocument();
      expect(actionBtn).toHaveTextContent('Agregar horario');
    });

    const dateHeading = container.querySelector('.v2-toolbar-date');
    expect(dateHeading).toBeInTheDocument();
    expect(dateHeading?.textContent).toBe('Miércoles, 28 Oct.');

    // 3. Counter eliminated
    expect(container.querySelector('.schedule-results-heading span')).toBeNull();
    expect(container.textContent).not.toMatch(/\d+\s+horarios?/i);
  });
});
