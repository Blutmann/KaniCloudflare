import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
import realCheckoutFixture from "../test/fixtures/mercadopago-checkout-orders-approved.json";
import { isOrderFullyApproved, verifyMercadoPagoWebhookSignature } from "./kani-mercadopago";
import { verifyAndConfirmAppointmentPayment, handleGetAppointmentPaymentStatus } from "./kani-mercadopago.server";
import { handleMercadoPagoWebhook } from "./kani-mercadopago-webhook.server";

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), notify: vi.fn(), from: vi.fn() }));
vi.mock("./kani-payment-db.server", () => ({ createPaymentSupabaseClient: async () => ({ rpc: mocks.rpc, from: mocks.from }) }));
vi.mock("./kani-notifications.functions", () => ({ dispatchAppointmentNotification: mocks.notify }));
const appointmentId = "123e4567-e89b-12d3-a456-426614174000";
const orderId = "ORD01AUDIT";
const approved = () => ({
  id: orderId, type: "online", external_reference: appointmentId, status: "processed", status_detail: "accredited",
  currency: "ARS", total_amount: "5000.00", total_paid_amount: "5000.00",
  transactions: { payments: [{ id: "PAY01", status: "processed", status_detail: "accredited", paid_amount: "5000.00", refunded_amount: "0.00" }] },
});
let resource: ReturnType<typeof approved>;
let fetchMock: ReturnType<typeof vi.fn>;
const runtime = globalThis as typeof globalThis & { __env__?: Record<string, string> };
beforeEach(() => {
  vi.clearAllMocks();
  runtime.__env__ = { MERCADOPAGO_ACCESS_TOKEN: "TEST-FAKE", MERCADOPAGO_WEBHOOK_SECRET: "fake-audit-secret" };
  resource = approved();
  fetchMock = vi.fn(async () => new Response(JSON.stringify(resource), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  mocks.from.mockImplementation((table: string) => ({ select: () => ({ eq: () => ({
    single: async () => ({ data: { order_id: orderId, expected_amount_ars: 5000 }, error: null }),
    maybeSingle: async () => ({ data: table === "appointments" ? { id: appointmentId, status: "PENDING" } : { name: "Fixture" }, error: null }),
  }) }) }));
  mocks.rpc.mockResolvedValue({ data: [{ result_code: "CONFIRMED", appointment_status: "CONFIRMED", notification_claim_token: "fixture-claim" }], error: null });
  mocks.notify.mockResolvedValue({ sent: true, status: "SENT" });
});
afterEach(() => { delete runtime.__env__; vi.unstubAllGlobals(); });

function webhook(bodyId = orderId, signatureId = orderId, type = "order") {
  const ts = String(Math.floor(Date.now() / 1000));
  const signature = createHmac("sha256", "fake-audit-secret").update(`id:${signatureId};request-id:req-audit;ts:${ts};`).digest("hex");
  return new Request(`https://preview.test/api/webhook/mercadopago?data.id=${orderId}`, {
    method: "POST", headers: { "content-type": "application/json", "x-request-id": "req-audit", "x-signature": `ts=${ts},v1=${signature}` },
    body: JSON.stringify({ type, data: { id: bodyId } }),
  });
}
describe("Payment security audit (mocked provider, not MP sandbox)", () => {
  it("approved: authenticates GET, validates full order and dispatches only after RPC transition", async () => {
    const result = await verifyAndConfirmAppointmentPayment({ appointmentId, orderId });
    expect(result.success).toBe(true);
    expect(fetchMock.mock.calls[0][0]).toBe(`https://api.mercadopago.com/v1/orders/${orderId}`);
    expect((fetchMock.mock.calls[0] as any)[1].headers.Authorization).toBe("Bearer TEST-FAKE");
    expect(mocks.rpc).toHaveBeenCalledWith("confirm_appointment_from_payment", { p_appointment_id: appointmentId, p_order_id: orderId, p_paid_amount: 5000 });
    expect(mocks.notify).toHaveBeenCalledTimes(1);
  });
  it.each(["pending", "rejected", "cancelled", "created"])("%s cannot confirm", async status => {
    resource.status = status;
    expect((await verifyAndConfirmAppointmentPayment({ appointmentId, orderId })).success).toBe(false);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("URL manipulation: approved query flags without certified resource cannot confirm", async () => {
    const result = await handleGetAppointmentPaymentStatus({ appointmentId, status: "approved", collection_status: "approved" } as any);
    expect(result.isConfirmed).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("rejects crossed appointment and order IDs", async () => {
    expect((await verifyAndConfirmAppointmentPayment({ appointmentId, orderId: "ORDER-B" })).success).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    resource.external_reference = "appointment-B";
    expect((await verifyAndConfirmAppointmentPayment({ appointmentId, orderId })).success).toBe(false);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each([
    { total_amount: "1.00" }, { total_paid_amount: "1.00" }, { total_amount: "NaN" }, { currency: "USD" },
    { currency: undefined }, { status_detail: "pending" }, { transactions: undefined },
    { total_paid_amount: undefined }, { total_amount: "" },
    { transactions: { payments: [{ status: "processed", status_detail: "accredited", paid_amount: "5000.00", refunded_amount: "1.00" }] } },
  ])("fails closed for missing/invalid payment evidence %j", patch => {
    expect(isOrderFullyApproved({ ...resource, ...patch } as any, 5000)).toBe(false);
  });
  it("does not accept order total in place of an underpaid transaction", () => {
    resource.transactions.payments[0].paid_amount = "1.00";
    expect(isOrderFullyApproved(resource, 5000)).toBe(false);
  });
  it("duplicate and refresh cannot dispatch again when DB reports ALREADY_CONFIRMED", async () => {
    await verifyAndConfirmAppointmentPayment({ appointmentId, orderId });
    mocks.rpc.mockResolvedValue({ data: [{ result_code: "ALREADY_CONFIRMED", appointment_status: "CONFIRMED" }] });
    await verifyAndConfirmAppointmentPayment({ appointmentId, orderId });
    expect(mocks.notify).toHaveBeenCalledTimes(1);
  });
  it("late payment cannot dispatch when database refuses the slot", async () => {
    mocks.rpc.mockResolvedValue({ data: [{ result_code: "SLOT_COLLISION_LATE_PAYMENT", appointment_status: "PENDING" }] });
    expect((await verifyAndConfirmAppointmentPayment({ appointmentId, orderId })).success).toBe(false);
    expect(mocks.notify).not.toHaveBeenCalled();
  });
  it("webhook awaits confirmation and dispatch before HTTP 200", async () => {
    let release!: () => void;
    mocks.notify.mockImplementation(() => new Promise(resolve => { release = () => resolve({ sent: true }); }));
    let responded = false;
    const pending = handleMercadoPagoWebhook(webhook()).then(r => { responded = true; return r; });
    await vi.waitFor(() => expect(mocks.notify).toHaveBeenCalled());
    expect(responded).toBe(false);
    release();
    expect((await pending).status).toBe(200);
  });
  it("missing secret fails closed and does not fetch", async () => {
    delete runtime.__env__!.MERCADOPAGO_WEBHOOK_SECRET;
    expect((await handleMercadoPagoWebhook(webhook())).status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("tampered signature or body ID is rejected", async () => {
    expect((await handleMercadoPagoWebhook(webhook(orderId, "OTHER-ID"))).status).toBe(401);
    expect((await handleMercadoPagoWebhook(webhook("OTHER-ID"))).status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("upstream or database failure returns retryable 503, not silent HTTP 200", async () => {
    fetchMock.mockResolvedValueOnce(new Response("unavailable", { status: 503 }));
    expect((await handleMercadoPagoWebhook(webhook())).status).toBe(503);
    mocks.rpc.mockResolvedValue({ error: { message: "database unavailable" } });
    expect((await handleMercadoPagoWebhook(webhook())).status).toBe(503);
  });
  it("rejects old valid signatures when timestamp tolerance is enabled", () => {
    const ts = "1700000000";
    const v1 = createHmac("sha256", "test").update(`id:x;request-id:y;ts:${ts};`).digest("hex");
    expect(verifyMercadoPagoWebhookSignature({ dataId: "x", xRequestId: "y", secret: "test", xSignature: `ts=${ts},v1=${v1}`, toleranceSeconds: 300 })).toBe(false);
  });
});

// Shape captured from the first official TEST Checkout Pro payment on 2026-10-25.
// Identifiers are synthetic; payer, credentials and client_token are omitted.
describe("real Checkout Pro Orders response regression", () => {
  function useCheckoutResponse() {
    const fixture = JSON.parse(JSON.stringify(realCheckoutFixture)) as typeof realCheckoutFixture;
    fetchMock.mockImplementation(async (url: string) => new Response(JSON.stringify(
      url.includes("/v1/payments/") ? fixture.payment : fixture.order,
    ), { status: 200 }));
    return fixture;
  }

  it.each([true, false])("links legacy Payment via Orders reference_id, not merchant order ID (order query supplied: %s)", async withOrderId => {
    const fixture = useCheckoutResponse();
    expect(isOrderFullyApproved(fixture.order)).toBe(true);
    expect(fixture.payment.order.id).not.toBe(fixture.order.id);
    const result = await verifyAndConfirmAppointmentPayment({
      appointmentId, ...(withOrderId ? { orderId } : {}), paymentId: String(fixture.payment.id),
    });
    expect(result.success).toBe(true);
    expect(mocks.rpc).toHaveBeenCalledWith("confirm_appointment_from_payment", {
      p_appointment_id: appointmentId, p_order_id: orderId, p_paid_amount: 5000,
    });
    expect(mocks.notify).toHaveBeenCalledTimes(1);
    for (const call of fetchMock.mock.calls) expect(call[1].method).toBe("GET");
  });

  it.each(["missing_reference", "crossed_reference", "wrong_appointment", "wrong_currency", "underpaid", "pending", "rejected"])("refuses %s even when the Order total is correct", async scenario => {
    const fixture = useCheckoutResponse();
    if (scenario === "missing_reference") delete (fixture.order.transactions.payments[0] as { reference_id?: string }).reference_id;
    if (scenario === "crossed_reference") fixture.order.transactions.payments[0].reference_id = "999999999999";
    if (scenario === "wrong_appointment") fixture.payment.external_reference = "another-appointment";
    if (scenario === "wrong_currency") fixture.payment.currency_id = "USD";
    if (scenario === "underpaid") fixture.payment.transaction_amount = 1;
    if (scenario === "pending") fixture.payment.status = "pending";
    if (scenario === "rejected") fixture.payment.status = "rejected";
    expect((await verifyAndConfirmAppointmentPayment({ appointmentId, orderId, paymentId: String(fixture.payment.id) })).success).toBe(false);
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.notify).not.toHaveBeenCalled();
  });

  it("reprocessing and refreshing the same linked payment never create a new charge or resend confirmation", async () => {
    const fixture = useCheckoutResponse();
    const input = { appointmentId, orderId, paymentId: String(fixture.payment.id) };
    expect((await verifyAndConfirmAppointmentPayment(input)).success).toBe(true);
    mocks.rpc.mockResolvedValue({ data: [{ result_code: "ALREADY_CONFIRMED", appointment_status: "CONFIRMED" }] });
    expect((await verifyAndConfirmAppointmentPayment(input)).success).toBe(true);
    expect(mocks.notify).toHaveBeenCalledTimes(1);
    for (const call of fetchMock.mock.calls) expect(call[1].method).toBe("GET");
  });
});
