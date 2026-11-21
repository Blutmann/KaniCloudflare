import fs from 'node:fs';
import path from 'node:path';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { V2Appointments } from '@/components/kani/v2/agenda';
import { ManualAppointmentDialog } from '@/components/kani/v2/manual-appointment-dialog';
import { AdminScheduleManager, findFirstValidManualTime } from '@/components/kani/admin-schedule-manager';
import { formatV2AgendaPeriodLabel, v2AgendaPeriodOrder } from '@/lib/kani-mobile-appointments';
import * as appointmentsModule from '@/lib/kani-appointments';
import * as availabilityModule from '@/lib/kani-availability';

const today = '2026-11-21';

const testState = {
  role: 'ADMIN' as 'ADMIN' | 'MANAGER' | 'BARBER',
  barberId: 'ALL',
  profileBarberId: null as string | null,
  appointments: [] as any[],
  clients: [
    { id: 'c1', name: 'Lucas Fernández', phone: '+5491155551111', email: 'lucas@ejemplo.com', archived: false },
    { id: 'c2', name: 'Matías Zárate', phone: '+5491155552222', email: 'matias@ejemplo.com', archived: false },
  ],
  refreshMock: vi.fn().mockResolvedValue(undefined),
  setBarberIdMock: vi.fn((next: string) => {
    testState.barberId = next;
  }),
};

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to, className }: any) => (
    <a href={to} className={className}>
      {children}
    </a>
  ),
  useRouter: () => ({ invalidate: vi.fn() }),
}));

vi.mock('@/lib/kani-admin-context', () => ({
  useAdminStaff: () => ({
    profile: {
      id: 'u1',
      user_id: 'u1',
      role: testState.role,
      barber_id: testState.profileBarberId,
      display_name: testState.role === 'BARBER' ? 'Lautaro' : 'Admin',
      active: true,
    },
    barbers: [
      { id: 'b-lautaro', name: 'Lautaro', active: true },
      { id: 'b-franco', name: 'Franco', active: true },
    ],
    refreshCount: 0,
    setIsRefreshing: vi.fn(),
  }),
}));

vi.mock('@/components/kani/v2/data', () => ({
  useV2: () => ({
    appointments: testState.appointments,
    barberId: testState.barberId,
    setBarberId: testState.setBarberIdMock,
    clients: testState.clients,
    services: [
      { id: 's-corte', dbId: 's-corte', name: 'Corte de cabello', duration_minutes: 45, price_ars: 25000, active: true },
    ],
    payments: [],
    availableStarts: [],
    refresh: testState.refreshMock,
    loading: false,
    error: '',
  }),
}));

vi.mock('@/lib/kani-mobile-appointments', async () => {
  const actual = await vi.importActual<any>('@/lib/kani-mobile-appointments');
  return {
    ...actual,
    businessDateToday: () => today,
  };
});

vi.mock('@/lib/kani-payments', async () => {
  const actual = await vi.importActual<any>('@/lib/kani-payments');
  return {
    ...actual,
    businessTimeNow: () => '09:00',
  };
});

vi.mock('@/lib/kani-appointments', async () => {
  const actual = await vi.importActual<any>('@/lib/kani-appointments');
  return {
    ...actual,
    readRealAppointments: vi.fn().mockResolvedValue([]),
    updateRealAppointmentStatus: vi.fn().mockResolvedValue(undefined),
    createManualAppointment: vi.fn().mockResolvedValue({ id: 'new-apt' }),
    updateManualAppointment: vi.fn().mockResolvedValue({ id: 'upd-apt' }),
  };
});

vi.mock('@/lib/kani-availability', async () => {
  const actual = await vi.importActual<any>('@/lib/kani-availability');
  return {
    ...actual,
    readAvailabilitySlotsForRange: vi.fn().mockResolvedValue([]),
    readAvailabilityStartsForRange: vi.fn().mockResolvedValue([]),
    createAvailabilitySlots: vi.fn().mockResolvedValue([]),
    updateAvailabilitySlot: vi.fn(),
  };
});

function makeAppointment(overrides: Partial<any> = {}) {
  return {
    id: 'apt-1',
    barberId: 'b-lautaro',
    barber: 'Lautaro',
    date: today,
    time: '10:00',
    endTime: '10:45',
    serviceDuration: 45,
    statusCode: 'CONFIRMED',
    name: 'Matías Zárate',
    phone: '+5491155552222',
    email: 'matias@ejemplo.com',
    serviceName: 'Corte',
    price: 25000,
    depositRequired: true,
    depositPaid: true,
    depositAmountArs: 5000,
    balancePaid: false,
    isManual: false,
    ...overrides,
  };
}

describe('KANI UX v3.1 — Regresión Turnos y Agenda', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    testState.role = 'ADMIN';
    testState.barberId = 'ALL';
    testState.profileBarberId = null;
    testState.appointments = [
      makeAppointment({ id: 'apt-1', barberId: 'b-lautaro', barber: 'Lautaro', statusCode: 'CONFIRMED', name: 'Matías Zárate', time: '19:00', endTime: '19:45' }),
      makeAppointment({ id: 'apt-2', barberId: 'b-franco', barber: 'Franco', statusCode: 'PENDING', name: 'Lucas Fernández', time: '20:30', endTime: '21:30' }),
    ];
  });

  afterEach(() => {
    cleanup();
    window.localStorage.clear();
  });

  it('T-06: ManualAppointmentDialog permite buscar, seleccionar y limpiar clientes, y CSS asigna >=40px de padding-left', () => {
    const v2Css = fs.readFileSync(path.resolve(process.cwd(), 'src/components/kani/v2/v2.css'), 'utf8');
    const unifiedCss = fs.readFileSync(path.resolve(process.cwd(), 'src/components/kani/kani-unified-modals.css'), 'utf8');
    expect(v2Css).toContain('padding-inline-start: 40px');
    expect(unifiedCss).toContain('padding-left: 40px');

    render(
      <ManualAppointmentDialog
        open={true}
        mode="CREATE"
        initialDate={today}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
      />,
    );

    const searchInput = screen.getByPlaceholderText('Buscar cliente existente...') as HTMLInputElement;
    fireEvent.focus(searchInput);
    fireEvent.change(searchInput, { target: { value: 'Lucas' } });

    const suggestionBtn = screen.getByRole('button', { name: /Lucas Fernández/i });
    expect(suggestionBtn).toBeInTheDocument();

    fireEvent.click(suggestionBtn);
    expect((screen.getByPlaceholderText('Ej. Lucas Fernández') as HTMLInputElement).value).toBe('Lucas Fernández');

    fireEvent.change(searchInput, { target: { value: '' } });
    expect(searchInput.value).toBe('');
  });

  it('T-04: Modal Cancelar turno tiene título estándar, contexto, mensaje claro, botones Volver / Confirmar cancelación con jerarquía destructiva y no cierra ante error', async () => {
    render(<V2Appointments />);

    const cancelTrigger = screen.getAllByRole('button', { name: 'Cancelar turno' })[0];
    fireEvent.click(cancelTrigger);

    expect(screen.getByRole('heading', { name: 'Cancelar turno' })).toBeInTheDocument();
    expect(screen.getByText('¿Querés cancelar este turno?')).toBeInTheDocument();
    expect(screen.getByText('El turno quedará registrado como cancelado.')).toBeInTheDocument();
    expect(screen.getByText('19:00 – 19:45 hs')).toBeInTheDocument();

    const backBtn = screen.getByRole('button', { name: 'Volver' });
    const confirmInitialBtn = screen.getByRole('button', { name: 'Confirmar cancelación' });
    expect(backBtn).toHaveClass('v2-cancel-back-btn');
    expect(confirmInitialBtn).toHaveClass('action-reject', 'v2-cancel-confirm-btn');

    // Cerrar con Volver no ejecuta cancelación
    fireEvent.click(backBtn);
    expect(appointmentsModule.updateRealAppointmentStatus).not.toHaveBeenCalled();

    // Reabrir y probar error de servidor: no debe cerrar el modal
    fireEvent.click(screen.getAllByRole('button', { name: 'Cancelar turno' })[0]);
    vi.mocked(appointmentsModule.updateRealAppointmentStatus).mockRejectedValueOnce(new Error('Error de red simulado'));

    fireEvent.click(screen.getByRole('button', { name: 'Confirmar cancelación' }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Error de red simulado');
    });
    expect(screen.getByRole('heading', { name: 'Cancelar turno' })).toBeInTheDocument();

    // Confirmación exitosa + bloqueo de doble envío mientras está pendiente
    let resolveConfirm!: () => void;
    vi.mocked(appointmentsModule.updateRealAppointmentStatus).mockImplementationOnce(
      () => new Promise((resolve) => { resolveConfirm = resolve; }),
    );
    const confirmBtn = screen.getByRole('button', { name: 'Confirmar cancelación' });
    fireEvent.click(confirmBtn);

    expect(screen.getByRole('button', { name: 'Cancelando…' })).toBeDisabled();
    expect(appointmentsModule.updateRealAppointmentStatus).toHaveBeenCalledTimes(2);

    resolveConfirm();
    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: 'Cancelar turno' })).not.toBeInTheDocument();
    });
  });

  it('T-05 y T-08: ADMIN ve filtro Barbero y estados reales; BARBER oculta Barbero y ve solo sus turnos; etiquetas compactas', () => {
    const labels = v2AgendaPeriodOrder.map((p) => formatV2AgendaPeriodLabel(p, today));
    expect(labels).toContain('Próx. 5 días');
    expect(labels).toContain('Próx. 10 días');
    expect(labels).toContain('Personalizado');

    const { unmount } = render(<V2Appointments />);
    expect(document.getElementById('v2-appointments-barber')).toBeInTheDocument();
    const statusSelect = document.getElementById('v2-appointments-status') as HTMLSelectElement;
    const statusValues = Array.from(statusSelect.options).map((o) => o.value);
    expect(statusValues).toEqual(['ALL', 'CONFIRMED', 'PENDING', 'COMPLETED', 'CANCELLED', 'NO_SHOW']);

    fireEvent.change(statusSelect, { target: { value: 'PENDING' } });
    expect(screen.getByText('Lucas Fernández')).toBeInTheDocument();
    expect(screen.queryByText('Matías Zárate')).not.toBeInTheDocument();
    unmount();

    // BARBER role
    testState.role = 'BARBER';
    testState.profileBarberId = 'b-lautaro';
    render(<V2Appointments />);
    expect(document.getElementById('v2-appointments-barber')).not.toBeInTheDocument();
    expect(screen.getByText('Matías Zárate')).toBeInTheDocument();
    expect(screen.queryByText('Lucas Fernández')).not.toBeInTheDocument();
  });

  it('A-03: findFirstValidManualTime elige el primer horario libre sin conflictos y AdminScheduleManager muestra intervalo simplificado', async () => {
    const picked = findFirstValidManualTime({
      barberId: 'b-lautaro',
      date: today,
      today,
      nowTime: '10:15',
      existingSlots: [
        { barber_id: 'b-lautaro', slot_date: today, start_time: '10:30:00' },
      ],
      appointments: [makeAppointment({ time: '11:00', endTime: '11:45' })],
    });
    expect(picked).toBe('11:45');

    const nonePast = findFirstValidManualTime({
      barberId: 'b-lautaro',
      date: '2026-11-20',
      today,
      nowTime: '09:30',
      existingSlots: [],
      appointments: [],
    });
    expect(nonePast).toBeNull();

    vi.mocked(appointmentsModule.readRealAppointments).mockResolvedValue([
      makeAppointment({ time: '10:00', endTime: '10:45' }),
    ]);

    render(<AdminScheduleManager />);
    await waitFor(() => {
      expect(availabilityModule.readAvailabilitySlotsForRange).toHaveBeenCalled();
    });

    fireEvent.click(screen.getByRole('button', { name: /\+ Agregar horario/i }));
    expect(screen.getByRole('heading', { name: 'Agregar horario' })).toBeInTheDocument();
    const intervalHint = document.querySelector('.admin-schedule-interval-hint');
    expect(intervalHint?.textContent).toMatch(/^\d{2}:\d{2} – \d{2}:\d{2} · \d+ min$/);
    expect(intervalHint?.textContent).not.toContain('Franja:');
    expect(intervalHint?.textContent).not.toContain('hs');
    expect(screen.getByRole('button', { name: 'Agregar horario' })).toBeInTheDocument();

    // Seleccionar 10:00 (con conflicto) muestra alerta de conflicto
    const timeSelect = document.getElementById('schedule-manual-time') as HTMLSelectElement;
    fireEvent.change(timeSelect, { target: { value: '10:00' } });
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/10:00 a 10:45/);
    });
  });
});
