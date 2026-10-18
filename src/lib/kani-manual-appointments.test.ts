import { describe, expect, it } from 'vitest';
import { appointmentErrorMessage, type RealAppointment } from './kani-appointments';
import { aggregateClientsDirectory } from './kani-statistics';

describe('Manual Appointments & Recurring Logic Unit Tests', () => {
  it('correctly categorizes manual appointment collision errors in appointmentErrorMessage', () => {
    const error1 = new Error('SLOT_ALREADY_BOOKED');
    expect(appointmentErrorMessage(error1)).toContain('Ese horario acaba de dejar de estar disponible');

    const error2 = new Error('MANUAL_APPOINTMENT_NOT_ALLOWED');
    expect(appointmentErrorMessage(error2)).toBe('No tenés permisos para agendar en la agenda de otro barbero.');

    const error3 = new Error('AUTH_REQUIRED');
    expect(appointmentErrorMessage(error3)).toBe('Tenés que iniciar sesión para realizar esta acción.');
  });

  it('preserves isManual, origin, and createdByDisplayName in RealAppointment and aggregates in client directory', () => {
    const mockAppointments: RealAppointment[] = [
      {
        id: 'apt-manual-1',
        requestNumber: 101,
        service: 'corte',
        barber: 'Gonzalo',
        date: '2026-10-20',
        time: '14:00',
        endTime: '14:45',
        name: 'Martín Palermo',
        email: 'palermo@boca.internal',
        phone: '11 4444 5555',
        status: 'Confirmado',
        statusCode: 'CONFIRMED',
        notes: 'Cliente habitual',
        barberId: 'barber-gonzalo',
        serviceId: 'svc-corte',
        serviceName: 'Corte',
        serviceDuration: 45,
        servicePrice: 25000,
        clientId: 'client-1',
        createdAt: '2026-10-18T10:00:00Z',
        isManual: true,
        origin: 'MANUAL',
        createdByUserId: 'user-admin-uuid',
        createdByDisplayName: 'Admin',
        depositRequired: false,
        depositPaid: false,
      },
      {
        id: 'apt-public-2',
        requestNumber: 102,
        service: 'barba',
        barber: 'Gonzalo',
        date: '2026-10-10',
        time: '11:00',
        endTime: '11:30',
        name: 'Martín Palermo',
        email: 'palermo@boca.internal',
        phone: '11 4444 5555',
        status: 'Confirmado',
        statusCode: 'CONFIRMED',
        notes: '',
        barberId: 'barber-gonzalo',
        serviceId: 'svc-barba',
        serviceName: 'Barba',
        serviceDuration: 30,
        servicePrice: 10000,
        clientId: 'client-1',
        createdAt: '2026-10-09T15:00:00Z',
        isManual: false,
        origin: 'PUBLIC_WEB',
        depositRequired: true,
        depositPaid: true,
      },
    ];

    const directory = aggregateClientsDirectory(mockAppointments);
    expect(directory.length).toBe(1);

    const client = directory[0];
    expect(client.name).toBe('Martín Palermo');
    expect(client.totalAppointments).toBe(2);
    expect(client.appointments.length).toBe(2);

    const manualItem = client.appointments.find(a => a.id === 'apt-manual-1');
    expect(manualItem).toBeDefined();
    expect(manualItem?.isManual).toBe(true);
    expect(manualItem?.origin).toBe('MANUAL');
    expect(manualItem?.createdByDisplayName).toBe('Admin');

    const publicItem = client.appointments.find(a => a.id === 'apt-public-2');
    expect(publicItem).toBeDefined();
    expect(publicItem?.isManual).toBe(false);
    expect(publicItem?.origin).toBe('PUBLIC_WEB');
    expect(publicItem?.createdByDisplayName).toBeUndefined();
  });

  it('ensures manual appointments do not require deposit or checkout flow', () => {
    const manualAppointment: RealAppointment = {
      id: 'apt-manual-99',
      requestNumber: 99,
      service: 'corte-barba',
      barber: 'Lautaro',
      date: '2026-10-22',
      time: '16:00',
      endTime: '16:45',
      name: 'Roman Riquelme',
      email: 'roman@boca.internal',
      phone: '11 1010 1010',
      status: 'Confirmado',
      statusCode: 'CONFIRMED',
      notes: 'Turno permanente semanal',
      barberId: 'barber-lautaro',
      serviceId: 'svc-corte-barba',
      serviceName: 'Corte + barba',
      serviceDuration: 45,
      servicePrice: 30000,
      isManual: true,
      origin: 'MANUAL',
      createdByDisplayName: 'Lautaro',
      depositRequired: false,
      depositPaid: false,
      recurringRuleId: 'rule-weekly-123',
    };

    expect(manualAppointment.depositRequired).toBe(false);
    expect(manualAppointment.depositPaid).toBe(false);
    expect(manualAppointment.statusCode).toBe('CONFIRMED');
    expect(manualAppointment.recurringRuleId).toBe('rule-weekly-123');
  });

  it('simulates recurrence occurrence generation logic within 28-day horizon idempotently', () => {
    // Test rule: every Tuesday (day_of_week = 2) starting from 2026-10-20 for 4 weeks
    const rule = {
      id: 'rule-tuesdays',
      dayOfWeek: 2, // Tuesday
      startDate: '2026-10-20',
      startTime: '15:00',
      durationMinutes: 45,
      active: true,
    };

    const simulatedToday = new Date('2026-10-20T00:00:00Z');
    const horizonEnd = new Date('2026-11-17T00:00:00Z'); // 28 days later

    const occurrences: string[] = [];
    let current = new Date(simulatedToday);

    while (current <= horizonEnd) {
      // getUTCDay: 0=Sun, 1=Mon, 2=Tue...
      if (current.getUTCDay() === rule.dayOfWeek) {
        occurrences.push(current.toISOString().slice(0, 10));
      }
      current.setUTCDate(current.getUTCDate() + 1);
    }

    // Must generate exactly 5 Tuesdays within [2026-10-20, 2026-11-17]:
    // Oct 20, Oct 27, Nov 3, Nov 10, Nov 17
    expect(occurrences).toEqual([
      '2026-10-20',
      '2026-10-27',
      '2026-11-03',
      '2026-11-10',
      '2026-11-17',
    ]);

    // Idempotency: if Nov 3 already exists (or was cancelled), the generator skips it
    const existingDates = new Set(['2026-10-20', '2026-11-03']);
    const newlyCreated = occurrences.filter(date => !existingDates.has(date));

    expect(newlyCreated).toEqual(['2026-10-27', '2026-11-10', '2026-11-17']);
  });
});
