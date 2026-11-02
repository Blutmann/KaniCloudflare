import { describe, expect, it } from 'vitest';
import { buildCancelledEmail } from './kani-notifications.functions';
import { notificationSubject } from './kani-email-environment';

describe('Kani — Rediseño del correo de cancelación', () => {
  const basePayload: any = {
    notificationId: 'notif-cancel-123',
    appointmentId: 'appt-cancel-456',
    notificationType: 'CANCELLED',
    recipientEmail: 'tomas@example.com',
    clientName: 'Martín Palermo',
    barberName: 'Lautaro',
    serviceName: 'Corte de Cabello',
    bookingDate: '2026-11-05',
    startTime: '16:00:00',
    endTime: '16:45:00',
    servicePriceArs: 25000,
    serviceDurationMinutes: 45,
    downPaymentArs: 5000,
  };

  it('1. Asunto: usa exactamente [KANI] Se canceló tu turno con {barbero} sin prefijo [PRUEBA]', () => {
    const result = buildCancelledEmail(basePayload);
    expect(result.subject).toBe('[KANI] Se canceló tu turno con Lautaro');

    // Comprobar que notificationSubject respeta [KANI] y no agrega [PRUEBA] ni en DEV ni con Supabase test
    const processedSubject = notificationSubject(
      result.subject,
      'DEV/PREVIEW',
      'https://iockpxtkflyjfagkvgnr.supabase.co'
    );
    expect(processedSubject).toBe('[KANI] Se canceló tu turno con Lautaro');
    expect(processedSubject).not.toContain('[PRUEBA]');
  });

  it('2. Diseño y contenido: estructura coherente con confirmación, logo, tarjeta negra y kanji', () => {
    const result = buildCancelledEmail(basePayload);

    // Fondo y contenedores negros
    expect(result.html).toContain('background-color: #000000');
    expect(result.html).toContain('color: #F5F5F5');
    expect(result.html).toContain('border: 1px solid #383838');

    // Logo oficial de Kani
    expect(result.html).toContain('kani-email-logo.png');

    // Título y saludo oficial
    expect(result.html).toContain('Tu turno fue cancelado');
    expect(result.html).toContain('Hola <strong style="color: #F5F5F5; font-weight: 600;">Martín Palermo</strong>, se canceló tu turno con Lautaro. Te dejamos los detalles de la reserva cancelada.');

    // Detalles del turno
    expect(result.html).toContain('Corte de Cabello');
    expect(result.html).toContain('Lautaro');
    expect(result.html).toContain('16:00 hs');
    expect(result.html).toContain('&#34809;'); // Kanji decorativo 蟹

    // Estado Cancelado claramente visible en texto
    expect(result.html).toContain('Estado: Cancelado');
    expect(result.text).toContain('ESTADO: CANCELADO');

    // NO incluye botones de agregar al calendario ni volver a cancelar
    expect(result.html).not.toContain('Agregar al calendario');
    expect(result.html).not.toContain('Cancelar turno');
    expect(result.text).not.toContain('Agregar al calendario');
    expect(result.text).not.toContain('Cancelar turno');

    // NO incluye la sección de tolerancia de llegada
    expect(result.html).not.toContain('tolerancia de 15 minutos');
    expect(result.html).not.toContain('PUNTUALIDAD');
  });

  it('3. Acciones: botones Reservar otro turno (dorado) y WhatsApp (verde oscuro)', () => {
    const result = buildCancelledEmail(basePayload, 'https://www.kanibarber.com/reservar-turno');

    // Botón Reservar otro turno en dorado (#B99A5B) con texto negro (#000000)
    expect(result.html).toContain('Reservar otro turno');
    expect(result.html).toContain('background-color: #B99A5B');
    expect(result.html).toContain('color: #000000');
    expect(result.html).toContain('href="https://www.kanibarber.com/reservar-turno"');

    // Botón WhatsApp en verde oscuro (#128C4A) con texto blanco (#FFFFFF)
    expect(result.html).toContain('Contactar por WhatsApp');
    expect(result.html).toContain('background-color: #128C4A');
    expect(result.html).toContain('color: #FFFFFF');
    expect(result.html).toContain('5491155616438');
    expect(result.html).toContain(encodeURIComponent('Hola, quisiera consultar por mi turno cancelado.'));

    // Altura táctil mínima de 44px
    expect(result.html).toContain('min-height: 44px');
  });

  it('4. Información económica: no presenta saldo deudor y refleja seña registrada sin inventar reembolsos', () => {
    const result = buildCancelledEmail(basePayload);

    // Muestra seña registrada
    expect(result.html).toContain('INFORMACIÓN DE SEÑA');
    expect(result.html).toContain('Seña registrada');
    expect(result.html).toContain('$5.000');

    // NO presenta saldo deudor ni exigible
    expect(result.html).not.toContain('Saldo a pagar en el local');
    expect(result.html).not.toContain('Saldo pendiente');
    expect(result.text).not.toContain('Saldo a pagar');
  });

  it('5. Beneficios: informa que el código utilizado ha sido consumido y no podrá reutilizarse', () => {
    const payloadWithBenefit = {
      ...basePayload,
      benefitCode: 'KANI-PROMO-1234',
      benefitType: 'NO_DEPOSIT',
    };
    const result = buildCancelledEmail(payloadWithBenefit);

    expect(result.html).toContain('KANI-PROMO-1234');
    expect(result.html).toContain('no podrá reutilizarse');
    expect(result.text).toContain('KANI-PROMO-1234');
    expect(result.text).toContain('no podrá reutilizarse');
  });

  it('6. Preencabezado y texto plano: versión accesible y libre de placeholders', () => {
    const result = buildCancelledEmail(basePayload);

    expect(result.html).toContain('Se canceló tu turno');
    expect(result.text).toContain('Tu turno fue cancelado');
    expect(result.text).toContain('Lautaro');
    expect(result.text).toContain('Corte de Cabello');
    expect(result.text).toContain('16:00 hs');
    expect(result.text).toContain('Reservar otro turno: https://www.kanibarber.com/reservar-turno');
    expect(result.text).toContain('Contactar por WhatsApp: https://wa.me/5491155616438');
  });

  it('7. Escapa correctamente caracteres especiales en nombres', () => {
    const result = buildCancelledEmail({
      ...basePayload,
      clientName: '<script>alert("hack")</script>',
      barberName: 'Lautaro & Co',
    });

    expect(result.subject).toBe('[KANI] Se canceló tu turno con Lautaro & Co');
    expect(result.html).not.toContain('<script>');
    expect(result.html).toContain('&lt;script&gt;');
    expect(result.html).toContain('Lautaro &amp; Co');
  });
});
