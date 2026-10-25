/** TanStack search parsing may deserialize numeric Mercado Pago identifiers. */
function paymentIdentifier(value: unknown): string | undefined {
  if (typeof value === "string") return value.trim() || undefined;
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return String(value);
  return undefined;
}

export function checkoutReturnIdentifiers(search: Record<string, unknown>) {
  return {
    appointmentId: paymentIdentifier(search.appointment_id) ?? paymentIdentifier(search.external_reference),
    // merchant_order_id belongs to the legacy API and is never a canonical Orders ID.
    orderId: paymentIdentifier(search.order_id),
    paymentId: paymentIdentifier(search.payment_id) ?? paymentIdentifier(search.collection_id),
  };
}
