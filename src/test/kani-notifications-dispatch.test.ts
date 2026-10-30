import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { mockClaim, mockComplete, mockFail, mockRecordError } = vi.hoisted(() => ({
  mockClaim: vi.fn(),
  mockComplete: vi.fn(),
  mockFail: vi.fn(),
  mockRecordError: vi.fn(),
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    rpc: (fn: string, params: any) => {
      if (fn === "claim_appointment_notification") return mockClaim(params);
      if (fn === "complete_appointment_notification") return mockComplete(params);
      if (fn === "fail_appointment_notification") return mockFail(params);
      if (fn === "record_appointment_notification_dispatch_error") return mockRecordError(params);
      return Promise.resolve({ data: null, error: null });
    },
  }),
}));

import { dispatchAppointmentNotification } from "../lib/kani-notifications.functions";

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
    process.env.PONTIUN_PHONE_NUMBER_ID = "1391432264052937";

    mockClaim.mockReset();
    mockComplete.mockReset().mockResolvedValue({ data: true, error: null });
    mockFail.mockReset().mockResolvedValue({ data: true, error: null });
    mockRecordError.mockReset().mockResolvedValue({ data: true, error: null });
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

  it("Full Success: Both Pontiun and Resend succeed -> marks SENT and records both provider message IDs", async () => {
    mockClaim.mockResolvedValue({ data: [baseEvent], error: null });

    globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("pontiun.com")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ resender: { messageId: "msg_pontiun_999", status: "sent" } }),
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
      clientPhone: "+5491128436014",
    });

    expect(result.sent).toBe(true);
    expect(result.status).toBe("SENT");
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
      clientPhone: "+5491128436014",
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
      clientPhone: "+5491128436014",
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
      clientPhone: "+5491128436014",
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
});
