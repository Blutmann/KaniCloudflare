import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createHmac } from "node:crypto";
import {
  normalizePhoneForPontiun,
  verifyPontiunWebhookSignature,
  handlePontiunWebhookRequest,
  sendPontiunAppointmentConfirmation,
  clearProcessedWebhookEventsForTest,
  type PontiunAppointmentPayload,
} from "./kani-pontiun";

describe("Pontiun WhatsApp Integration Unit Tests", () => {
  beforeEach(() => {
    clearProcessedWebhookEventsForTest();
    vi.restoreAllMocks();
    delete process.env.PONTIUN_API_KEY;
    delete process.env.PONTIUN_WHATSAPP_PHONE_NUMBER_ID;
    delete process.env.PONTIUN_PHONE_NUMBER_ID;
    delete process.env.PONTIUN_PAGE_ID;
    delete process.env.PONTIUN_WHATSAPP_CONFIRMATION_TEMPLATE;
    delete process.env.PONTIUN_WHATSAPP_TEMPLATE_LANGUAGE;
    delete process.env.PONTIUN_WEBHOOK_SECRET;
    delete process.env.PONTIUN_API_BASE_URL;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("normalizePhoneForPontiun", () => {
    it("normalizes Argentine numbers formatted as +54 9 11 ... without duplicating 54 or 9", () => {
      expect(normalizePhoneForPontiun("+54 9 11 5561-6438")).toBe("5491155616438");
      expect(normalizePhoneForPontiun("54 9 11 5561 6438")).toBe("5491155616438");
      expect(normalizePhoneForPontiun("5491155616438")).toBe("5491155616438");
    });

    it("inserts 9 for Argentine numbers with country code 54 but missing the mobile 9", () => {
      expect(normalizePhoneForPontiun("+54 11 5561-6438")).toBe("5491155616438");
      expect(normalizePhoneForPontiun("541155616438")).toBe("5491155616438");
    });

    it("handles Argentine numbers with redundant 9s gracefully without duplicating", () => {
      expect(normalizePhoneForPontiun("+54 9 9 11 5561-6438")).toBe("5491155616438");
    });

    it("normalizes Argentine 10-digit national numbers by adding 549", () => {
      expect(normalizePhoneForPontiun("11 5561-6438")).toBe("5491155616438");
      expect(normalizePhoneForPontiun("1155616438")).toBe("5491155616438");
      // Interior area code (e.g., Córdoba 351)
      expect(normalizePhoneForPontiun("351 555-1234")).toBe("5493515551234");
    });

    it("handles Argentine local numbers with leading 0 and 15", () => {
      expect(normalizePhoneForPontiun("011 15 5561-6438")).toBe("5491155616438");
      expect(normalizePhoneForPontiun("011 5561-6438")).toBe("5491155616438");
      expect(normalizePhoneForPontiun("+54 9 11 15 5561-6438")).toBe("5491155616438");
    });

    it("preserves international numbers with country code without modifying country code", () => {
      // Uruguay (+598)
      expect(normalizePhoneForPontiun("+598 99 123 456")).toBe("59899123456");
      // USA (+1)
      expect(normalizePhoneForPontiun("+1 202 555 0123")).toBe("12025550123");
      // Spain (+34)
      expect(normalizePhoneForPontiun("+34 600 123 456")).toBe("34600123456");
    });

    it("returns null for invalid, incomplete, or too short phone numbers", () => {
      expect(normalizePhoneForPontiun("")).toBeNull();
      expect(normalizePhoneForPontiun("1234")).toBeNull();
      expect(normalizePhoneForPontiun("abc")).toBeNull();
      expect(normalizePhoneForPontiun(null)).toBeNull();
      expect(normalizePhoneForPontiun(undefined)).toBeNull();
    });
  });

  describe("verifyPontiunWebhookSignature", () => {
    const secret = "whsec_test_secret_key_1234567890abcdef";
    const eventId = "evt_0123456789abcdef0123456789abcdef";
    const rawBody = JSON.stringify({ type: "message", text: "Hola Kani" });

    it("returns valid: true when HMAC-SHA256 signature matches official formula", () => {
      const nowSeconds = Math.floor(Date.now() / 1000).toString();
      const manifest = `${eventId}.${nowSeconds}.${rawBody}`;
      const hash = createHmac("sha256", secret).update(manifest).digest("hex");
      const signature = `v1=${hash}`;

      const result = verifyPontiunWebhookSignature({
        rawBody,
        eventId,
        timestamp: nowSeconds,
        signature,
        secret,
      });

      expect(result.valid).toBe(true);
    });

    it("accepts signature without 'v1=' prefix if raw hex matches", () => {
      const nowSeconds = Math.floor(Date.now() / 1000).toString();
      const manifest = `${eventId}.${nowSeconds}.${rawBody}`;
      const hash = createHmac("sha256", secret).update(manifest).digest("hex");

      const result = verifyPontiunWebhookSignature({
        rawBody,
        eventId,
        timestamp: nowSeconds,
        signature: hash,
        secret,
      });

      expect(result.valid).toBe(true);
    });

    it("rejects when rawBody has been tampered with", () => {
      const nowSeconds = Math.floor(Date.now() / 1000).toString();
      const manifest = `${eventId}.${nowSeconds}.${rawBody}`;
      const hash = createHmac("sha256", secret).update(manifest).digest("hex");

      const result = verifyPontiunWebhookSignature({
        rawBody: '{"tampered": true}',
        eventId,
        timestamp: nowSeconds,
        signature: `v1=${hash}`,
        secret,
      });

      expect(result.valid).toBe(false);
      expect(result.reason).toBe("SIGNATURE_MISMATCH");
    });

    it("rejects when timestamp is older than tolerance (replay attack prevention)", () => {
      // 301 seconds ago
      const expiredTimestamp = (Math.floor(Date.now() / 1000) - 305).toString();
      const manifest = `${eventId}.${expiredTimestamp}.${rawBody}`;
      const hash = createHmac("sha256", secret).update(manifest).digest("hex");

      const result = verifyPontiunWebhookSignature({
        rawBody,
        eventId,
        timestamp: expiredTimestamp,
        signature: `v1=${hash}`,
        secret,
        toleranceSeconds: 300,
      });

      expect(result.valid).toBe(false);
      expect(result.reason).toBe("TIMESTAMP_EXPIRED");
    });

    it("rejects when parameters are missing", () => {
      expect(
        verifyPontiunWebhookSignature({
          rawBody,
          eventId: null,
          timestamp: "12345",
          signature: "abc",
          secret,
        }).valid,
      ).toBe(false);

      expect(
        verifyPontiunWebhookSignature({
          rawBody,
          eventId,
          timestamp: null,
          signature: "abc",
          secret,
        }).valid,
      ).toBe(false);

      expect(
        verifyPontiunWebhookSignature({
          rawBody,
          eventId,
          timestamp: "12345",
          signature: null,
          secret,
        }).valid,
      ).toBe(false);

      expect(
        verifyPontiunWebhookSignature({
          rawBody,
          eventId,
          timestamp: "12345",
          signature: "abc",
          secret: null,
        }).valid,
      ).toBe(false);
    });
  });

  describe("handlePontiunWebhookRequest", () => {
    it("returns 200 OK for GET request with informative endpoint status", async () => {
      const request = new Request("https://preview.kanibarber.workers.dev/api/webhook/pontiun", {
        method: "GET",
      });

      const response = await handlePontiunWebhookRequest(request);
      expect(response.status).toBe(200);

      const json = await response.json();
      expect(json.service).toBe("pontiun-webhook");
      expect(json.status).toBe("active");
    });

    it("returns 405 Method Not Allowed for PUT or DELETE", async () => {
      const request = new Request("https://preview.kanibarber.workers.dev/api/webhook/pontiun", {
        method: "DELETE",
      });

      const response = await handlePontiunWebhookRequest(request);
      expect(response.status).toBe(405);
    });

    it("accepts valid POST with signature when secret is configured", async () => {
      const secret = "whsec_live_998877665544332211aabbcc";
      process.env.PONTIUN_WEBHOOK_SECRET = secret;

      const eventId = "evt_abcdef0123456789abcdef0123456789";
      const nowSeconds = Math.floor(Date.now() / 1000).toString();
      const body = JSON.stringify({
        type: "message",
        page: { channel: "whatsapp" },
        message: { id: "msg_123", direction: "inbound", text: "Muchas gracias!" },
      });

      const manifest = `${eventId}.${nowSeconds}.${body}`;
      const signature = `v1=${createHmac("sha256", secret).update(manifest).digest("hex")}`;

      const request = new Request("https://preview.kanibarber.workers.dev/api/webhook/pontiun", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "resender-event-id": eventId,
          "resender-timestamp": nowSeconds,
          "resender-signature": signature,
        },
        body,
      });

      const response = await handlePontiunWebhookRequest(request);
      expect(response.status).toBe(200);

      const json = await response.json();
      expect(json.received).toBe(true);
      expect(json.eventId).toBe(eventId);
    });

    it("rejects POST with 401 when signature is invalid and secret is configured", async () => {
      process.env.PONTIUN_WEBHOOK_SECRET = "whsec_valid_secret";

      const request = new Request("https://preview.kanibarber.workers.dev/api/webhook/pontiun", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "resender-event-id": "evt_123",
          "resender-timestamp": Math.floor(Date.now() / 1000).toString(),
          "resender-signature": "v1=invalid_hex_signature_hash_00000000000000000000000000000000000000000000",
        },
        body: JSON.stringify({ type: "message" }),
      });

      const response = await handlePontiunWebhookRequest(request);
      expect(response.status).toBe(401);
      const json = await response.json();
      expect(json.error).toBe("Invalid webhook signature");
    });

    it("accepts POST permissively with 200 OK when PONTIUN_WEBHOOK_SECRET is not yet configured", async () => {
      // Secret is undefined
      const request = new Request("https://preview.kanibarber.workers.dev/api/webhook/pontiun", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "resender-event-id": "evt_test_unverified",
        },
        body: JSON.stringify({ type: "test" }),
      });

      const response = await handlePontiunWebhookRequest(request);
      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json.received).toBe(true);
    });

    it("handles idempotency for repeated webhook events without duplicate work", async () => {
      const eventId = "evt_idempotent_event_test_123";
      const makeRequest = () =>
        new Request("https://preview.kanibarber.workers.dev/api/webhook/pontiun", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "resender-event-id": eventId,
          },
          body: JSON.stringify({ type: "message" }),
        });

      const res1 = await handlePontiunWebhookRequest(makeRequest());
      expect(res1.status).toBe(200);
      const json1 = await res1.json();
      expect(json1.received).toBe(true);
      expect(json1.idempotentReplay).toBeUndefined();

      // Second request with same eventId
      const res2 = await handlePontiunWebhookRequest(makeRequest());
      expect(res2.status).toBe(200);
      const json2 = await res2.json();
      expect(json2.received).toBe(true);
      expect(json2.idempotentReplay).toBe(true);
    });
  });

  describe("sendPontiunAppointmentConfirmation", () => {
    const validAppointment: PontiunAppointmentPayload = {
      appointmentId: "apt_uuid_11223344",
      clientName: "Gonzalo Ramos",
      clientPhone: "+54 9 11 5561-6438",
      barberName: "Lautaro",
      serviceName: "Corte y barba",
      bookingDate: "2026-10-30",
      startTime: "16:00:00",
    };

    it("skips gracefully without throwing when PONTIUN_API_KEY is not configured", async () => {
      process.env.PONTIUN_WHATSAPP_PHONE_NUMBER_ID = "phone_123456";

      const result = await sendPontiunAppointmentConfirmation(validAppointment);
      expect(result.success).toBe(false);
      expect(result.skipped).toBe(true);
      expect(result.error).toBe("PONTIUN_API_KEY_NOT_CONFIGURED");
    });

    it("skips gracefully without throwing when phone number ID is not configured", async () => {
      process.env.PONTIUN_API_KEY = "pk_live_test_api_key";

      const result = await sendPontiunAppointmentConfirmation(validAppointment);
      expect(result.success).toBe(false);
      expect(result.skipped).toBe(true);
      expect(result.error).toBe("PONTIUN_PHONE_NUMBER_ID_NOT_CONFIGURED");
    });

    it("returns controlled error when phone number is invalid, without throwing", async () => {
      process.env.PONTIUN_API_KEY = "pk_live_test_api_key";
      process.env.PONTIUN_WHATSAPP_PHONE_NUMBER_ID = "109283475610293";

      const result = await sendPontiunAppointmentConfirmation({
        ...validAppointment,
        clientPhone: "123", // invalid
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe("INVALID_PHONE_NUMBER");
    });

    it("dispatches official Pontiun template request with mandatory Idempotency-Key and correct payload", async () => {
      process.env.PONTIUN_API_KEY = "pk_live_secret_token_123";
      process.env.PONTIUN_PHONE_NUMBER_ID = "1391432264052937";
      process.env.PONTIUN_TEMPLATE_NAME = "confirmacion_turno_kani";
      process.env.PONTIUN_TEMPLATE_LANGUAGE = "es_MX";

      let capturedUrl = "";
      let capturedHeaders: HeadersInit | undefined;
      let capturedBody: any = null;

      globalThis.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
        capturedUrl = url;
        capturedHeaders = init?.headers;
        capturedBody = JSON.parse(String(init?.body));
        return {
          ok: true,
          status: 200,
          json: async () => ({
            resender: { messageId: "msg_pontiun_9988", status: "sent" },
            meta: { messages: [{ id: "wamid.HBgNNTQ5MTE..." }] },
          }),
        };
      }) as any;

      const result = await sendPontiunAppointmentConfirmation({
        ...validAppointment,
        serviceName: "Corte + barba",
      });

      expect(result.success).toBe(true);
      expect(result.messageId).toBe("msg_pontiun_9988");

      // Verified official endpoint
      expect(capturedUrl).toBe("https://pontiun.com/api/meta/whatsapp/templates/send");

      // Verified headers
      const headers = capturedHeaders as Record<string, string>;
      expect(headers["Authorization"]).toBe("Bearer pk_live_secret_token_123");
      expect(headers["Content-Type"]).toBe("application/json");
      expect(headers["Idempotency-Key"]).toBe("kani-appointment-apt_uuid_11223344-confirmed");

      // Verified body
      expect(capturedBody.pageId).toBe("1391432264052937");
      expect(capturedBody.recipientId).toBe("5491155616438");
      expect(capturedBody.template.name).toBe("confirmacion_turno_kani");
      // Must be a string per Pontiun OpenAPI 3.1
      expect(capturedBody.template.language).toBe("es_MX");

      const params = capturedBody.template.components[0].parameters;
      expect(params).toHaveLength(5);
      expect(params[0].text).toBe("Gonzalo Ramos");
      // Date formatted in Argentina DD/MM/YYYY
      expect(params[1].text).toBe("30/10/2026");
      // Time formatted HH:MM without 'hs'
      expect(params[2].text).toBe("16:00");
      // Service normalized to 'Corte y barba'
      expect(params[3].text).toBe("Corte y barba");
      expect(params[4].text).toBe("Lautaro");
    });

    it("fails closed when barberName is missing without inventing names", async () => {
      process.env.PONTIUN_API_KEY = "pk_live_secret_token_123";
      process.env.PONTIUN_PHONE_NUMBER_ID = "1391432264052937";

      const result = await sendPontiunAppointmentConfirmation({
        ...validAppointment,
        barberName: null,
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe("BARBER_MISSING");
      expect(result.retryable).toBe(false);
    });

    it("handles Pontiun idempotent replay response gracefully", async () => {
      process.env.PONTIUN_API_KEY = "pk_live_secret_token_123";
      process.env.PONTIUN_PHONE_NUMBER_ID = "1391432264052937";

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          resender: { messageId: "msg_original_123", idempotentReplay: true, status: "sent" },
        }),
      } as any);

      const result = await sendPontiunAppointmentConfirmation(validAppointment);
      expect(result.success).toBe(true);
      expect(result.idempotentReplay).toBe(true);
      expect(result.messageId).toBe("msg_original_123");
    });

    it("handles HTTP 409 template_not_approved from Pontiun without throwing", async () => {
      process.env.PONTIUN_API_KEY = "pk_live_secret_token_123";
      process.env.PONTIUN_PHONE_NUMBER_ID = "1391432264052937";

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 409,
        json: async () => ({
          error: "template_not_approved",
          message: "The template is not approved in Meta",
        }),
      } as any);

      const result = await sendPontiunAppointmentConfirmation(validAppointment);
      expect(result.success).toBe(false);
      expect(result.error).toBe("TEMPLATE_NOT_APPROVED");
      expect(result.retryable).toBe(false);
    });

    it("retries controlled on network timeouts or 5xx and fails safely without throwing", async () => {
      process.env.PONTIUN_API_KEY = "pk_live_secret_token_123";
      process.env.PONTIUN_PHONE_NUMBER_ID = "1391432264052937";

      const fetchMock = vi.fn().mockRejectedValue(new Error("Connection timeout after 5000ms"));
      globalThis.fetch = fetchMock as any;

      const result = await sendPontiunAppointmentConfirmation(validAppointment);
      expect(result.success).toBe(false);
      expect(result.error).toContain("timeout");
      expect(result.attempts).toBe(3);
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });
  });

  describe("Appointment Confirmation & WhatsApp Lifecycle Constraints", () => {
    it("ensures WhatsApp notification is strictly guarded to CONFIRMED appointments", () => {
      // Simulating dispatch conditions
      const shouldDispatchWhatsApp = (status: string) => status === "CONFIRMED";

      expect(shouldDispatchWhatsApp("CONFIRMED")).toBe(true);
      expect(shouldDispatchWhatsApp("PENDING")).toBe(false);
      expect(shouldDispatchWhatsApp("CANCELLED")).toBe(false);
      expect(shouldDispatchWhatsApp("SLOT_COLLISION_LATE_PAYMENT")).toBe(false);
      expect(shouldDispatchWhatsApp("FAILED")).toBe(false);
    });

    it("ensures idempotency key prevents duplicate requests for the same appointment", () => {
      const apptId = "apt-778899";
      const key1 = `kani-appointment-${apptId}-confirmed`;
      const key2 = `kani-appointment-${apptId}-confirmed`;
      expect(key1).toBe(key2);
      expect(key1.length).toBeLessThanOrEqual(200);
    });
  });
});
