import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const {
  mockClaim,
  mockComplete,
  mockFail,
  mockRecordError,
  mockRecordChannelDispatchStatus,
  mockFromEvents,
  mockFromAppointments,
  mockFromDispatches,
  mockFromClients,
  mockCreateClient,
} = vi.hoisted(() => ({
  mockClaim: vi.fn(),
  mockComplete: vi.fn(),
  mockFail: vi.fn(),
  mockRecordError: vi.fn(),
  mockRecordChannelDispatchStatus: vi.fn(),
  mockFromEvents: vi.fn(),
  mockFromAppointments: vi.fn(),
  mockFromDispatches: vi.fn(),
  mockFromClients: vi.fn(),
  mockCreateClient: vi.fn(),
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: (...args: any[]) => {
    mockCreateClient(...args);
    return {
    rpc: (fn: string, params: any) => {
      if (fn === "claim_appointment_notification") return mockClaim(params);
      if (fn === "complete_appointment_notification") return mockComplete(params);
      if (fn === "fail_appointment_notification") return mockFail(params);
      if (fn === "record_appointment_notification_dispatch_error") return mockRecordError(params);
      if (fn === "record_channel_dispatch_status") return mockRecordChannelDispatchStatus(params);
      return Promise.resolve({ data: null, error: null });
    },
    from: (table: string) => {
      if (table === "appointment_notification_events") {
        return {
          select: () => ({
            in: () => ({
              lt: () => ({
                gte: () => ({
                  order: () => ({
                    limit: (lim: number) => mockFromEvents(lim),
                  }),
                }),
              }),
            }),
          }),
        };
      }
      if (table === "appointments") {
        return {
          select: () => ({
            eq: (_col: string, id: string) => ({
              maybeSingle: () => mockFromAppointments(id),
            }),
          }),
        };
      }
      if (table === "appointment_notification_dispatches") {
        return {
          select: () => ({
            eq: (_col: string, eventId: string) => mockFromDispatches(eventId),
          }),
        };
      }
      if (table === "clients") {
        return {
          select: () => ({
            eq: (_col: string, clientId: string) => ({
              maybeSingle: () => mockFromClients(clientId),
            }),
          }),
        };
      }
      return {
        select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }),
      };
    },
  };
  },
}));

import {
  dispatchAppointmentNotification,
  recoverPendingNotificationEvents,
} from "../lib/kani-notifications.functions";

describe("dispatchAppointmentNotification Matrix", () => {
  const baseAppointmentId = "28aced18-7987-4dc0-9dda-2ea352149575";
  const baseClaimToken = "valid-claim-token-1234567890abcdef";

  beforeEach(() => {
    vi.restoreAllMocks();

    process.env.SUPABASE_URL = "https://iockpxtkflyjfagkvgnr.supabase.co";
    process.env.SUPABASE_ANON_KEY = "test-anon-key";
    process.env.RESEND_API_KEY = "re_test_key";
    process.env.RESEND_FROM_EMAIL = "Kani Barber <turnos@kanibarber.com>";
    process.env.PONTIUN_API_KEY = "pk_live_test";
    process.env.PONTIUN_PHONE_NUMBER_ID = "1443960902134586";
    process.env.PONTIUN_TEMPLATE_NAME = "kani_barber_confirmacion_turno";
    process.env.PONTIUN_TEMPLATE_LANGUAGE = "es_AR";

    mockClaim.mockReset();
    mockComplete.mockReset().mockResolvedValue({ data: true, error: null });
    mockFail.mockReset().mockResolvedValue({ data: true, error: null });
    mockRecordError.mockReset().mockResolvedValue({ data: true, error: null });
    mockRecordChannelDispatchStatus.mockReset().mockResolvedValue({ data: true, error: null });
    mockFromEvents.mockReset().mockResolvedValue({ data: [], error: null });
    mockFromAppointments.mockReset().mockResolvedValue({ data: null, error: null });
    mockFromDispatches.mockReset().mockResolvedValue({ data: [], error: null });
    mockFromClients.mockReset().mockResolvedValue({ data: null, error: null });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const baseEvent = {
    notification_id: "1b6004f8-f6c8-4e2f-a136-b49fe692f4ee",
    notification_type: "CONFIRMED",
    recipient_email: "tomas.harispe@hotmail.com",
    recipient_phone: "+5491128436014",
    client_name: "Payway Pontiun 1",
    barber_name: "Lautaro",
    service_name: "Corte",
    booking_date: "2026-10-30",
    start_time: "18:15:00",
    end_time: "19:00:00",
    dispatch_status: "READY",
    attempts: 1,
  };

  it("Full Success: RPC returns recipient_phone (no clientPhone passed in input) -> passes phone to Pontiun with template kani_barber_confirmacion_turno and language es_AR, marks SENT with both provider IDs", async () => {
    mockClaim.mockResolvedValue({ data: [baseEvent], error: null });

    let capturedPontiunBody: any = null;
    let capturedResendHeaders: any = null;
    let capturedPontiunHeaders: any = null;

    globalThis.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.includes("pontiun.com")) {
        capturedPontiunBody = JSON.parse(String(init?.body));
        capturedPontiunHeaders = init?.headers;
        return {
          ok: true,
          status: 200,
          json: async () => ({ resender: { messageId: "msg_pontiun_999", status: "sent" } }),
        };
      }
      if (url.includes("resend.com")) {
        capturedResendHeaders = init?.headers;
        return {
          ok: true,
          status: 200,
          json: async () => ({ id: "01a18e75-13fa-7b72-95e3-4bc7856cc87b" }),
        };
      }
      return { ok: false, status: 404 };
    }) as any;

    // Notice: data.clientPhone is omitted! It MUST come from event.recipient_phone returned by the RPC.
    const result = await dispatchAppointmentNotification({
      appointmentId: baseAppointmentId,
      claimToken: baseClaimToken,
    });

    expect(result.sent).toBe(true);
    expect(result.status).toBe("SENT");

    // Verify Pontiun contract: template name and language
    expect(capturedPontiunBody).toBeDefined();
    expect(capturedPontiunBody.pageId).toBe("1443960902134586");
    expect(capturedPontiunBody.recipientId).toBe("5491128436014");
    expect(capturedPontiunBody.template.name).toBe("kani_barber_confirmacion_turno");
    expect(capturedPontiunBody.template.language).toBe("es_AR");

    // Verify idempotency keys per channel
    expect(capturedPontiunHeaders["Idempotency-Key"]).toBe(`kani-appointment-${baseAppointmentId}-confirmed`);
    expect(capturedResendHeaders["Idempotency-Key"]).toBe(baseEvent.notification_id);

    expect(mockComplete).toHaveBeenCalledWith({
      p_notification_id: baseEvent.notification_id,
      p_claim_token: baseClaimToken,
      p_provider_message_id: "pontiun:msg_pontiun_999|resend:01a18e75-13fa-7b72-95e3-4bc7856cc87b",
    });
    expect(mockFail).not.toHaveBeenCalled();
  });

  it("Partial Failure: Pontiun returns 404 template error, Resend succeeds -> marks FAILED with PARTIAL_DISPATCH_FAILURE, NOT SENT", async () => {
    mockClaim.mockResolvedValue({ data: [baseEvent], error: null });

    globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("pontiun.com")) {
        return {
          ok: false,
          status: 404,
          json: async () => ({
            error: "This template doesn't exist in the requested language or isn't approved yet.",
          }),
        };
      }
      if (url.includes("resend.com")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ id: "01a18e75-13fa-7b72-95e3-4bc7856cc87b" }),
        };
      }
      return { ok: false, status: 404 };
    }) as any;

    const result = await dispatchAppointmentNotification({
      appointmentId: baseAppointmentId,
      claimToken: baseClaimToken,
    });

    expect(result.sent).toBe(false);
    expect(result.status).toBe("FAILED");
    expect(mockComplete).not.toHaveBeenCalled();
    expect(mockFail).toHaveBeenCalledWith({
      p_notification_id: baseEvent.notification_id,
      p_claim_token: baseClaimToken,
      p_error: expect.stringContaining("PARTIAL_DISPATCH_FAILURE: WhatsApp falló (PONTIUN_404: This template doesn't exist"),
    });
    expect(mockFail).toHaveBeenCalledWith({
      p_notification_id: baseEvent.notification_id,
      p_claim_token: baseClaimToken,
      p_error: expect.stringContaining("Email enviado (resend:01a18e75-13fa-7b72-95e3-4bc7856cc87b)"),
    });
  });

  it("Partial Failure: Pontiun succeeds, Resend returns 401 error -> marks FAILED with PARTIAL_DISPATCH_FAILURE, NOT SENT", async () => {
    mockClaim.mockResolvedValue({ data: [baseEvent], error: null });

    globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("pontiun.com")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ resender: { messageId: "msg_pontiun_ok_123", status: "sent" } }),
        };
      }
      if (url.includes("resend.com")) {
        return {
          ok: false,
          status: 401,
          json: async () => ({ message: "API key is invalid" }),
        };
      }
      return { ok: false, status: 404 };
    }) as any;

    const result = await dispatchAppointmentNotification({
      appointmentId: baseAppointmentId,
      claimToken: baseClaimToken,
    });

    expect(result.sent).toBe(false);
    expect(result.status).toBe("FAILED");
    expect(mockComplete).not.toHaveBeenCalled();
    expect(mockFail).toHaveBeenCalledWith({
      p_notification_id: baseEvent.notification_id,
      p_claim_token: baseClaimToken,
      p_error: expect.stringContaining("PARTIAL_DISPATCH_FAILURE: WhatsApp enviado (pontiun:msg_pontiun_ok_123) | Email falló (RESEND_401: API key is invalid)"),
    });
  });

  it("Structural Failure: RPC fails to return recipient_phone property -> detects structural error and marks FAILED with PARTIAL_DISPATCH_FAILURE, NOT SENT even if Resend succeeds", async () => {
    // Event WITHOUT recipient_phone key (simulates old broken RPC)
    const eventWithoutPhoneKey = {
      notification_id: "1b6004f8-f6c8-4e2f-a136-b49fe692f4ee",
      notification_type: "CONFIRMED",
      recipient_email: "tomas.harispe@hotmail.com",
      client_name: "Payway Pontiun 1",
      barber_name: "Lautaro",
      service_name: "Corte",
      booking_date: "2026-10-30",
      start_time: "18:15:00",
      end_time: "19:00:00",
      dispatch_status: "READY",
      attempts: 1,
    };
    mockClaim.mockResolvedValue({ data: [eventWithoutPhoneKey], error: null });

    globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("resend.com")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ id: "01a18e75-13fa-7b72-95e3-4bc7856cc87b" }),
        };
      }
      return { ok: false, status: 404 };
    }) as any;

    const result = await dispatchAppointmentNotification({
      appointmentId: baseAppointmentId,
      claimToken: baseClaimToken,
      // No clientPhone provided
    });

    expect(result.sent).toBe(false);
    expect(result.status).toBe("FAILED");
    expect(mockComplete).not.toHaveBeenCalled();
    expect(mockFail).toHaveBeenCalledWith({
      p_notification_id: baseEvent.notification_id,
      p_claim_token: baseClaimToken,
      p_error: expect.stringContaining("RPC_STRUCTURAL_ERROR: la función claim_appointment_notification no devolvió la columna recipient_phone"),
    });
  });

  it("Valid Omission: Client has no registered phone (recipient_phone is explicitly null in RPC) -> omits WhatsApp validly and marks SENT when email succeeds", async () => {
    const eventWithNullPhone = {
      ...baseEvent,
      recipient_phone: null,
    };
    mockClaim.mockResolvedValue({ data: [eventWithNullPhone], error: null });

    const fetchSpy = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("resend.com")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ id: "01a18e75-13fa-7b72-95e3-4bc7856cc87b" }),
        };
      }
      return { ok: false, status: 404 };
    });
    globalThis.fetch = fetchSpy as any;

    const result = await dispatchAppointmentNotification({
      appointmentId: baseAppointmentId,
      claimToken: baseClaimToken,
    });

    expect(result.sent).toBe(true);
    expect(result.status).toBe("SENT");
    // Pontiun should never be called
    expect(fetchSpy).not.toHaveBeenCalledWith(expect.stringContaining("pontiun.com"), expect.anything());
    // Only resend message id recorded
    expect(mockComplete).toHaveBeenCalledWith({
      p_notification_id: baseEvent.notification_id,
      p_claim_token: baseClaimToken,
      p_provider_message_id: "resend:01a18e75-13fa-7b72-95e3-4bc7856cc87b",
    });
  });

  it("Full Failure: Both Pontiun and Resend fail -> marks FAILED with NOTIFICATION_DISPATCH_FAILED", async () => {
    mockClaim.mockResolvedValue({ data: [baseEvent], error: null });

    globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("pontiun.com")) {
        return {
          ok: false,
          status: 400,
          json: async () => ({ error: "Bad request payload" }),
        };
      }
      if (url.includes("resend.com")) {
        return {
          ok: false,
          status: 500,
          json: async () => ({ message: "Internal server error" }),
        };
      }
      return { ok: false, status: 500 };
    }) as any;

    const result = await dispatchAppointmentNotification({
      appointmentId: baseAppointmentId,
      claimToken: baseClaimToken,
    });

    expect(result.sent).toBe(false);
    expect(result.status).toBe("FAILED");
    expect(mockComplete).not.toHaveBeenCalled();
    expect(mockFail).toHaveBeenCalledWith({
      p_notification_id: baseEvent.notification_id,
      p_claim_token: baseClaimToken,
      p_error: expect.stringContaining("NOTIFICATION_DISPATCH_FAILED: WhatsApp: PONTIUN_400: Bad request payload | Email: RESEND_500: Internal server error"),
    });
  });

  it("Idempotent replay: Event already sent -> returns ALREADY_SENT without dispatching", async () => {
    mockClaim.mockResolvedValue({
      data: [{ ...baseEvent, dispatch_status: "ALREADY_SENT" }],
      error: null,
    });

    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as any;

    const result = await dispatchAppointmentNotification({
      appointmentId: baseAppointmentId,
      claimToken: baseClaimToken,
    });

    expect(result.sent).toBe(true);
    expect(result.status).toBe("ALREADY_SENT");
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(mockComplete).not.toHaveBeenCalled();
  });

  it("Template pending (409 template_not_approved): records TEMPLATE_NOT_APPROVED for WHATSAPP while Email dispatches independently", async () => {
    mockClaim.mockResolvedValue({
      data: [
        {
          event_id: "evt-pending-tpl-1",
          appointment_id: baseAppointmentId,
          notification_type: "CONFIRMED",
          recipient_email: "cliente@kanibarber.com",
          recipient_phone: "+5491128436014",
          client_name: "Mateo",
          booking_date: "2026-11-20",
          start_time: "16:00:00",
          service_name: "Corte + barba",
          barber_name: "Franco",
          dispatch_status: "CLAIMED",
          attempts: 1,
        },
      ],
      error: null,
    });

    const fetchSpy = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("pontiun.com")) {
        return {
          ok: false,
          status: 409,
          json: async () => ({
            code: "template_not_approved",
            templateStatus: "PENDING",
            error: "Template kani_barber_confirmacion_turno is pending",
          }),
        };
      }
      if (url.includes("resend.com")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ id: "resend_msg_indep_001" }),
        };
      }
      return { ok: false, status: 500 };
    });
    globalThis.fetch = fetchSpy as any;

    const result = await dispatchAppointmentNotification({
      appointmentId: baseAppointmentId,
      claimToken: baseClaimToken,
    });

    expect(result.sent).toBe(false);
    expect(result.status).toBe("FAILED");
    expect(result.errorCode).toContain("PARTIAL_DISPATCH_FAILURE");
    expect(mockRecordChannelDispatchStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        p_channel: "EMAIL",
        p_status: "SENT",
        p_provider_message_id: "resend_msg_indep_001",
      }),
    );
    expect(mockRecordChannelDispatchStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        p_channel: "WHATSAPP",
        p_status: "FAILED",
        p_error_code: "TEMPLATE_NOT_APPROVED",
      }),
    );
    expect(mockFail).toHaveBeenCalledTimes(1);
  });

  it("Cron recovery skips re-sending when WHATSAPP failed with TEMPLATE_NOT_APPROVED and EMAIL is already resolved", async () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test-key";

    mockFromEvents.mockResolvedValue({
      data: [
        {
          id: "evt-cron-skip-1",
          appointment_id: baseAppointmentId,
          notification_type: "CONFIRMED",
          status: "FAILED",
          attempts: 1,
          created_at: new Date().toISOString(),
        },
      ],
      error: null,
    });
    mockFromAppointments.mockResolvedValue({
      data: { id: baseAppointmentId, status: "CONFIRMED", client_id: "c-1" },
      error: null,
    });
    mockFromDispatches.mockResolvedValue({
      data: [
        { channel: "WHATSAPP", status: "FAILED", error_code: "TEMPLATE_NOT_APPROVED" },
        { channel: "EMAIL", status: "PROVIDER_ACCEPTED", error_code: null },
      ],
      error: null,
    });

    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as any;

    const recovery = await recoverPendingNotificationEvents({ limit: 10 });

    expect(recovery.processed).toBe(1);
    expect(recovery.skipped).toBe(1);
    expect(recovery.recovered).toBe(0);
    expect(recovery.failed).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(mockClaim).not.toHaveBeenCalled();
  });

  it("V12.47: createNotificationSupabaseClient utiliza SUPABASE_SERVICE_ROLE_KEY cuando está disponible (con fallback a request client) y envía enlaces a /reservar", async () => {
    mockCreateClient.mockClear();
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-v12-47";

    const { createNotificationSupabaseClient } = await import("../lib/kani-notifications.server");
    const { buildCancelledEmail } = await import("../lib/kani-notifications.functions");

    createNotificationSupabaseClient();
    expect(mockCreateClient).toHaveBeenCalledWith(
      "https://iockpxtkflyjfagkvgnr.supabase.co",
      "service-role-v12-47",
      expect.any(Object),
    );

    const cancelled = buildCancelledEmail({
      appointmentId: baseAppointmentId,
      barberId: "lautaro",
      barberName: "Lautaro",
      clientName: "Cliente Test",
      clientEmail: "cliente@test.com",
      clientPhone: "+5491155551234",
      serviceId: "corte",
      serviceName: "Corte",
      servicePriceArs: 20000,
      downPaymentArs: 0,
      bookingDate: "2026-11-20",
      startTime: "15:00:00",
      endTime: "15:45:00",
    });

    expect(cancelled.html).toContain("https://www.kanibarber.com/reservar");
    expect(cancelled.html).not.toContain("/reservar-turno");
    expect(cancelled.text).toContain("https://www.kanibarber.com/reservar");
    expect(cancelled.text).not.toContain("/reservar-turno");
  });
});
