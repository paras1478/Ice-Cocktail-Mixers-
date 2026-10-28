// Pure pricing logic. All values are integer minor units (paise); no floats are persisted.
export interface DiscountRule {
  code: string;
  type: "PERCENT" | "FIXED";
  value: number;
  minSubtotalMinor: number;
  maxUses: number | null;
  usedCount: number;
  expiresAt: Date | null;
  isActive: boolean;
}

export interface PricingConfig {
  taxRateBps: number;
  deliveryFeeMinor: number;
  freeDeliveryThresholdMinor: number;
}

export interface Totals {
  subtotalMinor: number;
  discountMinor: number;
  deliveryMinor: number;
  taxMinor: number;
  totalMinor: number;
}

/** Returns an error message if the discount cannot be applied, otherwise null. */
export function discountError(rule: DiscountRule | null, subtotalMinor: number, now = new Date()): string | null {
  if (!rule || !rule.isActive) return "Invalid discount code";
  if (rule.expiresAt && rule.expiresAt <= now) return "This discount code has expired";
  if (rule.maxUses !== null && rule.usedCount >= rule.maxUses) return "This discount code is fully redeemed";
  if (subtotalMinor < rule.minSubtotalMinor)
    return `Minimum order of ₹${(rule.minSubtotalMinor / 100).toFixed(2)} required for this code`;
  return null;
}

export function discountAmount(rule: DiscountRule, subtotalMinor: number): number {
  const raw = rule.type === "PERCENT" ? Math.floor((subtotalMinor * rule.value) / 100) : rule.value;
  return Math.min(Math.max(raw, 0), subtotalMinor);
}

export function computeTotals(
  lines: { unitMinor: number; quantity: number }[],
  discount: DiscountRule | null,
  cfg: PricingConfig,
): Totals {
  const subtotalMinor = lines.reduce((s, l) => s + l.unitMinor * l.quantity, 0);
  const discountMinor = discount && !discountError(discount, subtotalMinor) ? discountAmount(discount, subtotalMinor) : 0;
  const taxable = subtotalMinor - discountMinor;
  const deliveryMinor = subtotalMinor === 0 || subtotalMinor >= cfg.freeDeliveryThresholdMinor ? 0 : cfg.deliveryFeeMinor;
  const taxMinor = Math.round((taxable * cfg.taxRateBps) / 10000);
  return { subtotalMinor, discountMinor, deliveryMinor, taxMinor, totalMinor: taxable + deliveryMinor + taxMinor };
}
