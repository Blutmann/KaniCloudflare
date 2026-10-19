import { describe, expect, it } from 'vitest';
import {
  aggregateClientsDirectory,
  classifyAppointmentTime,
  computeDailyDemand,
  computeFinancialControl,
  computeHourlyDistribution,
  computeKpiSummary,
  computeServiceDemand,
  dateRangeForStatisticsPreset,
  filterAndSortClients,
  filterStatisticsAppointments,
  getAppointmentDepositAmount,
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
  it('dateRangeForStatisticsPreset calculates correct bounds for all 14 presets', () => {
    const today = '2026-10-17'; // Saturday, October 17, 2026

    expect(dateRangeForStatisticsPreset('TODAY', today)).toEqual({
      start: '2026-10-17',
      end: '2026-10-17',
    });
    expect(dateRangeForStatisticsPreset('YESTERDAY', today)).toEqual({
      start: '2026-10-16',
      end: '2026-10-16',
    });
    expect(dateRangeForStatisticsPreset('THIS_WEEK', today)).toEqual({
      start: '2026-10-12', // Monday
      end: '2026-10-18',   // Sunday
    });
    expect(dateRangeForStatisticsPreset('THIS_MONTH', today)).toEqual({
      start: '2026-10-01',
      end: '2026-10-31',
    });
    expect(dateRangeForStatisticsPreset('THIS_YEAR', today)).toEqual({
      start: '2026-01-01',
      end: '2026-12-31',
    });
    expect(dateRangeForStatisticsPreset('PREVIOUS_MONTH', today)).toEqual({
      start: '2026-09-01',
      end: '2026-09-30',
    });
    expect(dateRangeForStatisticsPreset('PREVIOUS_YEAR', today)).toEqual({
      start: '2025-01-01',
      end: '2025-12-31',
    });
    expect(dateRangeForStatisticsPreset('LAST_7_DAYS', today)).toEqual({
      start: '2026-10-11',
      end: '2026-10-17',
    });
    expect(dateRangeForStatisticsPreset('LAST_30_DAYS', today)).toEqual({
      start: '2026-09-18',
      end: '2026-10-17',
    });
    expect(dateRangeForStatisticsPreset('LAST_60_DAYS', today)).toEqual({
      start: '2026-08-19',
      end: '2026-10-17',
    });
    expect(dateRangeForStatisticsPreset('LAST_90_DAYS', today)).toEqual({
      start: '2026-07-20',
      end: '2026-10-17',
    });
    expect(dateRangeForStatisticsPreset('LAST_180_DAYS', today)).toEqual({
      start: '2026-04-21',
      end: '2026-10-17',
    });
    expect(dateRangeForStatisticsPreset('LAST_365_DAYS', today)).toEqual({
      start: '2025-10-18',
      end: '2026-10-17',
    });
    expect(dateRangeForStatisticsPreset('SPECIFIC', today, '2026-10-05')).toEqual({
      start: '2026-10-05',
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

  it('consolidates clients sharing normalized phone across format differences', () => {
    const list: RealAppointment[] = [
      makeMockAppointment({
        id: 'apt-1',
        name: 'Martin Palermo',
        phone: '+54 9 11 4444-5555',
        email: 'martin@boca.com',
        date: '2026-10-01',
        time: '10:00',
      }),
      makeMockAppointment({
        id: 'apt-2',
        name: 'Martin P.',
        phone: '11 4444 5555',
        email: '',
        date: '2026-10-15',
        time: '11:00',
      }),
    ];

    const directory = aggregateClientsDirectory(list);
    expect(directory).toHaveLength(1);
    expect(directory[0].name).toBe('Martin Palermo');
    expect(directory[0].totalAppointments).toBe(2);
    expect(directory[0].appointments).toHaveLength(2);
  });

  it('consolidates clients sharing normalized email across case differences', () => {
    const list: RealAppointment[] = [
      makeMockAppointment({
        id: 'apt-1',
        name: 'Lucas Pratto',
        phone: '+5491100000001',
        email: '  Lucas.Pratto@River.COM  ',
        date: '2026-10-02',
        time: '12:00',
      }),
      makeMockAppointment({
        id: 'apt-2',
        name: 'Lucas',
        phone: '+5491100000002',
        email: 'lucas.pratto@river.com',
        date: '2026-10-16',
        time: '14:00',
      }),
    ];

    const directory = aggregateClientsDirectory(list);
    expect(directory).toHaveLength(1);
    expect(directory[0].name).toBe('Lucas Pratto');
    expect(directory[0].totalAppointments).toBe(2);
  });

  it('does NOT merge clients solely because of identical names', () => {
    const list: RealAppointment[] = [
      makeMockAppointment({
        id: 'apt-1',
        name: 'Juan Perez',
        phone: '+5491111111111',
        email: 'juan.perez.1@gmail.com',
        date: '2026-10-01',
      }),
      makeMockAppointment({
        id: 'apt-2',
        name: 'Juan Perez',
        phone: '+5491122222222',
        email: 'juan.perez.2@gmail.com',
        date: '2026-10-05',
      }),
    ];

    const directory = aggregateClientsDirectory(list);
    expect(directory).toHaveLength(2);
    expect(directory.map((c) => c.phone)).toContain('+5491111111111');
    expect(directory.map((c) => c.phone)).toContain('+5491122222222');
  });

  it('handles phone vs email conflict safely without cross-contaminating clients', () => {
    const list: RealAppointment[] = [
      makeMockAppointment({
        id: 'apt-1',
        name: 'Esteban Cambiasso',
        phone: '+5491133333333',
        email: 'esteban@inter.com',
        date: '2026-10-01',
      }),
      makeMockAppointment({
        id: 'apt-2',
        name: 'Diego Milito',
        phone: '+5491144444444',
        email: 'diego@racing.com',
        date: '2026-10-02',
      }),
      makeMockAppointment({
        id: 'apt-3',
        name: 'Esteban Cambiasso',
        phone: '+5491133333333', // matches Esteban's phone
        email: 'diego@racing.com', // matches Diego's email
        date: '2026-10-10',
      }),
    ];

    const directory = aggregateClientsDirectory(list);
    // Should NOT merge Esteban and Diego
    expect(directory.length).toBeGreaterThanOrEqual(2);
    const esteban = directory.find((c) => c.name === 'Esteban Cambiasso')!;
    const diego = directory.find((c) => c.name === 'Diego Milito')!;
    expect(esteban).toBeDefined();
    expect(diego).toBeDefined();
    expect(esteban.id).not.toBe(diego.id);
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

  describe('Financial Control («Control de cobros») and No-Show Exceptions', () => {
    // 1. Seña recibida para turno futuro
    it('1. Seña recibida para turno futuro: computa en señas cobradas y saldo en cobros pendientes; no computa en ejecutados ni retenidos', () => {
      const apt = makeMockAppointment({
        id: 'future-1',
        statusCode: 'CONFIRMED',
        servicePrice: 25000,
        depositPaid: true,
        depositAmountArs: 10000,
        date: '2026-10-25',
      });

      const summary = computeFinancialControl([apt]);

      // Seña cobrada efectivamente
      expect(summary.depositsCollected.totalArs).toBe(10000);
      expect(summary.depositsCollected.count).toBe(1);

      // Saldo pendiente = 25.000 - 10.000 = 15.000
      expect(summary.pendingBalances.totalArs).toBe(15000);
      expect(summary.pendingBalances.count).toBe(1);

      // No se computa en servicios ejecutados
      expect(summary.completedServices.count).toBe(0);
      expect(summary.completedServices.totalCollectedArs).toBe(0);

      // No se computa en señas retenidas
      expect(summary.retainedNoShowDeposits.count).toBe(0);
      expect(summary.retainedNoShowDeposits.totalArs).toBe(0);

      // No hay devoluciones ni condonaciones
      expect(summary.refundsAndWaives.totalImpactArs).toBe(0);
    });

    // 2. Turno ejecutado con seña y saldo pendiente
    it('2. Turno ejecutado con seña y saldo pendiente: computa lo efectivamente ingresado y diferencia el saldo impago', () => {
      const apt = makeMockAppointment({
        id: 'completed-unpaid-1',
        statusCode: 'COMPLETED',
        servicePrice: 30000,
        depositPaid: true,
        depositAmountArs: 10000,
        balancePaid: false, // saldo impago
      });

      const summary = computeFinancialControl([apt]);

      // Solo computa lo efectivamente ingresado (la seña)
      expect(summary.completedServices.count).toBe(1);
      expect(summary.completedServices.totalCollectedArs).toBe(10000);
      expect(summary.completedServices.totalServiceValueArs).toBe(30000);

      // Diferencia el saldo impago: 30.000 - 10.000 = 20.000
      expect(summary.completedServices.unpaidBalanceArs).toBe(20000);

      // No figura en cobros pendientes (los pendientes son solo de turnos vigentes futuros)
      expect(summary.pendingBalances.count).toBe(0);
      expect(summary.pendingBalances.totalArs).toBe(0);
    });

    // 3. Turno ejecutado y totalmente cobrado
    it('3. Turno ejecutado y totalmente cobrado: computa el valor total una sola vez sin duplicar con la seña', () => {
      const apt = makeMockAppointment({
        id: 'completed-paid-1',
        statusCode: 'COMPLETED',
        servicePrice: 25000,
        depositPaid: true,
        depositAmountArs: 10000,
        balancePaid: true, // totalmente cobrado
      });

      const summary = computeFinancialControl([apt]);

      // Total servicio computado exactamente una vez ($25.000), no $35.000
      expect(summary.completedServices.count).toBe(1);
      expect(summary.completedServices.totalCollectedArs).toBe(25000);
      expect(summary.completedServices.totalServiceValueArs).toBe(25000);
      expect(summary.completedServices.unpaidBalanceArs).toBe(0);

      // Seña cobrada registrada en indicador A
      expect(summary.depositsCollected.totalArs).toBe(10000);
    });

    // 4. Inasistencia con seña retenida
    it('4. Inasistencia con seña retenida: computa en señas retenidas; no en cobros pendientes ni como ejecutado', () => {
      const apt = makeMockAppointment({
        id: 'no-show-retain-1',
        statusCode: 'NO_SHOW',
        servicePrice: 20000,
        depositPaid: true,
        depositAmountArs: 10000,
        noShowDecision: 'RETAIN',
        noShowReason: 'Cliente no se presentó sin previo aviso',
      });

      const summary = computeFinancialControl([apt]);

      // Computa en señas retenidas con detalle
      expect(summary.retainedNoShowDeposits.count).toBe(1);
      expect(summary.retainedNoShowDeposits.totalArs).toBe(10000);
      expect(summary.retainedNoShowDeposits.items[0]).toMatchObject({
        appointmentId: 'no-show-retain-1',
        depositAmountArs: 10000,
        reason: 'Cliente no se presentó sin previo aviso',
      });

      // No debe figurar en cobros pendientes ni como servicio ejecutado
      expect(summary.pendingBalances.count).toBe(0);
      expect(summary.completedServices.count).toBe(0);

      // No es devolución ni condonación
      expect(summary.refundsAndWaives.items).toHaveLength(0);
    });

    // 5. Inasistencia cuya penalización se condona
    it('5. Inasistencia cuya penalización se condona: no figura como retenida ni como ingreso; registra excepción con motivo', () => {
      const apt = makeMockAppointment({
        id: 'no-show-waive-1',
        statusCode: 'NO_SHOW',
        servicePrice: 20000,
        depositPaid: true,
        depositAmountArs: 10000,
        noShowDecision: 'WAIVE',
        noShowReason: 'Urgencia de salud imprevista con certificado',
      });

      const summary = computeFinancialControl([apt]);

      // No debe figurar como seña retenida
      expect(summary.retainedNoShowDeposits.count).toBe(0);
      expect(summary.retainedNoShowDeposits.totalArs).toBe(0);

      // Debe quedar registrada la excepción condonada con su motivo
      expect(summary.refundsAndWaives.waivesCount).toBe(1);
      expect(summary.refundsAndWaives.waivesTotalArs).toBe(10000);
      expect(summary.refundsAndWaives.items[0]).toMatchObject({
        appointmentId: 'no-show-waive-1',
        decision: 'WAIVE',
        amountArs: 10000,
        reason: 'Urgencia de salud imprevista con certificado',
      });
    });

    // 6. Seña devuelta después de haber sido recibida
    it('6. Seña devuelta después de haber sido recibida: se refleja como devolución sin duplicarse en otros conceptos', () => {
      const apt = makeMockAppointment({
        id: 'no-show-refund-1',
        statusCode: 'NO_SHOW',
        servicePrice: 22000,
        depositPaid: true,
        depositAmountArs: 10000,
        noShowDecision: 'REFUND',
        noShowRefundAmountArs: 10000,
        noShowReason: 'Corte de luz general en la zona acordado reembolso',
      });

      const summary = computeFinancialControl([apt]);

      // Se refleja en devoluciones
      expect(summary.refundsAndWaives.refundsCount).toBe(1);
      expect(summary.refundsAndWaives.refundsTotalArs).toBe(10000);
      expect(summary.refundsAndWaives.items[0]).toMatchObject({
        appointmentId: 'no-show-refund-1',
        decision: 'REFUND',
        amountArs: 10000,
        reason: 'Corte de luz general en la zona acordado reembolso',
      });

      // No figura como seña retenida
      expect(summary.retainedNoShowDeposits.count).toBe(0);
      expect(summary.retainedNoShowDeposits.totalArs).toBe(0);
    });

    // 7. Prevención de devoluciones y contabilizaciones duplicadas
    it('7. Prevención de devoluciones y contabilizaciones duplicadas', () => {
      const aptRefund = makeMockAppointment({
        id: 'dup-refund-1',
        statusCode: 'NO_SHOW',
        servicePrice: 25000,
        depositPaid: true,
        depositAmountArs: 10000,
        noShowDecision: 'REFUND',
        noShowRefundAmountArs: 10000,
        noShowReason: 'Reintegro único registrado',
      });

      const summary = computeFinancialControl([aptRefund]);

      // Exactamente 1 ítem devuelto
      expect(summary.refundsAndWaives.items).toHaveLength(1);
      expect(summary.retainedNoShowDeposits.items).toHaveLength(0);

      // Si no hay seña cobrada (depositPaid = false), no puede haber retención
      const aptNoDeposit = makeMockAppointment({
        id: 'no-dep-1',
        statusCode: 'NO_SHOW',
        servicePrice: 20000,
        depositPaid: false,
        noShowDecision: 'RETAIN',
      });
      const summaryNoDep = computeFinancialControl([aptNoDeposit]);
      expect(summaryNoDep.retainedNoShowDeposits.count).toBe(0);
      expect(summaryNoDep.retainedNoShowDeposits.totalArs).toBe(0);
    });

    // 8. Coherencia de los indicadores al cambiar filtros de período
    it('8. Coherencia de los indicadores al cambiar filtros de período y barbero', () => {
      const aptToday = makeMockAppointment({
        id: 'apt-today',
        date: '2026-10-17',
        barber: 'Kani',
        statusCode: 'CONFIRMED',
        depositPaid: true,
        depositAmountArs: 10000,
        servicePrice: 20000,
      });

      const aptYesterday = makeMockAppointment({
        id: 'apt-yesterday',
        date: '2026-10-16',
        barber: 'Kani',
        statusCode: 'COMPLETED',
        depositPaid: true,
        depositAmountArs: 10000,
        balancePaid: true,
        servicePrice: 20000,
      });

      const aptOtherBarber = makeMockAppointment({
        id: 'apt-other-barber',
        date: '2026-10-17',
        barber: 'Valentín',
        barberId: 'barber-valentin',
        statusCode: 'CONFIRMED',
        depositPaid: true,
        depositAmountArs: 10000,
        servicePrice: 25000,
      });

      const all = [aptToday, aptYesterday, aptOtherBarber];
      const permittedBarberIds = new Set(['barber-kani', 'barber-valentin']);

      // Filtro: Solo HOY y Barbero Kani
      const todayRange = dateRangeForStatisticsPreset('TODAY', '2026-10-17');
      const filteredTodayKani = filterStatisticsAppointments(all, {
        dateRange: todayRange,
        barberFilter: 'Kani',
        timeSlotFilter: 'ALL',
        role: 'ADMIN',
        profileBarberId: null,
        permittedBarberIds,
      });
      expect(filteredTodayKani).toHaveLength(1);
      expect(filteredTodayKani[0].id).toBe('apt-today');

      const summaryToday = computeFinancialControl(filteredTodayKani);
      expect(summaryToday.depositsCollected.totalArs).toBe(10000);
      expect(summaryToday.pendingBalances.totalArs).toBe(10000);
      expect(summaryToday.completedServices.totalCollectedArs).toBe(0);

      // Filtro: Últimos 7 días y Todos los barberos
      const weekRange = dateRangeForStatisticsPreset('LAST_7_DAYS', '2026-10-17');
      const filteredWeek = filterStatisticsAppointments(all, {
        dateRange: weekRange,
        barberFilter: 'Todos',
        timeSlotFilter: 'ALL',
        role: 'ADMIN',
        profileBarberId: null,
        permittedBarberIds,
      });
      expect(filteredWeek).toHaveLength(3);

      const summaryWeek = computeFinancialControl(filteredWeek);
      expect(summaryWeek.depositsCollected.totalArs).toBe(30000);
      expect(summaryWeek.completedServices.totalCollectedArs).toBe(20000);
      expect(summaryWeek.pendingBalances.totalArs).toBe(25000); // 10k de aptToday + 15k de aptOtherBarber
    });

    // 9. Cálculo correcto de señas para turnos manuales vs reservas públicas
    it('9. getAppointmentDepositAmount respeta seña manual ($5.000), pública ($10.000) y tope por valor de servicio', () => {
      // Manual estándar
      const manualApt = makeMockAppointment({
        isManual: true,
        servicePrice: 15000,
      });
      expect(getAppointmentDepositAmount(manualApt)).toBe(5000);

      // Pública estándar
      const publicApt = makeMockAppointment({
        isManual: false,
        servicePrice: 25000,
      });
      expect(getAppointmentDepositAmount(publicApt)).toBe(10000);

      // Servicio más barato que la seña (ej. perfilado $4.000 < seña $10.000)
      const cheapApt = makeMockAppointment({
        isManual: false,
        servicePrice: 4000,
      });
      expect(getAppointmentDepositAmount(cheapApt)).toBe(4000);

      // Con depositAmountArs explícito en BD
      const customApt = makeMockAppointment({
        depositAmountArs: 7500,
      });
      expect(getAppointmentDepositAmount(customApt)).toBe(7500);
    });
  });
});
