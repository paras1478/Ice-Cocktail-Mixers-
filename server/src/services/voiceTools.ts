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
  quantity: opt(z.number().int().min(1).max(50)),
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
      "Search the live ICE Cocktail catalog (non-alcoholic products only). Use short keywords from the customer's wish or mood (e.g. 'tonic', 'lemon', 'ice', 'fizzy', 'citrus'). Also use it for budgets and to list a category. Returns real products with ids, prices in rupees and LIVE stock from the database (availability, availableQuantity and, if you pass quantity, canFulfillRequested). If nothing in stock matches, it also lists matching products that are out of stock.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "One to three keywords. Leave empty to browse the most popular products." },
        category: { type: "string", description: "Optional category name or slug, from the list of categories you were given." },
        min_price_rupees: { type: "number" },
        max_price_rupees: { type: "number", description: "Budget ceiling in rupees, e.g. 150." },
        in_stock_only: { type: "boolean", description: "Default true (hides products with zero stock). Pass false to include out-of-stock products too." },
        quantity: { type: "integer", description: "How many the customer wants. Each product then says whether the live stock can fulfil it." },
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
      properties: { product_id: { type: "string", description: "The id from a search result (best), or the product name the customer said." }, quantity: { type: "integer", description: "Optional: check whether this many are in stock." } },
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

/** The live stock facts the assistant may state, straight from Product.stock (never cached, never inferred). */
function stockFacts(p: { stock: number; lowStockAt: number }, requested?: number) {
  const availability = p.stock <= 0 ? "out_of_stock" : p.stock <= p.lowStockAt ? "low_stock" : "in_stock";
  return {
    inStock: p.stock > 0,
    availability,
    availableQuantity: Math.max(0, p.stock),
    // Only when the customer asked for a number: stock > 0 and enough of it means available; anything less is said as it is.
    ...(requested ? { requested, canFulfillRequested: p.stock >= requested } : {}),
  };
}

function summarize(p: ProductRow, requested?: number) {
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
    ...stockFacts(p, requested),
    description: clip(p.description, 160),
    image: [...p.images].sort((x, y) => x.sortOrder - y.sortOrder)[0]?.url ?? null,
  };
}

const STOP = new Set(["the", "and", "for", "with", "some", "any", "kuch", "mujhe", "chahiye", "ek", "hai", "ki", "ka", "ke", "ko", "me", "mein"]);
const tokens = (q?: string) => (q ?? "").toLowerCase().split(/[^a-z0-9ऀ-ॿ]+/).filter((t) => t.length >= 2 && !STOP.has(t)).slice(0, 5);

/** Several products fit what the customer said (typically pack sizes of one product): the assistant must ask which one. */
class AmbiguousProduct extends HttpError {
  constructor(ref: string, public options: ReturnType<typeof summarize>[]) {
    super(409, `Several products match "${ref}". Ask the customer which one they mean (for example the pack size), then use that product's id.`);
  }
}

/**
 * Finds a product from whatever the model passes: the id or slug from a search result, the SKU, or the product NAME as the customer said it
 * (exact name first, then a name that contains it). The product's stock is NOT part of the lookup, so a product that is out of stock is found and
 * reported as out of stock, and one that is in stock is always found; only "not in the store at all" ends as 404.
 */
async function findProduct(ref: string) {
  const q = ref.trim();
  const direct = await prisma.product.findFirst({ where: { OR: [{ id: q }, { slug: q }, { sku: q }, { slug: q.toLowerCase().replace(/[^a-z0-9]+/g, "-") }] }, include: productInclude });
  if (direct && isPublic(direct)) return direct;
  const named = async (where: Prisma.ProductWhereInput) => prisma.product.findMany({ where: { AND: [publicProductWhere(), where] }, include: productInclude, orderBy: [{ popularity: "desc" }, { name: "asc" }], take: 6 });
  let matches = await named({ name: { equals: q, mode: "insensitive" } });
  if (!matches.length) matches = await named({ OR: [{ name: { contains: q, mode: "insensitive" } }, ...(q.split(/\s+/).length > 1 ? [{ AND: q.split(/\s+/).filter((w) => w.length > 1).map((w) => ({ name: { contains: w, mode: "insensitive" as const } })) }] : [])] });
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) throw new AmbiguousProduct(q, matches.map((m) => summarize(m)));
  throw new HttpError(404, `There is no product called "${q}" in the store. Search the catalog before telling the customer it is not sold.`);
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
  // Zero-stock products are hidden by default. When the customer names a quantity they stay visible, so "only 3 left, you asked for 5" can be said truthfully.
  const stockOnly: Prisma.ProductWhereInput[] = a.in_stock_only !== false && !a.quantity ? [{ stock: { gt: 0 } }] : [];
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
  let rows = await run([...and, ...stockOnly, ...keywords]);
  // Nothing IN STOCK matched the words: say so truthfully if matching products exist but are out of stock (a product is only "unavailable" when its real stock is zero).
  const outOfStock = !rows.length && stockOnly.length && keywords.length
    ? await prisma.product.findMany({ where: { AND: [...and, { stock: { lte: 0 } }, ...keywords] }, include: productInclude, orderBy: [{ popularity: "desc" }, { name: "asc" }], take: 5 })
    : [];
  // Descriptions describe the product, not a mood, so "refreshing" or "fruity" often match nothing. Rather than answer "nothing found", fall back to the most
  // popular products that still fit the category, budget and stock, and say so, so the assistant recommends honestly (never claims a keyword match).
  const keywordMiss = rows.length === 0 && keywords.length > 0 && outOfStock.length === 0;
  if (keywordMiss) rows = await run([...and, ...stockOnly]);
  return {
    ok: true,
    count: rows.length,
    products: rows.map((p) => summarize(p, a.quantity)),
    ...(outOfStock.length ? { outOfStockMatches: outOfStock.map((p) => summarize(p, a.quantity)), note: "These products match but their live stock is zero, so they are out of stock right now. Tell the customer that, and offer find_alternatives." } : {}),
    ...(keywordMiss && rows.length ? { noKeywordMatch: true, note: "No product mentions those words. These are our most popular products within the filters: pick the ones that genuinely suit the customer's wish (by name and category) and say you are suggesting based on what we have." } : {}),
    ...(rows.length || outOfStock.length ? {} : { note: "No product fits these filters. Offer to widen the budget or suggest browsing a category." }),
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
      ...summarize(p, quantity),
      description: p.description,
      ingredients: p.details || null, // only ever from the product label; null means "not listed", never guess
      stock: p.stock,
      // Every pack size of this product with ITS OWN live stock (each variant is a separate product row with its own quantity).
      packSizes: packs.map((v) => ({ id: v.id, packSize: v.packSize, price: label(v.priceMinor), ...stockFacts(v, quantity) })),
      image: [...p.images].sort((x, y) => x.sortOrder - y.sortOrder)[0]?.url ?? null,
    },
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
  return { ok: true, original: { id: p.id, name: p.name, ...stockFacts(p) }, count: alts.length, alternatives: alts.map((a) => summarize(a)) };
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

/** The customer's own cart line for an id or a product name (the model may pass either). */
async function findCartLine(userId: string, ref: string) {
  const items = (await loadCart(userId)).items;
  const q = ref.trim().toLowerCase();
  const byId = items.find((i) => i.productId === ref);
  if (byId) return byId;
  const exact = items.filter((i) => i.name.toLowerCase() === q);
  if (exact.length === 1) return exact[0];
  const partial = exact.length ? exact : items.filter((i) => i.name.toLowerCase().includes(q));
  if (partial.length === 1) return partial[0];
  if (partial.length > 1) throw new HttpError(409, `Several items in the cart match "${ref}": ${partial.map((i) => `${i.name} (${i.packSize})`).join(", ")}. Ask which one.`);
  return undefined;
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
        const line = await findCartLine(userId, call.arguments.product_id);
        if (!line) throw new HttpError(404, "That item is not in the cart");
        const qty = call.name === "remove_from_cart" ? 0 : call.arguments.quantity;
        if (qty === 0) await removeCartItem(userId, line.id);
        else await setCartItemQuantity(userId, line.id, qty);
        return { ...(await cartSummary(userId)), changed: { name: line.name, quantity: qty } };
      }
    }
  } catch (e) {
    if (e instanceof AmbiguousProduct) return { ok: false, error: e.message, options: e.options };
    if (e instanceof HttpError) return { ok: false, error: e.message };
    console.error("[voice] tool failed:", call.name, e instanceof Error ? e.message.split("\n")[0] : "unknown error");
    return { ok: false, error: "Something went wrong on our side. Please try again." };
  }
}
