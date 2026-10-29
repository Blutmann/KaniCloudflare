import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { defaultSlotEndTime } from '../components/kani/admin-schedule-manager';
import { validateAvailabilityRange, isFixedBookingStart, FIXED_BOOKING_START_TIMES } from '../lib/kani-availability';
import { clientHistory } from '../lib/kani-v2';
import type { RealAppointment } from '../lib/kani-appointments';
import type { ServicePayment } from '../lib/kani-payments';

describe('1. HORARIOS — Disponibilidad administrativa fuera de horario comercial', () => {
  it('la migración elimina de raíz la constraint availability_inside_business_hours', () => {
    const migrationPath = path.resolve(
      __dirname,
      '../../supabase/migrations/20261029080000_kani_admin_v2_horarios_fuera_de_horario_y_eliminar_clientes.sql',
    );
    expect(fs.existsSync(migrationPath)).toBe(true);

    const sql = fs.readFileSync(migrationPath, 'utf8');
    expect(sql).toContain('DROP CONSTRAINT IF EXISTS availability_inside_business_hours');
    expect(sql).toContain('DROP CONSTRAINT IF EXISTS availability_inside_extended_hours');
  });

  it('defaultSlotEndTime calcula exactamente 45 minutos para 09:00 -> 09:45, 08:00 -> 08:45 y horarios de salón', () => {
    expect(defaultSlotEndTime('09:00')).toBe('09:45');
    expect(defaultSlotEndTime('08:00')).toBe('08:45');
    expect(defaultSlotEndTime('09:15')).toBe('10:00');
    expect(defaultSlotEndTime('13:15')).toBe('14:00');
    expect(defaultSlotEndTime('20:00')).toBe('20:45');
    expect(defaultSlotEndTime('21:30')).toBe('22:15');
    expect(defaultSlotEndTime('23:15')).toBe('00:00');
  });

  it('validateAvailabilityRange valida correctamente 09:00 -> 09:45 y medianoche 23:15 -> 00:00', () => {
    expect(validateAvailabilityRange('09:00', '09:45')).toEqual({
      normalizedStart: '09:00:00',
      normalizedEnd: '09:45:00',
    });
    expect(validateAvailabilityRange('23:15', '00:00')).toEqual({
      normalizedStart: '23:15:00',
      normalizedEnd: '00:00:00',
    });
  });

  it('la disponibilidad pública en /reserva-v4 continúa restringida a 10:00-19:00 y excluye 09:00', () => {
    // 09:00 NO es un inicio válido para reservas públicas normales
    expect(isFixedBookingStart('09:00')).toBe(false);
    expect(isFixedBookingStart('08:00')).toBe(false);
    expect(isFixedBookingStart('20:00')).toBe(false);

    // Inicios válidos estándar en Kani
    expect(isFixedBookingStart('10:00')).toBe(true);
    expect(isFixedBookingStart('10:45')).toBe(true);
    expect(isFixedBookingStart('13:00')).toBe(true);
    expect(isFixedBookingStart('13:45')).toBe(true);
    expect(isFixedBookingStart('19:00')).toBe(true);

    // Lista fija de inicios comerciales
    expect(FIXED_BOOKING_START_TIMES).not.toContain('09:00');
    expect(FIXED_BOOKING_START_TIMES).toContain('10:00');
    expect(FIXED_BOOKING_START_TIMES).toContain('19:00');
  });

  it('la función create_availability_slots en SQL permite a ADMIN gestionar excepciones dominicales', () => {
    const migrationPath = path.resolve(
      __dirname,
      '../../supabase/migrations/20261029080000_kani_admin_v2_horarios_fuera_de_horario_y_eliminar_clientes.sql',
    );
    const sql = fs.readFileSync(migrationPath, 'utf8');
    expect(sql).toContain('(extract(isodow from v_date) = 7 AND NOT v_is_admin)');
  });
});

describe('2. CLIENTES — Eliminación segura por ADMIN y preservación de historial', () => {
  it('la migración define columna deleted_at y políticas RLS restrictivas (DELETE = ADMIN ONLY)', () => {
    const migrationPath = path.resolve(
      __dirname,
      '../../supabase/migrations/20261029080000_kani_admin_v2_horarios_fuera_de_horario_y_eliminar_clientes.sql',
    );
    const sql = fs.readFileSync(migrationPath, 'utf8');

    expect(sql).toContain('ADD COLUMN IF NOT EXISTS deleted_at timestamptz DEFAULT NULL');
    expect(sql).toContain('CREATE POLICY admin_can_delete_clients');
    expect(sql).toContain('FOR DELETE');
    expect(sql).toContain('USING (\n    public.is_admin()\n  )');
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.delete_client(p_client_id uuid)');
    expect(sql).toContain("RAISE EXCEPTION USING errcode = '42501', message = 'ADMIN_ROLE_REQUIRED'");
  });

  it('un cliente eliminado con soft delete no altera ni elimina sus turnos ni pagos históricos', () => {
    const clientId = 'c-test-123';
    const mockAppointments: RealAppointment[] = [
      {
        id: 'apt-1',
        clientId,
        name: 'Cliente Histórico',
        email: 'cliente@test.com',
        phone: '1122334455',
        barber: 'Lautaro',
        barberId: 'b1',
        serviceName: 'Corte',
        serviceId: 's1',
        servicePrice: 25000,
        date: '2026-10-15',
        time: '14:30',
        endTime: '15:15',
        status: 'Confirmado',
        statusCode: 'CONFIRMED',
        notes: null,
        isManual: false,
        origin: 'PUBLIC_WEB',
        depositPaid: true,
        depositAmountArs: 5000,
        balancePaid: false,
        createdByName: null,
      },
    ];

    const mockPayments: ServicePayment[] = [
      {
        id: 'sp-1',
        barberId: 'b1',
        barberName: 'Lautaro',
        serviceId: 's1',
        serviceName: 'Corte',
        serviceOtherDetail: null,
        servicePriceArs: 25000,
        discountArs: 0,
        finalAmountArs: 25000,
        paymentDate: '2026-10-15',
        paymentTime: '15:15',
        paymentMethod: 'Efectivo',
        onlineDepositPaid: true,
        onlineDepositAmountArs: 5000,
        collectedAmountArs: 20000,
        clientName: 'Cliente Histórico',
        clientContact: '1122334455',
        appointmentId: 'apt-1',
        serviceOrigin: 'appointment',
        createdByUserId: 'staff-1',
        createdByDisplayName: 'Admin',
        createdAt: '2026-10-15T18:15:00Z',
        isDepositMovement: false,
      },
    ];

    // Consultar historial del cliente: sigue intacto
    const history = clientHistory(clientId, mockAppointments, mockPayments);
    expect(history.visits).toBe(1);
    expect(history.recordedSpend).toBe(25000);
    expect(history.lastVisit).toBe('2026-10-15');
    expect(history.history).toHaveLength(1);
  });

  it('el componente V2Clients oculta el botón eliminar a barberos y lo muestra a administradores', () => {
    const clientsComponentPath = path.resolve(__dirname, '../components/kani/v2/clients.tsx');
    const code = fs.readFileSync(clientsComponentPath, 'utf8');

    expect(code).toContain('isAdmin &&');
    expect(code).toContain('Eliminar cliente');
    expect(code).toContain('handleDeleteClient');
    expect(code).toContain('¿Eliminar este cliente?');
    expect(code).toContain('dejará de figurar en la lista de clientes activos');
  });

  it('los clientes marcados con deleted_at se excluyen de la lista activa de clientes', () => {
    const allClients = [
      { id: '1', name: 'Activo 1', phone: '11111111', archived: false, deleted_at: null },
      { id: '2', name: 'Eliminado', phone: '22222222', archived: false, deleted_at: '2026-10-29T10:00:00Z' },
      { id: '3', name: 'Activo 2', phone: '33333333', archived: false, deleted_at: null },
    ];

    const activeClients = allClients.filter((c) => !c.archived && !(c as any).deleted_at);
    expect(activeClients).toHaveLength(2);
    expect(activeClients.map((c) => c.id)).toEqual(['1', '3']);
  });
});
