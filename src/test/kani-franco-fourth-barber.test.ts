import { describe, expect, it } from 'vitest';
import {
  barbers,
  barberInstagramHandles,
  barberInstagramUrls,
  getEffectiveServicePrice,
  initialAvailability,
  availableSlots,
  serviceFor,
  money,
  parseDate,
  type Barber,
} from '@/lib/kani-model';
import {
  availabilityStartTimesForServiceDate,
  isAllowedPublicBookingStart,
  type PublicAvailabilityStart,
} from '@/lib/kani-availability';

describe('KANI Barber Studio — Incorporación de Franco como cuarto barbero', () => {
  describe('1. Catálogo de barberos y perfil de Franco', () => {
    it('incluye a Franco en la cuarta posición en el orden oficial', () => {
      expect(barbers).toHaveLength(4);
      expect(barbers[0]).toBe('Lautaro');
      expect(barbers[1]).toBe('Gonzalo');
      expect(barbers[2]).toBe('Valentín');
      expect(barbers[3]).toBe('Franco');
    });

    it('registra el Instagram correcto de Franco y de los barberos existentes', () => {
      expect(barberInstagramHandles.Franco).toBe('@franbarber.24');
      expect(barberInstagramUrls.Franco).toBe('https://www.instagram.com/franbarber.24/');

      expect(barberInstagramHandles.Lautaro).toBe('@lautarodejesus_');
      expect(barberInstagramHandles.Gonzalo).toBe('@gonzalopierucci');
      expect(barberInstagramHandles['Valentín']).toBe('@valentincarrizo_');
    });
  });

  describe('2. Precios promocionales específicos de Franco vs generales', () => {
    it('aplica los importes exactos para Franco: Corte $15.000, Corte y barba $20.000, Barba $5.000', () => {
      expect(getEffectiveServicePrice('corte', 'Franco')).toBe(15000);
      expect(getEffectiveServicePrice('Corte', 'Franco')).toBe(15000);

      expect(getEffectiveServicePrice('corte-barba', 'Franco')).toBe(20000);
      expect(getEffectiveServicePrice('Corte y barba', 'Franco')).toBe(20000);
      expect(getEffectiveServicePrice('Corte + barba', 'Franco')).toBe(20000);

      expect(getEffectiveServicePrice('barba', 'Franco')).toBe(5000);
      expect(getEffectiveServicePrice('Barba', 'Franco')).toBe(5000);
    });

    it('conserva los precios generales intactos para Lautaro, Gonzalo y Valentín', () => {
      const existingBarbers: Barber[] = ['Lautaro', 'Gonzalo', 'Valentín'];
      for (const b of existingBarbers) {
        expect(getEffectiveServicePrice('corte', b)).toBe(25000);
        expect(getEffectiveServicePrice('corte-barba', b)).toBe(30000);
        expect(getEffectiveServicePrice('barba', b)).toBe(15000);
      }
    });

    it('calcula la seña unificada ($5.000) y los saldos exactos para Franco', () => {
      const deposit = 5000;

      // Corte Franco: Total $15.000, Seña $5.000, Saldo $10.000
      const corteTotal = getEffectiveServicePrice('corte', 'Franco');
      const corteSaldo = Math.max(0, corteTotal - deposit);
      expect(corteTotal).toBe(15000);
      expect(corteSaldo).toBe(10000);

      // Corte y barba Franco: Total $20.000, Seña $5.000, Saldo $15.000
      const cbTotal = getEffectiveServicePrice('corte-barba', 'Franco');
      const cbSaldo = Math.max(0, cbTotal - deposit);
      expect(cbTotal).toBe(20000);
      expect(cbSaldo).toBe(15000);

      // Barba Franco: Total $5.000, Seña $5.000, Saldo $0 (100% cubierto por la seña)
      const barbaTotal = getEffectiveServicePrice('barba', 'Franco');
      const barbaSaldo = Math.max(0, barbaTotal - deposit);
      expect(barbaTotal).toBe(5000);
      expect(barbaSaldo).toBe(0);
    });

    it('calcula los saldos correctos para los barberos tradicionales', () => {
      const deposit = 5000;
      expect(getEffectiveServicePrice('corte', 'Lautaro') - deposit).toBe(20000);
      expect(getEffectiveServicePrice('corte-barba', 'Lautaro') - deposit).toBe(25000);
      expect(getEffectiveServicePrice('barba', 'Lautaro') - deposit).toBe(10000);
    });
  });

  describe('3. Disponibilidad inicial de Franco (exclusivamente sábados 15:00 a 20:00)', () => {
    const availability = initialAvailability();

    it('Franco solo tiene disponibilidad habilitada los sábados (día 6)', () => {
      // 0 = Domingo, 1 = Lunes, 2 = Martes, 3 = Miércoles, 4 = Jueves, 5 = Viernes, 6 = Sábado
      for (let day = 0; day <= 5; day++) {
        expect(availability.Franco[day].enabled).toBe(false);
      }
      expect(availability.Franco[6].enabled).toBe(true);
      expect(availability.Franco[6].start).toBe('15:00');
      expect(availability.Franco[6].end).toBe('20:00');
    });

    it('los demás barberos conservan su disponibilidad habitual (lunes a sábado 10:00 a 20:00)', () => {
      const existingBarbers: Barber[] = ['Lautaro', 'Gonzalo', 'Valentín'];
      for (const b of existingBarbers) {
        expect(availability[b][0].enabled).toBe(false); // Domingo cerrado
        for (let day = 1; day <= 6; day++) {
          expect(availability[b][day].enabled).toBe(true);
          expect(availability[b][day].start).toBe('10:00');
          expect(availability[b][day].end).toBe('20:00');
        }
      }
    });

    it('permite turnos en sábado a partir de las 15:00 y no antes', () => {
      const saturdayDate = '2099-11-07'; // Sábado
      expect(parseDate(saturdayDate).getDay()).toBe(6);

      const slotsCorte = availableSlots('corte', 'Franco', saturdayDate, [], availability);
      expect(slotsCorte).toContain('15:00');
      expect(slotsCorte.some(s => s < '15:00')).toBe(false);

      // En días de semana (ej. lunes 2099-11-02), no debe haber turnos para Franco
      const mondayDate = '2099-11-02';
      expect(parseDate(mondayDate).getDay()).toBe(1);
      expect(availableSlots('corte', 'Franco', mondayDate, [], availability)).toEqual([]);

      // En domingos (ej. domingo 2099-11-08), no debe haber turnos para Franco
      const sundayDate = '2099-11-08';
      expect(parseDate(sundayDate).getDay()).toBe(0);
      expect(availableSlots('corte', 'Franco', sundayDate, [], availability)).toEqual([]);
    });

    it('cumple con el límite de cierre a las 20:00 según la duración del servicio', () => {
      const saturdayDate = '2099-11-07';

      // Corte (45 min): puede iniciar a las 19:15 porque termina exactamente a las 20:00
      const corteSlots = availableSlots('corte', 'Franco', saturdayDate, [], availability);
      expect(corteSlots).toContain('19:15');
      expect(corteSlots).not.toContain('19:30'); // 19:30 + 45m = 20:15 > 20:00

      // Corte y barba (60 min): puede iniciar a las 19:00 (termina 20:00), pero NO a las 19:15 (terminaría 20:15)
      const cbSlots = availableSlots('corte-barba', 'Franco', saturdayDate, [], availability);
      expect(cbSlots).toContain('19:00');
      expect(cbSlots).not.toContain('19:15');

      // Barba (30 min): puede iniciar a las 19:30 (termina 20:00)
      const barbaSlots = availableSlots('barba', 'Franco', saturdayDate, [], availability);
      expect(barbaSlots).toContain('19:30');
    });

    it('isAllowedPublicBookingStart valida los inicios de Franco los sábados', () => {
      const saturdayDate = '2026-11-07';
      expect(isAllowedPublicBookingStart(saturdayDate, '15:00:00', false, 'Franco')).toBe(true);
      expect(isAllowedPublicBookingStart(saturdayDate, '19:15:00', false, 'Franco')).toBe(true);
      expect(isAllowedPublicBookingStart(saturdayDate, '14:20:00', false, 'Franco')).toBe(false);
    });

    it('availabilityStartTimesForServiceDate filtra correctamente servicios según compatibilidad', () => {
      const saturdayDate = '2026-11-07';
      const now = new Date('2026-11-01T12:00:00Z');

      const starts: PublicAvailabilityStart[] = [
        {
          barber_id: 'franco-id',
          barber_name: 'Franco',
          slot_date: saturdayDate,
          start_time: '15:00:00',
          is_exception: false,
          compatible_services: ['Corte', 'Corte y barba', 'Corte + barba', 'Barba'],
        },
        {
          barber_id: 'franco-id',
          barber_name: 'Franco',
          slot_date: saturdayDate,
          start_time: '19:00:00',
          is_exception: false,
          compatible_services: ['Corte', 'Corte y barba', 'Corte + barba', 'Barba'],
        },
        {
          barber_id: 'franco-id',
          barber_name: 'Franco',
          slot_date: saturdayDate,
          start_time: '19:15:00',
          is_exception: false,
          compatible_services: ['Corte', 'Barba'], // Corte y barba NO es compatible porque termina a las 20:15
        },
      ];

      // Para Corte (45m): 15:00, 19:00 y 19:15 disponibles
      const corteStarts = availabilityStartTimesForServiceDate(starts, saturdayDate, 'Corte', now, 'Franco');
      expect(corteStarts).toEqual(['15:00', '19:00', '19:15']);

      // Para Corte y barba (60m): 15:00 y 19:00 disponibles; 19:15 NO disponible
      const cbStarts = availabilityStartTimesForServiceDate(starts, saturdayDate, 'Corte y barba', now, 'Franco');
      expect(cbStarts).toEqual(['15:00', '19:00']);
    });
  });
});
