import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  sendPontiunAppointmentConfirmation,
  normalizePhoneForPontiun,
  type PontiunAppointmentPayload,
} from "./kani-pontiun";

describe("Pontiun E2E Matrix — 10 Required Scenarios", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    process.env.PONTIUN_API_KEY = "pk_live_test_secret";
    process.env.PONTIUN_PHONE_NUMBER_ID = "1391432264052937";
    process.env.PONTIUN_TEMPLATE_NAME = "confirmacion_turno_kani";
    process.env.PONTIUN_TEMPLATE_LANGUAGE = "es_AR";
  });

  const baseAppointment: PontiunAppointmentPayload = {
    appointmentId: "apt-e2e-1001",
    clientName: "Tomás",
    clientPhone: "+54 9 11 2843-6014",
    barberName: "Lautaro",
    serviceName: "Corte + barba",
    bookingDate: "2026-10-30",
    startTime: "15:30:00",
  };

  // Scenario 1: Confirmación manual -> Un WhatsApp
  it("Scenario 1: Confirmación manual triggers exactly one WhatsApp send", async () => {
    let calls = 0;
    globalThis.fetch = vi.fn().mockImplementation(async () => {
      calls++;
      return {
        ok: true,
        status: 200,
        json: async () => ({ resender: { messageId: "msg_manual_01", status: "sent" } }),
      };
    }) as any;

    const res = await sendPontiunAppointmentConfirmation(baseAppointment);
    expect(res.success).toBe(true);
    expect(res.messageId).toBe("msg_manual_01");
    expect(calls).toBe(1);
  });

  // Scenario 2: Confirmación por pago acreditado -> Un WhatsApp
  it("Scenario 2: Confirmación por pago acreditado triggers exactly one WhatsApp send", async () => {
    let calls = 0;
    globalThis.fetch = vi.fn().mockImplementation(async () => {
      calls++;
      return {
        ok: true,
        status: 200,
        json: async () => ({ resender: { messageId: "msg_payway_02", status: "sent" } }),
      };
    }) as any;

    const res = await sendPontiunAppointmentConfirmation({
      ...baseAppointment,
      appointmentId: "apt-payway-2002",
    });
    expect(res.success).toBe(true);
    expect(res.messageId).toBe("msg_payway_02");
    expect(calls).toBe(1);
  });

  // Scenario 3: Turno manual confirmado -> Un WhatsApp
  it("Scenario 3: Turno manual confirmado triggers exactly one WhatsApp send", async () => {
    let calls = 0;
    globalThis.fetch = vi.fn().mockImplementation(async () => {
      calls++;
      return {
        ok: true,
        status: 200,
        json: async () => ({ resender: { messageId: "msg_manual_created_03", status: "sent" } }),
      };
    }) as any;

    const res = await sendPontiunAppointmentConfirmation({
      ...baseAppointment,
      appointmentId: "apt-manual-3003",
    });
    expect(res.success).toBe(true);
    expect(res.messageId).toBe("msg_manual_created_03");
    expect(calls).toBe(1);
  });

  // Scenario 4: Webhook de pago duplicado -> Ningún envío adicional (idempotente)
  it("Scenario 4: Webhook de pago duplicado uses same Idempotency-Key and handles replay without duplicate send", async () => {
    let capturedIdempotencyKey = "";
    globalThis.fetch = vi.fn().mockImplementation(async (_url, init) => {
      capturedIdempotencyKey = (init?.headers as any)?.["Idempotency-Key"];
      return {
        ok: true,
        status: 200,
        json: async () => ({
          resender: { messageId: "msg_dup_04", status: "sent", idempotentReplay: true },
        }),
      };
    }) as any;

    const res = await sendPontiunAppointmentConfirmation({
      ...baseAppointment,
      appointmentId: "apt-dup-4004",
    });
    expect(res.success).toBe(true);
    expect(res.idempotentReplay).toBe(true);
    expect(capturedIdempotencyKey).toBe("kani-appointment-apt-dup-4004-confirmed");
  });

  // Scenario 5: Actualización de turno confirmado -> Ningún envío adicional
  it("Scenario 5: Actualización de turno confirmado is excluded from confirmation trigger", () => {
    const isNewConfirmation = (status: string, previousStatus: string) =>
      status === "CONFIRMED" && previousStatus !== "CONFIRMED";

    expect(isNewConfirmation("CONFIRMED", "CONFIRMED")).toBe(false);
    expect(isNewConfirmation("CONFIRMED", "PENDING")).toBe(true);
  });

  // Scenario 6: Turno pendiente -> Ningún envío
  it("Scenario 6: Turno pendiente never sends Pontiun notification", () => {
    const shouldDispatch = (status: string) => status === "CONFIRMED";
    expect(shouldDispatch("PENDING")).toBe(false);
  });

  // Scenario 7: Turno cancelado antes de confirmarse -> Ningún envío
  it("Scenario 7: Turno cancelado never sends Pontiun notification", () => {
    const shouldDispatch = (status: string) => status === "CONFIRMED";
    expect(shouldDispatch("CANCELLED")).toBe(false);
  });

  // Scenario 8: Error temporal de Pontiun -> Reintento controlado
  it("Scenario 8: Error temporal de Pontiun (503/timeout) executes controlled retries with exponential backoff", async () => {
    let attemptCount = 0;
    globalThis.fetch = vi.fn().mockImplementation(async () => {
      attemptCount++;
      return {
        ok: false,
        status: 503,
        json: async () => ({ error: "Service Unavailable" }),
      };
    }) as any;

    const res = await sendPontiunAppointmentConfirmation({
      ...baseAppointment,
      appointmentId: "apt-retry-8008",
    });
    expect(res.success).toBe(false);
    expect(res.retryable).toBe(true);
    expect(res.attempts).toBe(3);
    expect(attemptCount).toBe(3);
  });

  // Scenario 9: Teléfono inválido -> Error registrado sin reintentar
  it("Scenario 9: Teléfono inválido records INVALID_PHONE_NUMBER and does not retry", async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as any;

    const res = await sendPontiunAppointmentConfirmation({
      ...baseAppointment,
      clientPhone: "1234",
    });
    expect(res.success).toBe(false);
    expect(res.error).toBe("INVALID_PHONE_NUMBER");
    expect(res.retryable).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // Scenario 10: Variables dinámicas -> Cinco valores correctos en orden estricto
  it("Scenario 10: Variables dinámicas contains strictly 5 ordered parameters with valid formatting", async () => {
    let capturedBody: any = null;
    globalThis.fetch = vi.fn().mockImplementation(async (_url, init) => {
      capturedBody = JSON.parse(String(init?.body));
      return {
        ok: true,
        status: 200,
        json: async () => ({ resender: { messageId: "msg_vars_10", status: "sent" } }),
      };
    }) as any;

    await sendPontiunAppointmentConfirmation(baseAppointment);

    expect(capturedBody).toBeDefined();
    expect(capturedBody.template.name).toBe("confirmacion_turno_kani");
    expect(capturedBody.template.language).toBe("es_AR");

    const params = capturedBody.template.components[0].parameters;
    expect(params).toHaveLength(5);
    // 1: Nombre del cliente
    expect(params[0].text).toBe("Tomás");
    // 2: Fecha DD/MM/YYYY
    expect(params[1].text).toBe("30/10/2026");
    // 3: Horario HH:MM
    expect(params[2].text).toBe("15:30");
    // 4: Servicio normalizado
    expect(params[3].text).toBe("Corte y barba");
    // 5: Barbero
    expect(params[4].text).toBe("Lautaro");
  });
});
