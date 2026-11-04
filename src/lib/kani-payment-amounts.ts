export type DiscountKind = "FIXED" | "PERCENT";

export function canonicalPaymentService(name: string): string {
  if (name === "Corte de cabello") return "Corte";
  if (name === "Corte + barba") return "Corte y barba";
  if (name === "Otro") return "Otros";
  return name;
}

export function paymentAmounts(
  price: number,
  kind: DiscountKind,
  value: number,
  override?: number | null,
  deposit = 0,
  voided = false,
) {
  if (voided) {
    if (deposit > 0) throw new Error("Un cobro con seña no puede anularse.");
    return { discount: 0, final: 0, collected: 0 };
  }
  if (
    !Number.isSafeInteger(price) ||
    price <= 0 ||
    !Number.isFinite(value) ||
    value < 0 ||
    (kind === "PERCENT" && value > 100) ||
    !Number.isSafeInteger(deposit) ||
    deposit < 0
  ) {
    throw new Error("Revisá el precio y el descuento.");
  }
  const discount = Math.round(kind === "PERCENT" ? (price * value) / 100 : value);
  const final = override ?? price - discount;
  if (discount > price || !Number.isSafeInteger(final) || final < deposit) {
    throw new Error("El importe final no puede ser negativo ni menor que la seña.");
  }
  return { discount, final, collected: final - deposit };
}
