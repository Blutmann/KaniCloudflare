// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import {
  addCalendarDays,
  businessDateToday,
  formatV2AgendaPeriodLabel,
  v2AgendaPeriodOrder,
} from '@/lib/kani-mobile-appointments';

const testState = vi.hoisted(() => ({
  appointments: [] as any[],
  barbers: [
    { id: 'b1', name: 'Lautaro' },
    { id: 'b2', name: 'Gonzalo' },
  ],
  refresh: vi.fn(),
  setBarberId: vi.fn(),
  barberId: 'ALL',
}));

vi.mock('@/lib/kani-admin-context', () => ({
  useAdminStaff: () => ({
    profile: { role: 'ADMIN', barber_id: null, display_name: 'Kani Admin' },
    barbers: testState.barbers,
  }),
}));

vi.mock('@/components/kani/v2/data', () => ({
  useV2: () => ({
    barberId: testState.barberId,
    setBarberId: testState.setBarberId,
    barbers: testState.barbers,
    services: [{ id: 'corte', dbId: 's1', name: 'Corte', price: 25000, duration: 45 }],
    clients: [],
    payments: [],
    depositSupported: true,
    loading: false,
    refresh: testState.refresh,
    appointments: testState.appointments,
  }),
}));

vi.mock('@/lib/kani-appointments', () => ({
  updateRealAppointmentStatus: vi.fn(),
  appointmentErrorMessage: String,
}));

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, className }: any) => <a className={className}>{children}</a>,
}));

import { V2Appointments } from '@/components/kani/v2/agenda';

describe('V12.47.25.1 — Etiquetas de período y distribución de filtros en Turnos', () => {
  beforeEach(() => {
    window.localStorage.clear();
    testState.appointments = [];
    testState.barberId = 'ALL';
  });

  afterEach(() => {
    cleanup();
    window.localStorage.clear();
  });

  it('1. Genera las 9 etiquetas simplificadas y en el orden exacto', () => {
    const today = '2026-11-16';
    const labels = v2AgendaPeriodOrder.map((p) => formatV2AgendaPeriodLabel(p, today));
    expect(labels).toEqual([
      'Hoy',
      'Próximos 5 días',
      '16 - 22 Nov.',
      'Próximos 10 días',
      'Noviembre 2026',
      'Octubre 2026',
      '2026',
      'Rango personalizado',
      'Fecha exacta',
    ]);
  });

  it('2. Formatea rangos semanales dentro del mismo mes, entre meses, entre años y en febrero bisiesto', () => {
    expect(formatV2AgendaPeriodLabel('THIS_WEEK', '2026-11-16')).toBe('16 - 22 Nov.');
    expect(formatV2AgendaPeriodLabel('THIS_WEEK', '2026-11-01')).toBe('26 Oct. - 1 Nov.');
    expect(formatV2AgendaPeriodLabel('THIS_WEEK', '2026-12-30')).toBe('28 Dic. 2026 - 3 Ene. 2027');
    expect(formatV2AgendaPeriodLabel('THIS_WEEK', '2024-02-28')).toBe('26 Feb. - 3 Mar.');
    expect(formatV2AgendaPeriodLabel('THIS_MONTH', '2024-02-29')).toBe('Febrero 2024');
    expect(formatV2AgendaPeriodLabel('PREVIOUS_MONTH', '2024-03-01')).toBe('Febrero 2024');
  });

  it('3. Distribución predeterminada 2x2: Fila 1 (Período | Barbero), Fila 2 (Fecha | Estado)', () => {
    const { container } = render(<V2Appointments />);
    const panel = container.querySelector('.v2-turnos-filter-panel');
    expect(panel).toBeInTheDocument();
    expect(panel?.classList.contains('is-custom-range')).toBe(false);

    const labels = Array.from(panel!.querySelectorAll('.v2-admin-filter-label')).map((el) =>
      el.textContent?.trim(),
    );
    expect(labels).toEqual(['Período', 'Barbero', 'Fecha', 'Estado']);
  });

  it('4. Distribución Rango personalizado: Fila 1 (Período | Barbero), Fila 2 (Fecha desde | Fecha hasta), Fila 3 (Estado full width)', () => {
    const { container } = render(<V2Appointments />);
    const periodSelect = screen.getByLabelText('Período') as HTMLSelectElement;

    fireEvent.change(periodSelect, { target: { value: 'CUSTOM' } });

    const panel = container.querySelector('.v2-turnos-filter-panel');
    expect(panel?.classList.contains('is-custom-range')).toBe(true);

    const labels = Array.from(panel!.querySelectorAll('.v2-admin-filter-label')).map((el) =>
      el.textContent?.trim(),
    );
    expect(labels).toEqual(['Período', 'Barbero', 'Fecha desde', 'Fecha hasta', 'Estado']);

    const statusCell = container.querySelector('.v2-turnos-status-full');
    expect(statusCell).toBeInTheDocument();
    expect(statusCell?.textContent).toContain('Estado');
  });

  it('5. Al salir de Rango personalizado vuelve a llamarse Fecha y preserva valores y selección automática de Fecha exacta', () => {
    const today = businessDateToday();
    const nextDay = addCalendarDays(today, 2);
    const customEnd = addCalendarDays(today, 5);
    render(<V2Appointments />);

    const periodSelect = screen.getByLabelText('Período') as HTMLSelectElement;
    const fechaInput = screen.getByLabelText('Fecha') as HTMLInputElement;

    // Seleccionar fecha manualmente cambia a Fecha exacta
    fireEvent.change(fechaInput, { target: { value: nextDay } });
    expect(periodSelect.value).toBe('DATE');

    // Pasar a Rango personalizado convierte Fecha -> Fecha desde
    fireEvent.change(periodSelect, { target: { value: 'CUSTOM' } });
    const fechaDesdeInput = screen.getByLabelText('Fecha desde') as HTMLInputElement;
    const fechaHastaInput = screen.getByLabelText('Fecha hasta') as HTMLInputElement;
    expect(fechaDesdeInput.value).toBe(nextDay);
    fireEvent.change(fechaHastaInput, { target: { value: customEnd } });

    // Volver a otro período restaura el label a Fecha y oculta Fecha hasta
    fireEvent.change(periodSelect, { target: { value: 'TODAY' } });
    expect(screen.getByLabelText('Fecha')).toBeInTheDocument();
    expect(screen.queryByLabelText('Fecha desde')).toBeNull();
    expect(screen.queryByLabelText('Fecha hasta')).toBeNull();

    // Regresar a Rango personalizado conserva Fecha hasta previa y mantiene validación
    fireEvent.change(periodSelect, { target: { value: 'CUSTOM' } });
    expect((screen.getByLabelText('Fecha desde') as HTMLInputElement).value).toBe(today);
    expect((screen.getByLabelText('Fecha hasta') as HTMLInputElement).value).toBe(customEnd);
  });

  it('6. Las tarjetas de turnos y botones Cobrar | Cancelar turno continúan funcionando', () => {
    const today = businessDateToday();
    testState.appointments = [
      {
        id: 'apt-1',
        barberId: 'b1',
        barber: 'Lautaro',
        date: today,
        time: '23:15',
        endTime: '23:45',
        name: 'Cliente Test',
        phone: '+5491122334455',
        statusCode: 'CONFIRMED',
        serviceName: 'Corte',
        servicePrice: 25000,
      },
    ];

    const { container } = render(<V2Appointments />);
    expect(screen.getByText('Cliente Test')).toBeInTheDocument();
    const actionButtons = Array.from(container.querySelectorAll('.v2-action-btn')).map((el) =>
      el.textContent?.trim(),
    );
    expect(actionButtons.slice(0, 2)).toEqual(['Cobrar', 'Cancelar turno']);
  });
});
