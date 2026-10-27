import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { businessDateToday } from '@/lib/kani-mobile-appointments';

vi.mock('@/lib/kani-admin-context', () => ({
  useAdminStaff: () => ({
    barbers: [
      { id: 'b1', name: 'Lautaro' },
      { id: 'b2', name: 'Gonzalo' },
    ],
    profile: { role: 'ADMIN', barber_id: null },
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
      { id: 'barba', dbId: 's2', name: 'Barba', price: 15000, duration: 30 },
      { id: 'corte-barba', dbId: 's3', name: 'Corte y barba', price: 35000, duration: 60 },
    ],
    depositSupported: true,
    refresh: vi.fn(),
    appointments: [
      {
        id: 'apt-conflict',
        barberId: 'b1',
        date: businessDateToday(),
        time: '14:00',
        endTime: '14:45',
        serviceDuration: 45,
        serviceName: 'Corte',
        statusCode: 'CONFIRMED',
      },
    ],
    clients: [
      { id: 'c1', name: 'Nicolás Repetto', phone: '+5491122334455', email: 'nico@test.com' },
    ],
  }),
}));

vi.mock('@/lib/kani-appointments', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/kani-appointments')>();
  return {
    ...actual,
    createManualAppointment: vi.fn().mockResolvedValue({ id: 'new-apt-id' }),
    updateManualAppointment: vi.fn().mockResolvedValue({ id: 'updated-apt-id' }),
  };
});

import { ManualAppointmentDialog } from '@/components/kani/v2/manual-appointment-dialog';
import { createManualAppointment } from '@/lib/kani-appointments';

afterEach(() => {
  cleanup();
});

describe('ManualAppointmentDialog - Selector Horario Simplificado y Buscar Cliente', () => {
  it('1. Servicio normal: calcula fin automático según duración del catálogo (Corte 45 min, Barba 30 min, Corte y barba 60 min)', () => {
    render(
      <ManualAppointmentDialog
        open={true}
        mode="CREATE"
        initialDate={businessDateToday()}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
      />
    );

    // Initial default: Corte (45 min), Inicio 10:00 -> Fin 10:45 hs
    const startSelect = screen.getByRole('combobox', { name: /Hora de inicio \*/i });
    const endInput = screen.getByLabelText(/Hora de finalización/i) as HTMLInputElement;

    expect(startSelect).toHaveValue('10:00');
    expect(endInput.value).toBe('10:45 hs');
    expect(endInput.readOnly).toBe(true);

    // Switch service to Barba (30 min) -> Fin becomes 10:30 hs
    const serviceSelect = screen.getByRole('combobox', { name: /Servicio/i });
    fireEvent.change(serviceSelect, { target: { value: 's2' } });
    expect(endInput.value).toBe('10:30 hs');

    // Switch service to Corte y barba (60 min) -> Fin becomes 11:00 hs
    fireEvent.change(serviceSelect, { target: { value: 's3' } });
    expect(endInput.value).toBe('11:00 hs');
  });

  it('2. Cambio de hora de inicio: recalcula inmediatamente la hora de fin sin texto redundante', () => {
    render(
      <ManualAppointmentDialog
        open={true}
        mode="CREATE"
        initialDate={businessDateToday()}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
      />
    );

    const startSelect = screen.getByRole('combobox', { name: /Hora de inicio \*/i });
    const endInput = screen.getByLabelText(/Hora de finalización/i) as HTMLInputElement;

    // Change start to 10:15 -> Fin becomes 11:00 hs (Corte 45 min)
    fireEvent.change(startSelect, { target: { value: '10:15' } });
    expect(endInput.value).toBe('11:00 hs');

    // Change start to 18:30 -> Fin becomes 19:15 hs
    fireEvent.change(startSelect, { target: { value: '18:30' } });
    expect(endInput.value).toBe('19:15 hs');

    // No redundant duration texts or arrows
    expect(screen.queryByText('10:15 → 11:00')).toBeNull();
    expect(screen.queryByText(/45 min/)).toBeNull();
  });

  it('3. Servicio Otro: permite definir Hora de inicio y Hora de finalización libremente en intervalos de 15m', async () => {
    render(
      <ManualAppointmentDialog
        open={true}
        mode="CREATE"
        initialDate={businessDateToday()}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
      />
    );

    fireEvent.change(screen.getByRole('combobox', { name: /Servicio/i }), {
      target: { value: 'OTRO' },
    });

    // Both start and end are editable selects
    const startSelect = screen.getByRole('combobox', { name: /Hora de inicio \*/i });
    const endSelect = screen.getByRole('combobox', { name: /Hora de finalización \*/i });

    expect(startSelect).toBeInTheDocument();
    expect(endSelect).toBeInTheDocument();

    // Set 09:30 to 11:00
    fireEvent.change(startSelect, { target: { value: '09:30' } });
    fireEvent.change(endSelect, { target: { value: '11:00' } });

    // Fill other fields
    fireEvent.change(screen.getByPlaceholderText('Ej. Tintura de color'), {
      target: { value: 'Tintura de color' },
    });
    fireEvent.change(screen.getByPlaceholderText('Ej. 35000'), {
      target: { value: '45000' },
    });
    fireEvent.change(screen.getByPlaceholderText('Ej. Lucas Fernández'), {
      target: { value: 'Mariano Martínez' },
    });
    fireEvent.change(screen.getByPlaceholderText('Ej. 11 2345 6789'), {
      target: { value: '11 4444 7777' },
    });

    // Submit
    fireEvent.click(screen.getByRole('button', { name: /Generar turno/i }));

    expect(createManualAppointment).toHaveBeenCalledWith(
      expect.objectContaining({
        time: '09:30',
        endTime: '11:00',
        durationMinutes: 90,
        customServiceName: 'Tintura de color',
        servicePriceArs: 45000,
      })
    );
  });

  it('4. Anti-solapamiento: bloquea turnos en conflicto con citas existentes para el mismo barbero y fecha', () => {
    render(
      <ManualAppointmentDialog
        open={true}
        mode="CREATE"
        initialDate={businessDateToday()}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
      />
    );

    // Existing apt for b1 (Lautaro) is 14:00-14:45
    // Select barber Lautaro
    fireEvent.change(screen.getByRole('combobox', { name: /Barbero/i }), {
      target: { value: 'b1' },
    });

    // Select start 14:15 with Corte (45 min) -> 14:15-15:00 overlaps 14:00-14:45
    const startSelect = screen.getByRole('combobox', { name: /Hora de inicio \*/i });
    fireEvent.change(startSelect, { target: { value: '14:15' } });

    // Conflict error message must be shown
    expect(screen.getByText(/Horario ocupado por otro turno/i)).toBeInTheDocument();

    // Submit button is disabled
    expect(screen.getByRole('button', { name: /Generar turno/i })).toBeDisabled();

    // Non-overlapping time 14:45 (adjacent) is permitted
    fireEvent.change(startSelect, { target: { value: '14:45' } });
    expect(screen.queryByText(/Horario ocupado por otro turno/i)).toBeNull();
  });

  it('5. Permite turnos fuera del horario comercial (07:30, 21:45, etc.)', () => {
    render(
      <ManualAppointmentDialog
        open={true}
        mode="CREATE"
        initialDate={businessDateToday()}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
      />
    );

    const startSelect = screen.getByRole('combobox', { name: /Hora de inicio \*/i });

    // 07:30 is selectable and valid
    fireEvent.change(startSelect, { target: { value: '07:30' } });
    expect(startSelect).toHaveValue('07:30');
    expect(screen.getByLabelText(/Hora de finalización/i)).toHaveValue('08:15 hs');

    // 21:45 is selectable and valid
    fireEvent.change(startSelect, { target: { value: '21:45' } });
    expect(startSelect).toHaveValue('21:45');
    expect(screen.getByLabelText(/Hora de finalización/i)).toHaveValue('22:30 hs');
  });

  it('6. Buscar cliente existente: renderiza input visible con icono y autocompleta al seleccionar', () => {
    render(
      <ManualAppointmentDialog
        open={true}
        mode="CREATE"
        initialDate={businessDateToday()}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
      />
    );

    const searchInput = screen.getByPlaceholderText('Buscar cliente existente...');
    expect(searchInput).toBeInTheDocument();

    // Type query
    fireEvent.change(searchInput, { target: { value: 'Nico' } });

    // Suggestion appears
    const suggestionBtn = screen.getByRole('button', { name: /Nicolás Repetto/i });
    expect(suggestionBtn).toBeInTheDocument();

    // Click suggestion -> auto-fills client name, phone and email
    fireEvent.click(suggestionBtn);

    expect(screen.getByPlaceholderText('Ej. Lucas Fernández')).toHaveValue('Nicolás Repetto');
    expect(screen.getByPlaceholderText('Ej. 11 2345 6789')).toHaveValue('+5491122334455');
    expect(screen.getByPlaceholderText('cliente@ejemplo.com')).toHaveValue('nico@test.com');
  });
});
