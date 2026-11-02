import { describe, it, expect } from 'vitest';
import {
  calculateBenefitAmounts,
  normalizeBenefitCode,
  generateBenefitCode,
  type BenefitCodeType,
} from '@/lib/kani-benefit-codes';
import { computeFinancialControl, computeServiceDemand, type RealAppointment } from '@/lib/kani-statistics';
import { buildConfirmedEmail, buildCancelledEmail } from '@/lib/kani-notifications.functions';

describe('Kani Benefit Codes & Payway Integration Suite', () => {
  describe('1. The 4 Official Benefit Code Types Calculations', () => {
    it('Type A: NO_DEPOSIT — Servicio $30.000, Seña $0, Saldo en local $30.000, skipOnlinePayment=true', () => {
      const calc = calculateBenefitAmounts(30000, 5000, 'NO_DEPOSIT', 'KANI-ABCD-EFGH');
      expect(calc.benefitType).toBe('NO_DEPOSIT');
      expect(calc.originalPriceArs).toBe(30000);
      expect(calc.discountAmountArs).toBe(0);
      expect(calc.finalPriceArs).toBe(30000);
      expect(calc.onlineDepositArs).toBe(0);
      expect(calc.inPersonBalanceArs).toBe(30000);
      expect(calc.skipOnlinePayment).toBe(true);
      expect(calc.buttonLabel).toBe('Reservar turno');
    });

    it('Type B: FREE_SERVICE — Servicio $25.000, Bonificación 100%, Seña $0, Total $0, Saldo $0, skipOnlinePayment=true', () => {
      const calc = calculateBenefitAmounts(25000, 5000, 'FREE_SERVICE', 'KANI-FREE-TEST');
      expect(calc.benefitType).toBe('FREE_SERVICE');
      expect(calc.originalPriceArs).toBe(25000);
      expect(calc.discountAmountArs).toBe(25000);
      expect(calc.finalPriceArs).toBe(0);
      expect(calc.onlineDepositArs).toBe(0);
      expect(calc.inPersonBalanceArs).toBe(0);
      expect(calc.skipOnlinePayment).toBe(true);
      expect(calc.buttonLabel).toBe('Reservar turno');
    });

    it('Type C: PERCENT_10 — Servicio $30.000, Descuento $3.000, Total $27.000, Seña $5.000, Saldo $22.000', () => {
      const calc = calculateBenefitAmounts(30000, 5000, 'PERCENT_10', 'KANI-P010-TEST');
      expect(calc.benefitType).toBe('PERCENT_10');
      expect(calc.originalPriceArs).toBe(30000);
      expect(calc.discountAmountArs).toBe(3000);
      expect(calc.finalPriceArs).toBe(27000);
      expect(calc.onlineDepositArs).toBe(5000);
      expect(calc.inPersonBalanceArs).toBe(22000);
      expect(calc.skipOnlinePayment).toBe(false);
      expect(calc.buttonLabel).toContain('Pagar seña');
    });

    it('Type D: PERCENT_50 — Servicio $25.000, Descuento $12.500, Total $12.500, Seña $5.000, Saldo $7.500', () => {
      const calc = calculateBenefitAmounts(25000, 5000, 'PERCENT_50', 'KANI-P050-TEST');
      expect(calc.benefitType).toBe('PERCENT_50');
      expect(calc.originalPriceArs).toBe(25000);
      expect(calc.discountAmountArs).toBe(12500);
      expect(calc.finalPriceArs).toBe(12500);
      expect(calc.onlineDepositArs).toBe(5000);
      expect(calc.inPersonBalanceArs).toBe(7500);
      expect(calc.skipOnlinePayment).toBe(false);
    });

    it('Invariant: In no case can online deposit exceed final total price or yield negative balance', () => {
      // Servicio $4.000 con seña configurada de $5.000
      const calc = calculateBenefitAmounts(4000, 5000, 'PERCENT_50', 'KANI-CHEA-TEST');
      expect(calc.finalPriceArs).toBe(2000);
      expect(calc.onlineDepositArs).toBe(2000); // capped at finalPrice
      expect(calc.inPersonBalanceArs).toBe(0); // balance never negative
    });
  });

  describe('2. Financial Control, Collections & Accounting Invariants', () => {
    it('Free service has zero economic impact; completed free service counts as completed with $0 revenue', () => {
      const freeAppt: RealAppointment = {
        id: 'appt-free',
        requestNumber: 1001,
        bookingDate: '2026-11-05',
        startTime: '14:00',
        barber: 'Lautaro',
        service: 'corte',
        serviceName: 'Corte',
        servicePrice: 25000,
        statusCode: 'COMPLETED',
        depositPaid: false,
        balancePaid: true,
        benefitType: 'FREE_SERVICE',
        benefitCode: 'KANI-FREE-0001',
        benefitOriginalPriceArs: 25000,
        benefitDiscountAmountArs: 25000,
        benefitFinalPriceArs: 0,
        benefitOnlineDepositArs: 0,
        benefitInPersonBalanceArs: 0,
        barberId: 'barber-lautaro',
        name: 'Cliente Bonificado',
        phone: '+5491100000000',
        email: 'bonificado@test.com',
        notes: '',
        date: '2026-11-05',
        time: '14:00',
      };

      const summary = computeFinancialControl([freeAppt]);
      expect(summary.completedServices.count).toBe(1);
      expect(summary.completedServices.totalCollectedArs).toBe(0);
      expect(summary.completedServices.totalServiceValueArs).toBe(0);
      expect(summary.completedServices.unpaidBalanceArs).toBe(0);
      expect(summary.depositsCollected.totalArs).toBe(0);
    });

    it('No-deposit confirmed appointment shows full price in pendingBalances', () => {
      const noDepAppt: RealAppointment = {
        id: 'appt-nodep',
        requestNumber: 1002,
        bookingDate: '2026-11-05',
        startTime: '15:00',
        barber: 'Gonzalo',
        service: 'corte',
        serviceName: 'Corte',
        servicePrice: 30000,
        statusCode: 'CONFIRMED',
        depositPaid: false,
        benefitType: 'NO_DEPOSIT',
        benefitCode: 'KANI-NDEP-0002',
        benefitOriginalPriceArs: 30000,
        benefitDiscountAmountArs: 0,
        benefitFinalPriceArs: 30000,
        benefitOnlineDepositArs: 0,
        benefitInPersonBalanceArs: 30000,
        barberId: 'barber-gonzalo',
        name: 'Cliente Sin Seña',
        phone: '+5491100000001',
        email: 'sinseña@test.com',
        notes: '',
        date: '2026-11-05',
        time: '15:00',
      };

      const summary = computeFinancialControl([noDepAppt]);
      expect(summary.pendingBalances.count).toBe(1);
      expect(summary.pendingBalances.totalArs).toBe(30000);
      expect(summary.depositsCollected.totalArs).toBe(0);
    });

    it('Percentage discounts calculate revenue on reduced price, never on original price', () => {
      const discAppt: RealAppointment = {
        id: 'appt-disc',
        requestNumber: 1003,
        bookingDate: '2026-11-05',
        startTime: '16:00',
        barber: 'Lautaro',
        service: 'corte',
        serviceName: 'Corte',
        servicePrice: 30000, // original price
        statusCode: 'COMPLETED',
        depositPaid: true,
        depositAmountArs: 5000,
        balancePaid: true,
        benefitType: 'PERCENT_10',
        benefitCode: 'KANI-10PC-0003',
        benefitOriginalPriceArs: 30000,
        benefitDiscountAmountArs: 3000,
        benefitFinalPriceArs: 27000, // reduced final price
        benefitOnlineDepositArs: 5000,
        benefitInPersonBalanceArs: 22000,
        barberId: 'barber-lautaro',
        name: 'Cliente Diez Porciento',
        phone: '+5491100000002',
        email: 'diez@test.com',
        notes: '',
        date: '2026-11-05',
        time: '16:00',
      };

      const summary = computeFinancialControl([discAppt]);
      expect(summary.depositsCollected.totalArs).toBe(5000);
      expect(summary.completedServices.totalServiceValueArs).toBe(27000);
      expect(summary.completedServices.totalCollectedArs).toBe(27000);

      const demand = computeServiceDemand([discAppt]);
      expect(demand[0]?.totalRevenue).toBe(27000);
    });

    it('Cancelled appointments do not count as completed services or revenue', () => {
      const cancelledAppt: RealAppointment = {
        id: 'appt-cancelled',
        requestNumber: 1004,
        bookingDate: '2026-11-05',
        startTime: '17:00',
        barber: 'Lautaro',
        service: 'corte',
        serviceName: 'Corte',
        servicePrice: 25000,
        statusCode: 'CANCELLED',
        depositPaid: true,
        depositAmountArs: 5000,
        benefitType: 'PERCENT_50',
        benefitCode: 'KANI-50PC-0004',
        benefitFinalPriceArs: 12500,
        barberId: 'barber-lautaro',
        name: 'Cliente Cancelado',
        phone: '+5491100000003',
        email: 'cancel@test.com',
        notes: '',
        date: '2026-11-05',
        time: '17:00',
      };

      const summary = computeFinancialControl([cancelledAppt]);
      expect(summary.completedServices.count).toBe(0);

      const demand = computeServiceDemand([cancelledAppt]);
      expect(demand[0]?.totalRevenue).toBe(0);
    });
  });

  describe('3. Notification Templates for Benefits', () => {
    it('Confirmed email for NO_DEPOSIT states "Reserva sin seña" and does NOT say "seña abonada"', () => {
      const email = buildConfirmedEmail({
        notificationId: 'notif-1',
        notificationType: 'CONFIRMED',
        recipientEmail: 'cliente@test.com',
        clientName: 'Martín Pérez',
        barberName: 'Lautaro',
        serviceName: 'Corte y barba',
        bookingDate: '2026-11-10',
        startTime: '15:00:00',
        endTime: '15:50:00',
        clientNotes: null,
        servicePriceArs: 30000,
        serviceDurationMinutes: 50,
        downPaymentArs: null,
        transferAlias: null,
        transferCuit: null,
        transferHolderName: null,
        benefitType: 'NO_DEPOSIT',
        benefitCode: 'KANI-NDEP-9999',
        benefitOriginalPriceArs: 30000,
        benefitDiscountAmountArs: 0,
        benefitFinalPriceArs: 30000,
        benefitOnlineDepositArs: 0,
        benefitInPersonBalanceArs: 30000,
      });

      expect(email.html).toContain('Reserva sin seña');
      expect(email.html).toContain('Abonás el total de $30.000 en el local');
      expect(email.html).not.toContain('Seña abonada');
      expect(email.text).toContain('Reserva sin seña');
      expect(email.text).toContain('Abonás el total de $30.000 en el local');
      expect(email.text).not.toContain('Seña abonada');
    });

    it('Confirmed email for FREE_SERVICE states "Servicio bonificado al 100%" and "Total a pagar: $0"', () => {
      const email = buildConfirmedEmail({
        notificationId: 'notif-2',
        notificationType: 'CONFIRMED',
        recipientEmail: 'cliente@test.com',
        clientName: 'Martín Pérez',
        barberName: 'Lautaro',
        serviceName: 'Corte',
        bookingDate: '2026-11-10',
        startTime: '16:00:00',
        endTime: '16:45:00',
        clientNotes: null,
        servicePriceArs: 25000,
        serviceDurationMinutes: 45,
        downPaymentArs: null,
        transferAlias: null,
        transferCuit: null,
        transferHolderName: null,
        benefitType: 'FREE_SERVICE',
        benefitCode: 'KANI-FREE-9999',
        benefitOriginalPriceArs: 25000,
        benefitDiscountAmountArs: 25000,
        benefitFinalPriceArs: 0,
        benefitOnlineDepositArs: 0,
        benefitInPersonBalanceArs: 0,
      });

      expect(email.html).toContain('Servicio 100% bonificado');
      expect(email.html).toContain('Total a pagar: $0');
      expect(email.text).toContain('Servicio bonificado al 100 %');
      expect(email.text).toContain('Total a pagar: $0');
    });

    it('Cancelled email informs that benefit code is consumed and cannot be reused', () => {
      const email = buildCancelledEmail(
        {
          notificationId: 'notif-3',
          notificationType: 'CANCELLED',
          recipientEmail: 'cliente@test.com',
          clientName: 'Martín Pérez',
          barberName: 'Lautaro',
          serviceName: 'Corte',
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
          benefitCode: 'KANI-50PC-1234',
        },
        'https://kanibarber.workers.dev/reservar-turno'
      );

      expect(email.text).toContain('KANI-50PC-1234');
      expect(email.text).toContain('ha sido consumido y no puede reutilizarse');
      expect(email.html).toContain('KANI-50PC-1234');
      expect(email.html).toContain('ha sido consumido y no puede reutilizarse');
    });
  });
});
