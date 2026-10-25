import { describe, expect, it } from "vitest";
import { checkoutReturnIdentifiers } from "./kani-payment-return";

describe("Checkout Pro return query normalization", () => {
  it("normalizes the real numeric search shape before calling .trim or the backend", () => {
    expect(checkoutReturnIdentifiers({
      appointment_id: "appointment-fixture", order_id: "ORD01AUDIT",
      payment_id: 123456789012, collection_id: 123456789012, merchant_order_id: 9876543210,
      status: "approved", collection_status: "approved",
    })).toEqual({ appointmentId: "appointment-fixture", orderId: "ORD01AUDIT", paymentId: "123456789012" });
  });
  it("preserves string identifiers and trims whitespace", () => {
    expect(checkoutReturnIdentifiers({ appointment_id: " fixture ", order_id: " ORD01 ", payment_id: " 123 " }))
      .toEqual({ appointmentId: "fixture", orderId: "ORD01", paymentId: "123" });
  });
  it("accepts external_reference and collection_id aliases without confusing merchant order ID", () => {
    expect(checkoutReturnIdentifiers({ external_reference: "fixture", collection_id: 123, merchant_order_id: 456 }))
      .toEqual({ appointmentId: "fixture", orderId: undefined, paymentId: "123" });
  });
  it.each([NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, 12.5, {}, [123], true, null])("rejects malformed or lossy payment IDs: %j", value => {
    expect(checkoutReturnIdentifiers({ payment_id: value }).paymentId).toBeUndefined();
  });
  it("approval query flags never create a verified identifier", () => {
    expect(checkoutReturnIdentifiers({ status: "approved", collection_status: "approved" }))
      .toEqual({ appointmentId: undefined, orderId: undefined, paymentId: undefined });
  });
});
