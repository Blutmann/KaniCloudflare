import { describe, it, expect } from 'vitest';
import {
  buildConfirmedEmail,
  formatSpanishDateNatural,
} from '../lib/kani-notifications.functions';

describe('Email transaccional de confirmación de turno (Kani Barber Studio)', () => {
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

  it('1. Asunto: Utiliza exactamente "Kani - Se confirmó tu turno"', () => {
    const email = buildConfirmedEmail(basePayload);
    expect(email.subject).toBe('Kani - Se confirmó tu turno');
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
    expect(email.html).toContain('jueves 22 de octubre de 2026');
    expect(email.html).toContain('16:45 hs');
    expect(email.html).toContain('Corte');
    expect(email.html).toContain('Lautaro');
  });

  it('4. Resumen financiero: Importe, Seña abonada y Saldo a pagar en el local', () => {
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

  it('5. Cálculo dinámico con otro servicio (Corte y barba $30.000 con seña $10.000)', () => {
    const customPayload = {
      ...basePayload,
      serviceName: 'Corte y barba',
      barberName: 'Gonzalo',
      bookingDate: '2026-10-24',
      startTime: '11:00:00',
      servicePriceArs: 30000,
      downPaymentArs: 10000,
    };

    const email = buildConfirmedEmail(customPayload);
    expect(email.text).toContain('Importe: $30.000');
    expect(email.text).toContain('Seña abonada: $10.000');
    expect(email.text).toContain('Saldo a pagar en el local: $20.000');
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

  it('7. Ubicación: Dirección exacta y enlace a Google Maps', () => {
    const email = buildConfirmedEmail(basePayload);
    const mapsExactUrl = 'https://maps.app.goo.gl/pS9iomLQhNKRFkXp7?g_st=ic';

    expect(email.text).toContain('¿CÓMO LLEGO?');
    expect(email.text).toContain('San Isidro Labrador 7');
    expect(email.text).toContain('Martinez, Provincia de Buenos Aires');
    expect(email.text).toContain(mapsExactUrl);

    expect(email.html).toContain('¿Cómo llego?');
    expect(email.html).toContain('San Isidro Labrador 7');
    expect(email.html).toContain('Martinez, Provincia de Buenos Aires');
    expect(email.html).toContain(mapsExactUrl);
    expect(email.html).toContain('Ver ubicación');
  });

  it('8. WhatsApp: Acción y enlace exacto con número oficial', () => {
    const email = buildConfirmedEmail(basePayload);
    const waExactUrl = 'https://wa.me/5491128436014';

    expect(email.text).toContain('Contactar vía WhatsApp');
    expect(email.text).toContain(waExactUrl);

    expect(email.html).toContain('Contactar vía WhatsApp');
    expect(email.html).toContain(waExactUrl);
  });

  it('9. Estética Kani modo claro y compatibilidad de email (sin iframe, sin script)', () => {
    const email = buildConfirmedEmail(basePayload);

    // Colores Kani modo claro
    expect(email.html).toContain('#762936'); // Bordó institucional Kani
    expect(email.html).toContain('#FAF9F6'); // Fondo cálido Kani
    expect(email.html).toContain('#252323'); // Texto principal grafito Kani

    // Compatibilidad estricta
    expect(email.html).not.toContain('<script');
    expect(email.html).not.toContain('<iframe');
    expect(email.html).toContain('table role="presentation"');
  });
});
