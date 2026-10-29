import type { Prisma } from "@prisma/client";
import { env } from "../lib/env.js";
import { isPublic } from "../lib/publish.js";
import { HttpError } from "../lib/errors.js";
import { computeTotals, discountError, type DiscountRule, type PricingConfig } from "../lib/pricing.js";

export const pricingConfig: PricingConfig = {
  taxRateBps: env.TAX_RATE_BPS,
  deliveryFeeMinor: env.DELIVERY_FEE_MINOR,
  freeDeliveryThresholdMinor: env.FREE_DELIVERY_THRESHOLD_MINOR,
};

export interface RequestItem {
  productId: string;
  quantity: number;
}

/**
 * Loads products and computes an authoritative quote. Client-provided prices are never used, and only products
 * in the approved catalog (active, in an approved category) can be quoted.
 * `strict` throws on any stock/availability/discount problem; otherwise problems are reported in `issues`.
 */
export async function buildQuote(tx: Prisma.TransactionClient, items: RequestItem[], code: string | undefined, strict: boolean) {
  const merged = new Map<string, number>();
  for (const i of items) merged.set(i.productId, (merged.get(i.productId) ?? 0) + i.quantity);

  const products = await tx.product.findMany({
    where: { id: { in: [...merged.keys()] } },
    include: { images: true, category: true },
  });
  const byId = new Map(products.map((p) => [p.id, p]));
  const issues: { productId: string; message: string }[] = [];
  const lines: { productId: string; name: string; packSize: string; image?: string; unitMinor: number; quantity: number; stock: number }[] = [];

  for (const [productId, quantity] of merged) {
    const p = byId.get(productId);
    if (!p || !isPublic(p)) {
      issues.push({ productId, message: "This product is no longer available" });
      continue;
    }
    if (p.stock < quantity) issues.push({ productId, message: p.stock === 0 ? `${p.name} is out of stock` : `Only ${p.stock} of ${p.name} left` });
    lines.push({
      productId,
      name: p.name,
      packSize: p.packSize,
      image: [...p.images].sort((a, b) => a.sortOrder - b.sortOrder)[0]?.url,
      unitMinor: p.priceMinor,
      quantity,
      stock: p.stock,
    });
  }
  if (strict && issues.length) throw new HttpError(409, "Some items are unavailable", issues);

  let rule: DiscountRule | null = null;
  let discountId: string | null = null;
  let discountMessage: string | null = null;
  const subtotal = lines.reduce((s, l) => s + l.unitMinor * l.quantity, 0);
  if (code) {
    const d = await tx.discount.findUnique({ where: { code: code.trim().toUpperCase() } });
    rule = d;
    discountMessage = discountError(rule, subtotal);
    // The coupon is optional: one that is invalid, expired, fully redeemed or not eligible is IGNORED (no discount, original totals) and the
    // reason is returned so the customer can be told. It is never applied, and no other discount is substituted for it.
    if (discountMessage) rule = null;
    else if (d) discountId = d.id;
  }
  const totals = computeTotals(lines, rule, pricingConfig);
  return { lines, issues, totals, discountId, discountCode: rule?.code ?? null, discountMessage };
}
