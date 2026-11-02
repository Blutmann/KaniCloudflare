import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  addCalendarMonths,
  calculateBenefitAmounts,
  calculateValidityDates,
  computeBenefitCodeStatus,
  formatBuenosAiresDate,
  formatBuenosAiresDateTime,
  getBuenosAiresTodayDateString,
  normalizeBenefitCode,
  type BenefitCodeItem,
  type BenefitValidityType,
} from '@/lib/kani-benefit-codes';
import { buildCancelledEmail } from '@/lib/kani-notifications.functions';
import { aggregateClientsDirectory, type RealAppointment } from '@/lib/kani-statistics';

describe('Kani — Benefit Codes Expansion (Usages & Validity) Suite', () => {
  describe('1. Modalidad de uso y valores predeterminados', () => {
    it('Por defecto la modalidad es un solo uso y sin vencimiento', () => {
      const dates = calculateValidityDates({
        validityType: 'NO_EXPIRATION',
        startDate: '2026-11-02',
      });

      expect(dates.isValid).toBe(true);
      expect(dates.validUntilIso).toBeNull();
      expect(dates.summary).toBe('Sin vencimiento');
      expect(dates.startDateString).toBe('2026-11-02');
    });

    it('Calcula beneficios económicos idénticos para single-use y reusable', () => {
      const calc1 = calculateBenefitAmounts(25000, 5000, 'PERCENT_10', 'PROMO-10');
      const calc2 = calculateBenefitAmounts(25000, 5000, 'PERCENT_50', 'PROMO-50');
      const calc3 = calculateBenefitAmounts(25000, 5000, 'NO_DEPOSIT', 'SIN-SENA');
      const calc4 = calculateBenefitAmounts(25000, 5000, 'FREE_SERVICE', 'GRATIS');

      expect(calc1.discountAmountArs).toBe(2500);
      expect(calc1.finalPriceArs).toBe(22500);
      expect(calc1.onlineDepositArs).toBe(5000);
      expect(calc1.inPersonBalanceArs).toBe(17500);

      expect(calc2.discountAmountArs).toBe(12500);
      expect(calc2.finalPriceArs).toBe(12500);
      expect(calc2.onlineDepositArs).toBe(5000);
      expect(calc2.inPersonBalanceArs).toBe(7500);

      expect(calc3.discountAmountArs).toBe(0);
      expect(calc3.finalPriceArs).toBe(25000);
      expect(calc3.onlineDepositArs).toBe(0);
      expect(calc3.skipOnlinePayment).toBe(true);

      expect(calc4.discountAmountArs).toBe(25000);
      expect(calc4.finalPriceArs).toBe(0);
      expect(calc4.onlineDepositArs).toBe(0);
      expect(calc4.skipOnlinePayment).toBe(true);
    });
  });

  describe('2. Vigencia y Zona Horaria Buenos Aires (UTC-3)', () => {
    it('Durante una semana (7 días): finaliza al séptimo día a las 23:59:59.999-03:00', () => {
      const res = calculateValidityDates({
        validityType: 'ONE_WEEK',
        startDate: '2026-11-02',
      });

      expect(res.isValid).toBe(true);
      expect(res.endDateString).toBe('2026-11-09');
      // 2026-11-09 23:59:59.999-03:00 == 2026-11-10T02:59:59.999Z
      expect(res.validUntilIso).toBe(new Date('2026-11-09T23:59:59.999-03:00').toISOString());
      expect(res.summary).toContain('Durante 1 semana');
      expect(res.detail).toContain('23:59 hs');
    });

    it('Durante un mes calendario: suma 1 mes exacto y ajusta al último día del mes cuando corresponde', () => {
      // Caso 1: Mes normal (ej. 2 de noviembre -> 2 de diciembre)
      const resNov = calculateValidityDates({
        validityType: 'ONE_MONTH',
        startDate: '2026-11-02',
      });
      expect(resNov.endDateString).toBe('2026-12-02');
      expect(resNov.validUntilIso).toBe(new Date('2026-12-02T23:59:59.999-03:00').toISOString());

      // Caso 2: Ajuste de fin de mes de 31 días a mes de 30 días (31 de marzo -> 30 de abril)
      const resMar = calculateValidityDates({
        validityType: 'ONE_MONTH',
        startDate: '2026-03-31',
      });
      expect(resMar.endDateString).toBe('2026-04-30');
      expect(resMar.validUntilIso).toBe(new Date('2026-04-30T23:59:59.999-03:00').toISOString());

      // Caso 3: Ajuste a febrero no bisiesto (31 de enero 2027 -> 28 de febrero 2027)
      const resEne = calculateValidityDates({
        validityType: 'ONE_MONTH',
        startDate: '2027-01-31',
      });
      expect(resEne.endDateString).toBe('2027-02-28');
    });

    it('Duración personalizada en días, semanas o meses', () => {
      // 10 días
      const resDays = calculateValidityDates({
        validityType: 'CUSTOM_DURATION',
        startDate: '2026-11-01',
        durationValue: 10,
        durationUnit: 'DAYS',
      });
      expect(resDays.endDateString).toBe('2026-11-11');
      expect(resDays.summary).toBe('Por 10 días (hasta el 11/11/2026)');

      // 2 semanas
      const resWeeks = calculateValidityDates({
        validityType: 'CUSTOM_DURATION',
        startDate: '2026-11-01',
        durationValue: 2,
        durationUnit: 'WEEKS',
      });
      expect(resWeeks.endDateString).toBe('2026-11-15');
      expect(resWeeks.summary).toBe('Por 2 semanas (hasta el 15/11/2026)');

      // 3 meses con ajuste de fin de mes (31 de agosto -> 30 de noviembre)
      const resMonths = calculateValidityDates({
        validityType: 'CUSTOM_DURATION',
        startDate: '2026-08-31',
        durationValue: 3,
        durationUnit: 'MONTHS',
      });
      expect(resMonths.endDateString).toBe('2026-11-30');
    });

    it('Rango de fechas: valida que fecha final sea posterior o igual a la de inicio', () => {
      // Rango válido
      const resValid = calculateValidityDates({
        validityType: 'DATE_RANGE',
        startDate: '2026-11-10',
        endDate: '2026-11-20',
      });
      expect(resValid.isValid).toBe(true);
      expect(resValid.validUntilIso).toBe(new Date('2026-11-20T23:59:59.999-03:00').toISOString());

      // Rango inválido (fin anterior a inicio)
      const resInvalid = calculateValidityDates({
        validityType: 'DATE_RANGE',
        startDate: '2026-11-20',
        endDate: '2026-11-10',
      });
      expect(resInvalid.isValid).toBe(false);
      expect(resInvalid.error).toContain('no puede ser anterior');
    });
  });

  describe('3. Estados del ciclo de vida (computeBenefitCodeStatus)', () => {
    const fixedNow = new Date('2026-11-05T12:00:00-03:00');

    it('Distinción de estado: ACTIVE', () => {
      const status = computeBenefitCodeStatus({
        status: 'ACTIVE',
        usageMode: 'REUSABLE',
        validFrom: '2026-11-01T00:00:00-03:00',
        validUntil: '2026-11-10T23:59:59-03:00',
      }, fixedNow);

      expect(status).toBe('ACTIVE');
    });

    it('Distinción de estado: SCHEDULED (inicio futuro)', () => {
      const status = computeBenefitCodeStatus({
        status: 'ACTIVE',
        usageMode: 'REUSABLE',
        validFrom: '2026-11-10T00:00:00-03:00',
        validUntil: '2026-11-20T23:59:59-03:00',
      }, fixedNow);

      expect(status).toBe('SCHEDULED');
    });

    it('Distinción de estado: EXPIRED (vencido)', () => {
      const status = computeBenefitCodeStatus({
        status: 'ACTIVE',
        usageMode: 'REUSABLE',
        validFrom: '2026-10-01T00:00:00-03:00',
        validUntil: '2026-11-01T23:59:59-03:00',
      }, fixedNow);

      expect(status).toBe('EXPIRED');
    });

    it('Distinción de estado: DISABLED (desactivado administrativamente)', () => {
      const status = computeBenefitCodeStatus({
        status: 'DISABLED',
        usageMode: 'REUSABLE',
        validFrom: '2026-11-01T00:00:00-03:00',
        validUntil: '2026-11-10T23:59:59-03:00',
      }, fixedNow);

      expect(status).toBe('DISABLED');
    });

    it('Distinción de estado: CONSUMED (solo para un solo uso)', () => {
      const statusSingle = computeBenefitCodeStatus({
        status: 'CONSUMED',
        usageMode: 'SINGLE_USE',
        timesUsed: 1,
      }, fixedNow);
      expect(statusSingle).toBe('CONSUMED');

      // Si es reutilizable con 5 usos, NO está consumido sino ACTIVE
      const statusReusable = computeBenefitCodeStatus({
        status: 'ACTIVE',
        usageMode: 'REUSABLE',
        timesUsed: 5,
        validUntil: '2026-11-10T23:59:59-03:00',
      }, fixedNow);
      expect(statusReusable).toBe('ACTIVE');
    });

    it('Distinción de estado: DELETED (soft delete conservado en historial)', () => {
      const status = computeBenefitCodeStatus({
        status: 'DISABLED',
        usageMode: 'REUSABLE',
        deletedAt: '2026-11-04T10:00:00-03:00',
      }, fixedNow);

      expect(status).toBe('DELETED');
    });
  });

  describe('4. Cancelaciones y Notificaciones de Correo', () => {
    const basePayload = {
      notificationId: 'notif-1',
      recipientEmail: 'cliente@ejemplo.com',
      clientName: 'Tomás',
      barberName: 'Lautaro',
      serviceName: 'Corte de cabello',
      bookingDate: '2026-11-10',
      startTime: '16:00:00',
      endTime: '16:45:00',
      clientNotes: null,
      servicePriceArs: 25000,
      serviceDurationMinutes: 45,
      downPaymentArs: 5000,
      transferAlias: null,
      transferCuit: null,
      transferHolderName: null,
    };

    it('Código de un solo uso en cancelación: advierte que fue consumido y no podrá reutilizarse', () => {
      const email = buildCancelledEmail({
        ...basePayload,
        benefitCode: 'KANI-SINGLE-1234',
        benefitType: 'NO_DEPOSIT',
        benefitUsageMode: 'SINGLE_USE',
      });

      expect(email.html).toContain('KANI-SINGLE-1234');
      expect(email.html).toContain('ha sido consumido y no podrá reutilizarse');
      expect(email.text).toContain('ha sido consumido y no podrá reutilizarse');
    });

    it('Código reutilizable en cancelación: NO afirma que quedó inutilizable o consumido', () => {
      const email = buildCancelledEmail({
        ...basePayload,
        benefitCode: 'KANI-REUSABLE-9999',
        benefitType: 'PERCENT_10',
        benefitUsageMode: 'REUSABLE',
      });

      expect(email.html).toContain('KANI-REUSABLE-9999');
      expect(email.html).not.toContain('no podrá reutilizarse');
      expect(email.html).not.toContain('ha sido consumido');
      expect(email.text).toContain('KANI-REUSABLE-9999');
      expect(email.text).not.toContain('no podrá reutilizarse');
      expect(email.text).not.toContain('ha sido consumido');
    });
  });

  describe('5. Directorio de Clientes e Historial de Usos', () => {
    it('Refleja los datos de beneficios económicos en el historial del cliente', () => {
      const appts: RealAppointment[] = [
        {
          id: 'appt-1',
          requestNumber: 501,
          date: '2026-11-05',
          time: '16:00',
          barber: 'Franco',
          serviceName: 'Corte de cabello',
          status: 'Confirmado',
          statusCode: 'CONFIRMED',
          clientId: 'client-1',
          name: 'Martín Palermo',
          email: 'martin@boca.com',
          phone: '+54 9 11 1234 5678',
          notes: '',
          benefitCode: 'KANI-REUSABLE-BOCA',
          benefitType: 'PERCENT_50',
          benefitOriginalPriceArs: 25000,
          benefitDiscountAmountArs: 12500,
          benefitFinalPriceArs: 12500,
          benefitOnlineDepositArs: 5000,
          benefitInPersonBalanceArs: 7500,
        },
      ];

      const dir = aggregateClientsDirectory(appts);
      expect(dir).toHaveLength(1);
      const client = dir[0];
      expect(client.name).toBe('Martín Palermo');
      expect(client.appointments).toHaveLength(1);

      const aptItem = client.appointments[0];
      expect(aptItem.benefitCode).toBe('KANI-REUSABLE-BOCA');
      expect(aptItem.benefitType).toBe('PERCENT_50');
      expect(aptItem.benefitDiscountAmountArs).toBe(12500);
      expect(aptItem.benefitFinalPriceArs).toBe(12500);
    });
  });
});
