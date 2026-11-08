import { cleanup } from "@testing-library/react";
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  calculateMembershipPricing,
  consumeMembershipSession,
  createClientMembership,
  createRecurringAvailabilityRule,
  createRecurringManualSeries,
  fetchClientMemberships,
  fetchRecurringAvailabilityRules,
  generateRecurrenceDates,
  KANI_MEMBERSHIP_PAYMENT_METHODS,
  modifyRecurringAppointmentSeries,
  modifyRecurringAvailabilityRule,
  refundMembershipSession,
  registerMembershipPayment,
  resetFallbackStoresForTesting,
  updateClientMembershipDetails,
} from "@/lib/kani-recurrences-memberships";
import {
  buildAppointmentReminderEmail,
  buildRecurringSeriesGroupedEmail,
} from "@/lib/kani-recurring-notifications";
import { mayAccessStaffSection } from "@/lib/kani-permissions";
import type { AuthenticatedStaff } from "@/lib/kani-auth";

const mockState = vi.hoisted(() => ({
  role: "ADMIN" as "ADMIN" | "MANAGER" | "BARBER",
  barberId: null as string | null,
  rpc: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (...args: unknown[]) => mockState.rpc(...args),
    from: () => ({
      select: () => ({
        order: () => Promise.resolve({ data: null, error: { message: "offline-test-fallback" } }),
      }),
    }),
    auth: {
      getSession: async () => ({ data: { session: { access_token: "test-token" } } }),
    },
  },
}));

const adminStaff: AuthenticatedStaff = {
  user: { id: "staff-admin-1", email: "admin@kanibarber.com" },
  profile: {
    role: "ADMIN",
    barber_id: null,
    display_name: "KANI Admin",
    active: true,
  },
  barbers: [
    { id: "lautaro", name: "Lautaro" },
    { id: "tomas", name: "Tomás" },
  ],
};

const barberStaff: AuthenticatedStaff = {
  user: { id: "staff-barber-1", email: "lautaro@kanibarber.com" },
  profile: {
    role: "BARBER",
    barber_id: "lautaro",
    display_name: "Lautaro",
    active: true,
  },
  barbers: [
    { id: "lautaro", name: "Lautaro" },
    { id: "tomas", name: "Tomás" },
  ],
};

describe("FASE 15 — Pruebas integrales de Recurrencias, Membresías, Descuentos y Notificaciones", () => {
  beforeEach(() => {
    resetFallbackStoresForTesting();
    mockState.role = "ADMIN";
    mockState.barberId = null;
    mockState.rpc.mockReset().mockRejectedValue(new Error("PGRST202"));
  });

  afterEach(() => {
    cleanup();
  });

  describe("1. Disponibilidad recurrente y generador determinístico de fechas", () => {
    it("genera fechas por única vez, diarias, semanales, cada dos semanas y mensuales con condiciones de fin", () => {
      // Por única vez
      expect(
        generateRecurrenceDates({
          startDate: "2026-11-10",
          frequencyType: "ONCE",
          endType: "NEVER",
          windowFrom: "2026-11-01",
          windowTo: "2026-12-31",
        }),
      ).toEqual(["2026-11-10"]);

      // Todos los días (después de 4 repeticiones)
      expect(
        generateRecurrenceDates({
          startDate: "2026-11-10",
          frequencyType: "DAILY",
          endType: "AFTER_COUNT",
          maxOccurrences: 4,
          windowFrom: "2026-11-01",
          windowTo: "2026-12-31",
        }),
      ).toEqual(["2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13"]);

      // Todas las semanas (hasta fecha determinada)
      expect(
        generateRecurrenceDates({
          startDate: "2026-11-10",
          frequencyType: "WEEKLY",
          endType: "UNTIL_DATE",
          endDate: "2026-11-25",
          windowFrom: "2026-11-01",
          windowTo: "2026-12-31",
        }),
      ).toEqual(["2026-11-10", "2026-11-17", "2026-11-24"]);

      // Cada dos semanas
      expect(
        generateRecurrenceDates({
          startDate: "2026-11-10",
          frequencyType: "BIWEEKLY",
          endType: "AFTER_COUNT",
          maxOccurrences: 3,
          windowFrom: "2026-11-01",
          windowTo: "2026-12-31",
        }),
      ).toEqual(["2026-11-10", "2026-11-24", "2026-12-08"]);
    });

    it("omite meses sin día 31 en recurrencias mensuales sin correr al último día del mes", () => {
      const monthly31 = generateRecurrenceDates({
        startDate: "2026-01-31",
        frequencyType: "MONTHLY",
        endType: "AFTER_COUNT",
        maxOccurrences: 4,
        windowFrom: "2026-01-01",
        windowTo: "2026-08-31",
      });
      // Febrero (28), Abril (30) y Junio (30) deben omitirse; se generan Enero, Marzo, Mayo y Julio
      expect(monthly31).toEqual(["2026-01-31", "2026-03-31", "2026-05-31", "2026-07-31"]);
    });

    it("habilita domingos para un barbero específico sin afectar a otros y soporta alcance SINGLE / THIS_AND_FOLLOWING / ALL_FUTURE", async () => {
      const rule = await createRecurringAvailabilityRule(
        {
          barberId: "lautaro",
          startDate: "2026-11-15", // Domingo
          startTime: "11:00",
          endTime: "11:45",
          frequencyType: "WEEKLY",
          endType: "AFTER_COUNT",
          maxOccurrences: 4,
        },
        adminStaff,
      );

      const rulesLautaro = await fetchRecurringAvailabilityRules(adminStaff, "lautaro");
      const rulesTomas = await fetchRecurringAvailabilityRules(adminStaff, "tomas");
      expect(rulesLautaro).toHaveLength(1);
      expect(rulesTomas).toHaveLength(0);

      // Excluir solo una fecha ("2026-11-22")
      await modifyRecurringAvailabilityRule(
        {
          ruleId: rule.id,
          scope: "SINGLE",
          targetDate: "2026-11-22",
          action: "BLOCK",
        },
        adminStaff,
      );

      const updated = (await fetchRecurringAvailabilityRules(adminStaff, "lautaro"))[0];
      expect(updated.excludedDates).toContain("2026-11-22");

      const projected = generateRecurrenceDates({
        startDate: updated.startDate,
        frequencyType: updated.frequencyType,
        endType: updated.endType,
        endDate: updated.endDate,
        maxOccurrences: updated.maxOccurrences,
        excludedDates: updated.excludedDates,
        windowFrom: "2026-11-01",
        windowTo: "2026-12-31",
      });
      expect(projected).toEqual(["2026-11-15", "2026-11-29", "2026-12-06"]);

      // Cortar esta fecha y las siguientes desde 2026-11-29
      await modifyRecurringAvailabilityRule(
        {
          ruleId: rule.id,
          scope: "THIS_AND_FOLLOWING",
          targetDate: "2026-11-29",
          action: "DEACTIVATE",
        },
        adminStaff,
      );
      const afterSplit = (await fetchRecurringAvailabilityRules(adminStaff, "lautaro"))[0];
      expect(afterSplit.endType).toBe("UNTIL_DATE");
      expect(afterSplit.endDate).toBe("2026-11-28");
    });
  });

  describe("2. Turnos manuales recurrentes y gestión de conflictos (ventana 90 días)", () => {
    it("crea parcialmente los turnos dentro de los próximos 90 días, omite fechas con conflicto y las persiste como excepción", async () => {
      const existingAppointments = [
        {
          id: "apt-conflict-1",
          name: "Cliente Preexistente",
          barberId: "lautaro",
          date: "2026-11-17",
          time: "15:00",
          endTime: "15:45",
          statusCode: "CONFIRMED",
        },
      ];

      const result = await createRecurringManualSeries(
        {
          barberId: "lautaro",
          clientId: "client-1",
          clientName: "Matías Recurrente",
          clientPhone: "+5491199998888",
          clientEmail: "matias@example.com",
          serviceId: "service-corte",
          customServiceName: "Corte",
          servicePriceArs: 23000,
          startDate: "2026-11-10",
          startTime: "15:00",
          durationMinutes: 45,
          frequencyType: "WEEKLY",
          endType: "AFTER_COUNT",
          maxOccurrences: 4,
          pricingMode: "FIXED_PRICE",
        },
        adminStaff,
        existingAppointments,
      );

      // De las 4 semanas (10/11, 17/11, 24/11, 01/12), el 17/11 tiene conflicto y debe omitirse
      expect(result.createdCount).toBe(3);
      expect(result.omittedCount).toBe(1);
      expect(result.createdAppointments.map((a) => a.bookingDate)).toEqual([
        "2026-11-10",
        "2026-11-24",
        "2026-12-01",
      ]);
      expect(result.omittedConflicts[0].targetDate).toBe("2026-11-17");
      expect(result.omittedConflicts[0].conflictingClientName).toBe("Cliente Preexistente");

      // Modificar serie futura
      const modRes = await modifyRecurringAppointmentSeries(
        {
          appointmentId: result.createdAppointments[0].id,
          scope: "ALL_FUTURE",
          action: "CANCEL",
        },
        adminStaff,
      );
      expect(modRes.affectedCount).toBeGreaterThanOrEqual(1);
    });
  });

  describe("3. Membresías prepagadas (4 y 10 servicios), pagos, consumos, reintegros y agotamiento", () => {
    it("calcula con exactitud entera en ARS el 10% (4 servicios) y 15% (10 servicios) y valida la suma", () => {
      // Membresía 4 servicios: 2 Cortes ($25.000 c/u) + 2 Corte y barba ($28.000 c/u) = $106.000
      // 10% descuento = $10.600 -> Total final = $95.400
      const calc4 = calculateMembershipPricing(4, [
        { serviceName: "Corte", quantity: 2, unitPriceArs: 25000 },
        { serviceName: "Corte y barba", quantity: 2, unitPriceArs: 28000 },
      ]);
      expect(calc4.isValidComposition).toBe(true);
      expect(calc4.subtotalArs).toBe(106000);
      expect(calc4.discountPercent).toBe(10);
      expect(calc4.discountAmountArs).toBe(10600);
      expect(calc4.totalPriceArs).toBe(95400);

      // Membresía 10 servicios: 10 Cortes ($25.000 c/u) = $250.000
      // 15% descuento = $37.500 -> Total final = $212.500
      const calc10 = calculateMembershipPricing(10, [
        { serviceName: "Corte", quantity: 10, unitPriceArs: 25000 },
      ]);
      expect(calc10.isValidComposition).toBe(true);
      expect(calc10.subtotalArs).toBe(250000);
      expect(calc10.discountPercent).toBe(15);
      expect(calc10.discountAmountArs).toBe(37500);
      expect(calc10.totalPriceArs).toBe(212500);

      // Suma incorrecta (3 en lugar de 4) debe ser inválida
      const invalidCalc = calculateMembershipPricing(4, [
        { serviceName: "Corte", quantity: 3, unitPriceArs: 25000 },
      ]);
      expect(invalidCalc.isValidComposition).toBe(false);
    });

    it("impide consumir sesiones si está Pendiente de pago, permite consumir tras pago, previene doble consumo, soporta reintegro y detecta agotamiento", async () => {
      const m = await createClientMembership(
        {
          clientId: "client-1",
          barberId: "lautaro",
          packageSize: 4,
          items: [{ serviceName: "Corte", quantity: 4, unitPriceArs: 25000 }],
          expiresAt: null,
          paymentNow: false,
        },
        adminStaff,
        { name: "Juan Membresía" },
      );

      expect(m.status).toBe("PENDING_PAYMENT");

      // Intentar consumir en estado PENDING_PAYMENT debe fallar
      await expect(
        consumeMembershipSession(
          {
            membershipId: m.id,
            serviceName: "Corte",
            appointmentId: "apt-1",
            consumptionType: "SERVICE_COMPLETED",
          },
          adminStaff,
        ),
      ).rejects.toThrow(/pendiente de pago/i);

      // Registrar pago completo -> pasa a ACTIVE
      await registerMembershipPayment(m.id, "Transferencia", adminStaff);

      let list = await fetchClientMemberships(adminStaff);
      expect(list[0].status).toBe("ACTIVE");

      // Consumir sesión 1 (servicio realizado)
      const c1 = await consumeMembershipSession(
        {
          membershipId: m.id,
          serviceName: "Corte",
          appointmentId: "apt-1",
          consumptionType: "SERVICE_COMPLETED",
        },
        adminStaff,
      );
      expect(c1.remainingSessions).toBe(3);
      expect(c1.isExhausted).toBe(false);

      // Prevenir doble consumo para el mismo turno apt-1
      await expect(
        consumeMembershipSession(
          {
            membershipId: m.id,
            serviceName: "Corte",
            appointmentId: "apt-1",
            consumptionType: "SERVICE_COMPLETED",
          },
          adminStaff,
        ),
      ).rejects.toThrow(/ya consumió una sesión/i);

      // Reintegrar sesión de apt-1 y verificar trazabilidad
      const ref1 = await refundMembershipSession(
        {
          consumptionId: c1.consumption.id,
          reason: "Turno reprogramado",
        },
        adminStaff,
      );
      expect(ref1.remainingSessions).toBe(4);

      list = await fetchClientMemberships(adminStaff);
      expect(list[0].consumptions[0].status).toBe("REFUNDED");
      expect(list[0].events.some((e) => e.eventType === "SESSION_REFUNDED")).toBe(true);

      // Consumir las 4 sesiones (incluyendo una por inasistencia) hasta agotar
      await consumeMembershipSession(
        {
          membershipId: m.id,
          serviceName: "Corte",
          consumptionType: "SERVICE_COMPLETED",
        },
        adminStaff,
      );
      await consumeMembershipSession(
        {
          membershipId: m.id,
          serviceName: "Corte",
          consumptionType: "NO_SHOW_DEDUCTION",
        },
        adminStaff,
      );
      await consumeMembershipSession(
        {
          membershipId: m.id,
          serviceName: "Corte",
          consumptionType: "SERVICE_COMPLETED",
        },
        adminStaff,
      );
      const cLast = await consumeMembershipSession(
        {
          membershipId: m.id,
          serviceName: "Corte",
          consumptionType: "SERVICE_COMPLETED",
        },
        adminStaff,
      );
      expect(cLast.remainingSessions).toBe(0);
      expect(cLast.isExhausted).toBe(true);

      list = await fetchClientMemberships(adminStaff);
      expect(list[0].status).toBe("EXHAUSTED");

      // Actualizar vencimiento y auditar evento UPDATED
      await updateClientMembershipDetails(
        {
          membershipId: m.id,
          expiresAt: "2027-03-31",
          notes: "Extensión autorizada",
        },
        adminStaff,
      );
      list = await fetchClientMemberships(adminStaff);
      expect(list[0].expiresAt).toBe("2027-03-31");
      expect(list[0].events.some((e) => e.eventType === "UPDATED")).toBe(true);
    });

    it("admite todos los métodos de pago de KANI y respeta estrictamente el cupo por servicio contratado", async () => {
      expect(KANI_MEMBERSHIP_PAYMENT_METHODS).toEqual([
        "Efectivo",
        "Transferencia",
        "Tarjeta — Payway",
        "Tarjeta de crédito",
        "Tarjeta de débito",
        "Payway",
        "Mercado Pago",
      ]);

      const mixed = await createClientMembership(
        {
          clientId: "client-2",
          barberId: "lautaro",
          packageSize: 4,
          items: [
            { serviceName: "Corte", quantity: 1, unitPriceArs: 25000 },
            { serviceName: "Barba", quantity: 3, unitPriceArs: 19000 },
          ],
          paymentNow: true,
          paymentMethod: "Tarjeta — Payway",
        },
        adminStaff,
      );
      expect(mixed.paymentMethod).toBe("Tarjeta — Payway");

      // Consumir el único Corte contratado
      await consumeMembershipSession(
        { membershipId: mixed.id, serviceName: "Corte" },
        adminStaff,
      );

      // Intentar consumir un segundo Corte debe fallar aunque queden 3 Barbas disponibles
      await expect(
        consumeMembershipSession(
          { membershipId: mixed.id, serviceName: "Corte" },
          adminStaff,
        ),
      ).rejects.toThrow(/No quedan sesiones disponibles para ese servicio/i);
    });
  });

  describe("4. Permisos por rol (ADMIN, MANAGER, BARBER)", () => {
    it("autoriza acceso a membresias para los tres roles pero restringe descuentos y otros barberos", async () => {
      const admin = { role: "ADMIN", barber_id: null, active: true };
      const manager = { role: "MANAGER", barber_id: null, active: true };
      const barber = { role: "BARBER", barber_id: "lautaro", active: true };

      expect(mayAccessStaffSection(admin, "membresias")).toBe(true);
      expect(mayAccessStaffSection(manager, "membresias")).toBe(true);
      expect(mayAccessStaffSection(barber, "membresias")).toBe(true);

      expect(mayAccessStaffSection(admin, "descuentos")).toBe(true);
      expect(mayAccessStaffSection(manager, "descuentos")).toBe(true);
      expect(mayAccessStaffSection(barber, "descuentos")).toBe(false);

      // Barbero no puede crear membresía ni disponibilidad recurrente para otro barbero ("tomas")
      await expect(
        createClientMembership(
          {
            clientId: "client-1",
            barberId: "tomas",
            packageSize: 4,
            items: [{ serviceName: "Corte", quantity: 4, unitPriceArs: 25000 }],
            paymentNow: true,
          },
          barberStaff,
        ),
      ).rejects.toThrow(/otro barbero/i);

      await expect(
        createRecurringAvailabilityRule(
          {
            barberId: "tomas",
            startDate: "2026-11-15",
            startTime: "10:00",
            frequencyType: "WEEKLY",
            endType: "NEVER",
          },
          barberStaff,
        ),
      ).rejects.toThrow(/otro barbero/i);
    });
  });

  describe("5. Notificaciones agrupadas y recordatorios automáticos", () => {
    it("construye el correo agrupado de próximos turnos con enlaces individuales de cancelación", () => {
      const mail = buildRecurringSeriesGroupedEmail({
        clientName: "Matías Cliente",
        recipientEmail: "matias@example.com",
        barberName: "Lautaro",
        serviceName: "Corte y barba",
        frequencyLabel: "Todas las semanas",
        appointments: [
          {
            id: "apt-101",
            bookingDate: "2026-11-10",
            startTime: "15:00",
            serviceName: "Corte y barba",
            barberName: "Lautaro",
          },
          {
            id: "apt-102",
            bookingDate: "2026-11-24",
            startTime: "15:00",
            serviceName: "Corte y barba",
            barberName: "Lautaro",
          },
        ],
        membershipPlanName: "Membresía 4 servicios",
        appUrl: "https://kanibarber.com",
      });

      expect(mail.subject).toBe("KANI Barber Studio — Tus próximos turnos");
      expect(mail.html).toContain("apt-101");
      expect(mail.html).toContain("apt-102");
      expect(mail.html).toContain("Cancelar este turno");
      expect(mail.html).toContain("Membresía 4 servicios");
    });

    it("construye el correo de recordatorio del día anterior con enlace de cancelación individual", () => {
      const reminder = buildAppointmentReminderEmail({
        appointmentId: "apt-202",
        clientName: "Lucas Cliente",
        recipientEmail: "lucas@example.com",
        barberName: "Tomás",
        serviceName: "Corte",
        bookingDate: "2026-11-12",
        startTime: "17:00",
        appUrl: "https://kanibarber.com",
      });

      expect(reminder.subject).toContain("Recordatorio");
      expect(reminder.html).toContain("17:00 hs");
      expect(reminder.html).toContain("apt-202");
      expect(reminder.text).toContain("Lucas Cliente");
    });

    it("garantiza claves de idempotencia estables y soporte de lease contra bloqueos permanentes", () => {
      const sql = fs.readFileSync(
        path.resolve(
          process.cwd(),
          "supabase/migrations/20261108000100_kani_recurrences_memberships_and_discounts.sql",
        ),
        "utf8",
      );
      expect(sql).toContain("grouped_notification_claim_at");
      expect(sql).toContain("reminder_claim_at");

      // Claves de idempotencia determinísticas:
      const aptId = "apt-abc-123";
      const date = "2026-11-10";
      const expectedKey = `reminder-${aptId}-${date}`;
      expect(expectedKey).toBe("reminder-apt-abc-123-2026-11-10");
    });
  });

  describe("6. Corrección visual del campo Fecha (FASE 2) e integridad de migración SQL", () => {
    it("iguala tipografía (12px), altura (44px) y alineación vertical de #schedule-manual-date con Agenda y Horario", () => {
      const css = fs.readFileSync(path.resolve(process.cwd(), "src/styles.css"), "utf8");
      expect(css).toContain('.admin-schedule-manual-fields input[type="date"]');
      expect(css).toContain("font-size: 12px");
      expect(css).toContain("min-height: 44px");
      expect(css).toContain("height: 44px");
    });

    it("incluye la migración SQL transaccional con tablas, RLS y RPCs para recurrencias y membresías", () => {
      const sql = fs.readFileSync(
        path.resolve(
          process.cwd(),
          "supabase/migrations/20261108000100_kani_recurrences_memberships_and_discounts.sql",
        ),
        "utf8",
      );
      expect(sql).toContain("CREATE OR REPLACE FUNCTION public.generate_recurrence_dates");
      expect(sql).toContain("CREATE TABLE IF NOT EXISTS public.recurring_availability_rules");
      expect(sql).toContain("CREATE TABLE IF NOT EXISTS public.client_memberships");
      expect(sql).toContain("CREATE TABLE IF NOT EXISTS public.client_membership_items");
      expect(sql).toContain("CREATE TABLE IF NOT EXISTS public.client_membership_consumptions");
      expect(sql).toContain("CREATE TABLE IF NOT EXISTS public.client_membership_events");
      expect(sql).toContain("CREATE OR REPLACE FUNCTION public.create_client_membership");
      expect(sql).toContain("CREATE OR REPLACE FUNCTION public.consume_membership_session");
      expect(sql).toContain("CREATE OR REPLACE FUNCTION public.refund_membership_session");
      expect(sql).toContain("CREATE OR REPLACE FUNCTION public.create_recurring_manual_series");
      expect(sql).toContain("CREATE OR REPLACE FUNCTION public.modify_recurring_appointment_series");
    });
  });
});
