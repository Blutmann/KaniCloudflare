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

describe('Admin V2 — Turnos Density & Contact Actions Optimization', () => {
  it('client with phone + email: does NOT render raw phone/email as visible text, renders WhatsApp and mailto links', () => {
    const today = businessDateToday();
    testState.appointments = [
      {
        id: 'apt-1',
        barberId: 'b1',
        barber: 'Lautaro',
        date: today,
        time: '10:00',
        endTime: '10:45',
        name: 'Matias Zarate',
        phone: '+5491127969464',
        email: 'matiasdragon01.mz@gmail.com',
        statusCode: 'CONFIRMED',
        serviceName: 'Corte',
        servicePrice: 25000,
        depositPaid: true,
        depositAmountArs: 5000,
        isManual: false,
      },
    ];

    const { container } = render(<V2Appointments />);

    // 1. Phone and email must NOT appear as visible text on the card
    expect(screen.queryByText('+5491127969464')).toBeNull();
    expect(screen.queryByText('matiasdragon01.mz@gmail.com')).toBeNull();

    // 2. Client name is visible
    expect(screen.getByRole('heading', { level: 3, name: 'Matias Zarate' })).toBeInTheDocument();

    // 3. Fila 1, 2, 3 textual data
    expect(screen.getByText('10:00')).toBeInTheDocument();
    expect(screen.getByText('10:45')).toBeInTheDocument();
    expect(screen.getByText('Corte')).toBeInTheDocument();
    expect(container.querySelector('.v2-app-barber')).toHaveTextContent('Lautaro');
    expect(screen.getByText(/Seña:\s*\$ ?5\.000/i)).toBeInTheDocument();
    expect(screen.getByText(/Importe:\s*\$ ?25\.000/i)).toBeInTheDocument();

    // 4. Contact action buttons
    const waLink = screen.getByRole('link', { name: 'Enviar WhatsApp' });
    expect(waLink).toBeInTheDocument();
    expect(waLink).toHaveAttribute('href', 'https://wa.me/5491127969464');

    const mailLink = screen.getByRole('link', { name: 'Enviar mail' });
    expect(mailLink).toBeInTheDocument();
    expect(mailLink).toHaveAttribute('href', 'mailto:matiasdragon01.mz@gmail.com');

    // 5. Operational buttons
    expect(screen.getByRole('button', { name: 'Cancelar turno' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Cobrar' })).toBeInTheDocument();
  });

  it('client without email: hides Enviar mail completely, keeps WhatsApp', () => {
    const today = businessDateToday();
    testState.appointments = [
      {
        id: 'apt-2',
        barberId: 'b2',
        barber: 'Gonzalo',
        date: today,
        time: '11:00',
        endTime: '11:45',
        name: 'Lucas Fernandez',
        phone: '+5491144556677',
        email: null,
        statusCode: 'CANCELLED',
        serviceName: 'Barba',
        servicePrice: 15000,
        depositPaid: false,
        isManual: false,
      },
    ];

    render(<V2Appointments />);

    // WhatsApp exists
    expect(screen.getByRole('link', { name: 'Enviar WhatsApp' })).toBeInTheDocument();

    // Enviar mail must NOT be rendered
    expect(screen.queryByRole('link', { name: 'Enviar mail' })).toBeNull();

    // Seña: No abonada
    expect(screen.getByText(/Seña:\s*No abonada/i)).toBeInTheDocument();
  });

  it('client with manual appointment: renders badge Manual and Editar action when allowed', () => {
    const today = businessDateToday();
    testState.appointments = [
      {
        id: 'apt-manual-1',
        barberId: 'b1',
        barber: 'Lautaro',
        date: today,
        time: '12:00',
        endTime: '12:45',
        name: 'Franco Colapinto',
        phone: '+5491199887766',
        email: 'franco@williams.com',
        statusCode: 'CONFIRMED',
        serviceName: 'Corte',
        servicePrice: 30000,
        depositPaid: false,
        isManual: true,
      },
    ];

    render(<V2Appointments />);

    // Manual badge is visible
    expect(screen.getByText('Manual')).toBeInTheDocument();

    // Editar button is visible for ADMIN
    expect(screen.getByRole('button', { name: 'Editar' })).toBeInTheDocument();
  });

  it('header renders Agregar turno in the same horizontal block as the title', () => {
    const { container } = render(<V2Appointments />);

    const toolbar = container.querySelector('.v2-section-toolbar');
    expect(toolbar).toBeInTheDocument();

    const heading = toolbar?.querySelector('h2');
    expect(heading).toBeInTheDocument();
    expect(heading?.textContent).toMatch(/^[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+,\s+\d+\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+\.$/);

    const btn = toolbar?.querySelector('.v2-toolbar-action');
    expect(btn).toBeInTheDocument();
    expect(btn).toHaveTextContent('Agregar turno');
  });
});
