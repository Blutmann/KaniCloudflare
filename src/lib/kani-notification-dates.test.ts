import {describe,expect,it} from 'vitest';
import {notificationGeneratedAt,notificationPhrase,notificationToday} from './kani-notification-dates';
describe('Buenos Aires notification calendar',()=>{
 it.each([
  ['2026-11-09T00:00:00Z','2026-11-08'],['2026-11-09T02:59:59.999Z','2026-11-08'],
  ['2026-11-09T03:00:00Z','2026-11-09'],['2027-01-01T02:59:59Z','2026-12-31'],
 ])('uses BA day at %s',(instant,day)=>expect(notificationToday(new Date(instant))).toBe(day));
 it.each([
  ['APPOINTMENT_CONFIRMED','2026-11-09','Flavio reservó turno para hoy'],
  ['APPOINTMENT_CONFIRMED','2026-11-10','Flavio reservó turno para mañana'],
  ['APPOINTMENT_CONFIRMED','2026-11-13','Flavio reservó turno para el 13/11'],
  ['APPOINTMENT_CONFIRMED','2020-01-02','Flavio reservó turno para el 02/01'],
  ['APPOINTMENT_CANCELLED','2026-11-09','Flavio canceló el turno para hoy'],
  ['APPOINTMENT_CANCELLED','2026-11-10','Flavio canceló el turno para mañana'],
  ['APPOINTMENT_CANCELLED','2026-11-13','Flavio canceló el turno del 13/11'],
  ['APPOINTMENT_CANCELLED','2020-01-02','Flavio canceló el turno del 02/01'],
 ] as const)('formats %s on %s',(kind,date,text)=>expect(notificationPhrase(kind,'Flavio',date,'2026-11-09')).toBe(text));
 it.each([['2026-12-31','2027-01-01'],['2028-02-28','2028-02-29'],['2026-02-28','2026-03-01']])('adds a calendar day across %s',(today,tomorrow)=>{
  expect(notificationPhrase('APPOINTMENT_CONFIRMED','Cliente',tomorrow,today)).toBe('Cliente reservó turno para mañana');
 });
 it('formats the recorded generation instant independently from the appointment date',()=>{
  expect(notificationGeneratedAt('2026-11-09T01:15:00Z')).toContain('08/11/2026');
  expect(notificationGeneratedAt('2026-11-09T01:15:00Z')).toContain('22:15');
 });
});
