import type { Category, Product, ProductImage } from "@prisma/client";

type P = Product & { images: ProductImage[]; category?: Category };

export function serializeProduct(p: P) {
  // An original price (and therefore a discount) is only ever shown when the price is verified.
  const verified = p.priceStatus === "VERIFIED";
  const mrpMinor = verified && p.mrpMinor && p.mrpMinor > p.priceMinor ? p.mrpMinor : null;
  const discountPercent = mrpMinor ? Math.round(((mrpMinor - p.priceMinor) / mrpMinor) * 100) : 0;
  return {
    id: p.id,
    slug: p.slug,
    sku: p.sku,
    variantGroup: p.variantGroup,
    name: p.name,
    brand: p.brand,
    description: p.description,
    details: p.details,
    packSize: p.packSize,
    priceMinor: p.priceMinor,
    mrpMinor,
    priceStatus: p.priceStatus,
    priceSourceUrl: verified ? p.priceSourceUrl : null,
    priceVerifiedAt: verified ? p.priceVerifiedAt : null,
    priceNotes: p.priceNotes,
    discountPercent,
    stock: p.stock,
    inStock: p.stock > 0,
    lowStock: p.stock > 0 && p.stock <= p.lowStockAt,
    lowStockAt: p.lowStockAt,
    popularity: p.popularity,
    isActive: p.isActive,
    isDemo: p.isDemo,
    categoryId: p.categoryId,
    category: p.category ? { id: p.category.id, slug: p.category.slug, name: p.category.name } : undefined,
    images: [...p.images]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((i) => ({ url: i.url, alt: i.alt, isPlaceholder: i.isPlaceholder, license: i.license, attribution: i.attribution, sourceUrl: i.sourceUrl, lastCheckOk: i.lastCheckOk })),
  };
}
