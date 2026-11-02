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
import { verifyCancellationSignature } from '../lib/kani-cancellation-token';
import { KANI_MAPS_URL, KANI_PUBLIC_WHATSAPP_URL, KANI_STUDIO_FULL_ADDRESS } from '../lib/kani-constants';

describe('Email transaccional de confirmación de turno (Kani Barber Studio) — Ajustes Oficiales Kani', () => {
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

  it('1. Asunto y preencabezado: Asunto oficial [KANI] {nombre}, tu turno está confirmado', () => {
    const email = buildConfirmedEmail(basePayload);
    expect(email.subject).toBe('[KANI] Tomas Harispe, tu turno está confirmado');

    const emailWithoutName = buildConfirmedEmail({
      ...basePayload,
      clientName: '',
    });
    expect(emailWithoutName.subject).toBe('[KANI] Tu turno está confirmado');

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

  it('4. Resumen financiero: Importe, Seña abonada en bordó accesible y Saldo en el local', () => {
    const email = buildConfirmedEmail(basePayload);

    // Importes formateados
    expect(email.text).toContain('Importe: $25.000');
    expect(email.text).toContain('Seña abonada: $5.000');
    expect(email.text).toContain('Saldo a pagar en el local: $20.000');

    expect(email.html).toContain('$25.000');
    expect(email.html).toContain('−$5.000');
    expect(email.html).toContain('$20.000');
    // Variante accesible de bordó institucional sobre negro puro
    expect(email.html).toContain('#E06D80');

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

  it('7. Ubicación: Dirección exacta y botón sólido dorado oficial a Google Maps', () => {
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
    // Fondo sólido dorado oficial (#B99A5B) y texto negro (#000000)
    expect(email.html).toContain('background-color: #B99A5B');
    expect(email.html).toContain('color: #000000');
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

  it('9. Acciones del turno: Agregar al calendario y Cancelar turno con enlace único', () => {
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

    // Botón Agregar al calendario
    expect(email.html).toContain('Agregar al calendario');
    expect(email.html).not.toContain('Agregar a mi calendario');
    expect(email.html).toContain('background-color: #B99A5B'); // Dorado oficial

    // Botón Cancelar turno
    expect(email.html).toContain('Cancelar turno');
    expect(email.html).toContain('background-color: #762936'); // Bordó oficial
    expect(email.html).toContain('/cancelar-turno?id=notif-123&token=');

    // En texto plano
    expect(email.text).toContain('Agregar al calendario:');
    expect(email.text).toContain('Cancelar turno:');
    expect(email.text).toContain('/cancelar-turno?id=notif-123&token=');

    // El token generado en el correo es criptográficamente verificable
    const tokenMatch = email.text.match(/token=([0-9a-f]{64})/);
    expect(tokenMatch).not.toBeNull();
    const token = tokenMatch![1];
    expect(verifyCancellationSignature('notif-123', token)).toBe(true);
  });

  it('10. Estética Kani, composición completamente oscura (#000000), kanji bordó y colores oficiales', () => {
    const email = buildConfirmedEmail(basePayload);

    // Fondo completamente negro (#000000) para exterior, contenedor y tarjetas
    expect(email.html).toContain('background-color: #000000');
    expect(email.html).not.toContain('background-color: #121212'); // Fondo exterior anterior reemplazado
    expect(email.html).not.toContain('background-color: #1C1C1C'); // Fondo de tarjetas anterior reemplazado

    // Kanji decorativo 蟹 en bordó oficial (#762936)
    expect(email.html).toContain('color: rgba(118, 41, 54, 0.45)');

    // Títulos de sección en gris claro legible
    expect(email.html).toContain('color: #D4D4D4; letter-spacing: 0.12em; text-transform: uppercase;');

    // Paleta oficial
    expect(email.html).toContain('#F5F5F5'); // Texto principal blanco cálido
    expect(email.html).toContain('#C7C7C7'); // Texto secundario gris claro
    expect(email.html).toContain('#B99A5B'); // Dorado oficial Kani
    expect(email.html).toContain('#762936'); // Bordó oficial Kani
    expect(email.html).toContain('#383838'); // Bordes y divisores
    expect(email.html).toContain('#128C4A'); // Verde WhatsApp

    // Sección puntualidad
    expect(email.html).toContain('PUNTUALIDAD');
    expect(email.html).toContain('tolerancia de 15 minutos');
    expect(email.text).toContain('PUNTUALIDAD');
    expect(email.text).toContain('tolerancia de 15 minutos');

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
      barberName: 'Lautaro',
    });

    expect(icsContent).toContain('BEGIN:VCALENDAR');
    expect(icsContent).toContain('VERSION:2.0');
    expect(icsContent).toContain('PRODID:-//Kani Barber Studio//Turno//ES');
    expect(icsContent).toContain('SUMMARY:Corte — Kani Barber Studio');
    expect(icsContent).toContain('DESCRIPTION:Turno con Lautaro para Corte en Kani Barber Studio.');
    expect(icsContent).toContain(`LOCATION:${KANI_STUDIO_FULL_ADDRESS}`);
    expect(icsContent).toContain('TZID:America/Argentina/Buenos_Aires');
    expect(icsContent).toContain('DTSTART;TZID=America/Argentina/Buenos_Aires:20261102T153000');
    expect(icsContent).toContain('DTEND;TZID=America/Argentina/Buenos_Aires:20261102T161500');
    expect(icsContent).toContain('END:VCALENDAR');
  });

  it('12. Endpoint /api/calendar/turno.ics valida firma criptográfica', async () => {
    const validParams = {
      id: 'notif-auth-789',
      bookingDate: '2026-11-02',
      startTime: '10:00',
      durationMinutes: 45,
      serviceName: 'Corte',
      barberName: 'Lautaro',
    };

    const validUrl = buildTurnoIcsUrl(validParams);
    const validReq = new Request(validUrl);
    const validRes = await handleTurnoIcsRequest(validReq);
    expect(validRes.status).toBe(200);
    expect(validRes.headers.get('Content-Type')).toContain('text/calendar');
    expect(validRes.headers.get('Content-Disposition')).toContain('attachment; filename="turno-kani.ics"');

    // Firma adulterada
    const forgedUrl = validUrl.replace(/sig=[a-f0-9]+/, 'sig=badsignature1234');
    const forgedReq = new Request(forgedUrl);
    const forgedRes = await handleTurnoIcsRequest(forgedReq);
    expect(forgedRes.status).toBe(403);
    const bodyText = await forgedRes.text();
    expect(bodyText).toBe('Enlace de calendario no válido o alterado.');
  });
});
