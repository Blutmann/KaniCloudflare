import { describe, expect, it } from "vitest";
import { paymentAmounts } from "./kani-payment-amounts";
describe("economic changes retain discount intent and protect deposits", () => {
  it("retains a nominal discount after changing service", () => {
    expect(paymentAmounts(25000, "FIXED", 5000).final).toBe(20000);
    expect(paymentAmounts(30000, "FIXED", 5000).final).toBe(25000);
  });
  it("recalculates a percentage after changing service", () => {
    expect(paymentAmounts(25000, "PERCENT", 10).final).toBe(22500);
    expect(paymentAmounts(30000, "PERCENT", 10).final).toBe(27000);
  });
  it("allows explicit totals and deducts the deposit only once", () => {
    expect(paymentAmounts(30000, "FIXED", 5000, 24000, 5000)).toEqual({
      discount: 5000,
      final: 24000,
      collected: 19000,
    });
  });
  it("voids an eligible payment without deleting it", () => {
    expect(paymentAmounts(0, "FIXED", 0, null, 0, true)).toEqual({
      discount: 0,
      final: 0,
      collected: 0,
    });
    expect(() => paymentAmounts(0, "FIXED", 0, null, 5000, true)).toThrow();
  });
  it.each([
    [30000, "PERCENT", 101, null, 0],
    [25000, "FIXED", -1, null, 0],
    [30000, "FIXED", 0, 4999, 5000],
    [25000, "FIXED", 0, -1, 0],
  ] as const)("rejects invalid amounts", (p, k, d, f, dep) => {
    expect(() => paymentAmounts(p, k, d, f, dep)).toThrow();
  });
});
