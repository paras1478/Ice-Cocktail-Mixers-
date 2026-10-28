import type { Prisma } from "@prisma/client";
import { allowSamplePrices } from "./env.js";
import { APPROVED_CATEGORIES, isApprovedCategory } from "./catalog.js";

/**
 * Products customers may see and buy: active, in an active approved category and, in production,
 * priced with a verified price. Anything else (archived items, unapproved categories) never qualifies.
 */
export function publicProductWhere(allowSample = allowSamplePrices): Prisma.ProductWhereInput {
  return {
    isActive: true,
    category: { isActive: true, slug: { in: [...APPROVED_CATEGORIES] } },
    ...(allowSample ? {} : { priceStatus: "VERIFIED" }),
  };
}

export function isPublic(
  p: { isActive: boolean; priceStatus: string; category?: { slug: string; isActive: boolean } | null },
  allowSample = allowSamplePrices,
) {
  return p.isActive && !!p.category && p.category.isActive && isApprovedCategory(p.category.slug) && (allowSample || p.priceStatus === "VERIFIED");
}
