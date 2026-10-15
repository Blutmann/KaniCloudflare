import { describe, expect, it } from 'vitest';
import { buildDailyDemand, buildOccupancyCells, getDashboardRange, hasComparableMetrics, summarizeAppointments, type DashboardRange } from './kani-dashboard';
import type { RealAppointment } from './kani-appointments';
import type { DashboardAvailabilitySlot } from './kani-availability';

const range: DashboardRange = { startDate: '2026-10-05', endDate: '2026-10-10', label: 'test' };

function appointment(overrides: Partial<RealAppointment>): RealAppointment {
  return {
    id: 'appointment-1',
    requestNumber: 1,
    service: 'corte',
    barber: 'Lautaro',
    date: '2026-10-10',
    time: '10:00',
    name: 'Test',
    email: 'test@example.com',
    phone: '1111111111',
    status: 'Pendiente',
    notes: '',
    statusCode: 'PENDING',
    barberId: 'barber-1',
    serviceId: 'service-1',
    ...overrides,
  };
}

function slot(overrides: Partial<DashboardAvailabilitySlot>): DashboardAvailabilitySlot {
  return {
    id: 'slot-1',
    barber_id: 'barber-1',
    slot_date: '2026-10-10',
    start_time: '10:00:00',
    end_time: '11:00:00',
    status: 'AVAILABLE',
    ...overrides,
  };
}

describe('dashboard de demanda', () => {
  it('calcula la semana laboral y no inventa una tasa sin turnos resueltos', () => {
    expect(getDashboardRange('week', '', '', '2026-10-10')).toMatchObject({ startDate: '2026-10-05', endDate: '2026-10-10' });
    expect(summarizeAppointments([])).toMatchObject({ requested: 0, confirmed: 0, pending: 0, cancelled: 0, resolved: 0, confirmationRate: null });
  });

  it('cuenta estados una sola vez y calcula confirmación sobre turnos resueltos', () => {
    const values = summarizeAppointments([
      appointment({ statusCode: 'CONFIRMED' }),
      appointment({ id: 'appointment-2', statusCode: 'CANCELLED' }),
      appointment({ id: 'appointment-3', statusCode: 'PENDING' }),
      appointment({ id: 'appointment-4', statusCode: 'COMPLETED' }),
    ]);
    expect(values).toMatchObject({ requested: 4, confirmed: 1, pending: 1, cancelled: 1, completed: 1, resolved: 3, confirmationRate: 1 / 3 });
    expect(hasComparableMetrics(values, summarizeAppointments([appointment({ statusCode: 'CONFIRMED' })]))).toBe(true);
    expect(hasComparableMetrics(values, summarizeAppointments([appointment({ statusCode: 'PENDING' })]))).toBe(false);
  });

  it('agrupa solicitudes por lunes a sábado y separa confirmados', () => {
    const values = buildDailyDemand([
      appointment({ date: '2026-10-05', statusCode: 'PENDING' }),
      appointment({ id: 'appointment-2', date: '2026-10-10', statusCode: 'CONFIRMED' }),
      appointment({ id: 'appointment-4', date: '2026-10-10', statusCode: 'COMPLETED' }),
      appointment({ id: 'appointment-3', date: '2026-10-11', statusCode: 'CONFIRMED' }),
    ], range);
    expect(values.find(value => value.label === 'Lun')).toMatchObject({ requested: 1, confirmed: 0 });
    expect(values.find(value => value.label === 'Sáb')).toMatchObject({ requested: 2, confirmed: 1 });
    expect(values.reduce((sum, value) => sum + value.requested, 0)).toBe(3);
  });

  it('clasifica una franja ocupada, disponible y bloqueada sin contar disponibilidad como reserva', () => {
    const { cells } = buildOccupancyCells([
      slot({ id: 'slot-available' }),
      slot({ id: 'slot-blocked', start_time: '11:00:00', end_time: '12:00:00', status: 'UNAVAILABLE' }),
    ], [appointment({ statusCode: 'CONFIRMED' })], range);
    expect(cells.find(cell => cell.key === '6-10:00')).toMatchObject({ total: 1, confirmed: 1, available: 0, unavailable: 0 });
    expect(cells.find(cell => cell.key === '6-11:00')).toMatchObject({ total: 1, confirmed: 0, available: 0, unavailable: 1 });
  });
});
