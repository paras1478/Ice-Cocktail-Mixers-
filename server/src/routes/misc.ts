import { onlinePaymentsEnabled } from "../lib/razorpay.js";
import { Router } from "express";
import { z } from "zod";
import rateLimit from "express-rate-limit";
import { prisma } from "../lib/db.js";
import { ah, parse } from "../lib/http.js";
import { HttpError } from "../lib/errors.js";
import { env } from "../lib/env.js";
import { optionalAuth, requireAdmin } from "../middleware/auth.js";
import { isPublic } from "../lib/publish.js";
import { pricingConfig } from "../services/checkout.js";
import { listCustomers } from "../services/accounts.js";
import { serviceability } from "../lib/address.js";
import { lookupPincode, reverseGeocode, searchPlaces } from "../lib/geo.js";

export const publicRouter = Router();
export const adminRouter = Router();

const pin = z.string().regex(/^[1-9]\d{5}$/, "Enter a valid 6-digit PIN code");

// ---------- Public config & delivery ----------
publicRouter.get("/config", (_req, res) => {
  res.json({
    currency: "INR",
    deliveryFeeMinor: pricingConfig.deliveryFeeMinor,
    freeDeliveryThresholdMinor: pricingConfig.freeDeliveryThresholdMinor,
    taxRateBps: pricingConfig.taxRateBps,
    payments: { cod: env.ENABLE_COD === "true", card: Boolean(env.STRIPE_SECRET_KEY), online: onlinePaymentsEnabled() },
    google: { webClientId: env.GOOGLE_CLIENT_ID ?? null, androidClientId: env.GOOGLE_ANDROID_CLIENT_ID ?? null, iosClientId: env.GOOGLE_IOS_CLIENT_ID ?? null },
    voice: { enabled: Boolean(env.OPENAI_API_KEY) },
    location: { pincodeLookup: true, reverseGeocoding: true, addressSearch: !!env.GEOAPIFY_API_KEY },
  });
});

// Delivery coverage only (our ServiceArea table).
publicRouter.get(
  "/delivery/check",
  ah(async (req, res) => {
    const { pincode } = parse(z.object({ pincode: pin }), req.query);
    res.json(await serviceability(pincode));
  }),
);

publicRouter.get(
  "/delivery/areas",
  ah(async (_req, res) => {
    res.json({ areas: await prisma.serviceArea.findMany({ where: { isActive: true }, orderBy: [{ state: "asc" }, { city: "asc" }, { pincode: "asc" }] }) });
  }),
);

// Postal lookup (area / district / state suggestions) AND, separately, whether we deliver there.
// A failing postal service never hides the serviceability answer, and never fakes a lookup result.
// Protects the upstream postal service (and us) from hammering; lookups are cached server-side, so normal use stays far below this.
const pincodeLimiter = rateLimit({
  windowMs: 60_000,
  limit: env.NODE_ENV === "test" ? 10_000 : 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many PIN code lookups. Please wait a moment and try again." },
});

// Reverse geocoding and address search use Geoapify credits per request, so they get their own, tighter limit.
const geoLimiter = rateLimit({
  windowMs: 60_000,
  limit: env.NODE_ENV === "test" ? 10_000 : 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many location lookups. Please wait a moment and try again." },
});

const POSTAL_WAIT_MS = 2500;

publicRouter.get(
  "/pincode/:pin",
  pincodeLimiter,
  ah(async (req, res) => {
    const { pin: pincode } = parse(z.object({ pin }), req.params);
    const delivery = await serviceability(pincode);
    try {
      // Delivery (our own table) is already known. The postal lookup is only extra detail, so a slow provider must not hold the answer back:
      // wait a short while, then answer without it (the lookup keeps running and fills the cache for the next request).
      let slow: NodeJS.Timeout | undefined;
      const postal = await Promise.race([
        lookupPincode(pincode),
        new Promise<never>((_, reject) => { slow = setTimeout(() => reject(new HttpError(502, "The postal PIN lookup service is slow right now (timed out). You can enter the area, district and state manually.")), POSTAL_WAIT_MS); }),
      ]).finally(() => clearTimeout(slow));
      res.json({ pincode, postal: postal ? { status: "found", ...postal } : { status: "not_found" }, delivery });
    } catch (e) {
      if (!(e instanceof HttpError)) throw e;
      res.json({ pincode, postal: { status: "unavailable", message: e.message }, delivery });
    }
  }),
);

publicRouter.post(
  "/geo/reverse",
  geoLimiter,
  ah(async (req, res) => {
    const b = parse(z.object({ latitude: z.number().min(6).max(38), longitude: z.number().min(68).max(98) }), req.body);
    res.json(await reverseGeocode(b.latitude, b.longitude));
  }),
);

publicRouter.post(
  "/geo/search",
  geoLimiter,
  ah(async (req, res) => {
    const b = parse(z.object({ query: z.string().trim().min(3).max(200) }), req.body);
    res.json({ results: await searchPlaces(b.query) });
  }),
);

// ---------- Bundles ----------
const bundleInclude = { items: { include: { product: { include: { images: true, category: true } } } } } as const;

function serializeBundle(b: Awaited<ReturnType<typeof prisma.bundle.findFirstOrThrow<{ include: typeof bundleInclude }>>>) {
  const items = b.items.map((i) => ({
    productId: i.productId,
    name: i.product.name,
    packSize: i.product.packSize,
    quantity: i.quantity,
    unitMinor: i.product.priceMinor,
    inStock: isPublic(i.product) && i.product.stock >= i.quantity,
    image: [...i.product.images].sort((x, y) => x.sortOrder - y.sortOrder)[0]?.url,
  }));
  const regularMinor = items.reduce((s, i) => s + i.unitMinor * i.quantity, 0);
  return {
    id: b.id, slug: b.slug, name: b.name, description: b.description, imageUrl: b.imageUrl, isActive: b.isActive,
    priceMinor: b.priceMinor,
    regularMinor,
    savingsMinor: Math.max(0, regularMinor - b.priceMinor),
    inStock: items.length > 0 && items.every((i) => i.inStock),
    items,
  };
}

publicRouter.get(
  "/bundles",
  optionalAuth,
  ah(async (req, res) => {
    const admin = req.user?.role === "ADMIN" && req.query.includeInactive === "true";
    const rows = await prisma.bundle.findMany({ where: admin ? {} : { isActive: true }, include: bundleInclude, orderBy: { name: "asc" } });
    res.json({ bundles: rows.map(serializeBundle) });
  }),
);

// ---------- Admin ----------
adminRouter.use(requireAdmin);

const bundleBody = z.object({
  name: z.string().trim().min(2).max(120),
  slug: z.string().trim().regex(/^[a-z0-9-]+$/).max(120).optional(),
  description: z.string().max(1000).default(""),
  priceMinor: z.number().int().min(1),
  isActive: z.boolean().default(true),
  items: z.array(z.object({ productId: z.string().min(1), quantity: z.number().int().min(1).max(50) })).min(1, "Add at least one item"),
});
const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

async function checkBundleItems(items: { productId: string }[]) {
  const ps = await prisma.product.findMany({ where: { id: { in: items.map((i) => i.productId) } }, include: { category: true } });
  if (ps.length !== new Set(items.map((i) => i.productId)).size) throw new HttpError(400, "One of the bundle products does not exist");
  if (ps.some((p) => !isPublic(p, true))) throw new HttpError(400, "Bundles can only contain active products from the store categories");
}

adminRouter.post(
  "/bundles",
  ah(async (req, res) => {
    const { items, ...b } = parse(bundleBody, req.body);
    await checkBundleItems(items);
    const slug = b.slug ?? slugify(b.name);
    if (await prisma.bundle.findUnique({ where: { slug } })) throw new HttpError(409, "A bundle with this slug exists");
    const row = await prisma.bundle.create({ data: { ...b, slug, items: { create: items } }, include: bundleInclude });
    res.status(201).json({ bundle: serializeBundle(row) });
  }),
);

adminRouter.put(
  "/bundles/:id",
  ah(async (req, res) => {
    const { items, ...b } = parse(bundleBody.partial(), req.body);
    if (!(await prisma.bundle.findUnique({ where: { id: req.params.id } }))) throw new HttpError(404, "Bundle not found");
    if (items) await checkBundleItems(items);
    const row = await prisma.$transaction(async (tx) => {
      if (items) {
        await tx.bundleItem.deleteMany({ where: { bundleId: req.params.id } });
        await tx.bundleItem.createMany({ data: items.map((i) => ({ ...i, bundleId: req.params.id })) });
      }
      return tx.bundle.update({ where: { id: req.params.id }, data: b, include: bundleInclude });
    });
    res.json({ bundle: serializeBundle(row) });
  }),
);

adminRouter.delete(
  "/bundles/:id",
  ah(async (req, res) => {
    const r = await prisma.bundle.deleteMany({ where: { id: req.params.id } });
    if (!r.count) throw new HttpError(404, "Bundle not found");
    res.status(204).end();
  }),
);

const discountBody = z.object({
  code: z.string().trim().toUpperCase().min(3).max(40),
  type: z.enum(["PERCENT", "FIXED"]),
  value: z.number().int().min(1),
  minSubtotalMinor: z.number().int().min(0).default(0),
  maxUses: z.number().int().min(1).nullable().optional(),
  expiresAt: z.coerce.date().nullable().optional(),
  isActive: z.boolean().default(true),
});

adminRouter.get("/discounts", ah(async (_req, res) => res.json({ discounts: await prisma.discount.findMany({ orderBy: { code: "asc" } }) })));

adminRouter.post(
  "/discounts",
  ah(async (req, res) => {
    const b = parse(discountBody.refine((d) => d.type !== "PERCENT" || d.value <= 100, { message: "A percentage discount cannot exceed 100", path: ["value"] }), req.body);
    if (await prisma.discount.findUnique({ where: { code: b.code } })) throw new HttpError(409, "This code already exists");
    res.status(201).json({ discount: await prisma.discount.create({ data: b }) });
  }),
);

adminRouter.put(
  "/discounts/:id",
  ah(async (req, res) => {
    const b = parse(discountBody.partial(), req.body);
    const d = await prisma.discount.findUnique({ where: { id: req.params.id } });
    if (!d) throw new HttpError(404, "Discount not found");
    if ((b.type ?? d.type) === "PERCENT" && (b.value ?? d.value) > 100) throw new HttpError(400, "A percentage discount cannot exceed 100");
    res.json({ discount: await prisma.discount.update({ where: { id: d.id }, data: b }) });
  }),
);

adminRouter.delete(
  "/discounts/:id",
  ah(async (req, res) => {
    const d = await prisma.discount.findUnique({ where: { id: req.params.id }, include: { _count: { select: { orders: true } } } });
    if (!d) throw new HttpError(404, "Discount not found");
    if (d._count.orders) {
      await prisma.discount.update({ where: { id: d.id }, data: { isActive: false } });
      return res.json({ archived: true });
    }
    await prisma.discount.delete({ where: { id: d.id } });
    res.status(204).end();
  }),
);

// Delivery coverage management (the operator decides where, and how fast, we really deliver).
adminRouter.get("/service-areas", ah(async (_req, res) => res.json({ areas: await prisma.serviceArea.findMany({ orderBy: [{ state: "asc" }, { city: "asc" }, { pincode: "asc" }] }) })));

adminRouter.put(
  "/service-areas/:pincode",
  ah(async (req, res) => {
    const { pincode } = parse(z.object({ pincode: pin }), req.params);
    const b = parse(
      z.object({
        areaName: z.string().trim().min(2).max(120),
        city: z.string().trim().max(80).nullable().optional(),
        state: z.string().trim().max(80).nullable().optional(),
        etaMinutes: z.number().int().min(5).max(360),
        isActive: z.boolean().default(true),
        isSample: z.boolean().default(false),
      }),
      req.body,
    );
    res.json({ area: await prisma.serviceArea.upsert({ where: { pincode }, update: b, create: { pincode, ...b } }) });
  }),
);

adminRouter.get(
  "/stats",
  ah(async (_req, res) => {
    const [orders, customers, products, byStatus, revenue, lowStock] = await Promise.all([
      prisma.order.count(),
      prisma.user.count({ where: { role: "CUSTOMER" } }),
      prisma.product.count({ where: { isActive: true } }),
      prisma.order.groupBy({ by: ["status"], _count: true }),
      prisma.order.aggregate({ _sum: { totalMinor: true }, where: { status: { not: "CANCELLED" } } }),
      prisma.product.findMany({ where: { isActive: true, stock: { lte: 10 } }, orderBy: { stock: "asc" }, take: 20, select: { id: true, name: true, packSize: true, stock: true, lowStockAt: true } }),
    ]);
    res.json({
      orders, customers, products,
      revenueMinor: revenue._sum.totalMinor ?? 0,
      byStatus: Object.fromEntries(byStatus.map((s) => [s.status, s._count])),
      lowStock: lowStock.filter((p) => p.stock <= p.lowStockAt),
    });
  }),
);

adminRouter.get(
  "/customers",
  ah(async (req, res) => {
    const q = parse(
      z.object({
        q: z.string().trim().max(100).optional(),
        status: z.enum(["active", "disabled"]).optional(),
        sort: z.enum(["joined", "lastLogin", "name"]).optional(),
        page: z.coerce.number().int().min(1).default(1),
        pageSize: z.coerce.number().int().min(1).max(100).default(20),
      }),
      req.query,
    );
    res.json(await listCustomers(prisma, q));
  }),
);

adminRouter.get(
  "/customers/:id/orders",
  ah(async (req, res) => {
    res.json({ orders: await prisma.order.findMany({ where: { userId: req.params.id }, orderBy: { createdAt: "desc" }, include: { items: true, payment: true } }) });
  }),
);
