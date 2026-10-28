// Seeds from prisma/catalog.ts. DEVELOPMENT DATA: every price is SAMPLE until verified (see catalog.ts for the rules).
// Safe to re-run: it upserts, never touches orders or customers, and archives (not deletes) retired items.
import "dotenv/config";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { bundles, categories, products, serviceAreas } from "./catalog.js";
import { media } from "./catalog-media.js";
import { APPROVED_CATEGORIES } from "../src/lib/catalog.js";

const prisma = new PrismaClient();
const rupees = (n: number) => Math.round(n * 100);

async function main() {
  const adminEmail = process.env.SEED_ADMIN_EMAIL ?? "admin@example.com";
  const adminPass = process.env.SEED_ADMIN_PASSWORD ?? "ChangeMe123!";
  if (process.env.NODE_ENV === "production" && (!process.env.SEED_ADMIN_PASSWORD || adminPass === "ChangeMe123!" || adminPass.length < 8)) {
    console.warn("Admin NOT created: set SEED_ADMIN_EMAIL and a strong SEED_ADMIN_PASSWORD (not the default) to create the admin in production.");
  } else {
    await prisma.user.upsert({
      where: { email: adminEmail },
      update: {},
      create: { email: adminEmail, name: "Store Admin", role: "ADMIN", passwordHash: await bcrypt.hash(adminPass, 12) },
    });
  }

  const catId: Record<string, string> = {};
  for (const [i, c] of categories.entries()) {
    const data = { name: c.name, description: c.description, sortOrder: i, imageUrl: c.imageUrl ?? null, icon: null, isActive: true };
    catId[c.slug] = (await prisma.category.upsert({ where: { slug: c.slug }, update: data, create: { slug: c.slug, ...data } })).id;
  }
  // Anything outside the approved set stays hidden.
  await prisma.category.updateMany({ where: { slug: { notIn: [...APPROVED_CATEGORIES] } }, data: { isActive: false } });

  const prodId: Record<string, string> = {};
  for (const p of products) {
    const m = media[p.slug];
    if (!m) throw new Error(`No SKU/media entry for ${p.slug} in catalog-media.ts`);
    const image = m.image ?? p.image;
    const data = {
      sku: m.sku,
      variantGroup: m.variantGroup ?? null,
      name: p.name,
      brand: p.brand ?? null,
      packSize: p.packSize,
      description: p.description,
      details: p.details ?? null,
      stock: p.stock,
      popularity: p.popularity,
      priceMinor: rupees(p.price),
      mrpMinor: null, // MRP is stored only for verified prices
      priceStatus: "SAMPLE" as const,
      priceSourceUrl: null,
      priceVerifiedAt: null,
      priceNotes: p.priceNotes ?? null,
      categoryId: catId[p.category],
      isDemo: true,
      isActive: true,
    };
    const row = await prisma.product.upsert({ where: { slug: p.slug }, update: data, create: { slug: p.slug, ...data } });
    prodId[p.slug] = row.id;
    await prisma.productImage.deleteMany({ where: { productId: row.id } });
    await prisma.productImage.create({
      data: {
        productId: row.id,
        url: image.url,
        alt: image.alt,
        isPlaceholder: image.placeholder,
        sourceUrl: image.sourceUrl ?? null,
        license: image.license ?? null,
        attribution: image.attribution ?? null,
      },
    });
  }

  for (const b of bundles) {
    const data = { name: b.name, description: b.description, priceMinor: rupees(b.price), imageUrl: null, isActive: true };
    const row = await prisma.bundle.upsert({ where: { slug: b.slug }, update: data, create: { slug: b.slug, ...data } });
    await prisma.bundleItem.deleteMany({ where: { bundleId: row.id } });
    await prisma.bundleItem.createMany({ data: b.items.map(([s, quantity]) => ({ bundleId: row.id, productId: prodId[s], quantity })) });
  }
  await prisma.bundle.deleteMany({ where: { slug: { notIn: bundles.map((b) => b.slug) } } }); // bundles hold no order references

  // Retire demo products that left the catalog (delete if never ordered or bundled, else archive).
  const stale = await prisma.product.findMany({
    where: { isDemo: true, slug: { notIn: products.map((p) => p.slug) } },
    include: { _count: { select: { orderItems: true, bundleItems: true } } },
  });
  for (const s of stale) {
    if (s._count.orderItems || s._count.bundleItems) await prisma.product.update({ where: { id: s.id }, data: { isActive: false } });
    else await prisma.product.delete({ where: { id: s.id } });
  }

  for (const [pincode, areaName, city, state, etaMinutes] of serviceAreas)
    await prisma.serviceArea.upsert({ where: { pincode }, update: { areaName, city, state, etaMinutes, isSample: true }, create: { pincode, areaName, city, state, etaMinutes, isSample: true } });

  const discounts = [
    { code: "WELCOME10", type: "PERCENT" as const, value: 10, minSubtotalMinor: rupees(200) },
    { code: "FLAT50", type: "FIXED" as const, value: rupees(50), minSubtotalMinor: rupees(400) },
  ];
  for (const d of discounts) await prisma.discount.upsert({ where: { code: d.code }, update: d, create: d });

  console.log(`Seeded ${categories.length} categories, ${products.length} products (all SAMPLE prices), ${bundles.length} bundles; ${stale.length} stale demo products retired.`);
}

main().finally(() => prisma.$disconnect());
