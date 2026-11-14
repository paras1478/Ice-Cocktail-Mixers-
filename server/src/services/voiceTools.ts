import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../lib/db.js";
import { HttpError } from "../lib/errors.js";
import { publicProductWhere, isPublic } from "../lib/publish.js";
import { searchWhere } from "../lib/search.js";
import { buildQuote } from "./checkout.js";
import { addCartItem, loadCart, removeCartItem, setCartItemQuantity } from "./cart.js";

/**
 * The tools the voice assistant may call. Each one runs on the server as the logged-in customer and reuses the shop's own rules
 * (approved catalog guard, stock checks, cart ownership), so the model can never see or change anything the website could not.
 * Every result is { ok: true, ... } or { ok: false, error }, and the assistant is told to confirm only what the result says.
 */

// The model sometimes sends null for an optional field; treat that as "not given".
const opt = <T extends z.ZodType>(s: T) => s.nullish().transform((v) => v ?? undefined);
const productRef = z.string().trim().min(1).max(80);

const searchArgs = z.object({
  query: opt(z.string().trim().max(100)),
  category: opt(z.string().trim().max(60)),
  min_price_rupees: opt(z.number().min(0).max(1_000_000)),
  max_price_rupees: opt(z.number().min(0).max(1_000_000)),
  in_stock_only: opt(z.boolean()),
  sort: opt(z.enum(["popular", "price_asc", "price_desc"])),
  limit: opt(z.number().int().min(1).max(8)),
});

export const voiceToolCall = z.discriminatedUnion("name", [
  z.object({ name: z.literal("search_products"), arguments: searchArgs }),
  z.object({ name: z.literal("get_product_details"), arguments: z.object({ product_id: productRef, quantity: opt(z.number().int().min(1).max(50)) }) }),
  z.object({ name: z.literal("find_alternatives"), arguments: z.object({ product_id: productRef }) }),
  z.object({ name: z.literal("get_cart"), arguments: z.object({}).passthrough() }),
  z.object({ name: z.literal("add_to_cart"), arguments: z.object({ product_id: productRef, quantity: opt(z.number().int().min(1).max(50)) }) }),
  z.object({ name: z.literal("set_cart_quantity"), arguments: z.object({ product_id: productRef, quantity: z.number().int().min(0).max(50) }) }),
  z.object({ name: z.literal("remove_from_cart"), arguments: z.object({ product_id: productRef }) }),
]);
export type VoiceToolCall = z.infer<typeof voiceToolCall>;

/** Tool definitions in the shape the Realtime API expects (kept next to the validators above so the two cannot drift). */
export const voiceToolDefinitions = [
  {
    type: "function",
    name: "search_products",
    description:
      "Search the live ICE Cocktail catalog (non-alcoholic products only). Use short keywords from the customer's wish or mood (e.g. 'tonic', 'lemon', 'ice', 'fizzy', 'citrus'). Also use it for budgets and to list a category. Returns real products with ids, prices in rupees and stock.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "One to three keywords. Leave empty to browse the most popular products." },
        category: { type: "string", description: "Optional category name or slug, from the list of categories you were given." },
        min_price_rupees: { type: "number" },
        max_price_rupees: { type: "number", description: "Budget ceiling in rupees, e.g. 150." },
        in_stock_only: { type: "boolean", description: "Default true." },
        sort: { type: "string", enum: ["popular", "price_asc", "price_desc"] },
        limit: { type: "integer", description: "1-8, default 5." },
      },
    },
  },
  {
    type: "function",
    name: "get_product_details",
    description: "Get one product's description, ingredients (only if the label data exists), price, pack sizes and live stock. Use before answering questions about a product, price or availability.",
    parameters: {
      type: "object",
      properties: { product_id: { type: "string", description: "The id from a search result." }, quantity: { type: "integer", description: "Optional: check whether this many are in stock." } },
      required: ["product_id"],
    },
  },
  {
    type: "function",
    name: "find_alternatives",
    description: "Find in-stock similar products (same category, closest price) when a product is unavailable or the customer wants other options.",
    parameters: { type: "object", properties: { product_id: { type: "string" } }, required: ["product_id"] },
  },
  { type: "function", name: "get_cart", description: "Read the customer's cart: lines, quantities and the authoritative total (subtotal, delivery, tax, total).", parameters: { type: "object", properties: {} } },
  {
    type: "function",
    name: "add_to_cart",
    description: "Add a product to the customer's cart. Only call after the customer clearly asked to add it. Say it was added only if the result has ok:true.",
    parameters: { type: "object", properties: { product_id: { type: "string" }, quantity: { type: "integer", description: "Default 1." } }, required: ["product_id"] },
  },
  {
    type: "function",
    name: "set_cart_quantity",
    description: "Set the exact quantity of a product that is already in the cart (use 0 to remove it).",
    parameters: { type: "object", properties: { product_id: { type: "string" }, quantity: { type: "integer" } }, required: ["product_id", "quantity"] },
  },
  {
    type: "function",
    name: "remove_from_cart",
    description: "Remove a product from the cart.",
    parameters: { type: "object", properties: { product_id: { type: "string" } }, required: ["product_id"] },
  },
] as const;

/** Tools that change the customer's cart; the browser refreshes its cart after one of these. */
export const CART_CHANGING_TOOLS = new Set(["add_to_cart", "set_cart_quantity", "remove_from_cart"]);

const rupees = (minor: number) => Math.round(minor) / 100;
const label = (minor: number) => `₹${Number.isInteger(minor / 100) ? minor / 100 : (minor / 100).toFixed(2)}`;
const clip = (s: string | null | undefined, n: number) => (s && s.length > n ? `${s.slice(0, n - 1)}…` : s ?? "");

const productInclude = { images: true, category: true } as const;
type ProductRow = Prisma.ProductGetPayload<{ include: typeof productInclude }>;

function summarize(p: ProductRow) {
  return {
    id: p.id,
    slug: p.slug,
    name: p.name,
    brand: p.brand,
    category: p.category.name,
    packSize: p.packSize,
    priceRupees: rupees(p.priceMinor),
    price: label(p.priceMinor),
    // Prices in this catalog may be unverified samples; the assistant is told never to invent a discount or an original price.
    priceIsSample: p.priceStatus !== "VERIFIED",
    inStock: p.stock > 0,
    stockLeft: p.stock > 0 && p.stock <= p.lowStockAt ? p.stock : undefined,
    description: clip(p.description, 160),
    image: [...p.images].sort((x, y) => x.sortOrder - y.sortOrder)[0]?.url ?? null,
  };
}

const STOP = new Set(["the", "and", "for", "with", "some", "any", "kuch", "mujhe", "chahiye", "ek", "hai", "ki", "ka", "ke", "ko", "me", "mein"]);
const tokens = (q?: string) => (q ?? "").toLowerCase().split(/[^a-z0-9ऀ-ॿ]+/).filter((t) => t.length >= 2 && !STOP.has(t)).slice(0, 5);

async function findProduct(ref: string) {
  const p = await prisma.product.findFirst({ where: { OR: [{ id: ref }, { slug: ref }] }, include: productInclude });
  if (!p || !isPublic(p)) throw new HttpError(404, "I could not find that product in the store");
  return p;
}

async function search(a: z.infer<typeof searchArgs>) {
  const and: Prisma.ProductWhereInput[] = [publicProductWhere()];
  if (a.category) {
    const c = a.category.trim();
    and.push({ category: { OR: [{ slug: c.toLowerCase().replace(/[^a-z0-9]+/g, "-") }, { name: { contains: c, mode: "insensitive" } }] } });
  }
  if (a.min_price_rupees !== undefined || a.max_price_rupees !== undefined)
    and.push({
      priceMinor: {
        gte: a.min_price_rupees !== undefined ? Math.round(a.min_price_rupees * 100) : undefined,
        lte: a.max_price_rupees !== undefined ? Math.round(a.max_price_rupees * 100) : undefined,
      },
    });
  if (a.in_stock_only !== false) and.push({ stock: { gt: 0 } });
  const ts = tokens(a.query);
  const keywords: Prisma.ProductWhereInput[] = ts.length ? [{ OR: ts.map(searchWhere) }] : [];
  const sort = a.sort ?? "popular";
  const run =(where: Prisma.ProductWhereInput[]) =>
    prisma.product.findMany({
      where: { AND: where },
      orderBy: sort === "price_asc" ? [{ priceMinor: "asc" }] : sort === "price_desc" ? [{ priceMinor: "desc" }] : [{ popularity: "desc" }, { name: "asc" }],
      include: productInclude,
      take: a.limit ?? 5,
    });
  let rows = await run([...and, ...keywords]);
  // Descriptions describe the product, not a mood, so "refreshing" or "fruity" often match nothing. Rather than answer "nothing found", fall back to the most
  // popular products that still fit the category, budget and stock, and say so, so the assistant recommends honestly (never claims a keyword match).
  const keywordMiss = rows.length === 0 && keywords.length > 0;
  if (keywordMiss) rows = await run(and);
  return {
    ok: true,
    count: rows.length,
    products: rows.map(summarize),
    ...(keywordMiss && rows.length ? { noKeywordMatch: true, note: "No product mentions those words. These are our most popular products within the filters: pick the ones that genuinely suit the customer's wish (by name and category) and say you are suggesting based on what we have." } : {}),
    ...(rows.length ? {} : { note: "No product fits these filters. Offer to widen the budget or suggest browsing a category." }),
  };
}

async function details(ref: string, quantity?: number) {
  const p = await findProduct(ref);
  const packs = p.variantGroup
    ? await prisma.product.findMany({ where: { AND: [publicProductWhere(), { variantGroup: p.variantGroup }] }, orderBy: { priceMinor: "asc" }, include: productInclude })
    : [];
  return {
    ok: true,
    product: {
      ...summarize(p),
      description: p.description,
      ingredients: p.details || null, // only ever from the product label; null means "not listed", never guess
      stock: p.stock,
      packSizes: packs.map((v) => ({ id: v.id, packSize: v.packSize, price: label(v.priceMinor), inStock: v.stock > 0 })),
      image: [...p.images].sort((x, y) => x.sortOrder - y.sortOrder)[0]?.url ?? null,
    },
    ...(quantity ? { requested: quantity, canFulfillRequested: p.stock >= quantity } : {}),
  };
}

async function alternatives(ref: string) {
  const p = await findProduct(ref);
  const pool = await prisma.product.findMany({
    where: { AND: [publicProductWhere(), { categoryId: p.categoryId, id: { not: p.id }, stock: { gt: 0 } }] },
    orderBy: { popularity: "desc" },
    include: productInclude,
    take: 20,
  });
  const alts = pool.sort((x, y) => Math.abs(x.priceMinor - p.priceMinor) - Math.abs(y.priceMinor - p.priceMinor)).slice(0, 4);
  return { ok: true, original: { id: p.id, name: p.name, inStock: p.stock > 0 }, count: alts.length, alternatives: alts.map(summarize) };
}

async function cartSummary(userId: string) {
  const cart = await loadCart(userId);
  const items = cart.items.map((i) => ({
    productId: i.productId,
    name: i.name,
    packSize: i.packSize,
    quantity: i.quantity,
    unitPrice: label(i.unitMinor),
    linePrice: label(i.unitMinor * i.quantity),
    inStock: i.stock >= i.quantity,
  }));
  if (!items.length) return { ok: true, empty: true, itemCount: 0, items };
  // The same authoritative totals the checkout page uses (current prices, delivery fee, tax).
  const q = await prisma.$transaction((tx) => buildQuote(tx, cart.items.map((i) => ({ productId: i.productId, quantity: i.quantity })), undefined, false));
  const t = q.totals;
  return {
    ok: true,
    itemCount: items.reduce((s, i) => s + i.quantity, 0),
    items,
    totals: { subtotal: label(t.subtotalMinor), delivery: t.deliveryMinor === 0 ? "free" : label(t.deliveryMinor), tax: label(t.taxMinor), total: label(t.totalMinor) },
    problems: q.issues.map((i) => i.message),
  };
}

/** Runs one tool for `userId`. Failures the customer should hear about come back as { ok:false, error }; unexpected ones are logged and answered generically. */
export async function runVoiceTool(userId: string, call: VoiceToolCall): Promise<Record<string, unknown>> {
  try {
    switch (call.name) {
      case "search_products":
        return await search(call.arguments);
      case "get_product_details":
        return await details(call.arguments.product_id, call.arguments.quantity);
      case "find_alternatives":
        return await alternatives(call.arguments.product_id);
      case "get_cart":
        return await cartSummary(userId);
      case "add_to_cart": {
        const p = await findProduct(call.arguments.product_id); // the id comes from the model: re-check it against the live catalog
        const quantity = call.arguments.quantity ?? 1;
        await addCartItem(userId, p.id, quantity);
        return { ...(await cartSummary(userId)), added: { name: p.name, quantity } };
      }
      case "set_cart_quantity":
      case "remove_from_cart": {
        const line = (await loadCart(userId)).items.find((i) => i.productId === call.arguments.product_id);
        if (!line) throw new HttpError(404, "That item is not in the cart");
        const qty = call.name === "remove_from_cart" ? 0 : call.arguments.quantity;
        if (qty === 0) await removeCartItem(userId, line.id);
        else await setCartItemQuantity(userId, line.id, qty);
        return { ...(await cartSummary(userId)), changed: { name: line.name, quantity: qty } };
      }
    }
  } catch (e) {
    if (e instanceof HttpError) return { ok: false, error: e.message };
    console.error("[voice] tool failed:", call.name, e instanceof Error ? e.message.split("\n")[0] : "unknown error");
    return { ok: false, error: "Something went wrong on our side. Please try again." };
  }
}
