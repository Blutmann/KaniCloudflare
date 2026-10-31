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
  mockSelectFromStaffProfiles,
  mockGetUser,
} = vi.hoisted(() => ({
  mockClaim: vi.fn(),
  mockComplete: vi.fn(),
  mockFail: vi.fn(),
  mockRecordError: vi.fn(),
  mockRecordChannelDispatchStatus: vi.fn(),
  mockUpdatePontiunWebhookStatus: vi.fn(),
  mockSelectFromDispatches: vi.fn(),
  mockSelectFromAppointments: vi.fn(),
  mockSelectFromStaffProfiles: vi.fn(),
  mockGetUser: vi.fn(),
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    auth: {
      getUser: () => mockGetUser(),
    },
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
      if (table === "staff_profiles") {
        return {
          select: (cols: string) => ({
            eq: (field: string, val: any) => ({
              maybeSingle: () => mockSelectFromStaffProfiles({ field, val }),
            }),
          }),
        };
      }
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

describe("Consolidación integral de notificaciones — Seguridad, RLS y Autorización", () => {
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
    mockSelectFromStaffProfiles.mockReset().mockResolvedValue({
      data: { role: "ADMIN", barber_id: null, active: true },
      error: null,
    });
    mockGetUser.mockReset().mockResolvedValue({
      data: { user: { id: "admin-user-uuid", email: "admin@kanibarber.com" } },
      error: null,
    });
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

  it("1. Webhook rechaza solicitudes si PONTIUN_WEBHOOK_SECRET no está configurado (sin modo permisivo)", async () => {
    delete process.env.PONTIUN_WEBHOOK_SECRET;

    const req = new Request("https://kanibarberstudio.workers.dev/api/webhook/pontiun", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "ping" }),
    });

    const resp = await handlePontiunWebhookRequest(req);
    expect(resp.status).toBe(500);
    const body = await resp.json();
    expect(body.code).toBe("WEBHOOK_SECRET_MISSING");
    expect(mockUpdatePontiunWebhookStatus).not.toHaveBeenCalled();
  });

  it("2. Webhook rechaza solicitudes con firma inválida (401 Unauthorized)", async () => {
    const rawPayload = JSON.stringify({ type: "message.status", status: "delivered" });
    const req = new Request("https://kanibarberstudio.workers.dev/api/webhook/pontiun", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "resender-event-id": "evt_bad_sig_123",
        "resender-timestamp": String(Math.floor(Date.now() / 1000)),
        "resender-signature": "v1=badbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbad",
      },
      body: rawPayload,
    });

    const resp = await handlePontiunWebhookRequest(req);
    expect(resp.status).toBe(401);
    expect(mockUpdatePontiunWebhookStatus).not.toHaveBeenCalled();
  });

  it("3. Webhook con firma válida actualiza estado asociando Pontiun ID y Meta wamid", async () => {
    const rawPayload = JSON.stringify({
      type: "message.status",
      message: {
        id: "25e5acb1-1950-48d6-a1fb-b0c3c29eead7",
        status: "delivered",
      },
      meta: {
        id: "wamid.HBgLMTEyODQzNjAxNBUC",
      },
    });

    const eventId = "evt_delivered_ok_001";
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

    const resp = await handlePontiunWebhookRequest(req);
    expect(resp.status).toBe(200);

    expect(mockUpdatePontiunWebhookStatus).toHaveBeenCalledWith({
      p_provider_message_id: "25e5acb1-1950-48d6-a1fb-b0c3c29eead7",
      p_meta_message_id: "wamid.HBgLMTEyODQzNjAxNBUC",
      p_status: "delivered",
      p_error_code: null,
      p_error_description: null,
    });
  });

  it("4. Reintentos: rechaza reintentos si el usuario no es staff activo (ACCESS_DENIED)", async () => {
    mockSelectFromStaffProfiles.mockResolvedValue({
      data: { role: "CLIENT", barber_id: null, active: false },
      error: null,
    });

    const result = await retryNotificationChannel({
      appointmentId: baseAppointmentId,
      channel: "WHATSAPP",
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("ACCESS_DENIED");
  });

  it("5. Reintentos: un barbero NO puede reintentar turnos de otro barbero (ACCESS_DENIED)", async () => {
    mockSelectFromStaffProfiles.mockResolvedValue({
      data: { role: "BARBER", barber_id: "barber-lautaro-uuid", active: true },
      error: null,
    });

    mockSelectFromDispatches.mockResolvedValue({
      data: {
        id: "disp-1",
        appointment_id: baseAppointmentId,
        channel: "WHATSAPP",
        status: "FAILED",
        error_code: "PONTIUN_500",
      },
      error: null,
    });

    mockSelectFromAppointments.mockResolvedValue({
      data: {
        id: baseAppointmentId,
        barber_id: "different-barber-uuid", // Turno de otro barbero!
        booking_date: "2026-10-30",
        start_time: "18:15:00",
        client_id: "c-1",
        clients: { id: "c-1", name: "Tomas", phone: "+5491128436014" },
        barbers: { id: "different-barber-uuid", name: "Agustin" },
        services: { id: "s-1", name: "Corte" },
      },
      error: null,
    });

    const result = await retryNotificationChannel({
      appointmentId: baseAppointmentId,
      channel: "WHATSAPP",
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("ACCESS_DENIED: Solo puede reintentar notificaciones de sus propios turnos asignados");
  });

  it("6. Reintentos: no permite reintentar si el mensaje ya fue entregado o leído (RETRY_NOT_ALLOWED)", async () => {
    mockSelectFromDispatches.mockResolvedValue({
      data: {
        id: "disp-1",
        appointment_id: baseAppointmentId,
        channel: "WHATSAPP",
        status: "DELIVERED",
      },
      error: null,
    });

    const result = await retryNotificationChannel({
      appointmentId: baseAppointmentId,
      channel: "WHATSAPP",
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("RETRY_NOT_ALLOWED: La notificación ya fue entregada");
  });

  it("7. Reintentos: no permite reintentar si hay una operación en curso (PROCESSING)", async () => {
    mockSelectFromDispatches.mockResolvedValue({
      data: {
        id: "disp-1",
        appointment_id: baseAppointmentId,
        channel: "WHATSAPP",
        status: "PROCESSING",
      },
      error: null,
    });

    const result = await retryNotificationChannel({
      appointmentId: baseAppointmentId,
      channel: "WHATSAPP",
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("RETRY_NOT_ALLOWED: Existe una operación de notificación en curso");
  });

  it("8. Reintentos: no permite reintentar si ya fue aceptado o enviado por el proveedor (riesgo de duplicación)", async () => {
    mockSelectFromDispatches.mockResolvedValue({
      data: {
        id: "disp-1",
        appointment_id: baseAppointmentId,
        channel: "WHATSAPP",
        status: "PROVIDER_ACCEPTED",
      },
      error: null,
    });

    const result = await retryNotificationChannel({
      appointmentId: baseAppointmentId,
      channel: "WHATSAPP",
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("RETRY_NOT_ALLOWED: La notificación ya fue aceptada por el proveedor");
  });

  it("9. Reintentos: bloquea estrictamente reintentos con error 131042 (Meta currency billing)", async () => {
    mockSelectFromDispatches.mockResolvedValue({
      data: {
        id: "disp-1",
        appointment_id: baseAppointmentId,
        channel: "WHATSAPP",
        status: "FAILED",
        error_code: "131042",
      },
      error: null,
    });

    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as any;

    const result = await retryNotificationChannel({
      appointmentId: baseAppointmentId,
      channel: "WHATSAPP",
    });

    expect(result.success).toBe(false);
    expect(result.blockedByAdminConfig).toBe(true);
    expect(result.error).toContain("ADMIN_CONFIGURATION_BLOCK");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("10. Reintentos: reintentar WhatsApp marca PROCESSING, llama únicamente a Pontiun y NO a Resend", async () => {
    mockSelectFromDispatches.mockResolvedValue({
      data: {
        id: "disp-1",
        appointment_id: baseAppointmentId,
        channel: "WHATSAPP",
        status: "FAILED",
        error_code: "PONTIUN_500",
      },
      error: null,
    });

    mockSelectFromAppointments.mockResolvedValue({
      data: {
        id: baseAppointmentId,
        barber_id: "b-1",
        booking_date: "2026-10-30",
        start_time: "18:15:00",
        client_id: "c-1",
        clients: { id: "c-1", name: "Tomas", phone: "+5491128436014", email: "tomas@example.com" },
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
          json: async () => ({ resender: { messageId: "pontiun-new-id-777", status: "sent" } }),
        };
      }
      return { ok: false, status: 500 };
    });
    globalThis.fetch = fetchSpy as any;

    const result = await retryNotificationChannel({
      appointmentId: baseAppointmentId,
      channel: "WHATSAPP",
    });

    expect(result.success).toBe(true);
    expect(result.status).toBe("PROVIDER_ACCEPTED");

    // Verificamos que se haya marcado PROCESSING antes del envío
    expect(mockRecordChannelDispatchStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        p_channel: "WHATSAPP",
        p_status: "PROCESSING",
      }),
    );

    // Verificamos que Pontiun fue invocado y Resend NUNCA fue invocado
    expect(fetchSpy).toHaveBeenCalledWith(expect.stringContaining("pontiun.com"), expect.anything());
    expect(fetchSpy).not.toHaveBeenCalledWith(expect.stringContaining("resend.com"), expect.anything());
  });

  it("11. Reintentos: reintentar Email marca PROCESSING, llama únicamente a Resend y NO a Pontiun", async () => {
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
        barber_id: "b-1",
        booking_date: "2026-10-30",
        start_time: "18:15:00",
        client_id: "c-1",
        clients: { id: "c-1", name: "Tomas", phone: "+5491128436014", email: "tomas@example.com" },
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
          json: async () => ({ id: "resend-new-id-888" }),
        };
      }
      return { ok: false, status: 500 };
    });
    globalThis.fetch = fetchSpy as any;

    const result = await retryNotificationChannel({
      appointmentId: baseAppointmentId,
      channel: "EMAIL",
    });

    expect(result.success).toBe(true);
    expect(result.status).toBe("SENT");

    // Verificamos que se haya marcado PROCESSING antes del envío
    expect(mockRecordChannelDispatchStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        p_channel: "EMAIL",
        p_status: "PROCESSING",
      }),
    );

    // Verificamos que Resend fue invocado y Pontiun NUNCA fue invocado
    expect(fetchSpy).toHaveBeenCalledWith(expect.stringContaining("resend.com"), expect.anything());
    expect(fetchSpy).not.toHaveBeenCalledWith(expect.stringContaining("pontiun.com"), expect.anything());
  });
});
