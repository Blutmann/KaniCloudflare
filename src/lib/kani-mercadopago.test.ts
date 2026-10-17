import { describe, it, expect, vi } from "vitest";
import { createHmac } from "node:crypto";
import {
  verifyMercadoPagoWebhookSignature,
  createMercadoPagoOrder,
  getMercadoPagoOrder,
  isOrderFullyApproved,
  type CreateMercadoPagoOrderInput,
  type MercadoPagoOrderDetails,
} from "./kani-mercadopago";

describe("Mercado Pago Integration Unit Tests", () => {
  describe("verifyMercadoPagoWebhookSignature", () => {
    const secret = "test_webhook_secret_key_12345";
    const dataId = "order_123456789";
    const requestId = "req_abcdef_789";
    const ts = "1742505638683";

    it("returns true when HMAC signature matches the official manifest", () => {
      // Manifest pattern: id:{data.id};request-id:{x-request-id};ts:{ts};
      const manifest = `id:${dataId};request-id:${requestId};ts:${ts};`;
      const validV1 = createHmac("sha256", secret).update(manifest).digest("hex");
      const xSignature = `ts=${ts},v1=${validV1}`;

      const isValid = verifyMercadoPagoWebhookSignature({
        xSignature,
        xRequestId: requestId,
        dataId,
        secret,
      });

      expect(isValid).toBe(true);
    });

    it("returns false when HMAC signature does not match", () => {
      const xSignature = `ts=${ts},v1=invalid_signature_hash_0000000000000000000000000000000000000000000000000000000000000000`;

      const isValid = verifyMercadoPagoWebhookSignature({
        xSignature,
        xRequestId: requestId,
        dataId,
        secret,
      });

      expect(isValid).toBe(false);
    });

    it("returns false when any required header or secret is missing", () => {
      expect(
        verifyMercadoPagoWebhookSignature({
          xSignature: null,
          xRequestId: requestId,
          dataId,
          secret,
        }),
      ).toBe(false);

      expect(
        verifyMercadoPagoWebhookSignature({
          xSignature: `ts=${ts},v1=abc`,
          xRequestId: null,
          dataId,
          secret,
        }),
      ).toBe(false);

      expect(
        verifyMercadoPagoWebhookSignature({
          xSignature: `ts=${ts},v1=abc`,
          xRequestId: requestId,
          dataId: null,
          secret,
        }),
      ).toBe(false);

      expect(
        verifyMercadoPagoWebhookSignature({
          xSignature: `ts=${ts},v1=abc`,
          xRequestId: requestId,
          dataId,
          secret: undefined,
        }),
      ).toBe(false);
    });
  });

  describe("createMercadoPagoOrder", () => {
    const input: CreateMercadoPagoOrderInput = {
      externalReference: "apt_12345",
      title: "Seña reserva de turno",
      description: "Corte de pelo con Lautaro",
      amount: 10000,
      payer: { email: "cliente@example.com" },
      expirationMinutes: 10,
    };

    it("fails early when access token is not configured", async () => {
      const result = await createMercadoPagoOrder({
        input,
        accessToken: "",
        idempotencyKey: "test-key-1",
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe("MERCADOPAGO_ACCESS_TOKEN_NOT_CONFIGURED");
    });

    it("creates an order successfully with correct payload and headers", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          id: "mp_order_998877",
          status: "pending",
          init_point: "https://www.mercadopago.com.ar/checkout/v1/redirect?pref_id=998877",
        }),
      });
      global.fetch = mockFetch;

      const result = await createMercadoPagoOrder({
        input,
        accessToken: "TEST-1234567890-mock",
        idempotencyKey: "unique-uuid-key",
      });

      expect(result.success).toBe(true);
      expect(result.orderId).toBe("mp_order_998877");
      expect(result.initPoint).toContain("redirect?pref_id=998877");

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toBe("https://api.mercadopago.com/v1/orders");
      expect(options.method).toBe("POST");
      expect(options.headers["Authorization"]).toBe("Bearer TEST-1234567890-mock");
      expect(options.headers["X-Idempotency-Key"]).toBe("unique-uuid-key");

      const body = JSON.parse(options.body);
      expect(body.type).toBe("online");
      expect(body.total_amount).toBe("10000.00");
      expect(body.external_reference).toBe("apt_12345");
      expect(body.payer.email).toBe("cliente@example.com");
      expect(body.items[0].unit_price).toBe("10000.00");
      expect(body.expiration_date_to).toBeDefined();
    });

    it("handles Mercado Pago API errors gracefully", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        text: async () => JSON.stringify({ message: "Invalid payer email", error: "bad_request" }),
      });
      global.fetch = mockFetch;

      const result = await createMercadoPagoOrder({
        input,
        accessToken: "TEST-1234567890-mock",
        idempotencyKey: "unique-uuid-key-2",
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe("Invalid payer email");
    });
  });

  describe("getMercadoPagoOrder & isOrderFullyApproved", () => {
    it("fails early when access token is not configured", async () => {
      const result = await getMercadoPagoOrder({
        orderId: "order_123",
        accessToken: undefined,
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe("MERCADOPAGO_ACCESS_TOKEN_NOT_CONFIGURED");
    });

    it("correctly identifies fully approved orders", () => {
      const approvedOrder: MercadoPagoOrderDetails = {
        id: "order_100",
        status: "processed",
        total_amount: 10000,
        payments: [
          {
            id: 123456,
            status: "approved",
            transaction_amount: 10000,
            currency_id: "ARS",
          },
        ],
      };

      expect(isOrderFullyApproved(approvedOrder, 10000)).toBe(true);
    });

    it("rejects orders when payment amount does not match expected amount", () => {
      const wrongAmountOrder: MercadoPagoOrderDetails = {
        id: "order_101",
        status: "processed",
        total_amount: 5000,
        payments: [
          {
            id: 123457,
            status: "approved",
            transaction_amount: 5000,
            currency_id: "ARS",
          },
        ],
      };

      expect(isOrderFullyApproved(wrongAmountOrder, 10000)).toBe(false);
    });

    it("rejects orders when payment is pending or rejected", () => {
      const pendingOrder: MercadoPagoOrderDetails = {
        id: "order_102",
        status: "pending",
        total_amount: 10000,
        payments: [
          {
            id: 123458,
            status: "in_process",
            transaction_amount: 10000,
            currency_id: "ARS",
          },
        ],
      };

      expect(isOrderFullyApproved(pendingOrder, 10000)).toBe(false);
    });
  });
});
