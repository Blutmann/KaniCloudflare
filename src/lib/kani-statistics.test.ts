import { describe, expect, it } from 'vitest';
import {
  aggregateClientsDirectory,
  classifyAppointmentTime,
  computeDailyDemand,
  computeHourlyDistribution,
  computeKpiSummary,
  computeServiceDemand,
  dateRangeForStatisticsPreset,
  filterAndSortClients,
  filterStatisticsAppointments,
  type ClientDirectoryItem,
} from './kani-statistics';
import type { RealAppointment } from './kani-appointments';

function makeMockAppointment(overrides: Partial<RealAppointment> = {}): RealAppointment {
  return {
    id: 'apt-1',
    requestNumber: 100,
    service: 'corte',
    serviceName: 'Corte tradicional',
    servicePrice: 10000,
    serviceDuration: 45,
    barber: 'Kani',
    barberId: 'barber-kani',
    serviceId: 'srv-corte',
    date: '2026-10-17',
    time: '11:00',
    endTime: '11:45',
    name: 'Juan Perez',
    email: 'juan@example.com',
    phone: '+5491112345678',
    status: 'Confirmado',
    statusCode: 'CONFIRMED',
    notes: '',
    ...overrides,
  };
}

describe('Statistics Module Unit Tests', () => {
  it('dateRangeForStatisticsPreset calculates correct bounds', () => {
    const today = '2026-10-17';

    expect(dateRangeForStatisticsPreset('ALL', today)).toBeNull();
    expect(dateRangeForStatisticsPreset('LAST_7_DAYS', today)).toEqual({
      start: '2026-10-11',
      end: '2026-10-17',
    });
    expect(dateRangeForStatisticsPreset('LAST_10_DAYS', today)).toEqual({
      start: '2026-10-08',
      end: '2026-10-17',
    });
    expect(dateRangeForStatisticsPreset('LAST_30_DAYS', today)).toEqual({
      start: '2026-09-18',
      end: '2026-10-17',
    });
    expect(dateRangeForStatisticsPreset('SPECIFIC', today, '2026-10-15')).toEqual({
      start: '2026-10-15',
      end: '2026-10-15',
    });
    expect(
      dateRangeForStatisticsPreset('CUSTOM', today, '', {
        start: '2026-10-01',
        end: '2026-10-05',
      }),
    ).toEqual({
      start: '2026-10-01',
      end: '2026-10-05',
    });
  });

  it('filterStatisticsAppointments applies scope, date range, and time slot correctly', () => {
    const appointments: RealAppointment[] = [
      makeMockAppointment({
        id: '1',
        date: '2026-10-15',
        time: '10:00',
        barberId: 'barber-kani',
        barber: 'Kani',
      }),
      makeMockAppointment({
        id: '2',
        date: '2026-10-16',
        time: '16:00',
        barberId: 'barber-kani',
        barber: 'Kani',
      }),
      makeMockAppointment({
        id: '3',
        date: '2026-10-17',
        time: '11:00',
        barberId: 'barber-other',
        barber: 'Other',
      }),
    ];

    const permitted = new Set(['barber-kani', 'barber-other']);

    // Admin filter all
    const res1 = filterStatisticsAppointments(appointments, {
      dateRange: null,
      timeSlotFilter: 'ALL',
      barberFilter: 'Todos',
      role: 'ADMIN',
      profileBarberId: null,
      permittedBarberIds: permitted,
    });
    expect(res1).toHaveLength(3);

    // Morning slot filter only (10:00 <= hora < 12:00)
    const resMorning = filterStatisticsAppointments(appointments, {
      dateRange: null,
      timeSlotFilter: 'MORNING',
      barberFilter: 'Todos',
      role: 'ADMIN',
      profileBarberId: null,
      permittedBarberIds: permitted,
    });
    expect(resMorning.map((a) => a.id)).toEqual(['1', '3']);

    // Afternoon slot filter (12:00 <= hora < 18:00)
    const resAfternoon = filterStatisticsAppointments(appointments, {
      dateRange: null,
      timeSlotFilter: 'AFTERNOON',
      barberFilter: 'Todos',
      role: 'ADMIN',
      profileBarberId: null,
      permittedBarberIds: permitted,
    });
    expect(resAfternoon.map((a) => a.id)).toEqual(['2']);

    // Night slot filter (18:00 <= hora < 20:00)
    const resNight = filterStatisticsAppointments(appointments, {
      dateRange: null,
      timeSlotFilter: 'NIGHT',
      barberFilter: 'Todos',
      role: 'ADMIN',
      profileBarberId: null,
      permittedBarberIds: permitted,
    });
    expect(resNight.map((a) => a.id)).toEqual([]);

    // Barber role scope
    const resBarber = filterStatisticsAppointments(appointments, {
      dateRange: null,
      timeSlotFilter: 'ALL',
      barberFilter: 'Todos',
      role: 'BARBER',
      profileBarberId: 'barber-kani',
      permittedBarberIds: permitted,
    });
    expect(resBarber.map((a) => a.id)).toEqual(['1', '2']);
  });

  it('classifyAppointmentTime categorizes slots and tests exact boundary conditions', () => {
    // Exact boundaries
    expect(classifyAppointmentTime('09:59')).toBe('OUTSIDE');
    expect(classifyAppointmentTime('10:00')).toBe('MORNING');
    expect(classifyAppointmentTime('11:59')).toBe('MORNING');
    expect(classifyAppointmentTime('12:00')).toBe('AFTERNOON');
    expect(classifyAppointmentTime('17:59')).toBe('AFTERNOON');
    expect(classifyAppointmentTime('18:00')).toBe('NIGHT');
    expect(classifyAppointmentTime('19:59')).toBe('NIGHT');
    expect(classifyAppointmentTime('20:00')).toBe('OUTSIDE');
    expect(classifyAppointmentTime('21:30')).toBe('OUTSIDE');
    expect(classifyAppointmentTime('')).toBe('OUTSIDE');
    expect(classifyAppointmentTime('invalid')).toBe('OUTSIDE');
  });

  it('computeKpiSummary calculates totals, statuses, and completion rate accurately', () => {
    const list: RealAppointment[] = [
      makeMockAppointment({ id: '1', statusCode: 'COMPLETED' }),
      makeMockAppointment({ id: '2', statusCode: 'COMPLETED' }),
      makeMockAppointment({ id: '3', statusCode: 'CONFIRMED' }),
      makeMockAppointment({ id: '4', statusCode: 'PENDING' }),
      makeMockAppointment({ id: '5', statusCode: 'CANCELLED' }),
    ];

    const summary = computeKpiSummary(list);
    expect(summary.total).toBe(5);
    expect(summary.confirmed).toBe(3);
    expect(summary.pending).toBe(1);
    expect(summary.cancelled).toBe(1);
  });

  it('computeDailyDemand groups by date and detects peak demand day', () => {
    const list: RealAppointment[] = [
      makeMockAppointment({ id: '1', date: '2026-10-15', statusCode: 'COMPLETED' }),
      makeMockAppointment({ id: '2', date: '2026-10-16', statusCode: 'COMPLETED' }),
      makeMockAppointment({ id: '3', date: '2026-10-16', statusCode: 'CANCELLED' }),
      makeMockAppointment({ id: '4', date: '2026-10-16', statusCode: 'CONFIRMED' }),
      makeMockAppointment({ id: '5', date: '2026-10-17', statusCode: 'CONFIRMED' }),
    ];

    const demand = computeDailyDemand(list);
    expect(demand.peakDate).toBe('2026-10-16');
    expect(demand.peakCount).toBe(3);
    expect(demand.points).toHaveLength(3);
    expect(demand.points.find((p) => p.date === '2026-10-16')?.isPeak).toBe(true);
    expect(demand.points.find((p) => p.date === '2026-10-15')?.isPeak).toBe(false);
  });

  it('computeHourlyDistribution identifies morning, afternoon, night and peak hour', () => {
    const list: RealAppointment[] = [
      makeMockAppointment({ id: '1', time: '10:00' }), // MORNING
      makeMockAppointment({ id: '2', time: '11:00' }), // MORNING
      makeMockAppointment({ id: '3', time: '14:00' }), // AFTERNOON
      makeMockAppointment({ id: '4', time: '16:00' }), // AFTERNOON
      makeMockAppointment({ id: '5', time: '18:30' }), // NIGHT
      makeMockAppointment({ id: '6', time: '19:00' }), // NIGHT
    ];

    const hourly = computeHourlyDistribution(list);
    expect(hourly.morningCount).toBe(2);
    expect(hourly.morningPercentage).toBe(33);
    expect(hourly.afternoonCount).toBe(2);
    expect(hourly.afternoonPercentage).toBe(33);
    expect(hourly.nightCount).toBe(2);
    expect(hourly.nightPercentage).toBe(33);
    expect(hourly.peakHourCount).toBe(1);
  });

  it('computeServiceDemand returns ranking with percentages and revenues', () => {
    const list: RealAppointment[] = [
      makeMockAppointment({ id: '1', serviceName: 'Corte tradicional', servicePrice: 10000 }),
      makeMockAppointment({ id: '2', serviceName: 'Corte tradicional', servicePrice: 10000 }),
      makeMockAppointment({ id: '3', serviceName: 'Barba', servicePrice: 6000 }),
    ];

    const services = computeServiceDemand(list);
    expect(services).toHaveLength(2);
    expect(services[0].serviceName).toBe('Corte tradicional');
    expect(services[0].count).toBe(2);
    expect(services[0].percentage).toBe(67);
    expect(services[0].totalRevenue).toBe(20000);
    expect(services[1].serviceName).toBe('Barba');
    expect(services[1].count).toBe(1);
    expect(services[1].totalRevenue).toBe(6000);
  });

  it('aggregateClientsDirectory merges appointments by client, computes totals, cancellations, and history', () => {
    const list: RealAppointment[] = [
      makeMockAppointment({
        id: '1',
        name: 'Carlos Gomez',
        phone: '+5491100001111',
        email: 'carlos@example.com',
        date: '2026-10-10',
        time: '11:00',
        endTime: '11:45',
        serviceName: 'Corte tradicional',
        barber: 'Kani',
        statusCode: 'COMPLETED',
        createdAt: '2026-10-01T12:00:00Z',
      }),
      makeMockAppointment({
        id: '2',
        name: 'Carlos Gomez',
        phone: '+5491100001111',
        email: 'carlos@example.com',
        date: '2026-10-17',
        time: '16:00',
        endTime: '16:45',
        serviceName: 'Barba',
        barber: 'Kani',
        statusCode: 'CANCELLED',
        createdAt: '2026-10-15T15:30:00Z',
      }),
      makeMockAppointment({
        id: '3',
        name: 'Ana Lopez',
        phone: '+5491122223333',
        email: 'ana@example.com',
        date: '2026-10-12',
        time: '14:00',
        endTime: '14:30',
        serviceName: 'Perfilado',
        barber: 'Other',
        statusCode: 'CONFIRMED',
        createdAt: '2026-10-11T10:00:00Z',
      }),
    ];

    const directory = aggregateClientsDirectory(list);
    expect(directory).toHaveLength(2);

    const carlos = directory.find((c) => c.email === 'carlos@example.com')!;
    expect(carlos.totalAppointments).toBe(2);
    expect(carlos.totalCompleted).toBe(1);
    expect(carlos.totalCancelled).toBe(1);
    expect(carlos.totalActive).toBe(0);
    expect(carlos.lastBookingDate).toBe('2026-10-17');
    expect(carlos.lastBookingTime).toBe('16:00');
    expect(carlos.appointments).toHaveLength(2);
    // Newest first
    expect(carlos.appointments[0].id).toBe('2');
    expect(carlos.appointments[0].statusCode).toBe('CANCELLED');
    expect(carlos.appointments[0].createdAt).toBe('2026-10-15T15:30:00Z');
    expect(carlos.appointments[1].id).toBe('1');
    expect(carlos.appointments[1].statusCode).toBe('COMPLETED');

    const ana = directory.find((c) => c.email === 'ana@example.com')!;
    expect(ana.totalAppointments).toBe(1);
    expect(ana.totalCompleted).toBe(0);
    expect(ana.totalCancelled).toBe(0);
    expect(ana.totalActive).toBe(1);
    expect(ana.lastBookingDate).toBe('2026-10-12');
    expect(ana.appointments).toHaveLength(1);
    expect(ana.appointments[0].serviceName).toBe('Perfilado');
  });

  it('filterAndSortClients filters by partial name/email/phone and sorts asc/desc', () => {
    const clients: ClientDirectoryItem[] = [
      {
        id: '1',
        name: 'Carlos Gomez',
        email: 'carlos@gmail.com',
        phone: '1155551111',
        totalAppointments: 3,
        lastBookingDate: '2026-10-15',
      },
      {
        id: '2',
        name: 'Ana Perez',
        email: 'ana@hotmail.com',
        phone: '1144442222',
        totalAppointments: 1,
        lastBookingDate: '2026-10-12',
      },
      {
        id: '3',
        name: 'Beto Ruiz',
        email: 'beto@yahoo.com',
        phone: '1133339999',
        totalAppointments: 5,
        lastBookingDate: '2026-10-17',
      },
    ];

    // Filter by name
    const byName = filterAndSortClients(clients, 'ana', 'name', 'asc');
    expect(byName).toHaveLength(1);
    expect(byName[0].name).toBe('Ana Perez');

    // Filter by phone
    const byPhone = filterAndSortClients(clients, '9999', 'name', 'asc');
    expect(byPhone).toHaveLength(1);
    expect(byPhone[0].name).toBe('Beto Ruiz');

    // Filter by email
    const byEmail = filterAndSortClients(clients, 'gmail', 'name', 'asc');
    expect(byEmail).toHaveLength(1);
    expect(byEmail[0].name).toBe('Carlos Gomez');

    // Sort by totalAppointments descending
    const sortedByAptDesc = filterAndSortClients(clients, '', 'totalAppointments', 'desc');
    expect(sortedByAptDesc.map((c) => c.name)).toEqual(['Beto Ruiz', 'Carlos Gomez', 'Ana Perez']);

    // Sort by name ascending
    const sortedByNameAsc = filterAndSortClients(clients, '', 'name', 'asc');
    expect(sortedByNameAsc.map((c) => c.name)).toEqual(['Ana Perez', 'Beto Ruiz', 'Carlos Gomez']);
  });
});
