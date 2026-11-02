import { it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { buildCancelledEmail } from '@/lib/kani-notifications.functions';

const artifactDir = 'C:/Users/Administrador/.gemini/antigravity/brain/d2872479-aba2-4596-89f1-da4f4cbb0293';

it('generates HTML preview files for cancellation emails', () => {
  const payloadStandard: any = {
    notificationId: 'notif-canc-01',
    appointmentId: 'appt-canc-01',
    notificationType: 'CANCELLED',
    recipientEmail: 'tomas@example.com',
    clientName: 'Tomás Blutmann',
    barberName: 'Lautaro',
    serviceName: 'Corte de Cabello',
    bookingDate: '2026-11-05',
    startTime: '14:30:00',
    endTime: '15:15:00',
    servicePriceArs: 25000,
    serviceDurationMinutes: 45,
    downPaymentArs: 5000,
  };

  const payloadBenefit: any = {
    notificationId: 'notif-canc-02',
    appointmentId: 'appt-canc-02',
    notificationType: 'CANCELLED',
    recipientEmail: 'tomas@example.com',
    clientName: 'Tomás Blutmann',
    barberName: 'Lautaro',
    serviceName: 'Corte + Barba',
    bookingDate: '2026-11-06',
    startTime: '11:30:00',
    endTime: '12:30:00',
    servicePriceArs: 30000,
    serviceDurationMinutes: 60,
    downPaymentArs: 0,
    benefitCode: 'KANI-SIN-PAGO-TOMY',
    benefitType: 'NO_DEPOSIT',
  };

  const email1 = buildCancelledEmail(payloadStandard, 'https://www.kanibarber.com/reservar-turno');
  const email2 = buildCancelledEmail(payloadBenefit, 'https://www.kanibarber.com/reservar-turno');

  fs.writeFileSync(path.join(artifactDir, 'email-cancelacion-standard.html'), email1.html, 'utf8');
  fs.writeFileSync(path.join(artifactDir, 'email-cancelacion-benefit.html'), email2.html, 'utf8');
  console.log('Successfully generated cancellation HTML files!');
});
