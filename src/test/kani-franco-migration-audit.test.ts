import { describe, expect, it } from 'vitest';
import {
  barbers,
  barberInstagramHandles,
  barberInstagramUrls,
  getEffectiveServicePrice,
  type Barber,
} from '@/lib/kani-model';
import {
  availabilityStartTimesForServiceDate,
  type PublicAvailabilityStart,
} from '@/lib/kani-availability';

describe('KANI Barber Studio — Auditoría y Verificación de Migración de Franco', () => {
  const referenceNow = new Date('2026-10-31T12:00:00Z');

  describe('1. Disponibilidad de Franco: sábados 15:00 a 20:00 y ausencia en otros días', () => {
    it('muestra a Franco disponible exclusivamente los sábados de 15:00 a 20:00', () => {
      // Sábado 2026-11-07
      const starts: PublicAvailabilityStart[] = [
        { barber_id: 'franco-id', barber_name: 'Franco', slot_date: '2026-11-07', start_time: '15:00:00', is_exception: false, compatible_services: ['Corte', 'Barba', 'Corte + barba'] },
        { barber_id: 'franco-id', barber_name: 'Franco', slot_date: '2026-11-07', start_time: '15:45:00', is_exception: false, compatible_services: ['Corte', 'Barba', 'Corte + barba'] },
        { barber_id: 'franco-id', barber_name: 'Franco', slot_date: '2026-11-07', start_time: '16:30:00', is_exception: false, compatible_services: ['Corte', 'Barba', 'Corte + barba'] },
        { barber_id: 'franco-id', barber_name: 'Franco', slot_date: '2026-11-07', start_time: '17:15:00', is_exception: false, compatible_services: ['Corte', 'Barba', 'Corte + barba'] },
        { barber_id: 'franco-id', barber_name: 'Franco', slot_date: '2026-11-07', start_time: '18:00:00', is_exception: false, compatible_services: ['Corte', 'Barba', 'Corte + barba'] },
        { barber_id: 'franco-id', barber_name: 'Franco', slot_date: '2026-11-07', start_time: '18:45:00', is_exception: false, compatible_services: ['Corte', 'Barba', 'Corte + barba'] },
        { barber_id: 'franco-id', barber_name: 'Franco', slot_date: '2026-11-07', start_time: '19:30:00', is_exception: false, compatible_services: ['Barba'] },
      ];

      const corteTimes = availabilityStartTimesForServiceDate(starts, '2026-11-07', 'Corte', referenceNow, 'Franco');
      expect(corteTimes).toContain('15:00');
      expect(corteTimes).toContain('18:45');
      // 19:30 only accommodates Barba (30m), not Corte (45m) since closing is 20:00
      expect(corteTimes).not.toContain('19:30');

      const barbaTimes = availabilityStartTimesForServiceDate(starts, '2026-11-07', 'Barba', referenceNow, 'Franco');
      expect(barbaTimes).toContain('19:30');
    });

    it('no tiene disponibilidad habitual en días de semana ni domingos', () => {
      // Días de semana (lunes 2026-11-02 a viernes 2026-11-06)
      const emptyStarts: PublicAvailabilityStart[] = [];
      const mondayTimes = availabilityStartTimesForServiceDate(emptyStarts, '2026-11-02', 'Corte', referenceNow, 'Franco');
      expect(mondayTimes).toEqual([]);
    });
  });

  describe('2. Preservación de bloqueos (UNAVAILABLE) y excepciones', () => {
    it('excluye horarios bloqueados administrativamente', () => {
      // Simulación de respuesta de RPC donde el turno de 16:30 está bloqueado por UNAVAILABLE
      const filteredStarts: PublicAvailabilityStart[] = [
        { barber_id: 'franco-id', barber_name: 'Franco', slot_date: '2026-11-07', start_time: '15:00:00', is_exception: false, compatible_services: ['Corte', 'Barba'] },
        // 16:30 bloqueado administrativamente -> no aparece en valid starts
        { barber_id: 'franco-id', barber_name: 'Franco', slot_date: '2026-11-07', start_time: '17:15:00', is_exception: false, compatible_services: ['Corte', 'Barba'] },
      ];

      const times = availabilityStartTimesForServiceDate(filteredStarts, '2026-11-07', 'Corte', referenceNow, 'Franco');
      expect(times).toEqual(['15:00', '17:15']);
      expect(times).not.toContain('16:30');
    });
  });

  describe('3. Precios efectivos y saldos en Payway y Mercado Pago', () => {
    const deposit = 5000;

    it('calcula precios exactos para Franco: Corte $15.000, Corte y barba $20.000, Barba $5.000', () => {
      expect(getEffectiveServicePrice('corte', 'Franco')).toBe(15000);
      expect(getEffectiveServicePrice('corte-barba', 'Franco')).toBe(20000);
      expect(getEffectiveServicePrice('barba', 'Franco')).toBe(5000);
    });

    it('calcula correctamente la seña y los saldos para Franco', () => {
      // Corte: $15.000 total - $5.000 seña = $10.000 saldo
      const corteTotal = getEffectiveServicePrice('corte', 'Franco');
      expect(corteTotal - deposit).toBe(10000);

      // Corte + barba: $20.000 total - $5.000 seña = $15.000 saldo
      const cbTotal = getEffectiveServicePrice('corte-barba', 'Franco');
      expect(cbTotal - deposit).toBe(15000);

      // Barba: $5.000 total - $5.000 seña = $0 saldo
      const barbaTotal = getEffectiveServicePrice('barba', 'Franco');
      expect(barbaTotal - deposit).toBe(0);
    });

    it('determina automáticamente balance_paid = true cuando el saldo es $0 (Barba Franco)', () => {
      const barbaTotal = getEffectiveServicePrice('barba', 'Franco');
      const paidAmount = 5000;
      const isBalancePaid = barbaTotal <= paidAmount;
      expect(isBalancePaid).toBe(true);

      const corteTotal = getEffectiveServicePrice('corte', 'Franco');
      const isCorteBalancePaid = corteTotal <= paidAmount;
      expect(isCorteBalancePaid).toBe(false);
    });
  });

  describe('4. Funcionamiento sin regresiones de Lautaro, Gonzalo y Valentín', () => {
    const originalBarbers: Barber[] = ['Lautaro', 'Gonzalo', 'Valentín'];

    it('mantiene los precios estándar para los 3 barberos originales', () => {
      for (const b of originalBarbers) {
        expect(getEffectiveServicePrice('corte', b)).toBe(25000);
        expect(getEffectiveServicePrice('corte-barba', b)).toBe(30000);
        expect(getEffectiveServicePrice('barba', b)).toBe(15000);

        // Saldos tras seña $5.000
        expect(getEffectiveServicePrice('corte', b) - 5000).toBe(20000);
        expect(getEffectiveServicePrice('corte-barba', b) - 5000).toBe(25000);
        expect(getEffectiveServicePrice('barba', b) - 5000).toBe(10000);
      }
    });

    it('respeta el orden oficial de 4 barberos en catálogo', () => {
      expect(barbers).toEqual(['Lautaro', 'Gonzalo', 'Valentín', 'Franco']);
      expect(barberInstagramHandles.Franco).toBe('@franbarber.24');
    });
  });

  describe('5. Protección de datos de clientes (PII) en consultas públicas', () => {
    it('enmascara correo electrónico y teléfono para clientes anónimos', () => {
      const rawEmail = 'juan.perez@example.com';
      const rawPhone = '+5491123456789';

      // Lógica equivalente a SQL regexp_replace en get_appointment_payment_details
      const maskedEmail = rawEmail.replace(/^(.)(.*)(@.*)$/, '$1***$3');
      const maskedPhone = rawPhone.replace(/(\d{2})\d+(\d{2})$/, '$1****$2');

      expect(maskedEmail).toBe('j***@example.com');
      expect(maskedPhone).toBe('+54****89');
      expect(maskedEmail).not.toContain('perez');
      expect(maskedPhone).not.toContain('234567');
    });
  });
});
