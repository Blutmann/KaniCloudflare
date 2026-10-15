import { describe, expect, it } from 'vitest';
import type { RealAppointment } from './kani-appointments';
import {
  addCalendarDays,
  businessDateToday,
  dateRangeForMobilePreset,
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

describe('rangos del filtro de fechas del panel móvil', () => {
  it('calcula días simples y diez fechas inclusivas', () => {
    expect(addCalendarDays('2026-10-10', 1)).toBe('2026-10-11');
    expect(dateRangeForMobilePreset('TODAY', '2026-10-10')).toEqual({ start: '2026-10-10', end: '2026-10-10' });
    expect(dateRangeForMobilePreset('TOMORROW', '2026-10-10')).toEqual({ start: '2026-10-11', end: '2026-10-11' });
    expect(dateRangeForMobilePreset('NEXT_10_DAYS', '2026-10-10')).toEqual({ start: '2026-10-10', end: '2026-10-19' });
    expect(dateRangeForMobilePreset('ALL', '2026-10-10')).toBeNull();
  });

  it('usa America/Argentina/Buenos_Aires en el cambio de día', () => {
    expect(businessDateToday(new Date('2026-10-11T02:59:59.000Z'))).toBe('2026-10-10');
    expect(businessDateToday(new Date('2026-10-11T03:00:00.000Z'))).toBe('2026-10-11');
  });

  it('mantiene la semana lunes-domingo en lunes, sábado y domingo', () => {
    expect(startOfBusinessWeek('2026-10-05')).toBe('2026-10-05');
    expect(dateRangeForMobilePreset('THIS_WEEK', '2026-10-10')).toEqual({ start: '2026-10-05', end: '2026-10-11' });
    expect(dateRangeForMobilePreset('THIS_WEEK', '2026-10-11')).toEqual({ start: '2026-10-05', end: '2026-10-11' });
  });

  it('permite que una fecha específica sea el único día activo', () => {
    expect(dateRangeForMobilePreset('SPECIFIC', '2026-10-10', '2026-11-02')).toEqual({ start: '2026-11-02', end: '2026-11-02' });
    expect(dateRangeForMobilePreset('SPECIFIC', '2026-10-10')).toBeNull();
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

  it('Todos los días incluye fechas distintas y no oculta turnos anteriores', () => {
    expect(filterMobileAppointments(appointments, adminOptions).map(item => item.id)).toEqual([
      'pending-today', 'gonzalo-today', 'confirmed-tomorrow', 'cancelled-week', 'completed-next-week',
    ]);
  });

  it('combina rango y estado sin perder estados cancelados o completados', () => {
    expect(filterMobileAppointments(appointments, {
      ...adminOptions,
      dateRange: dateRangeForMobilePreset('NEXT_10_DAYS', '2026-10-10'),
      statusFilter: 'PENDING',
    }).map(item => item.id)).toEqual(['pending-today', 'gonzalo-today']);
    expect(filterMobileAppointments(appointments, {
      ...adminOptions,
      dateRange: dateRangeForMobilePreset('THIS_WEEK', '2026-10-10'),
      statusFilter: 'CANCELLED',
    }).map(item => item.id)).toEqual(['cancelled-week']);
    expect(filterMobileAppointments(appointments, {
      ...adminOptions,
      dateRange: dateRangeForMobilePreset('SPECIFIC', '2026-10-10', '2026-10-20'),
      statusFilter: 'COMPLETED',
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
