import { render, screen, fireEvent, cleanup, within, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { addCalendarDays, businessDateToday } from '@/lib/kani-mobile-appointments';

type MockAppointment = {
  id: string;
  barberId: string;
  date: string;
  statusCode: 'PENDING' | 'CONFIRMED' | 'COMPLETED' | 'NO_SHOW' | 'CANCELLED';
  time: string;
  endTime?: string;
  name: string;
  phone: string;
  email?: string;
  serviceName: string;
  barber: string;
  servicePrice?: number;
  recurringRuleId?: string | null;
};

const mocks = vi.hoisted(() => ({
  updateStatus: vi.fn().mockResolvedValue('CANCELLED'),
  refresh: vi.fn().mockResolvedValue(undefined),
  appointments: [] as MockAppointment[],
}));

vi.mock('@/lib/kani-admin-context', () => ({
  useAdminStaff: () => ({ barbers: [], profile: { role: 'ADMIN', barber_id: null } }),
}));
vi.mock('./data', () => ({
  useV2: () => ({
    barberId: 'ALL',
    setBarberId: vi.fn(),
    barbers: [],
    depositSupported: true,
    refresh: mocks.refresh,
    appointments: mocks.appointments,
  }),
}));
vi.mock('@/lib/kani-appointments', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/kani-appointments')>();
  return {
    ...actual,
    updateRealAppointmentStatus: (...args: unknown[]) => mocks.updateStatus(...args),
    appointmentErrorMessage: String,
  };
});
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, ...props }: any) => <a {...props}>{children}</a>,
}));

import { V2Appointments } from './agenda';

function makeAppt(overrides: Partial<MockAppointment> = {}): MockAppointment {
  return {
    id: 'a',
    barberId: 'b',
    date: addCalendarDays(businessDateToday(), 1),
    statusCode: 'CONFIRMED',
    time: '15:00',
    endTime: '15:45',
    name: 'Cliente Test',
    phone: '+54 9 11 2843-6014',
    email: 'cliente@example.com',
    serviceName: 'Corte',
    barber: 'Lautaro',
    servicePrice: 25000,
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  mocks.updateStatus.mockReset().mockResolvedValue('CANCELLED');
  mocks.refresh.mockReset().mockResolvedValue(undefined);
  mocks.appointments = [];
  window.localStorage?.clear();
});

describe('V2Appointments status lifecycle, filter & contextual modal', () => {
  it('shows cancellation with confirmation and direct WhatsApp link, without manual approval actions', () => {
    mocks.appointments = [makeAppt({ statusCode: 'PENDING', date: addCalendarDays(businessDateToday(), 1) })];
    render(<V2Appointments />);

    expect(screen.queryByRole('button', { name: 'Confirmar' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Rechazar' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Enviar correo' })).toBeNull();

    const waLink = screen.getByRole('link', { name: 'WhatsApp' });
    expect(waLink).toBeInTheDocument();
    expect(waLink).toHaveAttribute(
      'href',
      'https://api.whatsapp.com/send/?phone=5491128436014&text&type=phone_number&app_absent=0',
    );
    expect(waLink).toHaveAttribute('target', '_blank');

    fireEvent.click(screen.getByRole('button', { name: 'Cancelar turno' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: 'Cancelar turno' })).toBeInTheDocument();
    expect(mocks.updateStatus).not.toHaveBeenCalled();
  });

  it('does not offer cancellation for terminal states and explains when phone is missing', () => {
    mocks.appointments = [makeAppt({ statusCode: 'CANCELLED', phone: '' })];
    render(<V2Appointments />);

    expect(screen.queryByRole('button', { name: 'Cancelar turno' })).toBeNull();
    const waBtn = screen.getByRole('button', { name: 'WhatsApp' });
    expect(waBtn).toBeInTheDocument();
    fireEvent.click(waBtn);
    expect(screen.getByRole('heading', { name: 'Sin número de contacto' })).toBeInTheDocument();
  });

  it('exposes all 4 real statuses in the Estado filter and renders unified status labels', () => {
    const tomorrow = addCalendarDays(businessDateToday(), 1);
    mocks.appointments = [
      makeAppt({ id: 'c1', date: tomorrow, time: '10:00', name: 'Ana Confirmada', statusCode: 'CONFIRMED' }),
      makeAppt({ id: 'c2', date: tomorrow, time: '11:00', name: 'Beto Completado', statusCode: 'COMPLETED' }),
      makeAppt({ id: 'c3', date: tomorrow, time: '12:00', name: 'Carla Inasistencia', statusCode: 'NO_SHOW' }),
      makeAppt({ id: 'c4', date: tomorrow, time: '13:00', name: 'Diego Cancelado', statusCode: 'CANCELLED' }),
    ];

    render(<V2Appointments />);

    const statusSelect = screen.getByLabelText('Estado') as HTMLSelectElement;
    const optionTexts = Array.from(statusSelect.options).map((o) => o.textContent);
    expect(optionTexts).toEqual([
      'Todos',
      'Confirmado',
      'Completado',
      'Inasistencia',
      'Cancelado',
    ]);

    expect(screen.getByText('Ana Confirmada')).toBeInTheDocument();
    expect(screen.getByText('Beto Completado')).toBeInTheDocument();
    expect(screen.getByText('Carla Inasistencia')).toBeInTheDocument();
    expect(screen.getByText('Diego Cancelado')).toBeInTheDocument();

    fireEvent.change(statusSelect, { target: { value: 'COMPLETED' } });
    expect(screen.getByText('Beto Completado')).toBeInTheDocument();
    expect(screen.queryByText('Ana Confirmada')).toBeNull();
    expect(screen.queryByText('Carla Inasistencia')).toBeNull();
    expect(screen.queryByText('Diego Cancelado')).toBeNull();
    expect(document.querySelector('.v2-status-completed')).toHaveTextContent('Completado');

    fireEvent.change(statusSelect, { target: { value: 'NO_SHOW' } });
    expect(screen.getByText('Carla Inasistencia')).toBeInTheDocument();
    expect(screen.queryByText('Beto Completado')).toBeNull();
    expect(document.querySelector('.v2-status-no_show')).toHaveTextContent('Inasistencia');

    fireEvent.change(statusSelect, { target: { value: 'CANCELLED' } });
    expect(screen.getByText('Diego Cancelado')).toBeInTheDocument();
    expect(screen.queryByText('Carla Inasistencia')).toBeNull();
    expect(document.querySelector('.v2-status-cancelled')).toHaveTextContent('Cancelado');

    fireEvent.change(statusSelect, { target: { value: 'CONFIRMED' } });
    expect(screen.getByText('Ana Confirmada')).toBeInTheDocument();
    expect(screen.queryByText('Diego Cancelado')).toBeNull();
    expect(document.querySelector('.v2-status-confirmed')).toHaveTextContent('Confirmado');
  });

  it('opens Cancelar turno modal for future appointments and calls updateRealAppointmentStatus with CANCELLED', async () => {
    const tomorrow = addCalendarDays(businessDateToday(), 1);
    mocks.appointments = [makeAppt({ id: 'future-1', date: tomorrow, time: '16:00', statusCode: 'CONFIRMED' })];

    render(<V2Appointments />);

    fireEvent.click(screen.getByRole('button', { name: 'Cancelar turno' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: 'Cancelar turno' })).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Marcar inasistencia' })).toBeNull();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancelar turno' }));
    await waitFor(() => {
      expect(mocks.updateStatus).toHaveBeenCalledWith('future-1', 'CANCELLED');
    });
  });

  it('opens Cerrar turno pasado modal for past CONFIRMED appointments with Marcar inasistencia (NO_SHOW) and Cancelar turno (CANCELLED)', async () => {
    const yesterday = addCalendarDays(businessDateToday(), -1);
    mocks.appointments = [
      makeAppt({ id: 'past-1', date: yesterday, time: '10:00', endTime: '10:45', statusCode: 'CONFIRMED' }),
    ];

    render(<V2Appointments />);

    // Select yesterday via date input so the past appointment is visible
    const dateInput = screen.getByLabelText('Fecha');
    fireEvent.change(dateInput, { target: { value: yesterday } });

    expect(document.querySelector('.v2-past-badge')).toHaveTextContent('Finalizado');

    fireEvent.click(screen.getByRole('button', { name: 'Cancelar turno' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: 'Cerrar turno pasado' })).toBeInTheDocument();
    expect(within(dialog).getByText('¿El cliente no asistió o necesitás cancelarlo?')).toBeInTheDocument();

    const noShowBtn = within(dialog).getByRole('button', { name: 'Marcar inasistencia' });
    const cancelBtn = within(dialog).getByRole('button', { name: 'Cancelar turno' });
    expect(noShowBtn).toBeInTheDocument();
    expect(cancelBtn).toBeInTheDocument();

    // Primary action: Marcar inasistencia -> NO_SHOW
    fireEvent.click(noShowBtn);
    await waitFor(() => {
      expect(mocks.updateStatus).toHaveBeenCalledWith('past-1', 'NO_SHOW');
    });

    // Reopen and test secondary action: Cancelar turno -> CANCELLED
    mocks.updateStatus.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar turno' }));
    const dialog2 = screen.getByRole('dialog');
    fireEvent.click(within(dialog2).getByRole('button', { name: 'Cancelar turno' }));
    await waitFor(() => {
      expect(mocks.updateStatus).toHaveBeenCalledWith('past-1', 'CANCELLED');
    });
  });

  it('hides Finalizado pill, Cobrar, and Cancelar turno when past appointment is COMPLETED or NO_SHOW while keeping WA and Mail', () => {
    const yesterday = addCalendarDays(businessDateToday(), -1);
    mocks.appointments = [
      makeAppt({
        id: 'past-completed',
        date: yesterday,
        time: '10:00',
        endTime: '10:45',
        name: 'Cliente Completado',
        statusCode: 'COMPLETED',
      }),
      makeAppt({
        id: 'past-noshow',
        date: yesterday,
        time: '11:00',
        endTime: '11:45',
        name: 'Cliente Ausente',
        statusCode: 'NO_SHOW',
      }),
    ];

    render(<V2Appointments />);

    const dateInput = screen.getByLabelText('Fecha');
    fireEvent.change(dateInput, { target: { value: yesterday } });

    expect(screen.getByText('Cliente Completado')).toBeInTheDocument();
    expect(screen.getByText('Cliente Ausente')).toBeInTheDocument();

    // No "Finalizado" badge for COMPLETED or NO_SHOW
    expect(document.querySelectorAll('.v2-past-badge')).toHaveLength(0);
    // No Cobrar link or Cancelar turno button
    expect(screen.queryByRole('link', { name: 'Cobrar' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Cancelar turno' })).toBeNull();
    // WhatsApp and Mail contact links remain available for both cards
    expect(screen.getAllByRole('link', { name: 'WhatsApp' })).toHaveLength(2);
    expect(screen.getAllByRole('link', { name: 'Mail' })).toHaveLength(2);
  });
});
