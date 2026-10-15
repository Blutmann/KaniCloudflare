export const services = [
  { id: 'corte', name: 'Corte', price: 25000, duration: 45, description: 'Tu estilo, con precisión.', number: '01' },
  { id: 'corte-barba', name: 'Corte + barba', price: 30000, duration: 45, description: 'Una experiencia completa.', number: '02' },
  { id: 'barba', name: 'Barba', price: 10000, duration: 30, description: 'Los detalles hacen la diferencia.', number: '03' },
] as const;
export const barbers = ['Lautaro', 'Gonzalo', 'Valentín'] as const;
export type Barber = typeof barbers[number];
export type ServiceId = typeof services[number]['id'];
export type Status = 'Pendiente' | 'Confirmado' | 'Cancelado' | 'Completado';
export type Appointment = { id: string; requestNumber?: number; service: ServiceId; barber: Barber; date: string; time: string; name: string; email: string; phone: string; notes?: string; status: Status };
export type DayHours = { enabled: boolean; start: string; end: string };
export type Availability = Record<Barber, DayHours[]>;
export type SlotOverride = { available: boolean; note: string };
export type SlotOverrides = Record<string, SlotOverride>;
export const money = (value: number) => '$' + value.toLocaleString('es-AR');
export const serviceFor = (id: ServiceId) => services.find(s => s.id === id) ?? services[0];
export const minutes = (time: string) => { const [h = 0, m = 0] = time.split(':').map(Number); return h * 60 + m; };
export const timeFor = (value: number) => `${Math.floor(value / 60).toString().padStart(2, '0')}:${(value % 60).toString().padStart(2, '0')}`;
export const bookingStartTimes = Array.from({ length: 13 }, (_, index) => timeFor(10 * 60 + index * 45)) as string[];
export const parseDate = (date: string) => new Date(date + 'T12:00:00');
export const dateLabel = (date: string) => parseDate(date).toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' });
export const isoDate = (date: Date) => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
export const demoToday = isoDate(new Date());
export const bookingEndDateFor = (today: string) => isoDate(new Date(parseDate(today).getTime() + 21 * 24 * 60 * 60 * 1000));
export const bookingEndDate = bookingEndDateFor(demoToday);
export const isBookingDate = (date: string, today = demoToday, endDate = bookingEndDate) => date >= today && date <= endDate && parseDate(date).getDay() !== 0;
export const slotKey = (barber: Barber, date: string, time: string) => `${barber}|${date}|${time}`;
export function initialAvailability(): Availability {
  return Object.fromEntries(barbers.map(b => [b, Array.from({ length: 7 }, (_, day) => ({ enabled: day !== 0, start: '10:00', end: '20:00' }))])) as Availability;
}
export function initialSlotOverrides(): SlotOverrides {
  return {
    [slotKey('Lautaro', demoToday, '16:00')]: { available: false, note: 'Almuerzo' },
    [slotKey('Gonzalo', '2026-10-07', '11:00')]: { available: false, note: 'Motivo personal' },
  };
}
export const initialAppointments: Appointment[] = [
  { id: 'K-1001', service: 'corte', barber: 'Gonzalo', date: demoToday, time: '19:00', name: 'Tomás Blutmann', email: 'tomas@example.com', phone: '11 5555 0101', status: 'Confirmado' },
  { id: 'K-1002', service: 'corte-barba', barber: 'Lautaro', date: demoToday, time: '18:00', name: 'Martín González', email: 'martin@example.com', phone: '11 5555 0102', status: 'Pendiente' },
  { id: 'K-1003', service: 'barba', barber: 'Valentín', date: demoToday, time: '19:00', name: 'Nicolás Rodríguez', email: 'nicolas@example.com', phone: '11 5555 0103', status: 'Confirmado' },
  { id: 'K-1004', service: 'corte', barber: 'Lautaro', date: '2026-10-07', time: '11:00', name: 'Lucas Fernández', email: 'lucas@example.com', phone: '11 5555 0104', status: 'Confirmado' },
  { id: 'K-1005', service: 'corte', barber: 'Gonzalo', date: '2026-10-07', time: '15:00', name: 'Santiago Pérez', email: 'santiago@example.com', phone: '11 5555 0105', status: 'Pendiente' },
];
export function availableSlots(service: ServiceId, barber: Barber, date: string, appointments: Appointment[], availability: Availability, overrides: SlotOverrides = {}) {
  const hours = availability[barber][parseDate(date).getDay()];
  if (!hours || !hours.enabled || date < demoToday) return [];
  const duration = serviceFor(service).duration;
  return bookingStartTimes.filter(startTime => {
    const start = minutes(startTime);
    if (start < minutes(hours.start) || start + duration > Math.min(1200, minutes(hours.end))) return false;
    if (overrides[slotKey(barber, date, startTime)]?.available === false) return false;
    return !appointments.some(a => a.barber === barber && a.date === date && a.status !== 'Cancelado' && start < minutes(a.time) + serviceFor(a.service).duration && start + duration > minutes(a.time));
  });
}
