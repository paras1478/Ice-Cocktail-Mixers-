import { Router } from "express";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../lib/db.js";
import { ah, parse } from "../lib/http.js";
import { HttpError } from "../lib/errors.js";
import { optionalAuth, requireAdmin } from "../middleware/auth.js";
import { isPublic, publicProductWhere } from "../lib/publish.js";
import { isApprovedCategory } from "../lib/catalog.js";
import { serializeProduct } from "../lib/serialize.js";
import { searchWhere } from "../lib/search.js";

export const productRouter = Router();
export const categoryRouter = Router();
export const searchRouter = Router();

const include = { images: true, category: true } as const;

const listQuery = z.object({
  q: z.string().trim().max(100).optional(),
  category: z.string().trim().optional(), // slug
  minPrice: z.coerce.number().int().min(0).optional(), // minor units
  maxPrice: z.coerce.number().int().min(0).optional(),
  inStock: z.enum(["true", "false"]).optional(),
  sort: z.enum(["popular", "price_asc", "price_desc", "newest"]).default("popular"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(60).default(12),
  includeInactive: z.enum(["true", "false"]).optional(),
});

productRouter.get(
  "/",
  optionalAuth,
  ah(async (req, res) => {
    const q = parse(listQuery, req.query);
    const showInactive = q.includeInactive === "true" && req.user?.role === "ADMIN";
    const where: Prisma.ProductWhereInput = {
      ...(showInactive ? {} : publicProductWhere()),
      ...(q.q ? searchWhere(q.q) : {}),
      ...(q.category ? { category: { ...(showInactive ? {} : { isActive: true }), slug: q.category } } : {}),
      ...(q.minPrice !== undefined || q.maxPrice !== undefined ? { priceMinor: { gte: q.minPrice, lte: q.maxPrice } } : {}),
      ...(q.inStock === "true" ? { stock: { gt: 0 } } : {}),
    };
    // A category filter must never widen the approved set.
    if (q.category && !showInactive && !isApprovedCategory(q.category)) where.id = "none";
    const orderBy: Prisma.ProductOrderByWithRelationInput[] =
      q.sort === "price_asc" ? [{ priceMinor: "asc" }] : q.sort === "price_desc" ? [{ priceMinor: "desc" }] : q.sort === "newest" ? [{ createdAt: "desc" }] : [{ popularity: "desc" }, { name: "asc" }];
    const [total, rows] = await Promise.all([
      prisma.product.count({ where }),
      prisma.product.findMany({ where, orderBy, include, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
    ]);
    res.json({ products: rows.map(serializeProduct), total, page: q.page, pageSize: q.pageSize, totalPages: Math.max(1, Math.ceil(total / q.pageSize)) });
  }),
);

// Cheapest and dearest listed price (minor units) for the current category/search, for the price-range slider.
productRouter.get(
  "/price-range",
  ah(async (req, res) => {
    const q = parse(listQuery.pick({ category: true, q: true }), req.query);
    const where: Prisma.ProductWhereInput = {
      ...publicProductWhere(),
      ...(q.q ? searchWhere(q.q) : {}),
      ...(q.category ? { category: { isActive: true, slug: q.category } } : {}),
    };
    if (q.category && !isApprovedCategory(q.category)) where.id = "none";
    const r = await prisma.product.aggregate({ where, _min: { priceMinor: true }, _max: { priceMinor: true }, _count: true });
    res.json({ minMinor: r._min.priceMinor, maxMinor: r._max.priceMinor, count: r._count });
  }),
);

productRouter.get(
  "/:id",
  optionalAuth,
  ah(async (req, res) => {
    const p = await prisma.product.findFirst({ where: { OR: [{ id: req.params.id }, { slug: req.params.id }] }, include });
    if (!p || (!isPublic(p) && req.user?.role !== "ADMIN")) throw new HttpError(404, "Product not found");
    const related = await prisma.product.findMany({
      where: { categoryId: p.categoryId, id: { not: p.id }, ...publicProductWhere() },
      orderBy: { popularity: "desc" },
      take: 4,
      include,
    });
    // Other pack sizes of the same product family (same variantGroup), cheapest-pack-first by size label order of creation.
    const packs = p.variantGroup
      ? await prisma.product.findMany({ where: { variantGroup: p.variantGroup, ...publicProductWhere() }, orderBy: { priceMinor: "asc" }, include })
      : [];
    res.json({ product: serializeProduct(p), related: related.filter((r) => !p.variantGroup || r.variantGroup !== p.variantGroup).map(serializeProduct), packs: packs.map(serializeProduct) });
  }),
);

const productBody = z.object({
  name: z.string().trim().min(2).max(120),
  slug: z.string().trim().regex(/^[a-z0-9-]+$/).max(120).optional(),
  sku: z.string().trim().min(2).max(40).nullable().optional(),
  variantGroup: z.string().trim().regex(/^[a-z0-9-]+$/, "Use lowercase letters, numbers and dashes").max(60).nullable().optional(),
  brand: z.string().trim().max(80).nullable().optional(),
  priceStatus: z.enum(["VERIFIED", "SAMPLE"]).default("SAMPLE"),
  priceSourceUrl: z.string().url().max(500).nullable().optional(),
  priceVerifiedAt: z.coerce.date().nullable().optional(),
  priceNotes: z.string().max(500).nullable().optional(),
  description: z.string().max(2000).default(""),
  details: z.string().max(2000).nullable().optional(),
  packSize: z.string().trim().min(1).max(60),
  priceMinor: z.number().int().min(1),
  mrpMinor: z.number().int().min(1).nullable().optional(),
  stock: z.number().int().min(0),
  lowStockAt: z.number().int().min(0).default(10),
  popularity: z.number().int().min(0).default(0),
  isActive: z.boolean().default(true),
  categoryId: z.string().min(1),
  images: z
    .array(
      z.object({
        url: z.string().trim().min(1).max(500).regex(/^(https?:\/\/[^\s]+|\/[^\s]*)$/, "Image must be an http(s) URL or a path starting with /"),
        alt: z.string().trim().min(1).max(200),
        isPlaceholder: z.boolean().default(true),
        sourceUrl: z.string().trim().min(2).max(500).nullable().optional(),
        license: z.string().max(200).nullable().optional(),
        attribution: z.string().max(200).nullable().optional(),
      }),
    )
    .max(8)
    .default([]),
});

const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

interface Provenance {
  priceStatus?: "VERIFIED" | "SAMPLE";
  priceSourceUrl?: string | null;
  priceVerifiedAt?: Date | null;
  images?: { isPlaceholder: boolean; sourceUrl?: string | null; license?: string | null }[];
}

/** A verified price needs a source and date; a real (non-placeholder) image needs a source and licence. */
function checkProvenance(b: Provenance) {
  if (b.priceStatus === "VERIFIED" && (!b.priceSourceUrl || !b.priceVerifiedAt))
    throw new HttpError(400, "A verified price needs a source URL and a verification date");
  for (const i of b.images ?? [])
    if (!i.isPlaceholder && (!i.sourceUrl || !i.license)) throw new HttpError(400, "A real product image needs a source URL and a licence/permission note");
}

function checkPrices(b: { priceMinor?: number; mrpMinor?: number | null }) {
  if (b.mrpMinor && b.priceMinor && b.mrpMinor < b.priceMinor) throw new HttpError(400, "MRP cannot be lower than the selling price");
}

/** Products can only live in an approved, active category. */
async function checkCategory(categoryId: string) {
  const c = await prisma.category.findUnique({ where: { id: categoryId } });
  if (!c || !c.isActive || !isApprovedCategory(c.slug)) throw new HttpError(400, "Choose one of the store categories");
}

productRouter.post(
  "/",
  requireAdmin,
  ah(async (req, res) => {
    const { images, ...b } = parse(productBody, req.body);
    checkPrices(b);
    checkProvenance({ ...b, images });
    await checkCategory(b.categoryId);
    const slug = b.slug ?? slugify(b.name);
    if (await prisma.product.findUnique({ where: { slug } })) throw new HttpError(409, "A product with this slug exists");
    if (b.sku && (await prisma.product.findUnique({ where: { sku: b.sku } }))) throw new HttpError(409, "A product with this SKU exists");
    const p = await prisma.product.create({
      data: { ...b, slug, isDemo: b.priceStatus !== "VERIFIED", images: { create: images.map((i, n) => ({ ...i, sortOrder: n })) } },
      include,
    });
    res.status(201).json({ product: serializeProduct(p) });
  }),
);

productRouter.put(
  "/:id",
  requireAdmin,
  ah(async (req, res) => {
    const { images, ...b } = parse(productBody.partial(), req.body);
    const existing = await prisma.product.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new HttpError(404, "Product not found");
    // Provenance is judged on the merged record, so e.g. switching to VERIFIED needs a source even if only the status is sent.
    checkProvenance({
      priceStatus: b.priceStatus ?? existing.priceStatus,
      priceSourceUrl: b.priceSourceUrl === undefined ? existing.priceSourceUrl : b.priceSourceUrl,
      priceVerifiedAt: b.priceVerifiedAt === undefined ? existing.priceVerifiedAt : b.priceVerifiedAt,
      images,
    });
    checkPrices({ priceMinor: b.priceMinor ?? existing.priceMinor, mrpMinor: b.mrpMinor === undefined ? existing.mrpMinor : b.mrpMinor });
    if (b.sku && b.sku !== existing.sku && (await prisma.product.findUnique({ where: { sku: b.sku } }))) throw new HttpError(409, "A product with this SKU exists");
    if (b.categoryId && b.categoryId !== existing.categoryId) await checkCategory(b.categoryId);
    const p = await prisma.$transaction(async (tx) => {
      if (images) {
        await tx.productImage.deleteMany({ where: { productId: existing.id } });
        await tx.productImage.createMany({ data: images.map((i, n) => ({ ...i, sortOrder: n, productId: existing.id })) });
      }
      return tx.product.update({ where: { id: existing.id }, data: { ...b, ...(b.priceStatus ? { isDemo: b.priceStatus !== "VERIFIED" } : {}) }, include });
    });
    res.json({ product: serializeProduct(p) });
  }),
);

productRouter.delete(
  "/:id",
  requireAdmin,
  ah(async (req, res) => {
    const p = await prisma.product.findUnique({ where: { id: req.params.id }, include: { _count: { select: { orderItems: true, bundleItems: true } } } });
    if (!p) throw new HttpError(404, "Product not found");
    // Products with order history (or in bundles) are archived instead of deleted to preserve records.
    if (p._count.orderItems || p._count.bundleItems) {
      await prisma.product.update({ where: { id: p.id }, data: { isActive: false } });
      return res.json({ archived: true });
    }
    await prisma.product.delete({ where: { id: p.id } });
    res.status(204).end();
  }),
);

// ---------- Categories (fixed, approved set; admins may edit their text/image but not add alcohol-style categories) ----------
categoryRouter.get(
  "/",
  optionalAuth,
  ah(async (req, res) => {
    const all = req.user?.role === "ADMIN" && req.query.all === "true";
    const cats = await prisma.category.findMany({
      where: all ? {} : { isActive: true },
      orderBy: { sortOrder: "asc" },
      include: { _count: { select: { products: { where: publicProductWhere() } } } },
    });
    // Party Bundles holds bundles, not products, so its count is the number of active bundles.
    const bundleCount = await prisma.bundle.count({ where: { isActive: true } });
    res.json({
      categories: cats.filter((c) => all || isApprovedCategory(c.slug)).map(({ _count, ...c }) => ({ ...c, productCount: c.slug === "party-bundles" ? bundleCount : _count.products })),
    });
  }),
);

categoryRouter.put(
  "/:id",
  requireAdmin,
  ah(async (req, res) => {
    const b = parse(
      z.object({ name: z.string().trim().min(2).max(80).optional(), description: z.string().max(500).optional(), imageUrl: z.string().max(500).nullable().optional(), sortOrder: z.number().int().optional() }),
      req.body,
    );
    const exists = await prisma.category.findUnique({ where: { id: req.params.id } });
    if (!exists) throw new HttpError(404, "Category not found");
    res.json({ category: await prisma.category.update({ where: { id: exists.id }, data: b }) });
  }),
);

// ---------- Search suggestions ----------
searchRouter.get(
  "/suggest",
  ah(async (req, res) => {
    const q = parse(z.object({ q: z.string().trim().min(1).max(60) }), req.query).q;
    const [products, categories] = await Promise.all([
      prisma.product.findMany({ where: { ...publicProductWhere(), ...searchWhere(q) }, orderBy: { popularity: "desc" }, take: 6, include }),
      prisma.category.findMany({ where: { isActive: true, slug: { in: ["ice-bags", "tonic-water", "club-soda", "margarita-mixes", "bitters", "citrus-garnishes", "party-bundles", "party-essentials"] }, name: { contains: q, mode: "insensitive" } }, take: 3 }),
    ]);
    res.json({ products: products.map(serializeProduct), categories: categories.map((c) => ({ id: c.id, slug: c.slug, name: c.name })) });
  }),
);
