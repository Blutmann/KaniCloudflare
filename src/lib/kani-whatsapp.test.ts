import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  formatPhoneForWhatsApp,
  handleWhatsAppWebhookVerification,
  sendWhatsAppNotification,
} from "./kani-whatsapp";

describe("WhatsApp Integration Unit Tests", () => {
  describe("formatPhoneForWhatsApp", () => {
    it("strips non-digit characters and keeps country and area code", () => {
      expect(formatPhoneForWhatsApp("+54 9 11 1234-5678")).toBe("5491112345678");
      expect(formatPhoneForWhatsApp("+1 (555) 234-5678")).toBe("15552345678");
      expect(formatPhoneForWhatsApp(" 5491100001111 ")).toBe("5491100001111");
    });

    it("handles empty or already clean strings", () => {
      expect(formatPhoneForWhatsApp("")).toBe("");
      expect(formatPhoneForWhatsApp("5491122334455")).toBe("5491122334455");
    });
  });

  describe("handleWhatsAppWebhookVerification", () => {
    const SECRET = "kani_test_secret_token";

    it("returns 200 with plain text challenge when token and mode match", async () => {
      const url = new URL("https://example.com/api/webhook/whatsapp?hub.mode=subscribe&hub.verify_token=kani_test_secret_token&hub.challenge=test_challenge_code_123");
      const res = handleWhatsAppWebhookVerification(url, SECRET);

      expect(res).not.toBeNull();
      expect(res?.status).toBe(200);
      expect(res?.headers.get("Content-Type")).toBe("text/plain");
      expect(await res?.text()).toBe("test_challenge_code_123");
    });

    it("returns 403 when verify token does not match", async () => {
      const url = new URL("https://example.com/api/webhook/whatsapp?hub.mode=subscribe&hub.verify_token=wrong_token&hub.challenge=test_challenge_code_123");
      const res = handleWhatsAppWebhookVerification(url, SECRET);

      expect(res).not.toBeNull();
      expect(res?.status).toBe(403);
    });

    it("returns null when no webhook params exist", () => {
      const url = new URL("https://example.com/api/webhook/whatsapp");
      const res = handleWhatsAppWebhookVerification(url, SECRET);

      expect(res).toBeNull();
    });
  });

  describe("sendWhatsAppNotification", () => {
    beforeEach(() => {
      vi.restoreAllMocks();
    });

    it("rejects phone numbers that are too short without calling fetch", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch");
      const result = await sendWhatsAppNotification({
        payload: {
          toPhone: "123",
          clientName: "Juan",
          serviceName: "Corte",
          barberName: "Martin",
          bookingDate: "17/10/2026",
          startTime: "14:00 hs",
        },
        phoneNumberId: "123456789",
        accessToken: "test_token",
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe("INVALID_PHONE_NUMBER");
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("returns success when Meta Graph API responds 200 with message id", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify({ messages: [{ id: "wamid.HBgL..." }] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );

      const result = await sendWhatsAppNotification({
        payload: {
          toPhone: "+54 9 11 1234-5678",
          clientName: "Juan",
          serviceName: "Corte",
          barberName: "Martin",
          bookingDate: "17/10/2026",
          startTime: "14:00 hs",
        },
        phoneNumberId: "123456789",
        accessToken: "test_token",
      });

      expect(result.success).toBe(true);
      expect(result.messageId).toBe("wamid.HBgL...");
    });

    it("gracefully catches Meta Graph API errors and sanitizes error message", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: {
              message: "Invalid OAuth access token - Cannot parse access token Bearer secret_meta_token_1234567890",
              code: 190,
            },
          }),
          { status: 401, headers: { "Content-Type": "application/json" } },
        ),
      );

      const result = await sendWhatsAppNotification({
        payload: {
          toPhone: "+54 9 11 1234-5678",
          clientName: "Juan",
          serviceName: "Corte",
          barberName: "Martin",
          bookingDate: "17/10/2026",
          startTime: "14:00 hs",
        },
        phoneNumberId: "123456789",
        accessToken: "test_token",
      });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error).not.toContain("secret_meta_token");
    });

    it("gracefully handles network or timeout exceptions without throwing", async () => {
      vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("Network timeout after 5000ms"));

      const result = await sendWhatsAppNotification({
        payload: {
          toPhone: "+54 9 11 1234-5678",
          clientName: "Juan",
          serviceName: "Corte",
          barberName: "Martin",
          bookingDate: "17/10/2026",
          startTime: "14:00 hs",
        },
        phoneNumberId: "123456789",
        accessToken: "test_token",
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("Network timeout");
    });
  });
});
