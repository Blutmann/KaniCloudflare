import { describe, expect, it } from 'vitest';
import { availableSlots, bookingStartTimes, initialAvailability, initialAppointments, serviceFor, demoToday, parseDate, isoDate, type Appointment } from './kani-model';
const weekdayDate = parseDate(demoToday).getDay() === 0 ? isoDate(new Date(parseDate(demoToday).getTime() + 24 * 60 * 60 * 1000)) : demoToday;
describe('KANI mock availability', () => {
 it('uses the official service durations', () => {
  expect(serviceFor('corte').duration).toBe(45);
  expect(serviceFor('corte-barba').duration).toBe(60);
  expect(serviceFor('barba').duration).toBe(30);
 });
 it('respects closing time for all service lengths', () => {
  const hours = initialAvailability();
  expect(availableSlots('corte', 'Gonzalo', weekdayDate, [], hours).at(-1)).toBe('19:00');
  expect(availableSlots('corte-barba', 'Gonzalo', weekdayDate, [], hours).at(-1)).toBe('19:00');
  expect(availableSlots('barba', 'Gonzalo', weekdayDate, [], hours).at(-1)).toBe('19:00');
 });
 it('uses the thirteen fixed commercial starts for every service', () => {
  for (const service of ['corte', 'corte-barba', 'barba'] as const) {
   expect(availableSlots(service, 'Gonzalo', weekdayDate, [], initialAvailability())).toEqual(bookingStartTimes);
  }
 });
 it('rounds modified opening hours up to the next exact hour', () => {
  const hours = initialAvailability();
  const currentDay = hours.Gonzalo[parseDate(weekdayDate).getDay()];
  if (currentDay) currentDay.start = '10:30';
  expect(availableSlots('barba', 'Gonzalo', weekdayDate, [], hours)[0]).toBe('10:45');
 });
 it('blocks pending and confirmed overlapping intervals, but cancellation releases them', () => {
  const first = initialAppointments[0];
  if (!first) throw new Error('Missing sample');
  const a: Appointment = { ...first, date: weekdayDate, status: 'Pendiente' };
  const hours = initialAvailability();
  expect(availableSlots('corte', 'Gonzalo', a.date, [a], hours)).not.toContain('19:00');
  expect(availableSlots('barba', 'Gonzalo', a.date, [a], hours)).not.toContain('19:00');
  expect(availableSlots('barba', 'Gonzalo', a.date, [{ ...a, status: 'Cancelado' }], hours)).toContain('19:00');
  expect(availableSlots('barba', 'Valentín', a.date, [a], hours)).toContain('19:00');
 });
 it('excludes Sundays, past dates and closed days', () => {
  const hours = initialAvailability();
  expect(availableSlots('corte', 'Lautaro', '2099-10-11', [], hours)).toEqual([]);
  const yesterday = isoDate(new Date(parseDate(demoToday).getTime() - 24 * 60 * 60 * 1000));
  expect(availableSlots('corte', 'Lautaro', yesterday, [], hours)).toEqual([]);
  const currentDay = hours.Lautaro[parseDate(demoToday).getDay()];
  if (currentDay) currentDay.enabled = false;
  expect(availableSlots('corte', 'Lautaro', demoToday, [], hours)).toEqual([]);
 });
});
