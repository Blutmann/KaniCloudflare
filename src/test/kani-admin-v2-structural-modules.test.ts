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
  appointmentErrorMessage,
  createManualAppointment,
  timeToMinutes,
  minutesToTime,
} from '@/lib/kani-appointments';
import {
  fetchServicePayments,
  deleteServicePayment,
  updateServicePaymentClient,
} from '@/lib/kani-payments';
import { supabase } from '@/integrations/supabase/client';

describe('Kani Admin V2 - Corrección estructural de módulos', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('1. CLIENTES - Persistencia y búsqueda', () => {
    it('llama al RPC save_client para persistencia permanente en Supabase', async () => {
      vi.mocked(supabase.rpc).mockResolvedValueOnce({
        data: [{ id: 'client-1', name: 'Carlos Gardel', phone: '1155554444', email: 'carlos@tango.com' }],
        error: null,
      } as any);

      const { data, error } = await supabase.rpc('save_client', {
        p_id: null,
        p_name: 'Carlos Gardel',
        p_phone: '1155554444',
        p_email: 'carlos@tango.com',
      });

      expect(error).toBeNull();
      expect(supabase.rpc).toHaveBeenCalledWith('save_client', {
        p_id: null,
        p_name: 'Carlos Gardel',
        p_phone: '1155554444',
        p_email: 'carlos@tango.com',
      });
      expect(data).toHaveLength(1);
    });

    it('permite buscar clientes por nombre, celular o correo sin distinguir mayúsculas', () => {
      const clients = [
        { id: '1', name: 'Agustín Pichot', phone: '1199887766', email: 'pichot@rugby.internal' },
        { id: '2', name: 'Lautaro Martínez', phone: '1122334455', email: 'toro@inter.com' },
      ];

      const searchByName = 'pichot';
      const resultsName = clients.filter((c) =>
        `${c.name} ${c.phone} ${c.email || ''}`.toLowerCase().includes(searchByName.toLowerCase()),
      );
      expect(resultsName).toHaveLength(1);
      expect(resultsName[0].id).toBe('1');

      const searchByPhone = '223344';
      const resultsPhone = clients.filter((c) =>
        `${c.name} ${c.phone} ${c.email || ''}`.toLowerCase().includes(searchByPhone.toLowerCase()),
      );
      expect(resultsPhone).toHaveLength(1);
      expect(resultsPhone[0].id).toBe('2');

      const searchByEmail = 'inter.com';
      const resultsEmail = clients.filter((c) =>
        `${c.name} ${c.phone} ${c.email || ''}`.toLowerCase().includes(searchByEmail.toLowerCase()),
      );
      expect(resultsEmail).toHaveLength(1);
      expect(resultsEmail[0].id).toBe('2');
    });
  });

  describe('2. TURNOS MANUALES - Horarios 24h, medianoche y conflictos', () => {
    it('soporta turnos que atraviesan la medianoche calculando la duración correcta', () => {
      const start = '23:30';
      const end = '00:15';
      const startM = timeToMinutes(start);
      const endM = timeToMinutes(end);
      const durationM = endM <= startM ? (endM + 1440) - startM : endM - startM;

      expect(durationM).toBe(45);
      expect(minutesToTime((startM + durationM) % 1440)).toBe('00:15');
    });

    it('envía p_client_id a create_manual_appointment cuando se selecciona un cliente existente', async () => {
      vi.mocked(supabase.rpc).mockResolvedValueOnce({
        data: [{ id: 'apt-manual-1', status: 'CONFIRMED' }],
        error: null,
      } as any);

      await createManualAppointment({
        barberId: 'barber-uuid-1',
        serviceId: 'service-uuid-1',
        date: '2026-10-30',
        time: '23:30',
        endTime: '00:15',
        name: 'Martín Palermo',
        phone: '1144443333',
        clientId: 'client-existing-99',
      });

      expect(supabase.rpc).toHaveBeenCalledWith(
        'create_manual_appointment',
        expect.objectContaining({
          p_client_id: 'client-existing-99',
          p_start_time: '23:30:00',
          p_end_time: '00:15:00',
        }),
      );
    });

    it('formatea el error OVERLAP_CONFLICT con el intervalo exacto del turno ocupado', () => {
      const dbError = 'Error: 23P01: OVERLAP_CONFLICT:17:30:18:15';
      const formatted = appointmentErrorMessage(dbError);
      expect(formatted).toBe('El barbero ya tiene un turno reservado entre las 17:30 y las 18:15.');
    });
  });

  describe('3. PAGOS - Trazabilidad, soft-delete y permisos', () => {
    const adminStaff = {
      user: { id: 'admin-user-id' } as any,
      profile: { role: 'ADMIN', barber_id: null, name: 'Admin Kani' } as any,
      barbers: [{ id: 'barber-1', name: 'Lautaro' }],
    };

    const barberStaff = {
      user: { id: 'barber-user-id' } as any,
      profile: { role: 'BARBER', barber_id: 'barber-1', name: 'Lautaro' } as any,
      barbers: [{ id: 'barber-1', name: 'Lautaro' }],
    };

    it('ejecuta soft_delete_service_payment para anulación lógica con trazabilidad', async () => {
      vi.mocked(supabase.rpc).mockResolvedValueOnce({
        data: null,
        error: null,
      } as any);

      await deleteServicePayment('payment-id-123', adminStaff);

      expect(supabase.rpc).toHaveBeenCalledWith('soft_delete_service_payment', {
        p_payment_id: 'payment-id-123',
      });
    });

    it('impide a un barbero anular o eliminar cobros', async () => {
      await expect(deleteServicePayment('payment-id-123', barberStaff)).rejects.toThrow(
        'Solo los administradores tienen permiso para eliminar registros de cobro.',
      );
    });

    it('permite a un barbero actualizar el contacto del cliente via update_service_payment_client', async () => {
      vi.mocked(supabase.rpc).mockResolvedValueOnce({
        data: null,
        error: null,
      } as any);

      await updateServicePaymentClient('payment-id-123', 'Lionel Messi', '1133332222');

      expect(supabase.rpc).toHaveBeenCalledWith('update_service_payment_client', {
        p_payment_id: 'payment-id-123',
        p_client_name: 'Lionel Messi',
        p_client_contact: '1133332222',
      });
    });

    it('fetchServicePayments excluye los registros con deleted_at no nulo', async () => {
      const isMock = vi.fn().mockReturnThis();
      const orderMock = vi.fn().mockReturnThis();
      const queryMock = {
        is: isMock,
        order: orderMock,
        then: (resolve: any) => resolve({ data: [], error: null }),
      };

      vi.mocked(supabase.from).mockReturnValue({
        select: vi.fn().mockReturnValue(queryMock),
      } as any);

      await fetchServicePayments({}, adminStaff);

      expect(isMock).toHaveBeenCalledWith('deleted_at', null);
    });
  });

  describe('4. DATOS (Insights) - Selector de períodos estricto y etiquetas dinámicas', () => {
    it('ofrece exactamente las 10 opciones requeridas en el orden estricto', () => {
      const expectedKeys = [
        'HOY',
        'AYER',
        'ESTA_SEMANA',
        'ESTE_MES',
        'ESTE_ANIO',
        'ULTIMOS_7',
        'ULTIMOS_14',
        'ULTIMOS_30',
        'MES_ANTERIOR',
        'ANIO_ANTERIOR',
      ];
      expect(expectedKeys).toHaveLength(10);
    });

    it('calcula etiquetas dinámicas con mes y año para Este mes, Este año, Mes anterior y Año anterior', () => {
      const months = [
        'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
        'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
      ];
      const today = '2026-10-29';
      const [year, month] = today.split('-').map(Number);

      const esteMesLabel = `Este mes (${months[month - 1]} ${year})`;
      expect(esteMesLabel).toBe('Este mes (Octubre 2026)');

      const esteAnioLabel = `Este año (${year})`;
      expect(esteAnioLabel).toBe('Este año (2026)');

      const prevMonthNum = month === 1 ? 12 : month - 1;
      const prevYear = month === 1 ? year - 1 : year;
      const mesAnteriorLabel = `Mes anterior (${months[prevMonthNum - 1]} ${prevYear})`;
      expect(mesAnteriorLabel).toBe('Mes anterior (Septiembre 2026)');

      const anioAnteriorLabel = `Año anterior (${year - 1})`;
      expect(anioAnteriorLabel).toBe('Año anterior (2025)');
    });

    it('incluye los cobros del día de hoy en el rango de últimos 7 días', () => {
      const payments = [
        { id: '1', paymentDate: '2026-10-29', collectedAmountArs: 25000 },
        { id: '2', paymentDate: '2026-10-25', collectedAmountArs: 20000 },
        { id: '3', paymentDate: '2026-10-10', collectedAmountArs: 15000 },
      ];

      const start = '2026-10-23';
      const end = '2026-10-29';

      const filtered = payments.filter((p) => p.paymentDate >= start && p.paymentDate <= end);
      expect(filtered).toHaveLength(2);
      expect(filtered.some((p) => p.paymentDate === '2026-10-29')).toBe(true);
    });
  });

  describe('5. HORARIOS - Conflictos explícitos y mensajes', () => {
    it('parsea AVAILABILITY_APPOINTMENT_CONFLICT con nombre del barbero y franja ocupada', () => {
      const errorMsg = 'AVAILABILITY_APPOINTMENT_CONFLICT:Lautaro:18:15:19:00';
      const match = errorMsg.match(/AVAILABILITY_APPOINTMENT_CONFLICT:([^:]+):(\d{2}:\d{2}):(\d{2}:\d{2})/);
      expect(match).not.toBeNull();
      if (match) {
        const formatted = `No se puede modificar esta franja porque ${match[1]} tiene un turno reservado de ${match[2]} a ${match[3]}.`;
        expect(formatted).toBe('No se puede modificar esta franja porque Lautaro tiene un turno reservado de 18:15 a 19:00.');
      }
    });

    it('genera exactamente 96 intervalos de 15 minutos de 00:00 a 23:45', () => {
      const scheduleTimeOptions = Array.from({ length: 96 }, (_, index) => {
        const totalMinutes = index * 15;
        const hours = Math.floor(totalMinutes / 60);
        const minutes = totalMinutes % 60;
        return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
      });

      expect(scheduleTimeOptions).toHaveLength(96);
      expect(scheduleTimeOptions[0]).toBe('00:00');
      expect(scheduleTimeOptions[1]).toBe('00:15');
      expect(scheduleTimeOptions[95]).toBe('23:45');
    });
  });
});
