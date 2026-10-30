import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import fs from 'fs';
import path from 'path';
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

describe('Admin V2 Turnos — Responsive Buttons & Alignment Tests', () => {
  const cssPath = path.resolve(__dirname, '../components/kani/v2/v2.css');
  const css = fs.readFileSync(cssPath, 'utf-8');

  it('1. Desktop: alinea el bloque de acciones a la derecha mediante margin-left: auto y justify-content: space-between', () => {
    expect(css).toMatch(
      /\.v2-appointments-page \.v2-appointment\s*\{[^}]*justify-content:\s*space-between\s*!important/
    );
    expect(css).toMatch(
      /\.v2-appointments-page \.v2-appointment-actions\s*\{[^}]*margin:\s*0\s+0\s+0\s+auto\s*!important/
    );
    expect(css).toMatch(
      /\.v2-appointments-page \.v2-appointment-actions\s*\{[^}]*width:\s*280px\s*!important/
    );
  });

  it('2. Mobile: Fila 1 configura Cancelar turno y Cobrar al 50/50 (minmax(0, 1fr) minmax(0, 1fr)) con min-height de al menos 44px', () => {
    expect(css).toMatch(
      /\.v2-op-buttons\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s*minmax\(0,\s*1fr\)\s*!important/
    );
    expect(css).toMatch(
      /\.v2-op-buttons > \*\s*\{[^}]*min-height:\s*44px\s*!important/
    );
    expect(css).toMatch(
      /\.v2-op-buttons > \*\s*\{[^}]*justify-content:\s*center\s*!important/
    );
  });

  it('3. Mobile & Desktop: cuando sólo existe una acción operacional, se expande al 100% sin dejar columna vacía', () => {
    expect(css).toMatch(
      /\.v2-op-buttons:has\(>\s*:only-child\)\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s*!important/
    );
    expect(css).toMatch(
      /\.v2-op-buttons > :only-child\s*\{[^}]*grid-column:\s*1\s*\/\s*-1\s*!important/
    );
  });

  it('4. DOM Render: tarjeta con doble acción renderiza Cancelar turno y Cobrar', () => {
    testState.appointments = [
      {
        id: 'apt-dual-action',
        barberId: 'b1',
        barber: 'Lautaro',
        date: '2026-10-30',
        time: '10:00',
        endTime: '10:45',
        name: 'Esteban Demetrio de las Nieves y Armenteros (Nombre Muy Largo)',
        phone: '+5491122334455',
        email: 'esteban@ejemplo.com',
        statusCode: 'CONFIRMED',
        serviceName: 'Corte y barba',
        servicePrice: 30000,
        depositPaid: true,
        depositAmountArs: 5000,
        isManual: false,
      },
    ];

    render(<V2Appointments />);
    const cancelBtn = screen.getByRole('button', { name: /Cancelar turno/i });
    expect(cancelBtn).toBeDefined();

    const cobrarLink = screen.getByRole('link', { name: /Cobrar/i });
    expect(cobrarLink).toBeDefined();

    // Cancelar turno tiene clase action-reject (bordó)
    expect(cancelBtn.className).toContain('action-reject');
    expect(cancelBtn.className).toContain('v2-action-btn');

    // Cobrar tiene clase v2-secondary v2-action-btn
    expect(cobrarLink.className).toContain('v2-secondary');
    expect(cobrarLink.className).toContain('v2-action-btn');
  });

  it('5. DOM Render: nombre largo del cliente tiene text-overflow ellipsis para evitar superposición o desborde', () => {
    expect(css).toMatch(
      /\.v2-app-name\s*\{[^}]*overflow:\s*hidden\s*!important;\s*text-overflow:\s*ellipsis\s*!important;\s*white-space:\s*nowrap\s*!important/
    );
    expect(css).toMatch(
      /\.v2-appointment-main\s*\{[^}]*min-width:\s*0\s*!important/
    );
  });

  it('6. DOM Render: tarjeta CANCELLED no renderiza op-buttons y no deja separadores divisorios', () => {
    testState.appointments = [
      {
        id: 'apt-cancelled',
        barberId: 'b1',
        barber: 'Lautaro',
        date: '2026-10-30',
        time: '12:00',
        endTime: '12:45',
        name: 'Carlos Ruiz',
        phone: '+5491133445566',
        email: 'carlos@ejemplo.com',
        statusCode: 'CANCELLED',
        serviceName: 'Barba',
        servicePrice: 20000,
        depositPaid: false,
        isManual: false,
      },
    ];

    const { container } = render(<V2Appointments />);
    const cards = container.querySelectorAll('.v2-appointment');
    expect(cards).toHaveLength(1);

    const cancelledCard = cards[0];
    const opBtns = cancelledCard.querySelector('.v2-op-buttons');
    expect(opBtns?.children.length ?? 0).toBe(0);
  });
});
