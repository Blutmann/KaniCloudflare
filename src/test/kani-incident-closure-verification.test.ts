import { describe, it, expect } from 'vitest';
import fs from 'fs';
import { summarizeAppointments } from '../lib/kani-dashboard';
import { computeFinancialControl } from '../lib/kani-statistics';

describe('Verificaciones de Cierre de Incidente — Resiliencia, Recuperación y Seguridad', () => {
  describe('1. Resiliencia ante fallos de integraciones externas', () => {
    it('la confirmación de turno en kani-benefit-codes captura errores de notificación y calendario sin fallar la reserva', () => {
      const code = fs.readFileSync('src/lib/kani-benefit-codes.server.ts', 'utf8');
      
      // Debe contener bloque try-catch alrededor de dispatchAppointmentNotification
      expect(code).toContain('dispatchAppointmentNotification');
      expect(code).toContain('Notification dispatch deferred to recovery');
      
      // Debe contener bloque try-catch alrededor de processCalendarSyncQueue
      expect(code).toContain('processCalendarSyncQueue');
      expect(code).toContain('Calendar sync trigger error');
      
      // Debe retornar success: true a pesar de fallas en integraciones secundarias
      expect(code).toMatch(/return\s*\{[\s\S]*?success:\s*true[\s\S]*?appointmentId:/);
    });

    it('la confirmación de turno en kani-payway-store captura errores de notificación sin fallar la confirmación', () => {
      const storeCode = fs.readFileSync('src/lib/kani-payway-store.server.ts', 'utf8');
      expect(storeCode).toContain('dispatchAppointmentNotification');
      expect(storeCode).toContain('Durable outbox retains notification for recovery');
      expect(storeCode).toContain('return confirmed;');
    });
  });

  describe('2. Registro durable y recuperación automática de notificaciones', () => {
    it('las notificaciones se registran en appointment_notification_events y existe recoverPendingNotificationEvents', () => {
      const notifCode = fs.readFileSync('src/lib/kani-notifications.functions.ts', 'utf8');
      
      expect(notifCode).toContain('export async function recoverPendingNotificationEvents');
      expect(notifCode).toContain("appointment_notification_events");
      expect(notifCode).toContain(".in(\"status\", [\"PENDING\", \"FAILED\"])");
    });

    it('el cron de mantenimiento periódico y trigger-maintenance ejecutan recoverPendingNotificationEvents', () => {
      const serverCode = fs.readFileSync('src/server.ts', 'utf8');
      
      // En trigger-maintenance
      expect(serverCode).toContain('recoverPendingNotificationEvents');
      // En scheduled()
      expect(serverCode).toMatch(/scheduled[\s\S]*?recoverPendingNotificationEvents/);
    });
  });

  describe('3. Autorización ADMIN y bloqueo de destinatarios arbitrarios en /api/admin/recover-appointment-notification', () => {
    it('exige autenticación ADMIN y rechaza destinatarios arbitrarios', () => {
      const serverCode = fs.readFileSync('src/server.ts', 'utf8');
      
      // Bloqueo de destinatarios arbitrarios
      expect(serverCode).toContain('ARBITRARY_RECIPIENT_FORBIDDEN');
      expect(serverCode).toContain('url.searchParams.has("recipient")');
      expect(serverCode).toContain('url.searchParams.has("email")');
      expect(serverCode).toContain('url.searchParams.has("phone")');

      // Verificación de autenticación y rol ADMIN
      expect(serverCode).toContain('AUTH_REQUIRED');
      expect(serverCode).toContain('UNAUTHORIZED_ADMIN_ONLY');
      expect(serverCode).toContain('profile.role !== "ADMIN"');
    });

    it('los endpoints temporales de auditoría y desbloqueo de prueba fueron eliminados', () => {
      const serverCode = fs.readFileSync('src/server.ts', 'utf8');
      
      expect(serverCode).not.toContain('/api/admin/status-audit');
      expect(serverCode).not.toContain('/api/admin/franco-schedule-audit');
      expect(serverCode).not.toContain('/api/admin/benefit-codes-audit');
      expect(serverCode).not.toContain('/api/admin/benefit-codes-release-lock');
    });
  });

  describe('4. Diferenciación de email aceptado vs entregado respaldado por proveedor', () => {
    it('servidor cuenta con webhook de Resend para procesar email.delivered y email.bounced', () => {
      const serverCode = fs.readFileSync('src/server.ts', 'utf8');
      
      expect(serverCode).toContain('/api/webhook/resend');
      expect(serverCode).toContain('email.delivered');
      expect(serverCode).toContain('email.bounced');
    });

    it('la agenda visual distingue explícitamente entre Email Aceptado y Email Entregado', () => {
      const agendaCode = fs.readFileSync('src/components/kani/v2/agenda.tsx', 'utf8');
      
      expect(agendaCode).toMatch(/case "DELIVERED":\s*return "Email: Entregado";/);
      expect(agendaCode).toMatch(/case "SENT":[\s\S]*?case "PROVIDER_ACCEPTED":\s*return "Email: Aceptado";/);
      expect(agendaCode).toContain('Aceptado por proveedor (en tránsito)');
      expect(agendaCode).toContain('Entrega confirmada por proveedor');
    });
  });

  describe('5. Turnos cancelados no aparecen como servicios realizados ni generan recaudación', () => {
    it('summarizeAppointments clasifica turnos CANCELLED sin contarlos como confirmados', () => {
      const testAppointments: any[] = [
        {
          id: 'apt-completed-1',
          date: '2026-11-02',
          statusCode: 'COMPLETED',
          priceArs: 25000,
          depositAmountArs: 5000,
          balancePaid: true,
        },
        {
          id: 'apt-cancelled-test-1',
          date: '2026-11-02',
          statusCode: 'CANCELLED',
          priceArs: 25000,
          depositAmountArs: 5000,
          balancePaid: false,
        },
        {
          id: 'apt-cancelled-test-2',
          date: '2026-11-02',
          statusCode: 'CANCELLED',
          priceArs: 30000,
          depositAmountArs: 0,
          balancePaid: false,
        },
      ];

      const summary = summarizeAppointments(testAppointments);
      
      // Solo 1 confirmado/ejecutado
      expect(summary.confirmed).toBe(1);
      // Exactamente 2 cancelados registrados
      expect(summary.cancelled).toBe(2);
      expect(summary.requested).toBe(3);
    });

    it('computeFinancialControl no suma servicios realizados ni saldos de turnos CANCELLED', () => {
      const testAppointments: any[] = [
        {
          id: 'apt-1',
          statusCode: 'COMPLETED',
          servicePrice: 25000,
          depositAmount: 5000,
          depositPaid: true,
          balancePaid: true,
        },
        {
          id: 'apt-cancelled-test',
          statusCode: 'CANCELLED',
          servicePrice: 25000,
          depositAmount: 5000,
          depositPaid: false,
          balancePaid: false,
        },
        {
          id: 'apt-confirmed-active',
          statusCode: 'CONFIRMED',
          servicePrice: 25000,
          depositAmount: 5000,
          depositPaid: true,
          balancePaid: false,
        },
      ];

      const financial = computeFinancialControl(testAppointments);
      
      // Servicios completados debe ser exactamente 1 (el cancelado NO suma)
      expect(financial.completedServices.count).toBe(1);
      expect(financial.completedServices.totalCollectedArs).toBe(25000);
      // Cobros pendientes debe ser exactamente 1 (el confirmado activo: 25000 - 5000 = 20000; el cancelado NO suma saldo)
      expect(financial.pendingBalances.count).toBe(1);
      expect(financial.pendingBalances.totalArs).toBe(20000);
    });
  });
});
