import { describe, expect, it } from 'vitest';
import type { RealAppointment } from './kani-appointments';
import {
  addCalendarDays,
  appointmentsPresetLabels,
  appointmentsPresets,
  businessDateToday,
  dateRangeForAppointmentsPreset,
  dateRangeForSchedulePreset,
  filterMobileAppointments,
  startOfBusinessWeek,
} from './kani-mobile-appointments';

function appointment(overrides: Partial<RealAppointment>): RealAppointment {
  return {
    id: 'a-1',
    requestNumber: 1,
    service: 'corte',
    barber: 'Lautaro',
    date: '2026-10-10',
    time: '10:00',
    name: 'Cliente de prueba',
    email: 'test@example.com',
    phone: '1111111111',
    status: 'Pendiente',
    notes: '',
    statusCode: 'PENDING',
    barberId: 'barber-lautaro',
    serviceId: 'service-1',
    ...overrides,
  };
}

const adminOptions = {
  dateRange: null,
  statusFilter: 'ALL' as const,
  barberFilter: 'Todos',
  role: 'ADMIN' as const,
  profileBarberId: null,
  permittedBarberIds: new Set(['barber-lautaro', 'barber-gonzalo']),
};

describe('rangos del selector de período para Turnos (/admin/turnos)', () => {
  const today = '2026-10-10'; // Saturday, Oct 10, 2026

  it('ofrece exactamente las 8 opciones en el orden especificado con sus etiquetas', () => {
    expect(appointmentsPresets).toEqual([
      'TODAY',
      'TOMORROW',
      'THIS_WEEK',
      'THIS_MONTH',
      'NEXT_7_DAYS',
      'NEXT_14_DAYS',
      'NEXT_21_DAYS',
      'SPECIFIC',
    ]);
    expect(appointmentsPresets.map(p => appointmentsPresetLabels[p])).toEqual([
      'Hoy',
      'Mañana',
      'Esta semana',
      'Este mes',
      'Próximos 7 días',
      'Próximos 14 días',
      'Próximos 21 días',
      'Fecha específica',
    ]);
  });

  it('calcula límites consistentes: inicio inclusivo y final exclusivo', () => {
    // 1. Hoy
    expect(dateRangeForAppointmentsPreset('TODAY', today)).toEqual({
      start: '2026-10-10',
      end: '2026-10-10',
      endExclusive: '2026-10-11',
    });

    // 2. Mañana
    expect(dateRangeForAppointmentsPreset('TOMORROW', today)).toEqual({
      start: '2026-10-11',
      end: '2026-10-11',
      endExclusive: '2026-10-12',
    });

    // 3. Esta semana: lunes a domingo
    expect(dateRangeForAppointmentsPreset('THIS_WEEK', today)).toEqual({
      start: '2026-10-05',
      end: '2026-10-11',
      endExclusive: '2026-10-12',
    });

    // 4. Este mes: mes calendario completo
    expect(dateRangeForAppointmentsPreset('THIS_MONTH', today)).toEqual({
      start: '2026-10-01',
      end: '2026-10-31',
      endExclusive: '2026-11-01',
    });

    // 5. Próximos 7 días: incluye hoy
    expect(dateRangeForAppointmentsPreset('NEXT_7_DAYS', today)).toEqual({
      start: '2026-10-10',
      end: '2026-10-16',
      endExclusive: '2026-10-17',
    });

    // 6. Próximos 14 días: incluye hoy
    expect(dateRangeForAppointmentsPreset('NEXT_14_DAYS', today)).toEqual({
      start: '2026-10-10',
      end: '2026-10-23',
      endExclusive: '2026-10-24',
    });

    // 7. Próximos 21 días: incluye hoy
    expect(dateRangeForAppointmentsPreset('NEXT_21_DAYS', today)).toEqual({
      start: '2026-10-10',
      end: '2026-10-30',
      endExclusive: '2026-10-31',
    });

    // 8. Fecha específica
    expect(dateRangeForAppointmentsPreset('SPECIFIC', today, '2026-10-25')).toEqual({
      start: '2026-10-25',
      end: '2026-10-25',
      endExclusive: '2026-10-26',
    });
    expect(dateRangeForAppointmentsPreset('SPECIFIC', today, '')).toBeNull();
  });

  it('usa America/Argentina/Buenos_Aires en el cambio de día', () => {
    expect(businessDateToday(new Date('2026-10-11T02:59:59.000Z'))).toBe('2026-10-10');
    expect(businessDateToday(new Date('2026-10-11T03:00:00.000Z'))).toBe('2026-10-11');
  });

  it('mantiene la semana lunes-domingo en lunes, sábado y domingo', () => {
    expect(startOfBusinessWeek('2026-10-05')).toBe('2026-10-05'); // Lunes
    expect(startOfBusinessWeek('2026-10-10')).toBe('2026-10-05'); // Sábado
    expect(startOfBusinessWeek('2026-10-11')).toBe('2026-10-05'); // Domingo
  });
});

describe('filtro combinado de turnos del panel móvil', () => {
  const appointments = [
    appointment({ id: 'pending-today', statusCode: 'PENDING', date: '2026-10-10', time: '12:00' }),
    appointment({ id: 'confirmed-tomorrow', statusCode: 'CONFIRMED', date: '2026-10-11', time: '10:00' }),
    appointment({ id: 'cancelled-week', statusCode: 'CANCELLED', date: '2026-10-11', time: '11:00' }),
    appointment({ id: 'completed-next-week', statusCode: 'COMPLETED', date: '2026-10-20', time: '09:00' }),
    appointment({ id: 'gonzalo-today', barber: 'Gonzalo', barberId: 'barber-gonzalo', date: '2026-10-10', time: '13:00' }),
  ];

  it('combina rango y estado sin perder turnos en los límites ni duplicar', () => {
    expect(filterMobileAppointments(appointments, {
      ...adminOptions,
      dateRange: dateRangeForAppointmentsPreset('NEXT_7_DAYS', '2026-10-10'),
      statusFilter: 'PENDING',
    }).map(item => item.id)).toEqual(['pending-today', 'gonzalo-today']);

    expect(filterMobileAppointments(appointments, {
      ...adminOptions,
      dateRange: dateRangeForAppointmentsPreset('THIS_WEEK', '2026-10-10'),
      statusFilter: 'CANCELLED',
    }).map(item => item.id)).toEqual(['cancelled-week']);

    expect(filterMobileAppointments(appointments, {
      ...adminOptions,
      dateRange: dateRangeForAppointmentsPreset('SPECIFIC', '2026-10-10', '2026-10-20'),
      statusFilter: 'CONFIRMED',
    }).map(item => item.id)).toEqual(['completed-next-week']);
  });

  it('ADMIN puede filtrar por barbero y BARBER queda limitado a su barber_id', () => {
    expect(filterMobileAppointments(appointments, { ...adminOptions, barberFilter: 'Gonzalo' }).map(item => item.id)).toEqual(['gonzalo-today']);
    expect(filterMobileAppointments(appointments, {
      ...adminOptions,
      role: 'BARBER',
      profileBarberId: 'barber-lautaro',
    }).map(item => item.id)).toEqual(['pending-today', 'confirmed-tomorrow', 'cancelled-week', 'completed-next-week']);
  });
});
