import { describe, expect, it } from 'vitest';
import {
  buildSlotItemsForDate,
  findClosestAlternativeTimes,
  getTimePeriod,
  groupSlotsByPeriod,
  isAvailabilityConflictError,
  SlotUnavailableConflictError,
  sortTimesAscending,
} from '@/lib/kani-booking-slots';
import { PAYWAY_MESSAGES } from '@/lib/kani-payway';

describe('kani-booking-slots — Agrupación Mañana/Tarde, orden y alternativas', () => {
  it('clasifica horarios < 14:00 en Mañana y >= 14:00 en Tarde', () => {
    expect(getTimePeriod('09:30')).toBe('morning');
    expect(getTimePeriod('13:45')).toBe('morning');
    expect(getTimePeriod('14:00')).toBe('afternoon');
    expect(getTimePeriod('19:30')).toBe('afternoon');
  });

  it('ordena horarios cronológicamente en orden ascendente incluso si llegan desordenados', () => {
    expect(sortTimesAscending(['19:00', '10:00', '14:00', '10:45', '10:00', 'bad'])).toEqual([
      '10:00',
      '10:45',
      '14:00',
      '19:00',
    ]);
  });

  it('agrupa slots por franja y oculta secciones vacías', () => {
    const onlyMorning = groupSlotsByPeriod(
      buildSlotItemsForDate(['12:15', '10:00', '11:30']),
    );
    expect(onlyMorning.map(g => g.label)).toEqual(['Mañana']);
    expect(onlyMorning[0]?.slots.map(s => s.time)).toEqual(['10:00', '11:30', '12:15']);

    const onlyAfternoon = groupSlotsByPeriod(
      buildSlotItemsForDate(['19:00', '16:00', '14:00']),
    );
    expect(onlyAfternoon.map(g => g.label)).toEqual(['Tarde']);
    expect(onlyAfternoon[0]?.slots.map(s => s.time)).toEqual(['14:00', '16:00', '19:00']);

    const both = groupSlotsByPeriod(
      buildSlotItemsForDate(['16:45', '13:45', '14:00', '10:00']),
    );
    expect(both.map(g => g.label)).toEqual(['Mañana', 'Tarde']);
    expect(both[0]?.slots.map(s => s.time)).toEqual(['10:00', '13:45']);
    expect(both[1]?.slots.map(s => s.time)).toEqual(['14:00', '16:45']);
  });

  it('combina slots disponibles y ocupados sin duplicar y respeta disponibilidad fresca si se libera', () => {
    const merged = buildSlotItemsForDate(['10:45', '14:00'], ['10:00', '14:00']);
    expect(merged).toEqual([
      { time: '10:00', status: 'UNAVAILABLE' },
      { time: '10:45', status: 'AVAILABLE' },
      { time: '14:00', status: 'AVAILABLE' },
    ]);
  });

  it('selecciona hasta 3 alternativas disponibles más cercanas al horario solicitado y en orden cronológico', () => {
    const available = ['10:00', '10:45', '11:15', '11:45', '16:00', '18:30'];
    expect(
      findClosestAlternativeTimes({
        requestedTime: '11:00',
        availableTimes: available,
        maxCount: 3,
      }),
    ).toEqual(['10:45', '11:15', '11:45']);

    expect(
      findClosestAlternativeTimes({
        requestedTime: '17:00',
        availableTimes: ['11:00', '15:00'],
        maxCount: 3,
      }),
    ).toEqual(['11:00', '15:00']);

    expect(
      findClosestAlternativeTimes({
        requestedTime: '11:00',
        availableTimes: ['11:00'],
        maxCount: 3,
      }),
    ).toEqual([]);
  });

  it('distingue conflictos reales de disponibilidad de errores de pago, red o códigos de beneficio', () => {
    expect(
      isAvailabilityConflictError(
        new SlotUnavailableConflictError('Ese horario ya no está disponible.'),
      ),
    ).toBe(true);
    expect(isAvailabilityConflictError(new Error('SLOT_UNAVAILABLE'))).toBe(true);
    expect(isAvailabilityConflictError({ code: 'P0001', message: 'SLOT_ALREADY_BOOKED' })).toBe(true);
    expect(
      isAvailabilityConflictError(
        'El horario seleccionado ya no se encuentra disponible. Por favor seleccioná otro horario.',
      ),
    ).toBe(true);

    // Non-conflict errors must NEVER trigger slot recovery UI
    expect(isAvailabilityConflictError(PAYWAY_MESSAGES.unavailable)).toBe(false);
    expect(isAvailabilityConflictError(PAYWAY_MESSAGES.rejected)).toBe(false);
    expect(isAvailabilityConflictError(PAYWAY_MESSAGES.late_review)).toBe(false);
    expect(isAvailabilityConflictError('ORDER_CREATION_FAILED')).toBe(false);
    expect(isAvailabilityConflictError('BENEFIT_CODE_ALREADY_CONSUMED')).toBe(false);
    expect(isAvailabilityConflictError(new Error('PAYMENT_REVIEW_REQUIRED'))).toBe(false);
    expect(isAvailabilityConflictError({ code: '42703', message: 'column does not exist' })).toBe(
      false,
    );
  });
});
