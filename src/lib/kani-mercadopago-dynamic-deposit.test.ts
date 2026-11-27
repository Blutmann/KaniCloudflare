import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
import {
  handleCreateBookingOrder,
  handleGetAppointmentPaymentStatus,
  verifyAndConfirmAppointmentPayment,
} from "./kani-mercadopago.server";
import { handleMercadoPagoWebhook } from "./kani-mercadopago-webhook.server";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
  notify: vi.fn(),
  getDynamicDownPayment: vi.fn(),
  prepareBenefit: vi.fn(),
  consumeBenefit: vi.fn(),
}));

vi.mock("./kani-payment-db.server", () => ({
  createPaymentSupabaseClient: async () => ({
    rpc: mocks.rpc,
    from: mocks.from,
  }),
}));

vi.mock("./kani-notifications.functions", () => ({
  dispatchAppointmentNotification: mocks.notify,
}));

vi.mock("./kani-down-payment", () => ({
  getDynamicDownPayment: (...args: unknown[]) => mocks.getDynamicDownPayment(...args),
}));

vi.mock("./kani-benefit-codes-payment.server", () => ({
  prepareBenefitCodeForPaymentAttempt: (...args: unknown[]) => mocks.prepareBenefit(...args),
  consumeBenefitCodeForPaymentAttempt: (...args: unknown[]) => mocks.consumeBenefit(...args),
}));

const appointmentId = "223e4567-e89b-12d3-a456-426614174000";
const orderId = "ORD01DYNAMIC";
const runtime = globalThis as typeof globalThis & { __env__?: Record<string, string> };

function makeWebhookRequest(bodyId = orderId, type = "order") {
  const ts = String(Math.floor(Date.now() / 1000));
  const signature = createHmac("sha256", "dynamic-test-secret")
    .update(`id:${bodyId};request-id:req-dyn;ts:${ts};`)
    .digest("hex");
  return new Request(`https://www.kanibarber.com/api/webhook/mercadopago?data.id=${bodyId}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-request-id": "req-dyn",
      "x-signature": `ts=${ts},v1=${signature}`,
    },
    body: JSON.stringify({ type, data: { id: bodyId } }),
  });
}

describe("Mercado Pago dynamic deposit & benefit code flows", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    runtime.__env__ = {
      MERCADOPAGO_ACCESS_TOKEN: "APP_USR-fake-gonzalo-token",
      MERCADOPAGO_WEBHOOK_SECRET: "dynamic-test-secret",
      KANI_APP_URL: "https://www.kanibarber.com",
      MERCADOPAGO_NOTIFICATION_URL: "https://www.kanibarber.com/api/webhook/mercadopago",
    };
    mocks.getDynamicDownPayment.mockResolvedValue(3500);
    mocks.notify.mockResolvedValue({ sent: true, status: "SENT" });
    mocks.consumeBenefit.mockResolvedValue(undefined);
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    delete runtime.__env__;
    vi.unstubAllGlobals();
  });

  it("creates an MP order with a dynamic deposit != 5000 ARS and persists expected_amount_ars", async () => {
    let upsertedPayload: Record<string, unknown> | null = null;
    let boundOrderId: string | null = null;

    mocks.rpc.mockImplementation(async (fn: string) => {
      if (fn === "get_appointment_payment_details") {
        return {
          data: [
            {
              appointment_id: appointmentId,
              appointment_status: "PENDING",
              barber_name: "Gonzalo",
              service_name: "Corte",
              service_price_ars: 25000,
              client_name: "Juan Perez",
              client_email: "juan@example.com",
              client_phone: "+5491122334455",
            },
          ],
          error: null,
        };
      }
      return { data: null, error: null };
    });

    mocks.from.mockImplementation((table: string) => {
      if (table === "appointments") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: {
                  benefit_code_id: null,
                  benefit_code: null,
                  benefit_type: null,
                  benefit_online_deposit_ars: null,
                },
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === "appointment_payment_orders") {
        return {
          upsert: async (payload: Record<string, unknown>) => {
            upsertedPayload = payload;
            return { error: null };
          },
          select: () => ({
            eq: () => ({
              single: async () => ({
                data: {
                  idempotency_key: "123e4567-e89b-12d3-a456-426614174111",
                  order_id: boundOrderId,
                  expected_amount_ars: upsertedPayload?.expected_amount_ars ?? 3500,
                },
                error: null,
              }),
            }),
          }),
          update: (patch: Record<string, unknown>) => ({
            eq: () => ({
              is: async () => {
                boundOrderId = String(patch.order_id ?? "");
                return { error: null };
              },
            }),
          }),
        };
      }
      return {};
    });

    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: orderId,
          status: "created",
          checkout_url: "https://www.mercadopago.com.ar/checkout/v1/redirect?order_id=ORD01DYNAMIC",
        }),
        { status: 200 },
      ),
    );

    const res = await handleCreateBookingOrder({
      appointmentId,
      serviceName: "Corte",
      barberName: "Gonzalo",
      servicePrice: 25000,
      clientName: "Juan Perez",
      clientEmail: "juan@example.com",
      clientPhone: "+5491122334455",
    });

    expect(res.success).toBe(true);
    expect(res.depositAmount).toBe(3500);
    expect(res.checkoutUrl).toContain(orderId);
    expect(upsertedPayload).toEqual({
      appointment_id: appointmentId,
      expected_amount_ars: 3500,
    });

    const mpRequestBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(mpRequestBody.total_amount).toBe("3500.00");
    expect(mpRequestBody.items[0].unit_price).toBe("3500.00");
  });

  it("applies a PERCENT_50 benefit code on a $6.000 service and creates MP order for $3.000", async () => {
    mocks.getDynamicDownPayment.mockResolvedValue(5000);
    mocks.prepareBenefit.mockResolvedValue({
      codeId: "bc-50",
      code: "KANI-HALF-50",
      usageMode: "SINGLE_USE",
    });

    let updatedAppointmentBenefit: Record<string, unknown> | null = null;
    let upsertedPayload: Record<string, unknown> | null = null;
    let boundOrderId: string | null = null;

    mocks.rpc.mockResolvedValueOnce({
      data: [
        {
          appointment_id: appointmentId,
          appointment_status: "PENDING",
          barber_name: "Gonzalo",
          service_name: "Barba",
          service_price_ars: 6000,
          client_name: "Juan Perez",
          client_email: "juan@example.com",
          client_phone: "+5491122334455",
        },
      ],
      error: null,
    });

    mocks.from.mockImplementation((table: string) => {
      if (table === "appointments") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: {
                  benefit_code_id: null,
                  benefit_code: null,
                  benefit_type: null,
                  benefit_online_deposit_ars: null,
                },
                error: null,
              }),
            }),
          }),
          update: (patch: Record<string, unknown>) => ({
            eq: async () => {
              updatedAppointmentBenefit = patch;
              return { error: null };
            },
          }),
        };
      }
      if (table === "benefit_codes") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: { id: "bc-50", code: "KANI-HALF-50", type: "PERCENT_50" },
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === "appointment_payment_orders") {
        return {
          upsert: async (payload: Record<string, unknown>) => {
            upsertedPayload = payload;
            return { error: null };
          },
          select: () => ({
            eq: () => ({
              single: async () => ({
                data: {
                  idempotency_key: "123e4567-e89b-12d3-a456-426614174222",
                  order_id: boundOrderId,
                  expected_amount_ars: upsertedPayload?.expected_amount_ars ?? 3000,
                },
                error: null,
              }),
            }),
          }),
          update: (patch: Record<string, unknown>) => ({
            eq: () => ({
              is: async () => {
                boundOrderId = String(patch.order_id ?? "");
                return { error: null };
              },
            }),
          }),
        };
      }
      return {};
    });

    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: orderId,
          status: "created",
          checkout_url: "https://www.mercadopago.com.ar/checkout/v1/redirect?order_id=ORD01DYNAMIC",
        }),
        { status: 200 },
      ),
    );

    const res = await handleCreateBookingOrder({
      appointmentId,
      serviceName: "Barba",
      barberName: "Gonzalo",
      servicePrice: 6000,
      clientName: "Juan Perez",
      clientEmail: "juan@example.com",
      clientPhone: "+5491122334455",
      benefitCode: "KANI-HALF-50",
    });

    expect(res.success).toBe(true);
    expect(res.depositAmount).toBe(3000);
    expect(upsertedPayload).toEqual({
      appointment_id: appointmentId,
      expected_amount_ars: 3000,
    });
    expect(updatedAppointmentBenefit).toMatchObject({
      benefit_code: "KANI-HALF-50",
      benefit_type: "PERCENT_50",
      benefit_final_price_ars: 3000,
      benefit_online_deposit_ars: 3000,
      benefit_in_person_balance_ars: 0,
    });
  });

  it("verifies webhook & confirms appointment with dynamic expected_amount_ars = 3500 and consumes benefit code", async () => {
    const dynamicOrder = {
      id: orderId,
      type: "online",
      external_reference: appointmentId,
      status: "processed",
      status_detail: "accredited",
      currency: "ARS",
      total_amount: "3500.00",
      total_paid_amount: "3500.00",
      transactions: {
        payments: [
          {
            id: "PAY-DYN-1",
            reference_id: "99887766",
            status: "processed",
            status_detail: "accredited",
            paid_amount: "3500.00",
            refunded_amount: "0.00",
          },
        ],
      },
    };

    fetchMock.mockImplementation(async () => new Response(JSON.stringify(dynamicOrder), { status: 200 }));

    mocks.from.mockImplementation((table: string) => {
      if (table === "appointment_payment_orders") {
        return {
          select: () => ({
            eq: () => ({
              single: async () => ({
                data: { order_id: orderId, expected_amount_ars: 3500 },
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === "appointments") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: {
                  id: appointmentId,
                  status: "PENDING",
                  benefit_code_id: "bc-10",
                  benefit_code: "KANI-10-OFF",
                },
                error: null,
              }),
            }),
          }),
        };
      }
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: { name: "Gonzalo" }, error: null }),
          }),
        }),
      };
    });

    mocks.rpc.mockResolvedValueOnce({
      data: [{ result_code: "CONFIRMED", appointment_status: "CONFIRMED", notification_claim_token: "claim-dyn" }],
      error: null,
    });

    const response = await handleMercadoPagoWebhook(makeWebhookRequest(orderId, "order"));
    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("confirm_appointment_from_payment", {
      p_appointment_id: appointmentId,
      p_order_id: orderId,
      p_paid_amount: 3500,
    });
    expect(mocks.consumeBenefit).toHaveBeenCalledWith(expect.anything(), appointmentId, appointmentId);
    expect(mocks.notify).toHaveBeenCalledTimes(1);
  });

  it("rejects confirmation when paid amount does not match dynamic expected_amount_ars", async () => {
    const mismatchedOrder = {
      id: orderId,
      type: "online",
      external_reference: appointmentId,
      status: "processed",
      status_detail: "accredited",
      currency: "ARS",
      total_amount: "5000.00",
      total_paid_amount: "5000.00",
      transactions: {
        payments: [
          {
            id: "PAY-MISMATCH",
            status: "processed",
            status_detail: "accredited",
            paid_amount: "5000.00",
            refunded_amount: "0.00",
          },
        ],
      },
    };

    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(mismatchedOrder), { status: 200 }));
    mocks.from.mockImplementation(() => ({
      select: () => ({
        eq: () => ({
          single: async () => ({
            data: { order_id: orderId, expected_amount_ars: 3500 },
            error: null,
          }),
        }),
      }),
    }));

    const result = await verifyAndConfirmAppointmentPayment({ appointmentId, orderId });
    expect(result.success).toBe(false);
    expect(result.resultCode).toBe("ORDER_NOT_APPROVED");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("returns confirmed dynamic deposit amount on /pago/exito status verification", async () => {
    const dynamicOrder = {
      id: orderId,
      type: "online",
      external_reference: appointmentId,
      status: "processed",
      status_detail: "accredited",
      currency: "ARS",
      total_amount: "4000.00",
      total_paid_amount: "4000.00",
      transactions: {
        payments: [
          {
            id: "PAY-DYN-2",
            status: "processed",
            status_detail: "accredited",
            paid_amount: "4000.00",
            refunded_amount: "0.00",
          },
        ],
      },
    };

    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(dynamicOrder), { status: 200 }));
    mocks.rpc.mockResolvedValueOnce({
      data: [{ result_code: "CONFIRMED", appointment_status: "CONFIRMED", notification_claim_token: "claim-2" }],
      error: null,
    });
    mocks.from.mockImplementation((table: string) => {
      if (table === "appointment_payment_orders") {
        return {
          select: () => ({
            eq: () => ({
              single: async () => ({
                data: { order_id: orderId, expected_amount_ars: 4000 },
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === "appointments") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: {
                  id: appointmentId,
                  request_number: 42,
                  status: "PENDING",
                  booking_date: "2026-12-01",
                  start_time: "11:00:00",
                  end_time: "11:45:00",
                  barber_id: "b-gonza",
                  service_id: "s-corte",
                  client_id: "c-1",
                  deposit_amount_ars: null,
                  benefit_code: "KANI-10",
                  benefit_type: "PERCENT_10",
                  benefit_original_price_ars: 25000,
                  benefit_discount_amount_ars: 2500,
                  benefit_final_price_ars: 22500,
                  benefit_online_deposit_ars: 4000,
                  benefit_in_person_balance_ars: 18500,
                },
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === "barbers") {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { name: "Gonzalo" }, error: null }) }) }) };
      }
      if (table === "services") {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { name: "Corte", price_ars: 25000 }, error: null }) }) }) };
      }
      return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { name: "Juan", email: "j@e.com", phone: "11223344" }, error: null }) }) }) };
    });

    const statusRes = await handleGetAppointmentPaymentStatus({ appointmentId, orderId });
    expect(statusRes.success).toBe(true);
    expect(statusRes.isConfirmed).toBe(true);
    expect(statusRes.appointment?.barberName).toBe("Gonzalo");
    expect(statusRes.appointment?.depositAmountArs).toBe(4000);
    expect(statusRes.appointment?.benefitCode).toBe("KANI-10");
    expect(statusRes.appointment?.benefitType).toBe("PERCENT_10");
  });
});
