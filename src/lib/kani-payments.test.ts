import { describe, expect, it } from 'vitest';
import {
  findCandidateAppointments,
  normalizeClientString,
  clientNamesMatch,
  STANDARD_SERVICE_PRICES,
  validatePaymentInput,
  type RecordServicePaymentInput,
} from './kani-payments';
import type { RealAppointment } from './kani-appointments';

describe('Kani Payments Unit Tests', () => {
  const mockBarberLautaroId = 'barber-lautaro-111';
  const mockBarberGonzaloId = 'barber-gonzalo-222';

  const mockAppointments: RealAppointment[] = [
    {
      id: 'apt-1',
      requestNumber: 101,
      service: 'corte',
      barber: 'Lautaro',
      barberId: mockBarberLautaroId,
      serviceId: 'srv-1',
      date: '2026-10-20',
      time: '14:30',
      endTime: '15:15',
      name: 'Tomas Blutmann',
      email: 'tomas@example.com',
      phone: '11 5555 0101',
      status: 'Confirmado',
      statusCode: 'CONFIRMED',
      notes: '',
      depositPaid: true,
      depositAmountArs: 5000,
      balancePaid: false,
    },
    {
      id: 'apt-2',
      requestNumber: 102,
      service: 'corte-barba',
      barber: 'Gonzalo',
      barberId: mockBarberGonzaloId,
      serviceId: 'srv-2',
      date: '2026-10-20',
      time: '16:00',
      endTime: '16:45',
      name: 'Martín González',
      email: 'martin@example.com',
      phone: '11 5555 0102',
      status: 'Confirmado',
      statusCode: 'CONFIRMED',
      notes: '',
      depositPaid: false,
      depositAmountArs: 0,
      balancePaid: false,
    },
    {
      id: 'apt-3',
      requestNumber: 103,
      service: 'barba',
      barber: 'Lautaro',
      barberId: mockBarberLautaroId,
      serviceId: 'srv-3',
      date: '2026-10-21',
      time: '11:00',
      endTime: '11:30',
      name: 'Nicolás Rodríguez',
      email: 'nicolas@example.com',
      phone: '11 5555 0103',
      status: 'Cancelado',
      statusCode: 'CANCELLED',
      notes: '',
      depositPaid: false,
      balancePaid: false,
    },
  ];

  describe('Precios estándar automáticos', () => {
    it('proporciona importes oficiales para los servicios habituales', () => {
      expect(STANDARD_SERVICE_PRICES['Corte']).toBe(25000);
      expect(STANDARD_SERVICE_PRICES['Corte y barba']).toBe(30000);
      expect(STANDARD_SERVICE_PRICES['Barba']).toBe(15000);
    });
  });

  describe('Validación de formulario de pagos', () => {
    it('valida exitosamente un servicio habitual sin descuento', () => {
      const input: RecordServicePaymentInput = {
        barberId: mockBarberLautaroId,
        serviceName: 'Corte',
        servicePriceArs: 25000,
        discountArs: 0,
        paymentMethod: 'Efectivo',
      };
      const result = validatePaymentInput(input);
      expect(result.valid).toBe(true);
    });

    it('valida exitosamente un servicio con descuento válido', () => {
      const input: RecordServicePaymentInput = {
        barberId: mockBarberLautaroId,
        serviceName: 'Corte y barba',
        servicePriceArs: 30000,
        discountArs: 5000,
        paymentMethod: 'Transferencia',
      };
      const result = validatePaymentInput(input);
      expect(result.valid).toBe(true);
    });

    it('rechaza descuentos negativos', () => {
      const input: RecordServicePaymentInput = {
        barberId: mockBarberLautaroId,
        serviceName: 'Corte',
        servicePriceArs: 25000,
        discountArs: -100,
        paymentMethod: 'Efectivo',
      };
      const result = validatePaymentInput(input);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('negativo');
    });

    it('rechaza descuentos mayores al importe del servicio', () => {
      const input: RecordServicePaymentInput = {
        barberId: mockBarberLautaroId,
        serviceName: 'Barba',
        servicePriceArs: 10000,
        discountArs: 15000,
        paymentMethod: 'Efectivo',
      };
      const result = validatePaymentInput(input);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('superior al importe');
    });

    it('exige detalle e importe para el servicio Otros', () => {
      const withoutDetail: RecordServicePaymentInput = {
        barberId: mockBarberLautaroId,
        serviceName: 'Otros',
        serviceOtherDetail: '',
        servicePriceArs: 12000,
        paymentMethod: 'Efectivo',
      };
      const res1 = validatePaymentInput(withoutDetail);
      expect(res1.valid).toBe(false);
      expect(res1.error).toContain('detalle del servicio es obligatorio');

      const withoutPrice: RecordServicePaymentInput = {
        barberId: mockBarberLautaroId,
        serviceName: 'Otros',
        serviceOtherDetail: 'Venta de cera capilar',
        servicePriceArs: 0,
        paymentMethod: 'Efectivo',
      };
      const res2 = validatePaymentInput(withoutPrice);
      expect(res2.valid).toBe(false);
      expect(res2.error).toContain('mayor a cero');

      const validOther: RecordServicePaymentInput = {
        barberId: mockBarberLautaroId,
        serviceName: 'Otros',
        serviceOtherDetail: 'Lavado + Peinado especial',
        servicePriceArs: 15000,
        discountArs: 2000,
        paymentMethod: 'Transferencia',
      };
      const res3 = validatePaymentInput(validOther);
      expect(res3.valid).toBe(true);
    });

    it('impide marcar seña online si no hay turno vinculado', () => {
      const input: RecordServicePaymentInput = {
        barberId: mockBarberLautaroId,
        serviceName: 'Corte',
        servicePriceArs: 25000,
        onlineDepositPaid: true,
        paymentMethod: 'Efectivo',
      };
      const result = validatePaymentInput(input);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('sin vincular un turno con pago validado');
    });

    it('impide marcar seña online si el turno vinculado no tiene seña pagada', () => {
      const input: RecordServicePaymentInput = {
        barberId: mockBarberGonzaloId,
        serviceName: 'Corte y barba',
        servicePriceArs: 30000,
        appointmentId: 'apt-2',
        onlineDepositPaid: true,
        paymentMethod: 'Transferencia',
      };
      const result = validatePaymentInput(input, { appointment: mockAppointments[1] });
      expect(result.valid).toBe(false);
      expect(result.error).toContain('no registra una seña abonada online');
    });

    it('permite marcar seña online cuando el turno registra la seña efectivamente pagada', () => {
      const input: RecordServicePaymentInput = {
        barberId: mockBarberLautaroId,
        serviceName: 'Corte',
        servicePriceArs: 25000,
        appointmentId: 'apt-1',
        onlineDepositPaid: true,
        paymentMethod: 'Efectivo',
      };
      const result = validatePaymentInput(input, { appointment: mockAppointments[0] });
      expect(result.valid).toBe(true);
    });
  });

  describe('Búsqueda y coincidencia de turnos candidatos', () => {
    it('normaliza cadenas eliminando tildes y caracteres especiales', () => {
      expect(normalizeClientString('Martín González')).toBe('martin gonzalez');
      expect(normalizeClientString('Tomás Blutmann!')).toBe('tomas blutmann');
      expect(normalizeClientString('  Nicolás   Rodríguez  ')).toBe('nicolas rodriguez');
    });

    it('encuentra coincidencia aproximada de nombre con tildes o variaciones', () => {
      const match1 = clientNamesMatch('martin gonzalez', 'Martín González');
      expect(match1.match).toBe(true);

      const match2 = clientNamesMatch('Tomas', 'Tomás Blutmann');
      expect(match2.match).toBe(true);

      const match3 = clientNamesMatch('Desconocido', 'Tomás Blutmann');
      expect(match3.match).toBe(false);
    });

    it('identifica candidatos por fecha y horario exacto', () => {
      const matches = findCandidateAppointments(
        { date: '2026-10-20', time: '14:30' },
        mockAppointments,
      );
      expect(matches.length).toBeGreaterThanOrEqual(1);
      expect(matches[0]?.appointment.id).toBe('apt-1');
      expect(matches[0]?.matchReasons).toContain('Misma fecha');
      expect(matches[0]?.matchReasons).toContain('Mismo horario');
    });

    it('identifica candidatos por nombre aproximado aunque la hora difiera', () => {
      const matches = findCandidateAppointments(
        { date: '2026-10-20', clientName: 'Tomas' },
        mockAppointments,
      );
      expect(matches.some((m) => m.appointment.id === 'apt-1')).toBe(true);
    });

    it('excluye turnos cancelados de los candidatos', () => {
      const matches = findCandidateAppointments(
        { date: '2026-10-21', time: '11:00' },
        mockAppointments,
      );
      // apt-3 está CANCELLED
      expect(matches.find((m) => m.appointment.id === 'apt-3')).toBeUndefined();
    });

    it('excluye turnos que ya tienen un pago registrado para prevenir duplicados', () => {
      const alreadyPaid = new Set(['apt-1']);
      const matches = findCandidateAppointments(
        { date: '2026-10-20', time: '14:30' },
        mockAppointments,
        alreadyPaid,
      );
      expect(matches.find((m) => m.appointment.id === 'apt-1')).toBeUndefined();
    });

    it('respeta el filtro de barbero en la búsqueda de candidatos', () => {
      // Lautaro busca turnos para sí mismo
      const lautaroMatches = findCandidateAppointments(
        { date: '2026-10-20', barberId: mockBarberLautaroId },
        mockAppointments,
      );
      expect(lautaroMatches.every((m) => m.appointment.barberId === mockBarberLautaroId)).toBe(true);
      expect(lautaroMatches.find((m) => m.appointment.id === 'apt-2')).toBeUndefined();
    });
  });
});
