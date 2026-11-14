import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/lib/db.js";
import { APPROVED_CATEGORIES } from "../src/lib/catalog.js";

const app = createApp();
const FAKE_KEY = "sk-test-not-a-real-key";

let soda = { id: "" };
let tonic = { id: "" };
let scarce = { id: "" };
let outOfStock = { id: "" };
let hiddenAlcohol = { id: "" };

async function customer(email: string) {
  const a = request.agent(app);
  await a.post("/api/auth/register").send({ name: "Voice Tester", email, password: "password123" }).expect(201);
  return a;
}
const tool = (a: ReturnType<typeof request.agent>, name: string, args: unknown = {}) => a.post("/api/voice/tool").send({ name, arguments: args });

beforeAll(async () => {
  await prisma.$executeRawUnsafe(
    'TRUNCATE "Payment","OrderItem","Order","CartItem","Cart","BundleItem","Bundle","ProductImage","Product","Category","Discount","ServiceArea","Address","User" RESTART IDENTITY CASCADE',
  );
  const cats: Record<string, string> = {};
  for (const [i, slug] of APPROVED_CATEGORIES.entries()) cats[slug] = (await prisma.category.create({ data: { slug, name: slug.replace(/-/g, " "), sortOrder: i } })).id;
  const mk = (slug: string, name: string, priceMinor: number, stock: number, categoryId: string, extra: object = {}) =>
    prisma.product.create({ data: { slug, name, packSize: "1 unit", priceMinor, stock, categoryId, ...extra } });
  soda = await mk("lemon-soda", "Lemon Club Soda", 6000, 20, cats["club-soda"], { description: "Crisp, refreshing lemon fizz", popularity: 9 });
  tonic = await mk("indian-tonic", "Indian Tonic Water", 8500, 20, cats["tonic-water"], { brand: "Schweppes", description: "Classic bitter-sweet tonic", details: "Carbonated water, sugar, quinine", variantGroup: "tonic", popularity: 5 });
  await mk("indian-tonic-big", "Indian Tonic Water 1 L", 20000, 5, cats["tonic-water"], { variantGroup: "tonic" });
  scarce = await mk("scarce", "Scarce Item", 1000, 2, cats["ice-bags"]);
  outOfStock = await mk("sold-out", "Sold Out Mixer", 7000, 0, cats["tonic-water"]);
  const stray = await prisma.category.create({ data: { slug: "whisky", name: "Whisky", isActive: true } }); // active but not an approved category
  hiddenAlcohol = await mk("stray-whisky", "Stray Whisky", 90000, 10, stray.id, { popularity: 99 });
});

afterAll(() => prisma.$disconnect());
afterEach(() => vi.unstubAllGlobals());

describe("voice session", () => {
  const okSecret = () => vi.fn(async () => new Response(JSON.stringify({ value: "ek_short_lived", expires_at: 1900000000 }), { status: 200 }));

  it("requires a logged-in customer", async () => {
    await request(app).post("/api/voice/session").expect(401);
    await request(app).post("/api/voice/tool").send({ name: "get_cart" }).expect(401);
  });

  it("returns only a short-lived client secret and configures the session on the server", async () => {
    const a = await customer("session@test.dev");
    const f = okSecret();
    vi.stubGlobal("fetch", f);
    const r = await a.post("/api/voice/session").expect(200);
    expect(r.body.clientSecret).toBe("ek_short_lived");
    expect(JSON.stringify(r.body)).not.toContain(FAKE_KEY); // the permanent key never reaches the browser
    expect(r.headers["cache-control"]).toBe("no-store");
    const [url, init] = f.mock.calls[0] as unknown as [string, { headers: Record<string, string>; body: string }];
    expect(url).toBe("https://api.openai.com/v1/realtime/client_secrets");
    expect(init.headers.Authorization).toBe(`Bearer ${FAKE_KEY}`);
    const sent = JSON.parse(init.body);
    expect(sent.expires_after.seconds).toBeLessThanOrEqual(300);
    expect(sent.session.tools.map((t: { name: string }) => t.name)).toEqual(expect.arrayContaining(["search_products", "add_to_cart", "get_cart"]));
    expect(sent.session.instructions).toMatch(/non-alcoholic/i);
    expect(sent.session.instructions).toMatch(/Hindi, English and Hinglish/);
    expect(sent.session.instructions).toContain("club soda"); // live category names
    expect(sent.session.instructions).toContain("Lemon Club Soda (1 unit) | club soda | ₹60"); // live catalog snapshot
    expect(sent.session.instructions).not.toContain("Stray Whisky"); // an unapproved category is never offered
  });

  it("answers a clear error, not the provider's details, when OpenAI refuses or is unreachable", async () => {
    const a = await customer("session2@test.dev");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: { message: `bad key ${FAKE_KEY}` } }), { status: 401 })));
    const denied = await a.post("/api/voice/session").expect(503);
    expect(JSON.stringify(denied.body)).not.toContain(FAKE_KEY);
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network down"); }));
    await a.post("/api/voice/session").expect(502);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("not json", { status: 200 })));
    await a.post("/api/voice/session").expect(502);
  });

  it("is advertised in the public config", async () => {
    const r = await request(app).get("/api/config").expect(200);
    expect(r.body.voice.enabled).toBe(true);
  });
});

describe("voice tools: catalog", () => {
  it("finds real products by keyword and budget, in stock and approved only", async () => {
    const a = await customer("search@test.dev");
    const r = (await tool(a, "search_products", { query: "refreshing lemon" }).expect(200)).body.result;
    expect(r.ok).toBe(true);
    expect(r.products.map((p: { id: string }) => p.id)).toContain(soda.id);
    expect(r.products[0]).toMatchObject({ name: "Lemon Club Soda", priceRupees: 60, price: "₹60", inStock: true });

    const cheap = (await tool(a, "search_products", { max_price_rupees: 70 }).expect(200)).body.result;
    expect(cheap.products.every((p: { priceRupees: number }) => p.priceRupees <= 70)).toBe(true);

    const all = (await tool(a, "search_products", { limit: 8 }).expect(200)).body.result;
    const ids = all.products.map((p: { id: string }) => p.id);
    expect(ids).not.toContain(hiddenAlcohol.id); // an unapproved category never reaches the assistant
    expect(ids).not.toContain(outOfStock.id); // out of stock is hidden by default
    const withSoldOut = (await tool(a, "search_products", { category: "tonic water", in_stock_only: false }).expect(200)).body.result;
    expect(withSoldOut.products.map((p: { id: string }) => p.id)).toContain(outOfStock.id);
  });

  it("falls back to popular in-budget products, flagged, when no keyword matches (moods are not in descriptions), and is honest when nothing fits", async () => {
    const a = await customer("empty@test.dev");
    const mood = (await tool(a, "search_products", { query: "zzzznotathing", category: null, max_price_rupees: 100 }).expect(200)).body.result;
    expect(mood).toMatchObject({ ok: true, noKeywordMatch: true });
    expect(mood.products.length).toBeGreaterThan(0);
    expect(mood.products.every((p: { priceRupees: number }) => p.priceRupees <= 100)).toBe(true); // the budget still holds
    expect(mood.note).toMatch(/most popular/);
    const none = (await tool(a, "search_products", { query: "zzzznotathing", max_price_rupees: 1 }).expect(200)).body.result;
    expect(none).toMatchObject({ ok: true, count: 0 });
    expect(none.noKeywordMatch).toBeUndefined();
    expect(none.note).toBeTruthy();
  });

  it("gives details with label-only ingredients, pack sizes and live stock", async () => {
    const a = await customer("details@test.dev");
    const r = (await tool(a, "get_product_details", { product_id: tonic.id, quantity: 3 }).expect(200)).body.result;
    expect(r.product).toMatchObject({ ingredients: "Carbonated water, sugar, quinine", stock: 20, price: "₹85" });
    expect(r.product.packSizes).toHaveLength(2);
    expect(r.product).toMatchObject({ availability: "in_stock", availableQuantity: 20, requested: 3, canFulfillRequested: true });
    const none = (await tool(a, "get_product_details", { product_id: soda.id }).expect(200)).body.result;
    expect(none.product.ingredients).toBeNull(); // never guessed
    const unknown = (await tool(a, "get_product_details", { product_id: "nope" }).expect(200)).body.result;
    expect(unknown).toMatchObject({ ok: false });
    const hidden = (await tool(a, "get_product_details", { product_id: hiddenAlcohol.id }).expect(200)).body.result;
    expect(hidden.ok).toBe(false);
  });

  it("suggests in-stock alternatives for an unavailable product", async () => {
    const a = await customer("alt@test.dev");
    const r = (await tool(a, "find_alternatives", { product_id: outOfStock.id }).expect(200)).body.result;
    expect(r.ok).toBe(true);
    expect(r.original.inStock).toBe(false);
    const ids = r.alternatives.map((p: { id: string }) => p.id);
    expect(ids).toContain(tonic.id);
    expect(ids).not.toContain(outOfStock.id);
  });
});

describe("voice tools: cart", () => {
  it("adds, reads the total, changes the quantity and removes, through the same rules as the cart API", async () => {
    const a = await customer("cart@test.dev");
    const added = (await tool(a, "add_to_cart", { product_id: soda.id, quantity: 2 }).expect(200)).body;
    expect(added.cartChanged).toBe(true);
    expect(added.result).toMatchObject({ ok: true, itemCount: 2, added: { name: "Lemon Club Soda", quantity: 2 } });
    expect(added.result.totals.subtotal).toBe("₹120");
    // the website's own cart endpoint sees the same server cart
    expect((await a.get("/api/cart").expect(200)).body.items).toMatchObject([{ productId: soda.id, quantity: 2 }]);

    const cart = (await tool(a, "get_cart").expect(200)).body;
    expect(cart.cartChanged).toBe(false);
    expect(cart.result.totals.total).toMatch(/^₹/);

    const more = (await tool(a, "set_cart_quantity", { product_id: soda.id, quantity: 3 }).expect(200)).body.result;
    expect(more).toMatchObject({ ok: true, itemCount: 3, changed: { quantity: 3 } });

    const gone = (await tool(a, "remove_from_cart", { product_id: soda.id }).expect(200)).body.result;
    expect(gone).toMatchObject({ ok: true, empty: true });
    expect((await a.get("/api/cart").expect(200)).body.items).toEqual([]);
  });

  it("refuses more than the stock, unavailable products and quantities that make no sense, and never reports success", async () => {
    const a = await customer("limits@test.dev");
    const tooMany = (await tool(a, "add_to_cart", { product_id: scarce.id, quantity: 5 }).expect(200)).body;
    expect(tooMany.result).toMatchObject({ ok: false, error: "Only 2 left in stock" });
    expect(tooMany.cartChanged).toBe(false);
    expect((await tool(a, "add_to_cart", { product_id: outOfStock.id }).expect(200)).body.result.ok).toBe(false);
    expect((await tool(a, "add_to_cart", { product_id: hiddenAlcohol.id }).expect(200)).body.result.ok).toBe(false);
    await tool(a, "add_to_cart", { product_id: soda.id, quantity: 0 }).expect(400);
    await tool(a, "add_to_cart", { product_id: soda.id, quantity: 500 }).expect(400);
    expect((await a.get("/api/cart").expect(200)).body.items).toEqual([]);
  });

  it("only ever touches the logged-in customer's own cart", async () => {
    const alice = await customer("alice@test.dev");
    const bob = await customer("bob@test.dev");
    await tool(alice, "add_to_cart", { product_id: soda.id, quantity: 1 }).expect(200);
    // Bob cannot change or remove Alice's line (it is simply not in his cart), and a user id in the body is ignored.
    expect((await tool(bob, "set_cart_quantity", { product_id: soda.id, quantity: 9 }).expect(200)).body.result.ok).toBe(false);
    expect((await tool(bob, "remove_from_cart", { product_id: soda.id }).expect(200)).body.result.ok).toBe(false);
    await bob.post("/api/voice/tool").send({ name: "get_cart", arguments: {}, userId: "someone-else" }).expect(200);
    expect((await alice.get("/api/cart").expect(200)).body.items).toMatchObject([{ productId: soda.id, quantity: 1 }]);
    expect((await tool(bob, "get_cart").expect(200)).body.result.empty).toBe(true);
  });

  it("rejects unknown tools", async () => {
    const a = await customer("unknown@test.dev");
    await tool(a, "place_order", {}).expect(400); // the assistant has no way to order or pay
    await tool(a, "drop_database", {}).expect(400);
    await a.post("/api/voice/tool").send({}).expect(400);
  });
});
