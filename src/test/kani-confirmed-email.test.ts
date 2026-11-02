import { describe, it, expect } from 'vitest';
import {
  buildConfirmedEmail,
  formatSpanishDateNatural,
  formatSpanishDateCompact,
} from '../lib/kani-notifications.functions';
import {
  buildTurnoIcsUrl,
  generateTurnoIcsContent,
  handleTurnoIcsRequest,
  verifyTurnoIcsSignature,
} from '../lib/kani-calendar-ics';
import { KANI_MAPS_URL, KANI_PUBLIC_WHATSAPP_URL, KANI_STUDIO_FULL_ADDRESS } from '../lib/kani-constants';

describe('Email transaccional de confirmación de turno (Kani Barber Studio) — Nuevo Diseño Aprobado', () => {
  const basePayload = {
    notificationId: 'notif-123',
    notificationType: 'CONFIRMED' as const,
    recipientEmail: 'cliente@ejemplo.com',
    clientName: 'Tomas Harispe',
    barberName: 'Lautaro',
    serviceName: 'Corte',
    bookingDate: '2026-10-22',
    startTime: '16:45:00',
    endTime: '17:30:00',
    clientNotes: null,
    servicePriceArs: 25000,
    serviceDurationMinutes: 45,
    downPaymentArs: 5000,
    transferAlias: null,
    transferCuit: null,
    transferHolderName: null,
  };

  it('1. Asunto y preencabezado: Asunto personalizado y preencabezado con detalles clave', () => {
    const email = buildConfirmedEmail(basePayload);
    expect(email.subject).toBe('Tomas Harispe, tu turno en Kani está confirmado');

    const emailWithoutName = buildConfirmedEmail({
      ...basePayload,
      clientName: '',
    });
    expect(emailWithoutName.subject).toBe('Tu turno en Kani está confirmado');

    // Preencabezado en HTML con fecha compacta
    expect(email.html).toContain('Jueves 22 de octubre a las 16:45 hs · Corte con Lautaro');
  });

  it('2. Fecha natural en español: Formato natural y formato compacto sin año', () => {
    expect(formatSpanishDateNatural('2026-10-22')).toBe('jueves 22 de octubre de 2026');
    expect(formatSpanishDateNatural('2026-10-21')).toBe('miércoles 21 de octubre de 2026');
    expect(formatSpanishDateNatural('2026-10-24')).toBe('sábado 24 de octubre de 2026');

    // Formato compacto sin año, día de semana en mayúscula inicial y mes en minúscula
    expect(formatSpanishDateCompact('2026-11-02')).toBe('Lunes 2 de noviembre');
    expect(formatSpanishDateCompact('2026-10-22')).toBe('Jueves 22 de octubre');
  });

  it('3. Contenido principal dinámico con servicio, barbero, fecha compacta en tarjeta y completa en texto', () => {
    const email = buildConfirmedEmail(basePayload);
    const expectedSentence =
      'Se confirmó tu turno el día jueves 22 de octubre de 2026 a las 16:45 hs, para un servicio de Corte con Lautaro.';
    expect(email.text).toContain(expectedSentence);
    expect(email.html).toContain('Jueves 22 de octubre');
    expect(email.html).not.toContain('Jueves 22 de octubre de 2026'); // Año no visible en encabezado
    expect(email.html).toContain('16:45 hs');
    expect(email.html).toContain('Corte');
    expect(email.html).toContain('Lautaro');
    expect(email.html).toContain('Tomas Harispe');
  });

  it('4. Resumen financiero: Importe, Seña abonada y Saldo en el local', () => {
    const email = buildConfirmedEmail(basePayload);

    // Importes formateados
    expect(email.text).toContain('Importe: $25.000');
    expect(email.text).toContain('Seña abonada: $5.000');
    expect(email.text).toContain('Saldo a pagar en el local: $20.000');

    expect(email.html).toContain('$25.000');
    expect(email.html).toContain('−$5.000');
    expect(email.html).toContain('$20.000');

    // Validación matemática: Importe = Seña + Saldo
    const servicePrice = basePayload.servicePriceArs;
    const downPayment = basePayload.downPaymentArs;
    const remaining = servicePrice - downPayment;
    expect(servicePrice).toBe(downPayment + remaining);
    expect(remaining).toBe(20000);
  });

  it('5. Cálculo dinámico con otro servicio (Corte y barba $30.000 con seña unificada $5.000, normalizando valores antiguos)', () => {
    const customPayload = {
      ...basePayload,
      serviceName: 'Corte y barba',
      barberName: 'Gonzalo',
      bookingDate: '2026-10-24',
      startTime: '11:00:00',
      servicePriceArs: 30000,
      downPaymentArs: 10000, // Simula valor antiguo de la base, normalizado a 5.000
    };

    const email = buildConfirmedEmail(customPayload);
    expect(email.text).toContain('Importe: $30.000');
    expect(email.text).toContain('Seña abonada: $5.000');
    expect(email.text).not.toContain('Seña abonada: $10.000');
    expect(email.text).not.toContain('$10.000');
    expect(email.text).toContain('Saldo a pagar en el local: $25.000');
    expect(email.text).toContain(
      'Se confirmó tu turno el día sábado 24 de octubre de 2026 a las 11:00 hs, para un servicio de Corte y barba con Gonzalo.'
    );
  });

  it('6. Medio de pago del saldo: aclaración exclusiva Efectivo o Transferencia', () => {
    const email = buildConfirmedEmail(basePayload);
    const expectedClarification = 'Podés abonar el saldo en efectivo o por transferencia.';
    expect(email.text).toContain(expectedClarification);
    expect(email.html).toContain(expectedClarification);

    // No debe mencionar métodos no permitidos para el saldo
    expect(email.text.toLowerCase()).not.toContain('tarjeta');
    expect(email.text.toLowerCase()).not.toContain('mercado pago');
    expect(email.text.toLowerCase()).not.toContain('débito');
    expect(email.text.toLowerCase()).not.toContain('crédito');
  });

  it('7. Ubicación: Dirección exacta y enlace oficial a Google Maps', () => {
    const email = buildConfirmedEmail(basePayload);
    const mapsExactUrl = KANI_MAPS_URL;

    expect(email.text).toContain('San Isidro Labrador 7');
    expect(email.text).toContain('Martínez, Buenos Aires');
    expect(email.text).toContain(mapsExactUrl);

    expect(email.html).toContain('CÓMO LLEGAR');
    expect(email.html).toContain('San Isidro Labrador 7');
    expect(email.html).toContain('Martínez, Buenos Aires');
    expect(email.html).toContain(mapsExactUrl);
    expect(email.html).toContain('Ver en Google Maps');
  });

  it('8. WhatsApp y Redes: Enlaces oficiales con número verificado e Instagram', () => {
    const email = buildConfirmedEmail(basePayload);
    const waExactUrl = KANI_PUBLIC_WHATSAPP_URL;

    expect(email.text).toContain('Contactar por WhatsApp');
    expect(email.text).toContain(waExactUrl);

    expect(email.html).toContain('Contactar por WhatsApp');
    expect(email.html).toContain(waExactUrl);
    expect(email.html).toContain('https://www.instagram.com/kanibarberstudio/');
  });

  it('9. Integración de descarga iCalendar .ics y Botón de acción', () => {
    const email = buildConfirmedEmail(basePayload);
    const icsUrl = buildTurnoIcsUrl({
      id: basePayload.notificationId,
      bookingDate: basePayload.bookingDate,
      startTime: basePayload.startTime,
      endTime: basePayload.endTime,
      serviceDurationMinutes: basePayload.serviceDurationMinutes,
      serviceName: basePayload.serviceName,
      barberName: basePayload.barberName,
    });

    expect(icsUrl).toContain('/api/calendar/turno.ics?');
    expect(icsUrl).toContain('id=notif-123');
    expect(icsUrl).toContain('d=2026-10-22');
    expect(icsUrl).toContain('t=16%3A45');
    expect(icsUrl).toContain('m=45');
    expect(icsUrl).toContain('sig=');
    expect(email.html).toContain('Agregar a mi calendario');
    expect(email.html).toContain(icsUrl);
  });

  it('10. Estética Kani, composición oscura y tipografía 22px/28px', () => {
    const email = buildConfirmedEmail(basePayload);

    // Contenedor del encabezado del logo con fondo negro para máximo contraste
    expect(email.html).toContain('bgcolor="#000000"');
    expect(email.html).toContain('kani-email-logo.png');

    // Paleta oscura oficial
    expect(email.html).toContain('#121212'); // Fondo exterior
    expect(email.html).toContain('#000000'); // Contenedor principal
    expect(email.html).toContain('#1C1C1C'); // Tarjetas oscuras
    expect(email.html).toContain('#F5F5F5'); // Texto principal blanco cálido
    expect(email.html).toContain('#C7C7C7'); // Texto secundario gris claro
    expect(email.html).toContain('#C9A24D'); // Dorado acentos y botón calendario
    expect(email.html).toContain('#383838'); // Bordes y divisores
    expect(email.html).toContain('#128C4A'); // Verde WhatsApp

    // Botones con estilos exactos
    expect(email.html).toContain('background-color: #C9A24D'); // Botón sólido calendario
    expect(email.html).toContain('color: #000000'); // Texto botón calendario
    expect(email.html).toContain('background-color: #128C4A'); // Botón WhatsApp
    expect(email.html).toContain('border: 1.5px solid #C9A24D'); // Botón Google Maps

    // Sección puntualidad
    expect(email.html).toContain('PUNTUALIDAD');
    expect(email.html).toContain('tolerancia de 15 minutos');
    expect(email.text).toContain('PUNTUALIDAD');
    expect(email.text).toContain('tolerancia de 15 minutos');

    // Tipografía compacta 22px con interlineado 28px y serif
    expect(email.html).toContain('font-size: 22px; line-height: 28px;');

    // Compatibilidad estricta
    expect(email.html).not.toContain('<script');
    expect(email.html).not.toContain('<iframe');
    expect(email.html).toContain('table role="presentation"');
  });

  it('11. Generación de contenido RFC 5545 para archivo .ics con zona horaria Buenos Aires', () => {
    const icsContent = generateTurnoIcsContent({
      id: 'notif-test-456',
      bookingDate: '2026-11-02',
      startTime: '15:30',
      durationMinutes: 45,
      serviceName: 'Corte',
      barberName: 'Franco',
    });

    expect(icsContent).toContain('BEGIN:VCALENDAR');
    expect(icsContent).toContain('PRODID:-//Kani Barber Studio//Turno//ES');
    expect(icsContent).toContain('TZID:America/Argentina/Buenos_Aires');
    expect(icsContent).toContain('SUMMARY:Corte — Kani Barber Studio');
    expect(icsContent).toContain('DTSTART;TZID=America/Argentina/Buenos_Aires:20261102T153000');
    expect(icsContent).toContain('DTEND;TZID=America/Argentina/Buenos_Aires:20261102T161500');
    expect(icsContent).toContain('UID:kani-turno-notif-test-456@kanibarber.com');
    expect(icsContent).toContain('LOCATION:San Isidro Labrador 7, Martínez, Provincia de Buenos Aires');
    expect(icsContent).toContain('STATUS:CONFIRMED');
    expect(icsContent).toContain('END:VCALENDAR');
    expect(icsContent).toContain('\r\n');
  });

  it('12. Endpoint /api/calendar/turno.ics: validación de firma y prevención de manipulación', async () => {
    const validUrl = buildTurnoIcsUrl({
      id: 'notif-sec-789',
      bookingDate: '2026-11-02',
      startTime: '10:00',
      durationMinutes: 45,
      serviceName: 'Corte y barba',
      barberName: 'Gonzalo',
    });

    // Petición válida
    const reqValid = new Request(validUrl);
    const resValid = await handleTurnoIcsRequest(reqValid);
    expect(resValid.status).toBe(200);
    expect(resValid.headers.get('Content-Type')).toContain('text/calendar');
    expect(resValid.headers.get('Content-Disposition')).toContain('attachment; filename="turno-kani.ics"');
    const bodyText = await resValid.text();
    expect(bodyText).toContain('BEGIN:VCALENDAR');
    expect(bodyText).toContain('Gonzalo');

    // Manipulación de id sin firma válida -> 403 Forbidden
    const tamperedUrl = validUrl.replace('id=notif-sec-789', 'id=notif-sec-hacked');
    const resTampered = await handleTurnoIcsRequest(new Request(tamperedUrl));
    expect(resTampered.status).toBe(403);
  });
});
