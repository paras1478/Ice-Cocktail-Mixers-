// The approved storefront catalog. Only products in these categories can be listed, carted or ordered.
// Ice & Cocktail Mixers Express sells non-alcoholic items only; there is deliberately no alcohol category.
export const APPROVED_CATEGORIES = [
  "ice-bags",
  "tonic-water",
  "club-soda",
  "margarita-mixes",
  "bitters",
  "citrus-garnishes",
  "party-bundles",
  "party-essentials",
] as const;

export type ApprovedCategory = (typeof APPROVED_CATEGORIES)[number];
export const isApprovedCategory = (slug: string): slug is ApprovedCategory => (APPROVED_CATEGORIES as readonly string[]).includes(slug);
