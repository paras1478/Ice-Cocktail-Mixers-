import { describe, expect, it } from "vitest";
import { computeTotals, discountAmount, discountError, type DiscountRule } from "../src/lib/pricing.js";

const cfg = { taxRateBps: 1800, deliveryFeeMinor: 2900, freeDeliveryThresholdMinor: 39900 };
const rule = (o: Partial<DiscountRule> = {}): DiscountRule => ({ code: "X", type: "PERCENT", value: 10, minSubtotalMinor: 0, maxUses: null, usedCount: 0, expiresAt: null, isActive: true, ...o });

describe("computeTotals", () => {
  it("adds tax on the discounted subtotal and the delivery fee below the threshold", () => {
    const t = computeTotals([{ unitMinor: 10000, quantity: 2 }], rule(), cfg);
    expect(t).toEqual({ subtotalMinor: 20000, discountMinor: 2000, deliveryMinor: 2900, taxMinor: 3240, totalMinor: 18000 + 3240 + 2900 });
  });
  it("waives delivery at or above the threshold and for an empty cart", () => {
    expect(computeTotals([{ unitMinor: 39900, quantity: 1 }], null, cfg).deliveryMinor).toBe(0);
    expect(computeTotals([], null, cfg).totalMinor).toBe(0);
  });
  it("never discounts below zero and keeps integers", () => {
    expect(discountAmount(rule({ type: "FIXED", value: 99999 }), 5000)).toBe(5000);
    expect(Number.isInteger(computeTotals([{ unitMinor: 333, quantity: 3 }], rule({ value: 7 }), cfg).totalMinor)).toBe(true);
  });
});

describe("discountError", () => {
  it("explains each failure", () => {
    expect(discountError(null, 100)).toMatch(/Invalid/);
    expect(discountError(rule({ isActive: false }), 100)).toMatch(/Invalid/);
    expect(discountError(rule({ expiresAt: new Date(0) }), 100)).toMatch(/expired/);
    expect(discountError(rule({ maxUses: 1, usedCount: 1 }), 100)).toMatch(/redeemed/);
    expect(discountError(rule({ minSubtotalMinor: 500 }), 100)).toMatch(/Minimum order of ₹5.00/);
    expect(discountError(rule(), 100)).toBeNull();
  });
});
