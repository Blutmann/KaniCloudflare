import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createHmac } from "node:crypto";
import {
  dispatchAppointmentNotification,
  retryNotificationChannel,
  fetchAppointmentNotificationDispatches,
} from "../lib/kani-notifications.functions";
import {
  handlePontiunWebhookRequest,
  verifyPontiunWebhookSignature,
  clearProcessedWebhookEventsForTest,
} from "../lib/kani-pontiun";

const {
  mockClaim,
  mockComplete,
  mockFail,
  mockRecordError,
  mockRecordChannelDispatchStatus,
  mockUpdatePontiunWebhookStatus,
  mockSelectFromDispatches,
  mockSelectFromAppointments,
} = vi.hoisted(() => ({
  mockClaim: vi.fn(),
  mockComplete: vi.fn(),
  mockFail: vi.fn(),
  mockRecordError: vi.fn(),
  mockRecordChannelDispatchStatus: vi.fn(),
  mockUpdatePontiunWebhookStatus: vi.fn(),
  mockSelectFromDispatches: vi.fn(),
  mockSelectFromAppointments: vi.fn(),
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    rpc: (fn: string, params: any) => {
      if (fn === "claim_appointment_notification") return mockClaim(params);
      if (fn === "complete_appointment_notification") return mockComplete(params);
      if (fn === "fail_appointment_notification") return mockFail(params);
      if (fn === "record_appointment_notification_dispatch_error") return mockRecordError(params);
      if (fn === "record_channel_dispatch_status") return mockRecordChannelDispatchStatus(params);
      if (fn === "update_pontiun_webhook_message_status") return mockUpdatePontiunWebhookStatus(params);
      return Promise.resolve({ data: null, error: null });
    },
    from: (table: string) => {
      if (table === "appointment_notification_dispatches") {
        return {
          select: (cols: string) => ({
            in: (field: string, values: string[]) => mockSelectFromDispatches({ field, values }),
            eq: (field1: string, val1: any) => ({
              eq: (field2: string, val2: any) => ({
                maybeSingle: () => mockSelectFromDispatches({ field1, val1, field2, val2 }),
              }),
            }),
          }),
        };
      }
      if (table === "appointments") {
        return {
          select: (cols: string) => ({
            eq: (field: string, val: any) => ({
              maybeSingle: () => mockSelectFromAppointments({ field, val }),
            }),
          }),
        };
      }
      return {
        select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }),
      };
    },
  }),
}));

describe("Consolidación integral de notificaciones — Canales independientes y estados", () => {
  const baseAppointmentId = "1978f38b-3459-46a3-b3d8-08ea9ae472f4";
  const baseClaimToken = "claim-token-xyz-12345";
  const baseNotificationId = "58bd907b-3172-4c48-abd8-fb23bd6fc264";

  beforeEach(() => {
    vi.restoreAllMocks();
    clearProcessedWebhookEventsForTest();

    process.env.SUPABASE_URL = "https://iockpxtkflyjfagkvgnr.supabase.co";
    process.env.SUPABASE_ANON_KEY = "test-anon-key";
    process.env.RESEND_API_KEY = "re_test_key";
    process.env.RESEND_FROM_EMAIL = "Kani Barber <turnos@kanibarber.com>";
    process.env.PONTIUN_API_KEY = "pk_live_test";
    process.env.PONTIUN_PHONE_NUMBER_ID = "1391432264052937";
    process.env.PONTIUN_TEMPLATE_NAME = "confirmacion_turno_kani";
    process.env.PONTIUN_TEMPLATE_LANGUAGE = "es_AR";
    process.env.PONTIUN_WEBHOOK_SECRET = "whsec_test_secret_1234567890";

    mockClaim.mockReset();
    mockComplete.mockReset().mockResolvedValue({ data: true, error: null });
    mockFail.mockReset().mockResolvedValue({ data: true, error: null });
    mockRecordChannelDispatchStatus.mockReset().mockResolvedValue({ data: "dispatch-id-1", error: null });
    mockUpdatePontiunWebhookStatus.mockReset().mockResolvedValue({ data: true, error: null });
    mockSelectFromDispatches.mockReset().mockResolvedValue({ data: [], error: null });
    mockSelectFromAppointments.mockReset().mockResolvedValue({ data: null, error: null });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const baseEvent = {
    notification_id: baseNotificationId,
    notification_type: "CONFIRMED",
    recipient_email: "tomas.harispe@hotmail.com",
    recipient_phone: "+5491128436014",
    client_name: "Tomas Harispe",
    barber_name: "Lautaro",
    service_name: "Corte",
    booking_date: "2026-10-30",
    start_time: "18:15:00",
    end_time: "19:00:00",
    dispatch_status: "READY",
    attempts: 1,
  };

  it("1. WhatsApp HTTP 200 de Pontiun se registra como PROVIDER_ACCEPTED (NUNCA DELIVERED)", async () => {
    mockClaim.mockResolvedValue({ data: [baseEvent], error: null });

    globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("pontiun.com")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ resender: { messageId: "25e5acb1-1950-48d6-a1fb-b0c3c29eead7", status: "sent" } }),
        };
      }
      if (url.includes("resend.com")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ id: "01a18ef8-9c36-7d33-89f4-135380744136" }),
        };
      }
      return { ok: false, status: 404 };
    }) as any;

    const result = await dispatchAppointmentNotification({
      appointmentId: baseAppointmentId,
      claimToken: baseClaimToken,
    });

    expect(result.sent).toBe(true);

    // Verificamos que se haya invocado record_channel_dispatch_status para WHATSAPP con PROVIDER_ACCEPTED
    expect(mockRecordChannelDispatchStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        p_channel: "WHATSAPP",
        p_provider: "PONTIUN",
        p_status: "PROVIDER_ACCEPTED",
        p_provider_message_id: "25e5acb1-1950-48d6-a1fb-b0c3c29eead7",
        p_increment_attempt: true,
      }),
    );

    // Verificamos que EMAIL se registró como SENT
    expect(mockRecordChannelDispatchStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        p_channel: "EMAIL",
        p_provider: "RESEND",
        p_status: "SENT",
        p_provider_message_id: "01a18ef8-9c36-7d33-89f4-135380744136",
        p_increment_attempt: true,
      }),
    );
  });

  it("2. Webhook de Pontiun con status 'delivered' actualiza el mensaje a DELIVERED", async () => {
    const rawPayload = JSON.stringify({
      type: "message.status",
      id: "evt_delivered_001",
      message: {
        id: "25e5acb1-1950-48d6-a1fb-b0c3c29eead7",
        status: "delivered",
      },
    });

    const eventId = "evt_0123456789abcdef0123456789abcdef";
    const timestamp = String(Math.floor(Date.now() / 1000));
    const hmac = createHmac("sha256", process.env.PONTIUN_WEBHOOK_SECRET!)
      .update(`${eventId}.${timestamp}.${rawPayload}`)
      .digest("hex");

    const req = new Request("https://kanibarberstudio.workers.dev/api/webhook/pontiun", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "resender-event-id": eventId,
        "resender-timestamp": timestamp,
        "resender-signature": `v1=${hmac}`,
      },
      body: rawPayload,
    });

    const response = await handlePontiunWebhookRequest(req);
    expect(response.status).toBe(200);

    expect(mockUpdatePontiunWebhookStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        p_provider_message_id: "25e5acb1-1950-48d6-a1fb-b0c3c29eead7",
        p_status: "delivered",
      }),
    );
  });

  it("3. Webhook de Pontiun con error 131042 (Meta currency billing) registra FAILED y código 131042", async () => {
    const rawPayload = JSON.stringify({
      type: "message.status",
      message: {
        id: "25e5acb1-1950-48d6-a1fb-b0c3c29eead7",
        status: "failed",
        error: {
          code: 131042,
          message: "Business eligibility payment issue: Your WhatsApp Business account currency is not configured.",
        },
      },
    });

    const eventId = "evt_failed_131042_001";
    const timestamp = String(Math.floor(Date.now() / 1000));
    const hmac = createHmac("sha256", process.env.PONTIUN_WEBHOOK_SECRET!)
      .update(`${eventId}.${timestamp}.${rawPayload}`)
      .digest("hex");

    const req = new Request("https://kanibarberstudio.workers.dev/api/webhook/pontiun", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "resender-event-id": eventId,
        "resender-timestamp": timestamp,
        "resender-signature": `v1=${hmac}`,
      },
      body: rawPayload,
    });

    const response = await handlePontiunWebhookRequest(req);
    expect(response.status).toBe(200);

    expect(mockUpdatePontiunWebhookStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        p_provider_message_id: "25e5acb1-1950-48d6-a1fb-b0c3c29eead7",
        p_status: "failed",
        p_error_code: "131042",
        p_error_description: expect.stringContaining("Business eligibility payment issue"),
      }),
    );
  });

  it("4. retryNotificationChannel bloquea reintentos automáticos para error 131042 (ADMIN_CONFIGURATION_BLOCK)", async () => {
    // Simular que el despacho previo tenía error_code 131042
    mockSelectFromDispatches.mockResolvedValue({
      data: {
        id: "disp-1",
        appointment_id: baseAppointmentId,
        channel: "WHATSAPP",
        status: "FAILED",
        error_code: "131042",
        error_description: "Business eligibility payment issue",
      },
      error: null,
    });

    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as any;

    const retryResult = await retryNotificationChannel({
      appointmentId: baseAppointmentId,
      channel: "WHATSAPP",
    });

    expect(retryResult.success).toBe(false);
    expect(retryResult.blockedByAdminConfig).toBe(true);
    expect(retryResult.error).toContain("ADMIN_CONFIGURATION_BLOCK");
    expect(retryResult.error).toContain("131042");
    // Ningún fetch a proveedores
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("5. retryNotificationChannel solo reintenta el canal solicitado (WHATSAPP sin enviar Email)", async () => {
    mockSelectFromDispatches.mockResolvedValue({
      data: {
        id: "disp-1",
        appointment_id: baseAppointmentId,
        channel: "WHATSAPP",
        status: "FAILED",
        error_code: "PONTIUN_500",
        error_description: "Internal error",
      },
      error: null,
    });

    mockSelectFromAppointments.mockResolvedValue({
      data: {
        id: baseAppointmentId,
        booking_date: "2026-10-30",
        start_time: "18:15:00",
        client_id: "c-1",
        barber_id: "b-1",
        clients: { id: "c-1", name: "Tomas Harispe", phone: "+5491128436014", email: "tomas@example.com" },
        barbers: { id: "b-1", name: "Lautaro" },
        services: { id: "s-1", name: "Corte" },
      },
      error: null,
    });

    const fetchSpy = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("pontiun.com")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ resender: { messageId: "pontiun-retry-ok-123", status: "sent" } }),
        };
      }
      return { ok: false, status: 500 };
    });
    globalThis.fetch = fetchSpy as any;

    const retryResult = await retryNotificationChannel({
      appointmentId: baseAppointmentId,
      channel: "WHATSAPP",
    });

    expect(retryResult.success).toBe(true);
    expect(retryResult.status).toBe("PROVIDER_ACCEPTED");
    // Pontiun fue llamado
    expect(fetchSpy).toHaveBeenCalledWith(expect.stringContaining("pontiun.com"), expect.anything());
    // Resend NUNCA fue llamado
    expect(fetchSpy).not.toHaveBeenCalledWith(expect.stringContaining("resend.com"), expect.anything());
  });

  it("6. retryNotificationChannel solo reintenta EMAIL sin enviar WhatsApp", async () => {
    mockSelectFromDispatches.mockResolvedValue({
      data: {
        id: "disp-2",
        appointment_id: baseAppointmentId,
        channel: "EMAIL",
        status: "FAILED",
        error_code: "RESEND_500",
      },
      error: null,
    });

    mockSelectFromAppointments.mockResolvedValue({
      data: {
        id: baseAppointmentId,
        booking_date: "2026-10-30",
        start_time: "18:15:00",
        client_id: "c-1",
        barber_id: "b-1",
        clients: { id: "c-1", name: "Tomas Harispe", phone: "+5491128436014", email: "tomas@example.com" },
        barbers: { id: "b-1", name: "Lautaro" },
        services: { id: "s-1", name: "Corte" },
      },
      error: null,
    });

    const fetchSpy = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("resend.com")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ id: "resend-retry-email-id-456" }),
        };
      }
      return { ok: false, status: 500 };
    });
    globalThis.fetch = fetchSpy as any;

    const retryResult = await retryNotificationChannel({
      appointmentId: baseAppointmentId,
      channel: "EMAIL",
    });

    expect(retryResult.success).toBe(true);
    expect(retryResult.status).toBe("SENT");
    // Resend fue llamado
    expect(fetchSpy).toHaveBeenCalledWith(expect.stringContaining("resend.com"), expect.anything());
    // Pontiun NUNCA fue llamado
    expect(fetchSpy).not.toHaveBeenCalledWith(expect.stringContaining("pontiun.com"), expect.anything());
  });

  it("7. Webhook rechaza firmas inválidas y procesa deduplicación de eventos", async () => {
    const rawPayload = JSON.stringify({ type: "ping" });
    const eventId = "evt_dedup_001";
    const timestamp = String(Math.floor(Date.now() / 1000));

    // Request con firma incorrecta
    const badReq = new Request("https://kanibarberstudio.workers.dev/api/webhook/pontiun", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "resender-event-id": eventId,
        "resender-timestamp": timestamp,
        "resender-signature": "v1=0000000000000000000000000000000000000000000000000000000000000000",
      },
      body: rawPayload,
    });

    const badResp = await handlePontiunWebhookRequest(badReq);
    expect(badResp.status).toBe(401);

    // Request con firma válida
    const validHmac = createHmac("sha256", process.env.PONTIUN_WEBHOOK_SECRET!)
      .update(`${eventId}.${timestamp}.${rawPayload}`)
      .digest("hex");

    const validReq1 = new Request("https://kanibarberstudio.workers.dev/api/webhook/pontiun", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "resender-event-id": eventId,
        "resender-timestamp": timestamp,
        "resender-signature": `v1=${validHmac}`,
      },
      body: rawPayload,
    });

    const validResp1 = await handlePontiunWebhookRequest(validReq1);
    expect(validResp1.status).toBe(200);

    // Repetición del mismo evento -> retorno idempotente
    const validReq2 = new Request("https://kanibarberstudio.workers.dev/api/webhook/pontiun", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "resender-event-id": eventId,
        "resender-timestamp": timestamp,
        "resender-signature": `v1=${validHmac}`,
      },
      body: rawPayload,
    });

    const validResp2 = await handlePontiunWebhookRequest(validReq2);
    expect(validResp2.status).toBe(200);
    const body2 = await validResp2.json();
    expect(body2.idempotentReplay).toBe(true);
  });
});
