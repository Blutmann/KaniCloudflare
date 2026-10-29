import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminScheduleManager } from '@/components/kani/admin-schedule-manager';
import * as appointmentsModule from '@/lib/kani-appointments';
import * as availabilityModule from '@/lib/kani-availability';

const testState = {
  profile: { role: 'ADMIN', barber_id: null },
  barbers: [
    { id: 'b1', name: 'Lautaro' },
    { id: 'b2', name: 'Gonzalo' },
  ],
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
    profile: testState.profile,
    barbers: testState.barbers,
    refreshCount: 0,
    setIsRefreshing: vi.fn(),
  }),
}));

vi.mock('@/lib/kani-appointments', () => ({
  readRealAppointments: vi.fn(),
}));

vi.mock('@/lib/kani-availability', async () => {
  const actual = await vi.importActual<any>('@/lib/kani-availability');
  return {
    ...actual,
    readAvailabilitySlotsForRange: vi.fn().mockResolvedValue([]),
    readAvailabilityStartsForRange: vi.fn().mockResolvedValue([]),
    createAvailabilitySlots: vi.fn(),
    updateAvailabilitySlot: vi.fn(),
  };
});

describe('Admin V2 — Reactive Validation in Agregar horario de disponibilidad', () => {
  const today = '2026-10-30';
  const tomorrow = '2026-10-31';

  beforeEach(() => {
    vi.clearAllMocks();

    const mockAppointments: any[] = [
      {
        id: 'apt-1',
        barberId: 'b1',
        barber: 'Lautaro',
        date: today,
        time: '09:00',
        endTime: '09:45',
        statusCode: 'CONFIRMED',
      },
      {
        id: 'apt-2',
        barberId: 'b2',
        barber: 'Gonzalo',
        date: today,
        time: '14:00',
        endTime: '14:45',
        statusCode: 'CONFIRMED',
      },
      {
        id: 'apt-3',
        barberId: 'b1',
        barber: 'Lautaro',
        date: tomorrow,
        time: '11:00',
        endTime: '11:45',
        statusCode: 'CONFIRMED',
      },
    ];

    vi.mocked(appointmentsModule.readRealAppointments).mockResolvedValue(mockAppointments);
    vi.mocked(availabilityModule.createAvailabilitySlots).mockResolvedValue([
      {
        id: 'slot-new',
        barber_id: 'b1',
        slot_date: today,
        start_time: '10:00:00',
        end_time: '10:45:00',
        status: 'AVAILABLE',
        is_manual: true,
      },
    ]);
  });

  afterEach(() => {
    cleanup();
  });

  it('Test 1 — conflicto al seleccionar horario superpuesto', async () => {
    render(<AdminScheduleManager />);

    const addBtn = await screen.findByRole('button', { name: /agregar horario/i });
    fireEvent.click(addBtn);

    expect(screen.getByRole('dialog')).toBeInTheDocument();

    const timeSelect = document.getElementById('schedule-manual-time') as HTMLSelectElement;
    const dateInput = document.getElementById('schedule-manual-date') as HTMLInputElement;
    const submitBtn = screen.getByRole('button', { name: /guardar horario/i });

    // Set date to today
    fireEvent.change(dateInput, { target: { value: today } });

    // Select conflicting time: 09:00 (overlaps with Lautaro 09:00-09:45)
    fireEvent.change(timeSelect, { target: { value: '09:00' } });

    // Conflict error appears inside modal
    await waitFor(() => {
      const alert = screen.getByRole('alert');
      expect(alert).toBeInTheDocument();
      expect(alert.textContent).toMatch(/Lautaro tiene un turno reservado de 09:00 a 09:45/i);
    });

    // "Guardar horario" is disabled
    expect(submitBtn).toBeDisabled();

    // Clicking does not trigger submit
    fireEvent.click(submitBtn);
    expect(availabilityModule.createAvailabilitySlots).not.toHaveBeenCalled();
  });

  it('Test 2 — conflicto al cambiar fecha', async () => {
    render(<AdminScheduleManager />);

    const addBtn = await screen.findByRole('button', { name: /agregar horario/i });
    fireEvent.click(addBtn);

    const timeSelect = document.getElementById('schedule-manual-time') as HTMLSelectElement;
    const dateInput = document.getElementById('schedule-manual-date') as HTMLInputElement;
    const submitBtn = screen.getByRole('button', { name: /guardar horario/i });

    // Select time 11:00 on today (valid for Lautaro on today)
    fireEvent.change(dateInput, { target: { value: today } });
    fireEvent.change(timeSelect, { target: { value: '11:00' } });

    await waitFor(() => {
      expect(screen.queryByRole('alert')).toBeNull();
      expect(submitBtn).not.toBeDisabled();
    });

    // Change date to tomorrow (Lautaro has a booking at 11:00 on tomorrow)
    fireEvent.change(dateInput, { target: { value: tomorrow } });

    await waitFor(() => {
      const alert = screen.getByRole('alert');
      expect(alert).toBeInTheDocument();
      expect(alert.textContent).toMatch(/Lautaro tiene un turno reservado de 11:00 a 11:45/i);
      expect(submitBtn).toBeDisabled();
    });
  });

  it('Test 3 — conflicto al cambiar barbero', async () => {
    render(<AdminScheduleManager />);

    const addBtn = await screen.findByRole('button', { name: /agregar horario/i });
    fireEvent.click(addBtn);

    const barberSelect = document.getElementById('schedule-manual-barber') as HTMLSelectElement;
    const dateInput = document.getElementById('schedule-manual-date') as HTMLInputElement;
    const timeSelect = document.getElementById('schedule-manual-time') as HTMLSelectElement;
    const submitBtn = screen.getByRole('button', { name: /guardar horario/i });

    // Set today at 14:00. For Lautaro (b1), this is free.
    fireEvent.change(dateInput, { target: { value: today } });
    fireEvent.change(timeSelect, { target: { value: '14:00' } });

    await waitFor(() => {
      expect(screen.queryByRole('alert')).toBeNull();
      expect(submitBtn).not.toBeDisabled();
    });

    // Switch barber to Gonzalo (b2, who is booked at 14:00-14:45 on today)
    fireEvent.change(barberSelect, { target: { value: 'b2' } });

    await waitFor(() => {
      const alert = screen.getByRole('alert');
      expect(alert).toBeInTheDocument();
      expect(alert.textContent).toMatch(/Gonzalo tiene un turno reservado de 14:00 a 14:45/i);
      expect(submitBtn).toBeDisabled();
    });
  });

  it('Test 4 — resolución del conflicto', async () => {
    render(<AdminScheduleManager />);

    const addBtn = await screen.findByRole('button', { name: /agregar horario/i });
    fireEvent.click(addBtn);

    const dateInput = document.getElementById('schedule-manual-date') as HTMLInputElement;
    const timeSelect = document.getElementById('schedule-manual-time') as HTMLSelectElement;
    const submitBtn = screen.getByRole('button', { name: /guardar horario/i });

    // Start with conflict: Lautaro at 09:00
    fireEvent.change(dateInput, { target: { value: today } });
    fireEvent.change(timeSelect, { target: { value: '09:00' } });

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
      expect(submitBtn).toBeDisabled();
    });

    // Switch to non-overlapping time: 10:00
    fireEvent.change(timeSelect, { target: { value: '10:00' } });

    await waitFor(() => {
      expect(screen.queryByRole('alert')).toBeNull();
      expect(submitBtn).not.toBeDisabled();
    });
  });

  it('Test 5 — validación final al momento del submit muestra error en el modal', async () => {
    vi.mocked(availabilityModule.createAvailabilitySlots).mockRejectedValueOnce(
      new Error('AVAILABILITY_APPOINTMENT_CONFLICT:Lautaro:10:00:10:45')
    );

    const { container } = render(<AdminScheduleManager />);

    const addBtn = await screen.findByRole('button', { name: /agregar horario/i });
    fireEvent.click(addBtn);

    const dateInput = document.getElementById('schedule-manual-date') as HTMLInputElement;
    const timeSelect = document.getElementById('schedule-manual-time') as HTMLSelectElement;
    const submitBtn = screen.getByRole('button', { name: /guardar horario/i });

    fireEvent.change(dateInput, { target: { value: today } });
    fireEvent.change(timeSelect, { target: { value: '10:00' } });

    await waitFor(() => {
      expect(submitBtn).not.toBeDisabled();
    });

    // Click submit
    fireEvent.click(submitBtn);

    // Error must be rendered INSIDE the modal
    await waitFor(() => {
      const modalAlert = screen.getByRole('alert');
      expect(modalAlert).toBeInTheDocument();
      expect(modalAlert.textContent).toMatch(/No se puede agregar esta franja porque Lautaro tiene un turno reservado de 10:00 a 10:45/i);
    });

    // Modal is still open
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    // Page-level error behind the backdrop must NOT be present
    const globalError = container.querySelector('.admin-schedule-list')?.previousElementSibling?.querySelector('[aria-label="Cerrar error"]');
    expect(globalError).toBeNull();
  });

  it('Test 6 — respuesta asíncrona obsoleta no sobrescribe estado más reciente', async () => {
    render(<AdminScheduleManager />);

    const addBtn = await screen.findByRole('button', { name: /agregar horario/i });
    fireEvent.click(addBtn);

    let resolveSlowQuery: (val: any) => void = () => {};
    const slowPromise = new Promise((resolve) => {
      resolveSlowQuery = resolve;
    });

    // When selecting 09:00, return slowPromise (which will resolve with conflict)
    // When selecting 10:00, return fast resolved promise with no appointments
    vi.mocked(appointmentsModule.readRealAppointments)
      .mockReturnValueOnce(slowPromise as any)
      .mockResolvedValueOnce([]);

    const timeSelect = document.getElementById('schedule-manual-time') as HTMLSelectElement;
    const submitBtn = screen.getByRole('button', { name: /guardar horario/i });

    // Request 1: select 09:00 (triggers slowPromise)
    fireEvent.change(timeSelect, { target: { value: '09:00' } });

    // Request 2 immediately: select 10:00 (triggers immediate empty resolution)
    fireEvent.change(timeSelect, { target: { value: '10:00' } });

    // Fast request resolves: no error, button enabled
    await waitFor(() => {
      expect(screen.queryByRole('alert')).toBeNull();
      expect(submitBtn).not.toBeDisabled();
    });

    // Now resolve slow request with conflict
    resolveSlowQuery([
      {
        id: 'apt-late',
        barberId: 'b1',
        barber: 'Lautaro',
        date: today,
        time: '09:00',
        endTime: '09:45',
        statusCode: 'CONFIRMED',
      },
    ]);

    // Wait microtasks
    await new Promise((r) => setTimeout(r, 60));

    // Stale response must NOT overwrite 10:00 state!
    expect(screen.queryByRole('alert')).toBeNull();
    expect(submitBtn).not.toBeDisabled();
  });
});
