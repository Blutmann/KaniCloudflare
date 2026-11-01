import { createHmac, timingSafeEqual } from 'node:crypto';
import { KANI_STUDIO_FULL_ADDRESS } from './kani-constants';
import { getRuntimeEnv } from './kani-mercadopago.server';

export type TurnoIcsData = {
  id: string;
  bookingDate: string; // YYYY-MM-DD
  startTime: string; // HH:mm or HH:mm:ss
  endTime?: string | null;
  serviceDurationMinutes?: number | null;
  serviceName: string;
  barberName: string;
};

export function getCalendarIcsSecret(): string {
  return (
    getRuntimeEnv('KANI_ICS_SECRET') ||
    getRuntimeEnv('SUPABASE_SERVICE_ROLE_KEY') ||
    getRuntimeEnv('JWT_SECRET') ||
    'kani-calendar-ics-signing-key-2026'
  );
}

export function computeTurnoIcsSignature(data: {
  id: string;
  bookingDate: string;
  startTime: string;
  durationMinutes: number;
  serviceName: string;
  barberName: string;
}): string {
  const secret = getCalendarIcsSecret();
  const cleanTime = (data.startTime || '').trim().slice(0, 5);
  const cleanDate = (data.bookingDate || '').trim();
  const cleanId = (data.id || '').trim();
  const cleanService = (data.serviceName || '').trim();
  const cleanBarber = (data.barberName || '').trim();
  const raw = `${cleanId}|${cleanDate}|${cleanTime}|${data.durationMinutes}|${cleanService}|${cleanBarber}`;
  return createHmac('sha256', secret).update(raw).digest('hex').slice(0, 32);
}

export function verifyTurnoIcsSignature(
  params: {
    id: string;
    bookingDate: string;
    startTime: string;
    durationMinutes: number;
    serviceName: string;
    barberName: string;
  },
  providedSig: string
): boolean {
  if (!providedSig || typeof providedSig !== 'string') return false;
  const expected = computeTurnoIcsSignature(params);
  if (providedSig.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(providedSig), Buffer.from(expected));
  } catch {
    return false;
  }
}

export function buildTurnoIcsUrl(data: TurnoIcsData, baseUrl?: string): string {
  const appUrl = (
    baseUrl ||
    getRuntimeEnv('KANI_APP_URL') ||
    getRuntimeEnv('APP_URL') ||
    'https://kanibarberstudio-cloudflare.kanibarber.workers.dev'
  ).replace(/\/$/, '');

  const cleanTime = (data.startTime || '').trim().slice(0, 5);
  const duration = data.serviceDurationMinutes || 45;

  const sig = computeTurnoIcsSignature({
    id: data.id,
    bookingDate: data.bookingDate,
    startTime: cleanTime,
    durationMinutes: duration,
    serviceName: data.serviceName,
    barberName: data.barberName,
  });

  const query = new URLSearchParams({
    id: data.id,
    d: data.bookingDate,
    t: cleanTime,
    m: String(duration),
    s: data.serviceName,
    b: data.barberName,
    sig,
  });

  return `${appUrl}/api/calendar/turno.ics?${query.toString()}`;
}

export function generateTurnoIcsContent(data: {
  id: string;
  bookingDate: string;
  startTime: string;
  durationMinutes: number;
  serviceName: string;
  barberName: string;
}): string {
  const [year, month, day] = (data.bookingDate || '').split('-').map((v) => parseInt(v, 10));
  const [startHour, startMin] = (data.startTime || '').slice(0, 5).split(':').map((v) => parseInt(v, 10));

  const safeYear = year || 2026;
  const safeMonth = month || 11;
  const safeDay = day || 1;
  const safeStartHour = isNaN(startHour) ? 10 : startHour;
  const safeStartMin = isNaN(startMin) ? 0 : startMin;
  const duration = data.durationMinutes || 45;

  const startDate = new Date(Date.UTC(safeYear, safeMonth - 1, safeDay, safeStartHour, safeStartMin, 0));
  const endDate = new Date(startDate.getTime() + duration * 60 * 1000);

  const pad = (n: number) => String(n).padStart(2, '0');
  const formatLocal = (d: Date) =>
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}00`;

  const dtstart = formatLocal(startDate);
  const dtend = formatLocal(endDate);
  const dtstamp = new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';

  const safeId = (data.id || 'turno').replace(/[^a-zA-Z0-9_-]/g, '');
  const summary = `${data.serviceName} — Kani Barber Studio`;
  const description = `Turno con ${data.barberName} para ${data.serviceName} en Kani Barber Studio.\\nDirección: San Isidro Labrador 7, Martínez.\\nContacto: kanibarberstudio@gmail.com`;
  const location = KANI_STUDIO_FULL_ADDRESS;

  // RFC 5545 format with CRLF line endings
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Kani Barber Studio//Turno//ES',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VTIMEZONE',
    'TZID:America/Argentina/Buenos_Aires',
    'X-LIC-LOCATION:America/Argentina/Buenos_Aires',
    'BEGIN:STANDARD',
    'TZOFFSETFROM:-0300',
    'TZOFFSETTO:-0300',
    'TZNAME:-03',
    'DTSTART:19700101T000000',
    'END:STANDARD',
    'END:VTIMEZONE',
    'BEGIN:VEVENT',
    `UID:kani-turno-${safeId}@kanibarber.com`,
    `DTSTAMP:${dtstamp}`,
    `DTSTART;TZID=America/Argentina/Buenos_Aires:${dtstart}`,
    `DTEND;TZID=America/Argentina/Buenos_Aires:${dtend}`,
    `SUMMARY:${summary}`,
    `DESCRIPTION:${description}`,
    `LOCATION:${location}`,
    'STATUS:CONFIRMED',
    'END:VEVENT',
    'END:VCALENDAR',
  ];

  return lines.join('\r\n') + '\r\n';
}

export function handleTurnoIcsRequest(request: Request): Response {
  try {
    const url = new URL(request.url);
    const id = url.searchParams.get('id') || '';
    const d = url.searchParams.get('d') || '';
    const t = url.searchParams.get('t') || '';
    const m = parseInt(url.searchParams.get('m') || '45', 10);
    const s = url.searchParams.get('s') || '';
    const b = url.searchParams.get('b') || '';
    const sig = url.searchParams.get('sig') || '';

    if (!id || !d || !t || !s || !b || !sig) {
      return new Response('Parámetros de turno incompletos.', {
        status: 400,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      });
    }

    const isValid = verifyTurnoIcsSignature(
      {
        id,
        bookingDate: d,
        startTime: t,
        durationMinutes: isNaN(m) ? 45 : m,
        serviceName: s,
        barberName: b,
      },
      sig
    );

    if (!isValid) {
      return new Response('Enlace de calendario no válido o alterado.', {
        status: 403,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      });
    }

    const icsContent = generateTurnoIcsContent({
      id,
      bookingDate: d,
      startTime: t,
      durationMinutes: isNaN(m) ? 45 : m,
      serviceName: s,
      barberName: b,
    });

    return new Response(icsContent, {
      status: 200,
      headers: {
        'Content-Type': 'text/calendar; charset=utf-8',
        'Content-Disposition': 'attachment; filename="turno-kani.ics"',
        'Cache-Control': 'public, max-age=86400',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (err: any) {
    return new Response(`Error generando archivo de calendario: ${err.message}`, {
      status: 500,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
}
