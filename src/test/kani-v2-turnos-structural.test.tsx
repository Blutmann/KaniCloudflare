import { render, screen, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { businessDateToday } from '@/lib/kani-mobile-appointments';
import { V2Appointments } from '@/components/kani/v2/agenda';

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
  }),
}));

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to, ...props }: any) => <a href={to} {...props}>{children}</a>,
}));

afterEach(() => {
  cleanup();
  testState.role = 'ADMIN';
  testState.barberId = null;
  testState.appointments = [];
});

describe('Admin V2 — Turnos Structural Responsive Verification', () => {
  it('handles long client names gracefully with title tooltip and ellipsis-ready heading', () => {
    const today = businessDateToday();
    testState.appointments = [
      {
        id: 'apt-long',
        barberId: 'b1',
        barber: 'Lautaro',
        date: today,
        time: '11:30',
        endTime: '12:15',
        name: 'Lucas Fernández de la Vega y San Martín',
        phone: '+5491199887766',
        email: 'lucas@test.com',
        statusCode: 'PENDING',
        serviceName: 'Corte',
        servicePrice: 25000,
        depositPaid: false,
        isManual: true,
      },
    ];

    const { container } = render(<V2Appointments />);

    const nameHeading = screen.getByRole('heading', { level: 3 });
    expect(nameHeading).toHaveTextContent('Lucas Fernández de la Vega y San Martín');
    expect(nameHeading).toHaveAttribute('title', 'Lucas Fernández de la Vega y San Martín');
    expect(nameHeading).toHaveClass('v2-app-name');

    // Both badges are rendered alongside the name
    expect(screen.getByText('Manual')).toBeInTheDocument();
    expect(container.querySelector('.v2-badge.v2-status-pending')).toHaveTextContent('Pendiente de pago');
  });

  it('renders 2x2 matrix for Confirmed appointments with 4 action buttons', () => {
    const today = businessDateToday();
    testState.appointments = [
      {
        id: 'apt-confirmed',
        barberId: 'b1',
        barber: 'Lautaro',
        date: today,
        time: '10:00',
        endTime: '10:45',
        name: 'Tomas',
        phone: '+5491122334455',
        email: 'tomas@test.com',
        statusCode: 'CONFIRMED',
        serviceName: 'Corte',
        servicePrice: 25000,
        depositPaid: true,
        depositAmountArs: 5000,
        isManual: false,
      },
    ];

    const { container } = render(<V2Appointments />);

    const opButtons = container.querySelector('.v2-op-buttons');
    expect(opButtons).toBeInTheDocument();
    expect(opButtons?.querySelectorAll('.v2-action-btn')).toHaveLength(2); // Cancelar + Cobrar

    const contactButtons = container.querySelector('.v2-contact-buttons');
    expect(contactButtons).toBeInTheDocument();
    expect(contactButtons?.querySelectorAll('.v2-action-btn')).toHaveLength(2); // WhatsApp + Mail
  });

  it('renders single 2-column row for Cancelled appointments without ghost operational row', () => {
    const today = businessDateToday();
    testState.appointments = [
      {
        id: 'apt-cancelled',
        barberId: 'b2',
        barber: 'Gonzalo',
        date: today,
        time: '10:00',
        endTime: '10:45',
        name: 'Tomas',
        phone: '+5491122334455',
        email: 'tomas@test.com',
        statusCode: 'CANCELLED',
        serviceName: 'Corte',
        servicePrice: 25000,
        depositPaid: false,
        isManual: false,
      },
    ];

    const { container } = render(<V2Appointments />);

    // In Cancelled, op-buttons is empty/omitted
    const opButtons = container.querySelector('.v2-op-buttons');
    expect(opButtons?.children.length ?? 0).toBe(0);

    const contactButtons = container.querySelector('.v2-contact-buttons');
    expect(contactButtons?.querySelectorAll('.v2-action-btn')).toHaveLength(2);
  });

  it('renders unified header block with title, count, and Generar turno action', () => {
    const { container } = render(<V2Appointments />);

    const header = container.querySelector('.v2-appointments-header');
    expect(header).toBeInTheDocument();

    const titleGroup = header?.querySelector('.v2-appointments-title-group');
    expect(titleGroup).toBeInTheDocument();
    expect(titleGroup?.querySelector('h2')).toBeInTheDocument();
    expect(titleGroup?.querySelector('span')).toHaveTextContent(/turnos?/i);

    const generateBtn = header?.querySelector('.v2-add-manual-btn');
    expect(generateBtn).toBeInTheDocument();
    expect(generateBtn).toHaveTextContent('Generar turno');
  });
});
