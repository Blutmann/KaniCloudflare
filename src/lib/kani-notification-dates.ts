const zone = 'America/Argentina/Buenos_Aires';
const calendar = new Intl.DateTimeFormat('en-US', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' });
const generated = new Intl.DateTimeFormat('es-AR', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

export function notificationToday(now = new Date()): string {
  const parts = calendar.formatToParts(now);
  const value = (key: string) => parts.find(p => p.type === key)!.value;
  return `${value('year')}-${value('month')}-${value('day')}`;
}

/** Advance the calendar date, rather than adding a duration to the current instant. */
function nextCalendarDate(today: string): string {
  const [year, month, day] = today.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
}

export function notificationPhrase(kind: 'APPOINTMENT_CONFIRMED' | 'APPOINTMENT_CANCELLED', client: string, appointmentDate: string, today: string): string {
  const name = client.trim() || 'Cliente';
  const relative = appointmentDate === today ? 'hoy' : appointmentDate === nextCalendarDate(today) ? 'mañana' : null;
  const date = `${appointmentDate.slice(8, 10)}/${appointmentDate.slice(5, 7)}`;
  if (kind === 'APPOINTMENT_CANCELLED') return `${name} canceló el turno ${relative ? `para ${relative}` : `del ${date}`}`;
  return `${name} reservó turno para ${relative || `el ${date}`}`;
}

export function notificationGeneratedAt(createdAt: string): string {
  return generated.format(new Date(createdAt));
}
