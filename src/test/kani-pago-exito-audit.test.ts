import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  KANI_STUDIO_ADDRESS,
  KANI_MAPS_URL,
  KANI_STANDARD_DEPOSIT_ARS,
  formatAppointmentDateTime,
} from '../lib/kani-constants';
import { buildConfirmedEmail } from '../lib/kani-notifications.functions';

describe('Auditoría de consistencia de Pago Exitoso y Confirmación (Kani Barber Studio)', () => {
  const pagoExitoCode = fs.readFileSync(
    path.resolve(__dirname, '../routes/pago.exito.tsx'),
    'utf-8',
  );
  const pagoPendienteCode = fs.readFileSync(
    path.resolve(__dirname, '../routes/pago.pendiente.tsx'),
    'utf-8',
  );

  it('1. Formato de fecha y hora: "2026-10-26" + "10:00:00" produce "26 Octubre 2026 | 10:00 hs"', () => {
    const formatted = formatAppointmentDateTime('2026-10-26', '10:00:00');
    expect(formatted).toBe('26 Octubre 2026 | 10:00 hs');

    // Test con padding de día y mes de un solo dígito
    const singleDigit = formatAppointmentDateTime('2026-05-04', '14:30');
    expect(singleDigit).toBe('04 Mayo 2026 | 14:30 hs');

    // Sin segundos y libre de desfase de huso horario
    expect(formatAppointmentDateTime('2026-12-01', '09:05:00')).toBe('01 Diciembre 2026 | 09:05 hs');
  });

  it('2. Dirección correcta: "San Isidro Labrador 7, Martinez" en constante y en páginas de pago', () => {
    expect(KANI_STUDIO_ADDRESS).toBe('San Isidro Labrador 7, Martinez');

    // En pago.exito.tsx
    expect(pagoExitoCode).toContain('Dirección:');
    expect(pagoExitoCode).toContain('{KANI_STUDIO_ADDRESS}');
    expect(pagoExitoCode).not.toContain('Av. Maipú');
    expect(pagoExitoCode).not.toContain('Olivos');

    // En pago.pendiente.tsx
    expect(pagoPendienteCode).toContain('Dirección:');
    expect(pagoPendienteCode).toContain('{KANI_STUDIO_ADDRESS}');
    expect(pagoPendienteCode).not.toContain('Av. Maipú');
    expect(pagoPendienteCode).not.toContain('Olivos');
  });

  it('3. Google Maps: Usa exactamente la URL oficial indicada', () => {
    const expectedUrl =
      'https://www.google.com/maps/place/KANI+BARBER+STUDIO/@-34.4939808,-58.5005199,17z/data=!3m1!4b1!4m6!3m5!1s0x95bcb11919d38997:0x48bcfe7b2ea7ba60!8m2!3d-34.4939808!4d-58.497945!16s%2Fg%2F11nvyg5zgw?entry=ttu&g_ep=EgoyMDI2MTAyMC4wIKXMDSoASAFQAw%3D%3D';

    expect(KANI_MAPS_URL).toBe(expectedUrl);
    expect(pagoExitoCode).toContain('href={KANI_MAPS_URL}');
  });

  it('4. Texto posterior al pago: Sin "Te esperamos en el estudio", sin promesas de WhatsApp, con aviso de spam', () => {
    // Eliminados
    expect(pagoExitoCode).not.toContain('Te esperamos en el estudio');
    expect(pagoExitoCode).not.toContain('Te enviamos el detalle y recordatorio por WhatsApp y correo electrónico');

    // Nuevo aviso de correo
    const expectedNotice =
      'Te enviamos el resumen de tu turno por correo electrónico. Si no lo encontrás, revisá Spam o Correo no deseado.';
    expect(pagoExitoCode).toContain(expectedNotice);
  });

  it('5. Seña vigente ARS 5.000: El email calcula correctamente el saldo y nunca muestra $10.000 como seña', () => {
    expect(KANI_STANDARD_DEPOSIT_ARS).toBe(5000);

    const testPayload = {
      notificationId: 'audit-test-1',
      notificationType: 'CONFIRMED' as const,
      recipientEmail: 'cliente@test.com',
      clientName: 'Cliente Test',
      barberName: 'Lautaro',
      serviceName: 'Corte',
      bookingDate: '2026-10-26',
      startTime: '10:00:00',
      endTime: '10:45:00',
      clientNotes: null,
      servicePriceArs: 25000,
      serviceDurationMinutes: 45,
      downPaymentArs: 10000, // Simulación de registro heredado en DB
      transferAlias: null,
      transferCuit: null,
      transferHolderName: null,
    };

    const email = buildConfirmedEmail(testPayload);

    // Muestra seña de $5.000
    expect(email.text).toContain('Seña abonada: $5.000');
    expect(email.html).toContain('−$5.000');

    // Saldo restante: 25.000 - 5.000 = 20.000
    expect(email.text).toContain('Saldo a pagar en el local: $20.000');
    expect(email.html).toContain('$20.000');

    // NO muestra $10.000 como seña
    expect(email.text).not.toContain('Seña abonada: $10.000');
    expect(email.text).not.toContain('$10.000');
  });

  it('6. Fecha formateada en pago.exito y pago.pendiente mediante formatAppointmentDateTime', () => {
    expect(pagoExitoCode).toContain('formatAppointmentDateTime(appt.date, appt.time)');
    expect(pagoPendienteCode).toContain('formatAppointmentDateTime(result.appointment.date, result.appointment.time)');
  });
});
