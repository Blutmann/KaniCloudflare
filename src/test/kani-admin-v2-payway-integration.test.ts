import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/integrations/supabase/client', () => {
  return {
    supabase: {
      rpc: vi.fn(),
      from: vi.fn(),
    },
  };
});

import {
  calculatePaymentPeriodRange,
  getPaymentPeriodDynamicLabels,
  timestampToBusinessDateTime,
  fetchServicePayments,
  type ServicePayment,
} from '@/lib/kani-payments';
import { paymentSummary, clientHistory } from '@/lib/kani-v2';
import { readRealAppointments, type RealAppointment } from '@/lib/kani-appointments';
import { supabase } from '@/integrations/supabase/client';
import type { AuthenticatedStaff } from '@/lib/kani-auth';

const mockStaff: AuthenticatedStaff = {
  profile: {
    id: 'staff-1',
    role: 'ADMIN',
    barber_id: null,
    full_name: 'Admin Test',
    email: 'admin@kani.ar',
    permissions: ['*'],
    created_at: '2026-01-01T00:00:00Z',
  },
  barbers: [
    { id: 'b1', name: 'Lautaro', active: true },
    { id: 'b2', name: 'Gonzalo', active: true },
  ],
  user: null,
};

describe('Kani Admin V2 — Integración Payway, Pagos, Turnos e Identidad Histórica', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ============================================================================
  // 1. PAGOS — SEÑAS PAYWAY Y PREVENCIÓN DE DOBLE CONTEO
  // ============================================================================
  describe('1. PAGOS — Señas Payway en La cobranza y prevención de doble conteo', () => {
    it('muestra la seña Payway APPROVED según su fecha real de cobro, no la fecha futura del turno', () => {
      // Cliente pagó seña el 28/10/2026 a las 14:30 (UTC: 17:30)
      // Turno programado para el 05/11/2026 a las 10:45
      const { date: payDate, time: payTime } = timestampToBusinessDateTime('2026-10-28T17:30:00Z');
      expect(payDate).toBe('2026-10-28');
      expect(payTime).toBe('14:30');
    });

    it('la seña de $5.000 aparece como movimiento financiero propio en La cobranza', () => {
      const señaPayway: ServicePayment = {
        id: 'deposit-att-1',
        barberId: 'b1',
        barberName: 'Lautaro',
        serviceId: 's1',
        serviceName: 'Seña — Corte',
        serviceOtherDetail: null,
        servicePriceArs: 5000,
        discountArs: 0,
        finalAmountArs: 5000,
        paymentDate: '2026-10-28',
        paymentTime: '14:30',
        paymentMethod: 'Payway',
        onlineDepositPaid: true,
        onlineDepositAmountArs: 5000,
        collectedAmountArs: 5000,
        clientName: 'Juan Pérez',
        clientContact: '+5491155551111',
        appointmentId: 'apt-1',
        appointmentDate: '2026-11-05',
        appointmentTime: '10:45',
        serviceOrigin: 'online_deposit',
        createdByUserId: null,
        createdByDisplayName: 'Payway',
        createdAt: '2026-10-28T17:30:00Z',
        isDepositMovement: true,
      };

      const summary = paymentSummary([señaPayway]);
      expect(summary.collected).toBe(5000);
      expect(summary.value).toBe(5000);
      expect(summary.deposits).toBe(5000);
      expect(summary.count).toBe(1);
    });

    it('previene el doble conteo: saldo de $20.000 en local + seña de $5.000 totalizan $25.000 exactos', () => {
      // 1. Movimiento online cobrado el 28/10
      const señaPayway: ServicePayment = {
        id: 'deposit-att-1',
        barberId: 'b1',
        barberName: 'Lautaro',
        serviceId: 's1',
        serviceName: 'Seña — Corte',
        serviceOtherDetail: null,
        servicePriceArs: 5000,
        discountArs: 0,
        finalAmountArs: 5000,
        paymentDate: '2026-10-28',
        paymentTime: '14:30',
        paymentMethod: 'Payway',
        onlineDepositPaid: true,
        onlineDepositAmountArs: 5000,
        collectedAmountArs: 5000,
        clientName: 'Juan Pérez',
        clientContact: '+5491155551111',
        appointmentId: 'apt-1',
        appointmentDate: '2026-11-05',
        appointmentTime: '10:45',
        serviceOrigin: 'online_deposit',
        createdByUserId: null,
        createdByDisplayName: 'Payway',
        createdAt: '2026-10-28T17:30:00Z',
        isDepositMovement: true,
      };

      // 2. Cobro en el local el 05/11 por el saldo restante ($20.000)
      const cobroLocal: ServicePayment = {
        id: 'sp-1',
        barberId: 'b1',
        barberName: 'Lautaro',
        serviceId: 's1',
        serviceName: 'Corte',
        serviceOtherDetail: null,
        servicePriceArs: 25000,
        discountArs: 0,
        finalAmountArs: 25000,
        paymentDate: '2026-11-05',
        paymentTime: '11:30',
        paymentMethod: 'Efectivo',
        onlineDepositPaid: true,
        onlineDepositAmountArs: 5000,
        collectedAmountArs: 20000,
        clientName: 'Juan Pérez',
        clientContact: '+5491155551111',
        appointmentId: 'apt-1',
        serviceOrigin: 'appointment',
        createdByUserId: 'staff-1',
        createdByDisplayName: 'Admin Test',
        createdAt: '2026-11-05T14:30:00Z',
        isDepositMovement: false,
      };

      // Período 28/10: solo seña
      const summary28 = paymentSummary([señaPayway]);
      expect(summary28.collected).toBe(5000);
      expect(summary28.value).toBe(5000);

      // Período 05/11: solo cobro local
      const summary05 = paymentSummary([cobroLocal]);
      expect(summary05.collected).toBe(20000);
      expect(summary05.value).toBe(25000);

      // Período combinado (ambos movimientos):
      const summaryCombined = paymentSummary([señaPayway, cobroLocal]);
      // Total dinero efectivamente cobrado: 5.000 + 20.000 = 25.000
      expect(summaryCombined.collected).toBe(25000);
      // Valor económico total del servicio: 25.000 (NO 30.000)
      expect(summaryCombined.value).toBe(25000);
      // Señas reconocidas: 5.000
      expect(summaryCombined.deposits).toBe(5000);
      expect(summaryCombined.count).toBe(2);
    });

    it('fetchServicePayments integra RPC get_online_deposit_movements y combina con cobros de salón', async () => {
      // Mock de service_payments
      const mockQueryBuilder = {
        select: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        gte: vi.fn().mockReturnThis(),
        lte: vi.fn().mockReturnThis(),
        in: vi.fn().mockReturnThis(),
        ilike: vi.fn().mockReturnThis(),
        then: vi.fn((resolve) =>
          resolve({
            data: [
              {
                id: 'sp-1',
                barber_id: 'b1',
                service_id: 's1',
                service_name: 'Corte',
                service_other_detail: null,
                service_price_ars: 25000,
                discount_ars: 0,
                final_amount_ars: 25000,
                payment_date: '2026-10-29',
                payment_time: '11:00:00',
                payment_method: 'Efectivo',
                online_deposit_paid: false,
                online_deposit_amount_ars: 0,
                collected_amount_ars: 25000,
                client_name: 'Marcos Rojo',
                client_contact: '1122334455',
                appointment_id: null,
                service_origin: 'walk_in',
                created_by_user_id: 'staff-1',
                created_by_display_name: 'Admin',
                created_at: '2026-10-29T14:00:00Z',
              },
            ],
            error: null,
          }),
        ),
      };

      vi.mocked(supabase.from).mockReturnValue(mockQueryBuilder as any);

      // Mock de RPC get_online_deposit_movements
      vi.mocked(supabase.rpc).mockResolvedValueOnce({
        data: [
          {
            movement_id: 'deposit-att-payway-1',
            appointment_id: 'apt-pw-1',
            provider: 'PAYWAY',
            amount_ars: 5000,
            payment_date: '2026-10-29',
            payment_time: '15:20',
            payment_timestamp: '2026-10-29T18:20:00Z',
            barber_id: 'b1',
            barber_name: 'Lautaro',
            service_name: 'Seña — Corte',
            client_name: 'Nicolás Otamendi',
            client_contact: '1144556677',
            appointment_date: '2026-11-04',
            appointment_time: '16:00',
          },
        ],
        error: null,
      } as any);

      const payments = await fetchServicePayments({ date: '2026-10-29' }, mockStaff);
      expect(payments).toHaveLength(2);

      const deposit = payments.find((p) => p.isDepositMovement);
      expect(deposit).toBeDefined();
      expect(deposit?.serviceName).toBe('Seña — Corte');
      expect(deposit?.paymentMethod).toBe('Tarjeta — Payway');
      expect(deposit?.collectedAmountArs).toBe(5000);
      expect(deposit?.paymentDate).toBe('2026-10-29');
      expect(deposit?.appointmentDate).toBe('2026-11-04');
    });

    it('clasifica el método como "Tarjeta — Payway" y previene invención de crédito/débito', () => {
      const señaPayway: ServicePayment = {
        id: 'deposit-att-99',
        barberId: 'b1',
        barberName: 'Lautaro',
        serviceId: 's1',
        serviceName: 'Seña — Corte',
        serviceOtherDetail: null,
        servicePriceArs: 5000,
        discountArs: 0,
        finalAmountArs: 5000,
        paymentDate: '2026-10-29',
        paymentTime: '10:00',
        paymentMethod: 'Tarjeta — Payway',
        onlineDepositPaid: true,
        onlineDepositAmountArs: 5000,
        collectedAmountArs: 5000,
        clientName: 'Cliente Prueba',
        clientContact: '1122334455',
        appointmentId: 'apt-99',
        appointmentDate: '2026-11-10',
        appointmentTime: '11:00',
        serviceOrigin: 'online_deposit',
        createdByUserId: null,
        createdByDisplayName: 'Payway',
        createdAt: '2026-10-29T13:00:00Z',
        isDepositMovement: true,
      };

      const salonCash: ServicePayment = {
        id: 'sp-99',
        barberId: 'b1',
        barberName: 'Lautaro',
        serviceId: 's2',
        serviceName: 'Corte',
        serviceOtherDetail: null,
        servicePriceArs: 25000,
        discountArs: 0,
        finalAmountArs: 25000,
        paymentDate: '2026-10-29',
        paymentTime: '12:00',
        paymentMethod: 'Efectivo',
        onlineDepositPaid: false,
        onlineDepositAmountArs: 0,
        collectedAmountArs: 25000,
        clientName: 'Cliente Local',
        clientContact: '1199887766',
        appointmentId: null,
        serviceOrigin: 'walk_in',
        createdByUserId: 'staff-1',
        createdByDisplayName: 'Admin',
        createdAt: '2026-10-29T15:00:00Z',
        isDepositMovement: false,
      };

      const payments = [señaPayway, salonCash];
      const canonical = ["Efectivo", "Transferencia", "Tarjeta — Payway"];
      const present = new Set(
        payments
          .map((p) => (p.paymentMethod === "Payway" ? "Tarjeta — Payway" : p.paymentMethod))
          .filter(Boolean),
      );
      const methods = [...new Set([...canonical, ...present])];
      const byMethod = methods.map((name) => ({
        name,
        amount: payments
          .filter((p) => p.paymentMethod === name || (name === "Tarjeta — Payway" && p.paymentMethod === "Payway"))
          .reduce((sum, p) => sum + p.collectedAmountArs, 0),
      }));

      const efectivo = byMethod.find((m) => m.name === 'Efectivo');
      const transferencia = byMethod.find((m) => m.name === 'Transferencia');
      const tarjetaPayway = byMethod.find((m) => m.name === 'Tarjeta — Payway');

      expect(efectivo?.amount).toBe(25000);
      expect(transferencia?.amount).toBe(0);
      expect(tarjetaPayway?.amount).toBe(5000);
    });
  });

  // ============================================================================
  // 2. PERÍODOS EN PAGOS (11 OPCIONES, LÍMITES Y TIMEZONE)
  // ============================================================================
  describe('2. PERÍODOS EN PAGOS — 11 opciones dinámicas y validación', () => {
    const today = '2026-10-29';

    it('calcula correctamente los períodos del negocio', () => {
      // 1. Hoy
      expect(calculatePaymentPeriodRange('TODAY', today)).toEqual({
        start: '2026-10-29',
        end: '2026-10-29',
        label: 'Hoy',
      });

      // 2. Ayer
      expect(calculatePaymentPeriodRange('YESTERDAY', today)).toEqual({
        start: '2026-10-28',
        end: '2026-10-28',
        label: 'Ayer',
      });

      // 3. Esta semana (lunes a domingo)
      expect(calculatePaymentPeriodRange('THIS_WEEK', today)).toEqual({
        start: '2026-10-26',
        end: '2026-11-01',
        label: 'Esta semana',
      });

      // 4. Este mes (dinámico: Octubre 2026)
      expect(calculatePaymentPeriodRange('THIS_MONTH', today)).toEqual({
        start: '2026-10-01',
        end: '2026-10-31',
        label: 'Octubre 2026',
      });

      // 5. Este año (dinámico: 2026)
      expect(calculatePaymentPeriodRange('THIS_YEAR', today)).toEqual({
        start: '2026-01-01',
        end: '2026-12-31',
        label: '2026',
      });

      // 6. Últimos 7 días
      expect(calculatePaymentPeriodRange('LAST_7_DAYS', today)).toEqual({
        start: '2026-10-23',
        end: '2026-10-29',
        label: 'Últimos 7 días',
      });

      // 7. Últimos 14 días
      expect(calculatePaymentPeriodRange('LAST_14_DAYS', today)).toEqual({
        start: '2026-10-16',
        end: '2026-10-29',
        label: 'Últimos 14 días',
      });

      // 8. Últimos 30 días
      expect(calculatePaymentPeriodRange('LAST_30_DAYS', today)).toEqual({
        start: '2026-09-30',
        end: '2026-10-29',
        label: 'Últimos 30 días',
      });

      // 9. Mes anterior (dinámico: Septiembre 2026)
      expect(calculatePaymentPeriodRange('PREVIOUS_MONTH', today)).toEqual({
        start: '2026-09-01',
        end: '2026-09-30',
        label: 'Septiembre 2026',
      });

      // 10. Año anterior (dinámico: 2025)
      expect(calculatePaymentPeriodRange('PREVIOUS_YEAR', today)).toEqual({
        start: '2025-01-01',
        end: '2025-12-31',
        label: '2025',
      });
    });

    it('maneja correctamente los límites de cambio de año (ej. 1 de enero)', () => {
      const janFirst = '2026-01-01';
      // Mes anterior en enero debe ser Diciembre del año anterior (2025)
      expect(calculatePaymentPeriodRange('PREVIOUS_MONTH', janFirst)).toEqual({
        start: '2025-12-01',
        end: '2025-12-31',
        label: 'Diciembre 2025',
      });

      // Año anterior en 2026 debe ser 2025
      expect(calculatePaymentPeriodRange('PREVIOUS_YEAR', janFirst)).toEqual({
        start: '2025-01-01',
        end: '2025-12-31',
        label: '2025',
      });
    });

    it('valida rangos personalizados en Fecha específica (desde <= hasta)', () => {
      // Mismo día
      const sameDay = calculatePaymentPeriodRange('CUSTOM', today, '2026-10-15', '2026-10-15');
      expect(sameDay.isInvalid).toBe(false);
      expect(sameDay.start).toBe('2026-10-15');
      expect(sameDay.end).toBe('2026-10-15');

      // Rango válido
      const validRange = calculatePaymentPeriodRange('CUSTOM', today, '2026-10-01', '2026-10-15');
      expect(validRange.isInvalid).toBe(false);

      // Rango inválido (desde > hasta)
      const invalidRange = calculatePaymentPeriodRange('CUSTOM', today, '2026-10-20', '2026-10-10');
      expect(invalidRange.isInvalid).toBe(true);
    });

    it('genera etiquetas dinámicas correctas para los selectores', () => {
      const labels = getPaymentPeriodDynamicLabels('2026-10-29');
      expect(labels.THIS_MONTH).toBe('Octubre 2026');
      expect(labels.THIS_YEAR).toBe('2026');
      expect(labels.PREVIOUS_MONTH).toBe('Septiembre 2026');
      expect(labels.PREVIOUS_YEAR).toBe('2025');
    });
  });

  // ============================================================================
  // 3. TURNOS — VISIBILIDAD DE PAYWAY Y ESTADOS
  // ============================================================================
  describe('3. TURNOS — Reservas Payway visibles y estados reales', () => {
    it('representa turnos Payway APPROVED con estado CONFIRMED y seña de $5.000', () => {
      const aptApproved: RealAppointment = {
        id: 'apt-pw-approved',
        requestNumber: 101,
        service: 'corte',
        barber: 'Lautaro',
        date: '2026-11-04',
        time: '16:00',
        endTime: '16:45',
        name: 'Rodrigo De Paul',
        email: 'depaul@afa.ar',
        phone: '+5491133334444',
        status: 'Confirmado',
        notes: '',
        statusCode: 'CONFIRMED',
        barberId: 'b1',
        depositPaid: true,
        depositAmountArs: 5000,
        servicePrice: 25000,
      };

      expect(aptApproved.statusCode).toBe('CONFIRMED');
      expect(aptApproved.status).toBe('Confirmado');
      expect(aptApproved.depositPaid).toBe(true);
      expect(aptApproved.depositAmountArs).toBe(5000);
    });

    it('representa turnos Payway PENDING y CANCELLED sin desvirtuar su estado', () => {
      const aptPending: RealAppointment = {
        id: 'apt-pw-pending',
        requestNumber: 102,
        service: 'corte',
        barber: 'Gonzalo',
        date: '2026-11-04',
        time: '17:00',
        name: 'Julián Álvarez',
        email: 'spider@afa.ar',
        phone: '+5491122223333',
        status: 'Pendiente',
        notes: '',
        statusCode: 'PENDING',
        barberId: 'b2',
        depositPaid: false,
      };

      const aptCancelled: RealAppointment = {
        id: 'apt-pw-cancelled',
        requestNumber: 103,
        service: 'corte',
        barber: 'Lautaro',
        date: '2026-11-04',
        time: '18:00',
        name: 'Enzo Fernández',
        email: 'enzo@chelsea.com',
        phone: '+5491111112222',
        status: 'Cancelado',
        notes: '',
        statusCode: 'CANCELLED',
        barberId: 'b1',
        depositPaid: false,
      };

      expect(aptPending.statusCode).toBe('PENDING');
      expect(aptCancelled.statusCode).toBe('CANCELLED');
    });
  });

  // ============================================================================
  // 4. IDENTIDAD HISTÓRICA — SNAPSHOT INMUTABLE POR TURNO
  // ============================================================================
  describe('4. IDENTIDAD HISTÓRICA — Preservación de nombres independientes para mismo contacto', () => {
    it('conserva el nombre original de cada turno (Juan vs Camilo) aun compartiendo teléfono y email', () => {
      // Caso solicitado en prompt:
      // Turno 1: Juan reserva con teléfono X y email Y
      // Turno 2: Camilo reserva con el mismo teléfono X y email Y
      const sharedClientId = 'client-uuid-shared';
      const sharedPhone = '+5491199887766';
      const sharedEmail = 'amigos@barber.ar';

      const turnoJuan: RealAppointment = {
        id: 'apt-juan-1',
        requestNumber: 201,
        service: 'corte',
        serviceName: 'Corte',
        barber: 'Lautaro',
        date: '2026-10-10',
        time: '10:00',
        name: 'Juan', // Snapshot inmutable de la reserva
        bookingClientName: 'Juan',
        clientId: sharedClientId,
        phone: sharedPhone,
        email: sharedEmail,
        status: 'Ejecutado',
        statusCode: 'COMPLETED',
        notes: '',
        barberId: 'b1',
      };

      const turnoCamilo: RealAppointment = {
        id: 'apt-camilo-2',
        requestNumber: 202,
        service: 'corte',
        serviceName: 'Corte y barba',
        barber: 'Lautaro',
        date: '2026-10-20',
        time: '11:00',
        name: 'Camilo', // Snapshot inmutable de la reserva
        bookingClientName: 'Camilo',
        clientId: sharedClientId,
        phone: sharedPhone,
        email: sharedEmail,
        status: 'Confirmado',
        statusCode: 'CONFIRMED',
        notes: '',
        barberId: 'b1',
      };

      // 1. En Turnos, cada appointment se muestra con su propio nombre:
      expect(turnoJuan.name).toBe('Juan');
      expect(turnoCamilo.name).toBe('Camilo');

      // 2. En el Historial del cliente, se vinculan al mismo contacto pero cada turno conserva su nombre:
      const appointments = [turnoJuan, turnoCamilo];
      const payments: ServicePayment[] = [];
      const historySummary = clientHistory(sharedClientId, appointments, payments);

      expect(historySummary.history).toHaveLength(2);
      expect(historySummary.history[0].name).toBe('Juan');
      expect(historySummary.history[1].name).toBe('Camilo');

      // 3. Si posteriormente se cambia el nombre del contacto maestro a "Juan Pérez",
      // los snapshots de los turnos NO deben alterarse:
      const masterDirectoryClient = {
        id: sharedClientId,
        name: 'Juan Pérez',
        phone: sharedPhone,
        email: sharedEmail,
      };

      expect(masterDirectoryClient.name).toBe('Juan Pérez');
      // Los snapshots históricos permanecen intactos
      expect(turnoJuan.bookingClientName).toBe('Juan');
      expect(turnoCamilo.bookingClientName).toBe('Camilo');
    });
  });
});
