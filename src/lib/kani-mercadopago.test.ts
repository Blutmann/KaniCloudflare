import { describe, it, expect, vi } from "vitest";
import { createHmac } from "node:crypto";
import {
  verifyMercadoPagoWebhookSignature,
  createMercadoPagoOrder,
  getMercadoPagoOrder,
  isOrderFullyApproved,
  getDynamicDownPayment,
  confirmAppointmentPayment,
  toValidUuid,
  type CreateMercadoPagoOrderInput,
  type MercadoPagoOrderDetails,
} from "./kani-mercadopago";

const mockRpc = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (...args: unknown[]) => mockRpc(...args),
  },
}));

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
          checkout_url: "https://www.mercadopago.com.ar/checkout/v1/redirect?order_id=mp_order_998877",
        }),
      });
      global.fetch = mockFetch;

      const result = await createMercadoPagoOrder({
        input,
        accessToken: "TEST-1234567890-mock",
        idempotencyKey: "123e4567-e89b-12d3-a456-426614174000",
      });

      expect(result.success).toBe(true);
      expect(result.orderId).toBe("mp_order_998877");
      expect(result.checkoutUrl).toBe("https://www.mercadopago.com.ar/checkout/v1/redirect?order_id=mp_order_998877");
      expect(result.initPoint).toBe("https://www.mercadopago.com.ar/checkout/v1/redirect?order_id=mp_order_998877");

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toBe("https://api.mercadopago.com/v1/orders");
      expect(options.method).toBe("POST");
      expect(options.headers["Authorization"]).toBe("Bearer TEST-1234567890-mock");
      expect(options.headers["X-Idempotency-Key"]).toBe("123e4567-e89b-12d3-a456-426614174000");

      const body = JSON.parse(options.body);
      expect(body.type).toBe("online");
      expect(body.total_amount).toBe("10000.00");
      expect(body.external_reference).toBe("apt_12345");
      expect(body.payer.email).toBe("cliente@example.com");
      expect(body.items[0].unit_price).toBe("10000.00");
      expect(body.items[0].title).toBe("Seña reserva de turno");
      expect(body.items[0].id).toBeUndefined();
      expect(body.expiration_date_to).toBeUndefined();
      expect(body.notification_url).toBeUndefined();
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

    it("rejects orders when currency is not ARS", () => {
      const usdOrder: MercadoPagoOrderDetails = {
        id: "order_103",
        status: "processed",
        currency_id: "USD",
        total_amount: 10000,
        payments: [
          {
            id: 123459,
            status: "approved",
            transaction_amount: 10000,
            currency_id: "USD",
          },
        ],
      };

      expect(isOrderFullyApproved(usdOrder, 10000)).toBe(false);
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

  describe("getDynamicDownPayment", () => {
    it("returns dynamic down payment from RPC when available", async () => {
      mockRpc.mockResolvedValueOnce({
        data: 5000,
        error: null,
      });

      const amount = await getDynamicDownPayment("Lautaro");
      expect(amount).toBe(5000);
      expect(mockRpc).toHaveBeenCalledWith("read_public_deposit_amount", {
        p_barber_name: "Lautaro",
      });
    });

    it("falls back to default 5000 when RPC returns error", async () => {
      mockRpc.mockResolvedValueOnce({
        data: null,
        error: { message: "function does not exist" },
      });

      const amount = await getDynamicDownPayment("Gonzalo");
      expect(amount).toBe(5000);
    });
  });

  describe("confirmAppointmentPayment", () => {
    it("confirms appointment successfully and dispatches notification on valid approved payment", async () => {
      const notifModule = await import("./kani-notifications.functions");
      const sendNotifSpy = vi
        .spyOn(notifModule, "sendAppointmentNotification")
        .mockResolvedValueOnce({ sent: true, status: "SENT" });

      mockRpc.mockResolvedValueOnce({
        data: [
          {
            appointment_status: "CONFIRMED",
            result_code: "CONFIRMED",
            notification_claim_token: "test_token_abc123",
          },
        ],
        error: null,
      });

      const result = await confirmAppointmentPayment({
        appointmentId: "apt_111",
        orderId: "order_999",
        totalAmount: 10000,
      });

      expect(result.success).toBe(true);
      expect(result.resultCode).toBe("CONFIRMED");
      expect(result.appointmentStatus).toBe("CONFIRMED");
      expect(sendNotifSpy).toHaveBeenCalledWith({
        data: {
          appointmentId: "apt_111",
          claimToken: "test_token_abc123",
        },
      });

      sendNotifSpy.mockRestore();
    });

    it("handles idempotent webhook retries safely without duplicating notifications", async () => {
      const notifModule = await import("./kani-notifications.functions");
      const sendNotifSpy = vi.spyOn(notifModule, "sendAppointmentNotification");

      mockRpc.mockResolvedValueOnce({
        data: [
          {
            appointment_status: "CONFIRMED",
            result_code: "ALREADY_CONFIRMED",
            notification_claim_token: null,
          },
        ],
        error: null,
      });

      const result = await confirmAppointmentPayment({
        appointmentId: "apt_111",
        orderId: "order_999",
        totalAmount: 10000,
      });

      expect(result.success).toBe(true);
      expect(result.resultCode).toBe("ALREADY_CONFIRMED");
      expect(sendNotifSpy).not.toHaveBeenCalled();

      sendNotifSpy.mockRestore();
    });

    it("prevents double-booking when payment arrives late and slot was taken", async () => {
      mockRpc.mockResolvedValueOnce({
        data: [
          {
            appointment_status: "PENDING",
            result_code: "SLOT_COLLISION_LATE_PAYMENT",
            notification_claim_token: null,
          },
        ],
        error: null,
      });

      const result = await confirmAppointmentPayment({
        appointmentId: "apt_late",
        orderId: "order_999",
        totalAmount: 10000,
      });

      expect(result.success).toBe(false);
      expect(result.resultCode).toBe("SLOT_COLLISION_LATE_PAYMENT");
      expect(result.error).toBe("SLOT_COLLISION_LATE_PAYMENT");
    });

    it("handles RPC database failure safely without throwing an unhandled exception", async () => {
      mockRpc.mockResolvedValueOnce({
        data: null,
        error: { message: "database connection failed" },
      });

      const result = await confirmAppointmentPayment({
        appointmentId: "apt_err",
        orderId: "order_999",
      });

      expect(result.success).toBe(false);
      expect(result.resultCode).toBe("FAILED");
      expect(result.error).toBe("database connection failed");
    });
  });

  describe("toValidUuid & Idempotency Key Handling", () => {
    it("preserves valid UUID v4 unchanged (in lowercase)", () => {
      const validUuid = "123e4567-e89b-12d3-a456-426614174000";
      expect(toValidUuid(validUuid)).toBe(validUuid);
    });

    it("extracts UUID from prefixed strings like order_<uuid>", () => {
      const uuid = "e58ed763-928c-4155-bee9-fdbaaadc15f3";
      expect(toValidUuid(`order_${uuid}`)).toBe(uuid);
    });

    it("generates a valid UUID v4 when input is not a UUID", () => {
      const generated = toValidUuid("not-a-uuid");
      expect(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(generated)).toBe(true);
    });
  });

  describe("createMercadoPagoOrder Advanced Resolution", () => {
    const input: CreateMercadoPagoOrderInput = {
      externalReference: "123e4567-e89b-12d3-a456-426614174000",
      title: "Seña reserva de turno",
      description: "Corte de pelo con Lautaro",
      amount: 10000,
      payer: { email: "cliente@example.com" },
      returnUrl: "https://example.com/reservar?status=return",
    };

    it("includes config.online returnUrl in the payload", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          id: "mp_order_123",
          status: "pending",
          checkout_url: "https://www.mercadopago.com.ar/checkout/v1/redirect?order_id=mp_order_123",
        }),
      });
      global.fetch = mockFetch;

      const result = await createMercadoPagoOrder({
        input,
        accessToken: "TEST-TOKEN",
        idempotencyKey: input.externalReference,
      });

      expect(result.success).toBe(true);
      const [, options] = mockFetch.mock.calls[0];
      const body = JSON.parse(options.body);
      expect(body.config.online.success_url).toBe("https://example.com/reservar?status=return");
      expect(body.config.online.auto_return).toBe("approved");
    });

    it("extracts error cause descriptions from Mercado Pago error response", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        text: async () =>
          JSON.stringify({
            message: "Validation error",
            error: "bad_request",
            cause: [{ description: "payer.email is invalid", code: "3001" }],
          }),
      });
      global.fetch = mockFetch;

      const result = await createMercadoPagoOrder({
        input,
        accessToken: "TEST-TOKEN",
        idempotencyKey: input.externalReference,
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe("payer.email is invalid");
    });

    it("falls back to standard redirect URL with order_id if neither checkout_url nor init_point is present", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          id: "9988776655",
          status: "pending",
        }),
      });
      global.fetch = mockFetch;

      const result = await createMercadoPagoOrder({
        input,
        accessToken: "TEST-TOKEN",
        idempotencyKey: input.externalReference,
      });

      expect(result.success).toBe(true);
      expect(result.checkoutUrl).toBe("https://www.mercadopago.com.ar/checkout/v1/redirect?order_id=9988776655");
    });

    it("extracts error details from modern Orders API errors array", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        text: async () =>
          JSON.stringify({
            errors: [
              {
                code: "property_value",
                message: "Invalid value for property",
                details: ["'$.items[0].external_code' - length must be <= 30, but got 36"],
              },
            ],
          }),
      });
      global.fetch = mockFetch;

      const result = await createMercadoPagoOrder({
        input,
        accessToken: "TEST-TOKEN",
        idempotencyKey: input.externalReference,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("'$.items[0].external_code' - length must be <= 30, but got 36");
    });
  });

  describe("Deterministic Idempotency Key (toValidUuid)", () => {
    it("returns identical UUID for multiple calls with the exact same non-UUID input", () => {
      const input = "custom-order-ref-12345";
      const key1 = toValidUuid(input);
      const key2 = toValidUuid(input);
      expect(key1).toBe(key2);
      expect(key1).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    });

    it("preserves standard valid UUID inputs in lowercase", () => {
      const validUuid = "C56A4180-65AA-42EC-A945-5FD21DEC0538";
      expect(toValidUuid(validUuid)).toBe(validUuid.toLowerCase());
      expect(toValidUuid(validUuid.toLowerCase())).toBe(validUuid.toLowerCase());
    });
  });

  describe("Runtime Environment Resolution (getRuntimeEnv)", () => {
    it("resolves variables stored in globalThis.__env__", async () => {
      const { getRuntimeEnv } = await import("./kani-mercadopago.functions");
      const globalObj = globalThis as typeof globalThis & { __env__?: Record<string, string> };
      globalObj.__env__ = {
        MERCADOPAGO_ACCESS_TOKEN: "TEST-from-nitro-env-12345",
      };

      expect(getRuntimeEnv("MERCADOPAGO_ACCESS_TOKEN")).toBe("TEST-from-nitro-env-12345");

      delete globalObj.__env__;
    });
  });
});
