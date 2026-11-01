import { describe, it, expect } from 'vitest';
import {
  buildConfirmedEmail,
  formatSpanishDateNatural,
  buildGoogleCalendarUrl,
} from '../lib/kani-notifications.functions';
import { KANI_MAPS_URL, KANI_PUBLIC_WHATSAPP_URL } from '../lib/kani-constants';

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

    // Preencabezado en HTML
    expect(email.html).toContain('jueves 22 de octubre de 2026 a las 16:45 hs · Corte con Lautaro');
  });

  it('2. Fecha natural en español: Formato día semana + número + mes + año', () => {
    expect(formatSpanishDateNatural('2026-10-22')).toBe('jueves 22 de octubre de 2026');
    expect(formatSpanishDateNatural('2026-10-21')).toBe('miércoles 21 de octubre de 2026');
    expect(formatSpanishDateNatural('2026-10-24')).toBe('sábado 24 de octubre de 2026');
  });

  it('3. Contenido principal dinámico con servicio, barbero, fecha y horario 24h', () => {
    const email = buildConfirmedEmail(basePayload);
    const expectedSentence =
      'Se confirmó tu turno el día jueves 22 de octubre de 2026 a las 16:45 hs, para un servicio de Corte con Lautaro.';
    expect(email.text).toContain(expectedSentence);
    expect(email.html).toContain('Jueves 22 de octubre de 2026');
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

    expect(email.text).toContain('Contactar vía WhatsApp');
    expect(email.text).toContain(waExactUrl);

    expect(email.html).toContain('Contactar por WhatsApp');
    expect(email.html).toContain(waExactUrl);
    expect(email.html).toContain('https://www.instagram.com/kanibarberstudio/');
  });

  it('9. Integración de Google Calendar y Botón de acción', () => {
    const email = buildConfirmedEmail(basePayload);
    const calUrl = buildGoogleCalendarUrl({
      bookingDate: basePayload.bookingDate,
      startTime: basePayload.startTime,
      endTime: basePayload.endTime,
      serviceDurationMinutes: basePayload.serviceDurationMinutes,
      serviceName: basePayload.serviceName,
      barberName: basePayload.barberName,
    });

    expect(calUrl).toContain('calendar.google.com/calendar/render?action=TEMPLATE');
    expect(calUrl).toContain('Corte%20%E2%80%94%20Kani%20Barber%20Studio');
    expect(email.html).toContain(calUrl);
    expect(email.html).toContain('Agregar a mi calendario');
  });

  it('10. Estética Kani modo claro aprobada y compatibilidad de email (sin iframe, sin script)', () => {
    const email = buildConfirmedEmail(basePayload);

    // Paleta oficial aprobada
    expect(email.html).toContain('#F4EFE6'); // Fondo marfil
    expect(email.html).toContain('#1C1A17'); // Negro cálido
    expect(email.html).toContain('#C9A24D'); // Dorado
    expect(email.html).toContain('#9A7A2E'); // Dorado oscuro
    expect(email.html).toContain('#7A2C3A'); // Bordó

    // Compatibilidad estricta
    expect(email.html).not.toContain('<script');
    expect(email.html).not.toContain('<iframe');
    expect(email.html).toContain('table role="presentation"');
  });
});
