import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import { createApp } from "../src/app.js";
import { prisma } from "../src/lib/db.js";
import { env } from "../src/lib/env.js";
import { APPROVED_CATEGORIES } from "../src/lib/catalog.js";

const app = createApp();
const agent = () => request.agent(app);

const address = { house: "12", line1: "Test Street, Sector 54", city: "Gurgaon", state: "Haryana", pincode: "122018" };
const checkout = (items: unknown[], extra: object = {}) => ({
  items, contactName: "Test User", contactPhone: "9876543210", address, addressConfirmed: true, paymentMethod: "COD", ...extra,
});

let iceCat = "";
let ice = { id: "", priceMinor: 6000 };
let tonic = { id: "", priceMinor: 8500 };
let scarce = { id: "" };
let beerLike = { id: "" }; // a product in a category outside the approved set
let archived = { id: "" };

async function login(email: string, password: string) {
  const a = agent();
  await a.post("/api/auth/login").send({ email, password }).expect(200);
  return a;
}

beforeAll(async () => {
  await prisma.$executeRawUnsafe(
    'TRUNCATE "Payment","OrderItem","Order","CartItem","Cart","BundleItem","Bundle","ProductImage","Product","Category","Discount","ServiceArea","Address","User" RESTART IDENTITY CASCADE',
  );
  const cats: Record<string, string> = {};
  for (const [i, slug] of APPROVED_CATEGORIES.entries()) cats[slug] = (await prisma.category.create({ data: { slug, name: slug.replace(/-/g, " "), sortOrder: i } })).id;
  iceCat = cats["ice-bags"];
  const mk = (slug: string, name: string, priceMinor: number, stock: number, popularity = 0, categoryId = iceCat, extra: object = {}) =>
    prisma.product.create({ data: { slug, name, packSize: "1 unit", priceMinor, stock, popularity, categoryId, ...extra } });
  ice = await mk("ice", "Party Ice", 6000, 50, 10);
  tonic = await mk("tonic", "Tonic Water", 8500, 50, 5, cats["tonic-water"], { brand: "Schweppes" });
  scarce = await mk("scarce", "Scarce Item", 1000, 2);
  await mk("out", "Out Of Stock Thing", 1000, 0);
  // Out-of-scope data that must never reach customers:
  const hidden = await prisma.category.create({ data: { slug: "beer", name: "Beer", isActive: false } });
  beerLike = await mk("old-beer", "Archived Beer", 15000, 10, 99, hidden.id);
  const stray = await prisma.category.create({ data: { slug: "whisky", name: "Whisky", isActive: true } }); // active but NOT approved
  archived = await mk("stray-whisky", "Stray Whisky", 90000, 10, 99, stray.id);
  await prisma.serviceArea.createMany({
    data: [
      { pincode: "122018", areaName: "Sector 54", city: "Gurgaon", state: "Haryana", etaMinutes: 14 },
      { pincode: "834001", areaName: "Ranchi", city: "Ranchi", state: "Jharkhand", etaMinutes: 45, isActive: false },
    ],
  });
  await prisma.discount.createMany({
    data: [
      { code: "TEN", type: "PERCENT", value: 10 },
      { code: "BIGSPEND", type: "FIXED", value: 5000, minSubtotalMinor: 1_000_000 },
      { code: "OLD", type: "PERCENT", value: 10, expiresAt: new Date(Date.now() - 1000) },
    ],
  });
  await prisma.user.create({ data: { email: "admin@test.dev", name: "Admin", role: "ADMIN", passwordHash: await bcrypt.hash("AdminPass123", 4) } });
});

afterAll(() => prisma.$disconnect());
afterEach(() => vi.unstubAllGlobals());

describe("auth", () => {
  it("registers, logs in, returns the profile and logs out", async () => {
    const a = agent();
    await a.post("/api/auth/register").send({ name: "Jo Customer", email: "Jo@Test.dev", password: "password123" }).expect(201);
    expect((await a.get("/api/auth/me").expect(200)).body.user).toMatchObject({ email: "jo@test.dev", role: "CUSTOMER" });
    await a.post("/api/auth/logout").expect(200);
    expect((await a.get("/api/auth/me").expect(200)).body).toEqual({ user: null }); // logged out is an answer, not an error
    await request(app).post("/api/auth/register").send({ name: "Dup", email: "jo@test.dev", password: "password123" }).expect(409);
  });
  it("rejects bad credentials with one generic message and weak passwords", async () => {
    const wrong = await request(app).post("/api/auth/login").send({ email: "jo@test.dev", password: "nope" }).expect(401);
    const unknown = await request(app).post("/api/auth/login").send({ email: "who@test.dev", password: "nope" }).expect(401);
    expect(wrong.body.error).toBe(unknown.body.error);
    await request(app).post("/api/auth/register").send({ name: "Weak", email: "weak@test.dev", password: "123" }).expect(400);
  });
});

describe("storefront catalog", () => {
  it("lists only approved, active products; out-of-scope categories never appear", async () => {
    const { products } = (await request(app).get("/api/products?pageSize=60").expect(200)).body;
    const slugs = products.map((p: { slug: string }) => p.slug);
    expect(slugs).toEqual(expect.arrayContaining(["ice", "tonic", "scarce", "out"]));
    expect(slugs).not.toContain("old-beer");
    expect(slugs).not.toContain("stray-whisky");
    await request(app).get("/api/products/old-beer").expect(404);
    await request(app).get("/api/products/stray-whisky").expect(404);
    const bad = (await request(app).get("/api/products?category=whisky").expect(200)).body;
    expect(bad.total).toBe(0);
  });
  it("exposes exactly the approved categories", async () => {
    const { categories } = (await request(app).get("/api/categories").expect(200)).body;
    expect(categories.map((c: { slug: string }) => c.slug)).toEqual([...APPROVED_CATEGORIES]);
    expect(JSON.stringify(categories)).not.toMatch(/beer|whisky|vodka|rum|wine|champagne|malt/i);
  });
  it("counts active bundles for the Party Bundles category (it holds bundles, not products)", async () => {
    const c = (await request(app).get("/api/categories").expect(200)).body.categories.find((x: { slug: string }) => x.slug === "party-bundles");
    expect(c.productCount).toBe(await prisma.bundle.count({ where: { isActive: true } }));
  });
  it("searches names, brands and category names; filters by category, price and stock", async () => {
    const names = async (qs: string) => (await request(app).get(`/api/products?${qs}`).expect(200)).body.products.map((p: { name: string }) => p.name);
    expect(await names("q=schweppes")).toEqual(["Tonic Water"]);
    expect(await names("q=TONIC")).toContain("Tonic Water");
    expect(await names("category=tonic-water")).toEqual(["Tonic Water"]);
    expect(await names(`minPrice=7000&maxPrice=9000`)).toEqual(["Tonic Water"]);
    expect(await names("inStock=true&category=ice-bags")).not.toContain("Out Of Stock Thing");
    expect(await names("q=nothing-matches")).toEqual([]);
  });
  it("sorts by price and popularity and paginates", async () => {
    const get = async (qs: string) => (await request(app).get(`/api/products?${qs}`).expect(200)).body;
    expect((await get("sort=price_asc")).products[0].priceMinor).toBeLessThanOrEqual((await get("sort=price_asc")).products[1].priceMinor);
    expect((await get("sort=price_desc")).products[0].name).toBe("Tonic Water");
    expect((await get("sort=popular")).products[0].name).toBe("Party Ice");
    const p1 = await get("pageSize=2&page=1");
    expect(p1.products).toHaveLength(2);
    expect(p1.totalPages).toBe(2);
    expect((await get("pageSize=2&page=2")).products.length).toBeGreaterThan(0);
  });
  it("returns related products and 404 for unknown", async () => {
    const r = (await request(app).get("/api/products/tonic").expect(200)).body;
    expect(r.product.name).toBe("Tonic Water");
    await request(app).get("/api/products/does-not-exist").expect(404);
  });
  it("suggests only approved products", async () => {
    const r = (await request(app).get("/api/search/suggest?q=beer").expect(200)).body;
    expect(r.products).toEqual([]);
  });
});

describe("verified prices and image provenance", () => {
  it("only exposes MRP and discount for verified prices", async () => {
    const mk = (slug: string, status: "VERIFIED" | "SAMPLE") =>
      prisma.product.create({ data: { slug, name: slug, packSize: "1", priceMinor: 8000, mrpMinor: 10000, stock: 5, categoryId: iceCat, priceStatus: status, priceSourceUrl: status === "VERIFIED" ? "https://x.test" : null, priceVerifiedAt: status === "VERIFIED" ? new Date() : null } });
    await mk("v-price", "VERIFIED");
    await mk("s-price", "SAMPLE");
    const v = (await request(app).get("/api/products/v-price")).body.product;
    const s = (await request(app).get("/api/products/s-price")).body.product;
    expect(v).toMatchObject({ mrpMinor: 10000, discountPercent: 20 });
    expect(s).toMatchObject({ mrpMinor: null, discountPercent: 0, priceStatus: "SAMPLE" });
  });
  it("hides sample prices in production mode and archived/unapproved products always", async () => {
    const { publicProductWhere, isPublic } = await import("../src/lib/publish.js");
    expect(publicProductWhere(false)).toMatchObject({ isActive: true, priceStatus: "VERIFIED" });
    expect(publicProductWhere(true)).not.toHaveProperty("priceStatus");
    const approved = { slug: "ice-bags", isActive: true };
    expect(isPublic({ isActive: true, priceStatus: "SAMPLE", category: approved }, false)).toBe(false);
    expect(isPublic({ isActive: true, priceStatus: "VERIFIED", category: approved }, false)).toBe(true);
    expect(isPublic({ isActive: true, priceStatus: "VERIFIED", category: { slug: "beer", isActive: true } }, true)).toBe(false);
    expect(isPublic({ isActive: true, priceStatus: "VERIFIED", category: { slug: "ice-bags", isActive: false } }, true)).toBe(false);
    expect(isPublic({ isActive: false, priceStatus: "VERIFIED", category: approved }, true)).toBe(false);
  });
});

describe("admin product management", () => {
  let admin: ReturnType<typeof agent>;
  beforeAll(async () => { admin = await login("admin@test.dev", "AdminPass123"); });
  const body = (o: object = {}) => ({ name: "Admin Mixer", packSize: "500 ml", priceMinor: 12000, stock: 10, categoryId: iceCat, ...o });

  it("blocks anonymous and customer writes", async () => {
    await request(app).post("/api/products").send(body()).expect(401);
    const jo = await login("jo@test.dev", "password123");
    await jo.post("/api/products").send(body()).expect(403);
    await jo.put(`/api/products/${ice.id}`).send({ stock: 1 }).expect(403);
  });
  it("creates, edits stock/price and archives products; validates provenance and category", async () => {
    const created = (await admin.post("/api/products").send(body()).expect(201)).body.product;
    expect(created).toMatchObject({ slug: "admin-mixer", priceMinor: 12000, isDemo: true });
    await admin.post("/api/products").send(body()).expect(409); // duplicate slug
    await admin.post("/api/products").send(body({ name: "Bad", priceStatus: "VERIFIED" })).expect(400); // no source
    await admin.post("/api/products").send(body({ name: "Bad MRP", mrpMinor: 100 })).expect(400);
    await admin.post("/api/products").send(body({ name: "Real photo", images: [{ url: "/x.jpg", alt: "x", isPlaceholder: false }] })).expect(400);
    const hiddenCat = await prisma.category.findUniqueOrThrow({ where: { slug: "beer" } });
    await admin.post("/api/products").send(body({ name: "Beer thing", categoryId: hiddenCat.id })).expect(400); // outside approved categories
    const edited = (await admin.put(`/api/products/${created.id}`).send({ stock: 3, priceMinor: 13000 }).expect(200)).body.product;
    expect(edited).toMatchObject({ stock: 3, priceMinor: 13000 });
    const verified = (await admin.put(`/api/products/${created.id}`).send({ priceStatus: "VERIFIED", priceSourceUrl: "https://shop.test/p", priceVerifiedAt: "2026-10-27", mrpMinor: 15000 }).expect(200)).body.product;
    expect(verified).toMatchObject({ priceStatus: "VERIFIED", mrpMinor: 15000, isDemo: false });
    await admin.delete(`/api/products/${created.id}`).expect(204);
  });
  it("archives instead of deleting products that have order history", async () => {
    const p = await prisma.product.create({ data: { slug: "ordered", name: "Ordered", packSize: "1", priceMinor: 100, stock: 5, categoryId: iceCat } });
    const u = await prisma.user.create({ data: { email: "hist@test.dev", name: "Hist", passwordHash: "x" } });
    await prisma.order.create({ data: { userId: u.id, subtotalMinor: 100, deliveryMinor: 0, taxMinor: 0, totalMinor: 100, contactName: "H", contactPhone: "9876543210", addrLine1: "a", addrCity: "c", addrState: "s", addrPincode: "122018", items: { create: [{ productId: p.id, name: "Ordered", unitMinor: 100, quantity: 1 }] } } });
    expect((await admin.delete(`/api/products/${p.id}`).expect(200)).body).toEqual({ archived: true });
    await request(app).get("/api/products/ordered").expect(404);
    expect(await prisma.orderItem.count({ where: { productId: p.id } })).toBe(1);
  });
});

describe("price range, SKU and pack sizes", () => {
  it("returns the real cheapest and dearest listed price for the slider, scoped by category", async () => {
    const all = (await request(app).get("/api/products/price-range").expect(200)).body;
    expect(all.minMinor).toBe(1000); // cheapest approved product in the fixtures
    expect(all.maxMinor).toBeGreaterThanOrEqual(8500);
    expect(all.maxMinor).toBeLessThan(90000); // the out-of-scope 90000 item is never counted
    expect((await request(app).get("/api/products/price-range?category=tonic-water").expect(200)).body).toMatchObject({ minMinor: 8500, maxMinor: 8500, count: 1 });
    expect((await request(app).get("/api/products/price-range?category=whisky").expect(200)).body).toMatchObject({ minMinor: null, maxMinor: null, count: 0 });
  });
  it("filters by min and max price (inclusive) using real prices", async () => {
    const names = async (qs: string) => (await request(app).get("/api/products?" + qs).expect(200)).body.products.map((p: { name: string }) => p.name);
    expect(await names("minPrice=8500&maxPrice=8500")).toEqual(["Tonic Water"]);
    expect(await names("minPrice=8501")).not.toContain("Tonic Water");
    expect(await names("maxPrice=999")).toEqual([]);
    expect(await names("minPrice=6000&maxPrice=6000")).toContain("Party Ice");
  });
  it("stores a unique SKU and a pack-size group, and lists sibling packs on the product page", async () => {
    const admin = await login("admin@test.dev", "AdminPass123");
    const mk = (name: string, packSize: string, priceMinor: number, extra: object) => admin.post("/api/products").send({ name, packSize, priceMinor, stock: 5, categoryId: iceCat, ...extra });
    const a = (await mk("Pack Ice 1 kg", "1 kg", 6000, { sku: "ICX-T-001", variantGroup: "pack-ice" }).expect(201)).body.product;
    await mk("Pack Ice 5 kg", "5 kg", 22000, { sku: "ICX-T-002", variantGroup: "pack-ice" }).expect(201);
    await mk("Other", "1", 100, { sku: "ICX-T-001" }).expect(409); // duplicate SKU
    await mk("Bad group", "1", 100, { variantGroup: "Bad Group!" }).expect(400);
    const r = (await request(app).get("/api/products/" + a.slug).expect(200)).body;
    expect(r.product).toMatchObject({ sku: "ICX-T-001", variantGroup: "pack-ice" });
    expect(r.packs.map((p: { packSize: string }) => p.packSize)).toEqual(["1 kg", "5 kg"]);
    expect(r.related.some((p: { variantGroup: string }) => p.variantGroup === "pack-ice")).toBe(false); // packs are not repeated as "related"
    const edited = (await admin.put("/api/products/" + a.id).send({ sku: "ICX-T-009" }).expect(200)).body.product;
    expect(edited.sku).toBe("ICX-T-009");
    await admin.put("/api/products/" + a.id).send({ sku: "ICX-T-002" }).expect(409);
    const none = (await request(app).get("/api/products/ice").expect(200)).body;
    expect(none.packs).toEqual([]);
  });
});

describe("product image references", () => {
  it("accepts http(s) URLs and site paths, and rejects anything else", async () => {
    const admin = await login("admin@test.dev", "AdminPass123");
    const mk = (url: string, name: string) => admin.post("/api/products").send({ name, packSize: "1", priceMinor: 100, stock: 1, categoryId: iceCat, images: [{ url, alt: "alt text", isPlaceholder: true }] });
    await mk("/img/stock/ice-cubes.jpg", "Img Path").expect(201);
    await mk("https://cdn.example.com/p/ice.jpg", "Img Https").expect(201);
    for (const bad of ["javascript:alert(1)", "data:image/png;base64,AAAA", "ice.jpg", "ftp://x.test/a.jpg", "//evil.test/a.jpg x", "/with space.jpg"]) {
      const r = await mk(bad, "Bad " + bad.slice(0, 6)).expect(400);
      expect(JSON.stringify(r.body.details)).toContain("http(s) URL or a path");
    }
  });
  it("shows an updated image on the storefront straight away (no frontend edit needed)", async () => {
    const admin = await login("admin@test.dev", "AdminPass123");
    const p = (await request(app).get("/api/products/ice").expect(200)).body.product;
    await admin.put("/api/products/" + p.id).send({ images: [{ url: "/img/stock/ice-bucket.jpg", alt: "Ice in a bucket", isPlaceholder: true }, { url: "/img/stock/ice-cubes.jpg", alt: "Ice cubes", isPlaceholder: true }] }).expect(200);
    const after = (await request(app).get("/api/products/ice").expect(200)).body.product;
    expect(after.images.map((i: { url: string }) => i.url)).toEqual(["/img/stock/ice-bucket.jpg", "/img/stock/ice-cubes.jpg"]);
    const listed = (await request(app).get("/api/products?q=Party Ice").expect(200)).body.products.find((x: { slug: string }) => x.slug === "ice");
    expect(listed.images[0].url).toBe("/img/stock/ice-bucket.jpg");
  });
});

describe("cart quote", () => {
  it("computes totals on the server and ignores client prices", async () => {
    const r = (await request(app).post("/api/cart/quote").send({ items: [{ productId: ice.id, quantity: 2, unitMinor: 1 }, { productId: tonic.id, quantity: 1 }] }).expect(200)).body;
    expect(r.totals.subtotalMinor).toBe(2 * 6000 + 8500);
    expect(r.totals.taxMinor).toBe(Math.round(r.totals.subtotalMinor * 0.18));
    expect(r.totals.totalMinor).toBe(r.totals.subtotalMinor + r.totals.taxMinor + r.totals.deliveryMinor);
    expect(r.lines).toHaveLength(2);
  });
  it("applies valid discounts and explains invalid ones", async () => {
    const q = (code: string) => request(app).post("/api/cart/quote").send({ items: [{ productId: ice.id, quantity: 2 }], code }).then((r) => r.body);
    expect((await q("ten")).totals.discountMinor).toBe(1200);
    expect((await q("OLD")).discountMessage).toMatch(/expired/);
    expect((await q("BIGSPEND")).discountMessage).toMatch(/Minimum order/);
    expect((await q("NOPE")).discountMessage).toMatch(/Invalid/);
  });
  it("flags insufficient stock and products outside the approved catalog", async () => {
    const low = (await request(app).post("/api/cart/quote").send({ items: [{ productId: scarce.id, quantity: 5 }] })).body;
    expect(low.issues[0].message).toMatch(/Only 2/);
    const hidden = (await request(app).post("/api/cart/quote").send({ items: [{ productId: beerLike.id, quantity: 1 }, { productId: archived.id, quantity: 1 }] })).body;
    expect(hidden.lines).toEqual([]);
    expect(hidden.issues).toHaveLength(2);
    expect(hidden.totals.subtotalMinor).toBe(0);
  });
  it("waives the delivery fee above the threshold", async () => {
    const r = (await request(app).post("/api/cart/quote").send({ items: [{ productId: tonic.id, quantity: 5 }] })).body;
    expect(r.totals.deliveryMinor).toBe(0);
  });
});

describe("server cart (authenticated)", () => {
  it("adds, updates and removes items while validating stock and approval", async () => {
    const jo = await login("jo@test.dev", "password123");
    await jo.get("/api/cart").expect(200);
    await jo.post("/api/cart/items").send({ productId: scarce.id, quantity: 1 }).expect(201);
    const c = (await jo.post("/api/cart/items").send({ productId: scarce.id, quantity: 1 }).expect(201)).body;
    expect(c.items).toHaveLength(1);
    expect(c.items[0].quantity).toBe(2);
    await jo.post("/api/cart/items").send({ productId: scarce.id, quantity: 1 }).expect(409);
    await jo.post("/api/cart/items").send({ productId: beerLike.id, quantity: 1 }).expect(404);
    await jo.patch(`/api/cart/items/${c.items[0].id}`).send({ quantity: 1 }).expect(200);
    await jo.patch(`/api/cart/items/${c.items[0].id}`).send({ quantity: 3 }).expect(409);
    expect((await jo.delete(`/api/cart/items/${c.items[0].id}`).expect(200)).body.items).toHaveLength(0);
  });
});

describe("PIN lookup and serviceability", () => {
  const postal = (offices: object[]) => vi.fn().mockResolvedValue({ ok: true, json: async () => [{ Status: "Success", PostOffice: offices }] });

  it("returns postal suggestions and, separately, delivery coverage", async () => {
    vi.stubGlobal("fetch", postal([{ Name: "Sector 54", District: "Gurgaon", State: "Haryana", Block: "Gurgaon" }, { Name: "DLF Phase 5", District: "Gurgaon", State: "Haryana", Block: "NA" }]));
    const r = (await request(app).get("/api/pincode/122018").expect(200)).body;
    expect(r.postal).toMatchObject({ status: "found", district: "Gurgaon", state: "Haryana" });
    expect(r.postal.offices).toHaveLength(2);
    expect(r.delivery).toMatchObject({ serviceable: true, etaMinutes: 14 });
  });
  it("does not treat a valid postal PIN as deliverable", async () => {
    vi.stubGlobal("fetch", postal([{ Name: "Ghatkopar", District: "Mumbai", State: "Maharashtra" }]));
    const r = (await request(app).get("/api/pincode/400077").expect(200)).body;
    expect(r.postal.status).toBe("found");
    expect(r.delivery).toEqual({ serviceable: false, pincode: "400077", reason: "not_covered" });
  });
  it("reports paused coverage and unknown PINs honestly", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => [{ Status: "Error", PostOffice: null }] }));
    const r = (await request(app).get("/api/pincode/834001").expect(200)).body;
    expect(r.postal.status).toBe("not_found");
    expect(r.delivery).toMatchObject({ serviceable: false, reason: "paused" });
  });
  it("surfaces postal-service failures instead of faking a result, while still answering serviceability", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    const r = (await request(app).get("/api/pincode/110099").expect(200)).body;
    expect(r.postal.status).toBe("unavailable");
    expect(r.postal.message).toMatch(/unavailable/);
    expect(r.delivery.serviceable).toBe(false);
  });
  it("validates the PIN format", async () => {
    await request(app).get("/api/pincode/12345").expect(400);
    await request(app).get("/api/delivery/check?pincode=abc").expect(400);
    expect((await request(app).get("/api/delivery/check?pincode=122018").expect(200)).body).toMatchObject({ serviceable: true, areaName: "Sector 54" });
  });
  const place = (extra: object = {}) => ({ housenumber: "12", street: "MG Road", suburb: "Sector 54", city: "Gurugram", county: "Gurugram", state: "Haryana", postcode: "122 018", formatted: "12 MG Road, Sector 54, Gurugram - 122018, HR, India", lat: 28.4312345, lon: 77.1012345, ...extra });
  const ok = (results: object[]) => ({ ok: true, json: async () => ({ results }) });
  const withKey = (fn: () => Promise<void>) => async () => { env.GEOAPIFY_API_KEY = "test-key"; try { await fn(); } finally { delete env.GEOAPIFY_API_KEY; } };

  it("reverse geocodes GPS positions through Geoapify, sending the key only upstream", withKey(async () => {
    const f = vi.fn().mockResolvedValue(ok([place()]));
    vi.stubGlobal("fetch", f);
    const res = await request(app).post("/api/geo/reverse").send({ latitude: 28.43, longitude: 77.1 }).expect(200);
    expect(res.body).toMatchObject({ line1: "12 MG Road", area: "Sector 54", city: "Gurugram", state: "Haryana", pincode: "122018" });
    expect(String(f.mock.calls[0][0])).toMatch(/\/v1\/geocode\/reverse\?.*lat=28\.43&lon=77\.1/);
    expect(JSON.stringify(res.body)).not.toContain("test-key");
    await request(app).post("/api/geo/reverse").send({ latitude: 91, longitude: 0 }).expect(400);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 401 }));
    const err = (await request(app).post("/api/geo/reverse").send({ latitude: 28.43, longitude: 77.1 }).expect(502)).body.error;
    expect(err).toMatch(/enter it manually/);
    expect(err).not.toContain("test-key");
  }));
  it("does not name an amenity as the street, and returns an empty address when nothing is known", withKey(async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ok([{ name: "The Oberoi", result_type: "amenity", city: "Gurugram", county: "Gurugram", state: "Haryana", formatted: "The Oberoi, Gurugram, India" }])));
    expect((await request(app).post("/api/geo/reverse").send({ latitude: 28.4595, longitude: 77.0266 }).expect(200)).body).toMatchObject({ line1: null, city: "Gurugram", pincode: null });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ok([])));
    expect((await request(app).post("/api/geo/reverse").send({ latitude: 28.43, longitude: 77.1 }).expect(200)).body).toMatchObject({ line1: null, state: null, pincode: null });
  }));
  it("searches addresses and PIN codes (India only, max 5), validates the query and returns coordinates", withKey(async () => {
    const f = vi.fn().mockResolvedValue(ok([place(), place({ lat: undefined })]));
    vi.stubGlobal("fetch", f);
    const res = await request(app).post("/api/geo/search").send({ query: "MG Road Gurugram" }).expect(200);
    expect(res.body.results).toHaveLength(1); // the result without coordinates is dropped
    expect(res.body.results[0]).toMatchObject({ latitude: 28.431234, longitude: 77.101235, pincode: "122018" });
    expect(decodeURIComponent(String(f.mock.calls[0][0]))).toContain("filter=countrycode:in");
    await request(app).post("/api/geo/search").send({ query: "122018" }).expect(200);
    expect(decodeURIComponent(String(f.mock.calls[1][0]))).toContain("text=122018");
    await request(app).post("/api/geo/search").send({ query: "ab" }).expect(400);
  }));
  it("reports address lookup as not set up without the Geoapify key", async () => {
    await request(app).post("/api/geo/search").send({ query: "MG Road" }).expect(503);
    await request(app).post("/api/geo/reverse").send({ latitude: 28.43, longitude: 77.1 }).expect(503);
  });
});

describe("addresses", () => {
  it("validates addresses and manages a customer's saved addresses", async () => {
    const jo = await login("jo@test.dev", "password123");
    const full = { label: "Home", type: "HOME", ...address, landmark: "Near park", latitude: 28.43, longitude: 77.1, confirmed: true };
    await jo.post("/api/addresses").send({ ...full, pincode: "12" }).expect(400);
    await jo.post("/api/addresses").send({ ...full, latitude: undefined }).expect(400); // coordinates come as a pair
    await jo.post("/api/addresses").send({ ...full, latitude: 5, longitude: 77 }).expect(400); // outside India
    const a = (await jo.post("/api/addresses").send(full).expect(201)).body.address;
    expect(a).toMatchObject({ isDefault: true, latitude: 28.43, longitude: 77.1 });
    expect(a.confirmedAt).toBeTruthy();
    const b = (await jo.put(`/api/addresses/${a.id}`).send({ ...full, house: "99", latitude: null, longitude: null }).expect(200)).body.address;
    expect(b).toMatchObject({ house: "99", latitude: null });
    expect((await jo.get("/api/addresses").expect(200)).body.addresses).toHaveLength(1);
    const other = await login("admin@test.dev", "AdminPass123");
    await other.put(`/api/addresses/${a.id}`).send(full).expect(404); // not theirs
    await request(app).get("/api/addresses").expect(401);
    await jo.delete(`/api/addresses/${a.id}`).expect(204);
  });
  it("checks serviceability for an address being typed", async () => {
    const r = (await request(app).post("/api/addresses/validate").send(address).expect(200)).body;
    expect(r).toMatchObject({ serviceable: true });
    expect((await request(app).post("/api/addresses/validate").send({ ...address, pincode: "834001" }).expect(200)).body.reason).toBe("paused");
    await request(app).post("/api/addresses/validate").send({ ...address, house: "" }).expect(400);
  });
});

describe("order creation", () => {
  it("creates an order with server-computed totals, an address snapshot, stock decrement and an ETA", async () => {
    const jo = await login("jo@test.dev", "password123");
    const items = [{ productId: ice.id, quantity: 2 }, { productId: tonic.id, quantity: 1 }];
    const quote = (await request(app).post("/api/cart/quote").send({ items })).body;
    const before = await prisma.product.findUniqueOrThrow({ where: { id: ice.id } });
    const res = await jo.post("/api/orders").send(checkout(items, { expectedTotalMinor: quote.totals.totalMinor, saveAddress: true, address: { ...address, latitude: 28.43, longitude: 77.1, landmark: "Near park" } })).expect(201);
    const o = res.body.order;
    expect(o.totalMinor).toBe(quote.totals.totalMinor);
    expect(o).toMatchObject({ status: "PLACED", addrHouse: "12", addrPincode: "122018", addrLatitude: 28.43, addrLandmark: "Near park" });
    expect(o.payment).toMatchObject({ method: "COD", status: "PENDING" });
    expect(o.addressId).toBeTruthy();
    const eta = new Date(o.estimatedDeliveryAt).getTime() - Date.now();
    expect(eta).toBeGreaterThan(12 * 60_000);
    expect(eta).toBeLessThan(16 * 60_000);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: ice.id } })).stock).toBe(before.stock - 2);
    // Editing/deleting the saved address never changes the order snapshot.
    await prisma.address.update({ where: { id: o.addressId }, data: { house: "EDITED" } });
    expect((await jo.get(`/api/orders/${o.id}`).expect(200)).body.order.addrHouse).toBe("12");
  });
  it("rejects invalid checkout data and unconfirmed addresses", async () => {
    const jo = await login("jo@test.dev", "password123");
    const items = [{ productId: ice.id, quantity: 1 }];
    await jo.post("/api/orders").send(checkout(items, { contactPhone: "123" })).expect(400);
    await jo.post("/api/orders").send(checkout(items, { addressConfirmed: false })).expect(400);
    await jo.post("/api/orders").send(checkout(items, { address: { ...address, house: "" } })).expect(400);
    await jo.post("/api/orders").send(checkout([])).expect(400);
    await jo.post("/api/orders").send(checkout(items, { paymentMethod: "CARD" })).expect(501);
    await request(app).post("/api/orders").send(checkout(items)).expect(401);
  });
  it("refuses unserviceable and paused pincodes", async () => {
    const jo = await login("jo@test.dev", "password123");
    const items = [{ productId: ice.id, quantity: 1 }];
    expect((await jo.post("/api/orders").send(checkout(items, { address: { ...address, pincode: "400077" } })).expect(422)).body.error).toMatch(/don.t deliver/);
    expect((await jo.post("/api/orders").send(checkout(items, { address: { ...address, pincode: "834001" } })).expect(422)).body.error).toMatch(/paused/);
  });
  it("refuses products outside the approved catalog even if their ids are known", async () => {
    const jo = await login("jo@test.dev", "password123");
    const before = await prisma.order.count();
    await jo.post("/api/orders").send(checkout([{ productId: beerLike.id, quantity: 1 }])).expect(409);
    await jo.post("/api/orders").send(checkout([{ productId: archived.id, quantity: 1 }])).expect(409);
    expect(await prisma.order.count()).toBe(before);
  });
  it("refuses a stale total and verifies stock without overselling under concurrency", async () => {
    const jo = await login("jo@test.dev", "password123");
    await jo.post("/api/orders").send(checkout([{ productId: ice.id, quantity: 1 }], { expectedTotalMinor: 1 })).expect(409);
    const p = await prisma.product.create({ data: { slug: "race", name: "Race", packSize: "1", priceMinor: 1000, stock: 3, categoryId: iceCat } });
    const results = await Promise.all(Array.from({ length: 6 }, () => jo.post("/api/orders").send(checkout([{ productId: p.id, quantity: 1 }]))));
    expect(results.filter((r) => r.status === 201)).toHaveLength(3);
    expect(results.filter((r) => r.status === 409)).toHaveLength(3);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: p.id } })).stock).toBe(0);
  });
});

describe("area, district and postal lookup edge cases", () => {
  const full = { house: "12B", line1: "Church Road", area: "Hindpiri", district: "Ranchi", state: "Jharkhand", pincode: "122018", landmark: "Near the park", latitude: 23.37, longitude: 85.33 };
  it("stores area and district on the order snapshot and the saved address, and shows them to the admin", async () => {
    const jo = await login("jo@test.dev", "password123");
    const admin = await login("admin@test.dev", "AdminPass123");
    const o = (await jo.post("/api/orders").send(checkout([{ productId: ice.id, quantity: 1 }], { address: full, saveAddress: true })).expect(201)).body.order;
    expect(o).toMatchObject({ addrArea: "Hindpiri", addrDistrict: "Ranchi", addrCity: "Ranchi", addrHouse: "12B", addrLandmark: "Near the park", addrLatitude: 23.37, addrLongitude: 85.33, addrPincode: "122018" });
    const saved = (await jo.get("/api/addresses").expect(200)).body.addresses.find((a: { id: string }) => a.id === o.addressId);
    expect(saved).toMatchObject({ area: "Hindpiri", district: "Ranchi", city: "Ranchi" });
    const seen = (await admin.get("/api/orders?all=true").expect(200)).body.orders.find((x: { id: string }) => x.id === o.id);
    expect(seen).toMatchObject({ addrArea: "Hindpiri", addrDistrict: "Ranchi", addrState: "Jharkhand", addrLatitude: 23.37 });
    expect((await admin.get("/api/orders/" + o.id).expect(200)).body.order.addrArea).toBe("Hindpiri");
  });
  it("accepts a city without a district (and vice versa) but requires one of them", async () => {
    const jo = await login("jo@test.dev", "password123");
    const items = [{ productId: ice.id, quantity: 1 }];
    const { district: _d, ...noDistrict } = full;
    const a = (await jo.post("/api/orders").send(checkout(items, { address: { ...noDistrict, city: "Gurgaon" } })).expect(201)).body.order;
    expect(a).toMatchObject({ addrCity: "Gurgaon", addrDistrict: "Gurgaon" });
    const { city: _c, ...rest } = { ...full, city: undefined };
    await jo.post("/api/orders").send(checkout(items, { address: { ...rest, district: "" } })).expect(400);
    const r = await request(app).post("/api/addresses/validate").send({ ...rest, district: "" }).expect(400);
    expect(r.body.details.district).toBeTruthy();
  });
  it("keeps the PIN a string and rejects numeric or malformed PIN codes", async () => {
    const jo = await login("jo@test.dev", "password123");
    const items = [{ productId: ice.id, quantity: 1 }];
    await jo.post("/api/orders").send(checkout(items, { address: { ...full, pincode: 122018 } })).expect(400);
    await jo.post("/api/orders").send(checkout(items, { address: { ...full, pincode: "012345" } })).expect(400);
    await request(app).get("/api/pincode/1220180").expect(400);
  });
  it("treats a postal-service timeout like any other outage: reported, not faked", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" })));
    const r = (await request(app).get("/api/pincode/110011").expect(200)).body;
    expect(r.postal.status).toBe("unavailable");
    expect(r.postal.message).toMatch(/enter the area, district and state manually/i);
    expect(r.delivery).toEqual({ serviceable: false, pincode: "110011", reason: "not_covered" });
  });
  it("answers a PIN with several post offices", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => [{ Status: "Success", PostOffice: ["Banahappa", "Bedam", "Daroo"].map((Name) => ({ Name, District: "Hazaribag", State: "Jharkhand", Block: "Sadar" })) }] }));
    const r = (await request(app).get("/api/pincode/825313").expect(200)).body;
    expect(r.postal.offices.map((o: { name: string }) => o.name)).toEqual(["Banahappa", "Bedam", "Daroo"]);
    expect(r.postal).toMatchObject({ district: "Hazaribag", state: "Jharkhand" });
  });
});

describe("order access and status", () => {
  it("scopes orders to their owner, lets admins see all with address details, and restricts status changes", async () => {
    const jo = await login("jo@test.dev", "password123");
    const admin = await login("admin@test.dev", "AdminPass123");
    const mine = (await jo.get("/api/orders").expect(200)).body.orders;
    expect(mine.length).toBeGreaterThan(0);
    const id = mine[0].id;
    const sam = agent();
    await sam.post("/api/auth/register").send({ name: "Sam Other", email: "sam@test.dev", password: "password123" }).expect(201);
    await sam.get(`/api/orders/${id}`).expect(404);
    expect((await sam.get("/api/orders?all=true").expect(200)).body.orders).toHaveLength(0);
    const all = (await admin.get("/api/orders?all=true").expect(200)).body.orders;
    expect(all.length).toBeGreaterThanOrEqual(mine.length);
    expect(all[0].user).toMatchObject({ email: expect.any(String) });
    await jo.patch(`/api/orders/${id}/status`).send({ status: "DELIVERED" }).expect(403);
    await admin.patch(`/api/orders/${id}/status`).send({ status: "DELIVERED" }).expect(409); // must follow the flow
    await admin.patch(`/api/orders/${id}/status`).send({ status: "CONFIRMED" }).expect(200);
  });
  it("cancelling restores stock and delivered orders are final", async () => {
    const jo = await login("jo@test.dev", "password123");
    const admin = await login("admin@test.dev", "AdminPass123");
    const p = await prisma.product.create({ data: { slug: "cancelme", name: "Cancel", packSize: "1", priceMinor: 1000, stock: 4, categoryId: iceCat } });
    const o = (await jo.post("/api/orders").send(checkout([{ productId: p.id, quantity: 3 }])).expect(201)).body.order;
    expect((await prisma.product.findUniqueOrThrow({ where: { id: p.id } })).stock).toBe(1);
    await jo.patch(`/api/orders/${o.id}/status`).send({ status: "CANCELLED" }).expect(200);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: p.id } })).stock).toBe(4);
    // cancelling is idempotent: a repeated request is harmless and does not restock a second time
    await jo.patch(`/api/orders/${o.id}/status`).send({ status: "CANCELLED" }).expect(200);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: p.id } })).stock).toBe(4);
    const o2 = (await jo.post("/api/orders").send(checkout([{ productId: p.id, quantity: 1 }])).expect(201)).body.order;
    for (const s of ["CONFIRMED", "PREPARING", "OUT_FOR_DELIVERY", "DELIVERED"]) await admin.patch(`/api/orders/${o2.id}/status`).send({ status: s }).expect(200);
    expect((await prisma.payment.findUniqueOrThrow({ where: { orderId: o2.id } })).status).toBe("PAID");
    await jo.patch(`/api/orders/${o2.id}/status`).send({ status: "CANCELLED" }).expect(409);
  });
});

describe("admin dashboard data", () => {
  it("serves stats, bundles, discounts, customers and service areas to admins only", async () => {
    const admin = await login("admin@test.dev", "AdminPass123");
    const jo = await login("jo@test.dev", "password123");
    await jo.get("/api/admin/stats").expect(403);
    await request(app).get("/api/admin/stats").expect(401);
    const stats = (await admin.get("/api/admin/stats").expect(200)).body;
    expect(stats.orders).toBeGreaterThan(0);
    expect(stats).toHaveProperty("lowStock");
    expect((await admin.get("/api/admin/customers").expect(200)).body.customers.length).toBeGreaterThan(0);
    const b = (await admin.post("/api/admin/bundles").send({ name: "Test Kit", priceMinor: 9000, items: [{ productId: ice.id, quantity: 1 }, { productId: tonic.id, quantity: 1 }] }).expect(201)).body.bundle;
    expect(b).toMatchObject({ regularMinor: 14500, savingsMinor: 5500 });
    await admin.post("/api/admin/bundles").send({ name: "Bad Kit", priceMinor: 9000, items: [{ productId: beerLike.id, quantity: 1 }] }).expect(400);
    expect((await request(app).get("/api/bundles").expect(200)).body.bundles.map((x: { slug: string }) => x.slug)).toContain("test-kit");
    await admin.put("/api/admin/service-areas/700001").send({ areaName: "Kolkata test", etaMinutes: 30 }).expect(200);
    expect((await request(app).get("/api/delivery/check?pincode=700001")).body.serviceable).toBe(true);
    await admin.post("/api/admin/discounts").send({ code: "pct150", type: "PERCENT", value: 150 }).expect(400);
    expect((await admin.post("/api/admin/discounts").send({ code: "party5", type: "PERCENT", value: 5 }).expect(201)).body.discount.code).toBe("PARTY5");
  });
});

describe("customer management", () => {
  const cust = { name: "Cara Customer", email: "cara@test.dev", password: "password123", phone: "9123456780" };

  it("saves registrations, reuses the record on login, and lists real data with search, filter and pagination for admins only", async () => {
    const before = await prisma.user.count();
    const a = agent();
    await a.post("/api/auth/register").send(cust).expect(201);
    const row = await prisma.user.findUniqueOrThrow({ where: { email: cust.email } });
    expect(row).toMatchObject({ name: cust.name, phone: cust.phone, role: "CUSTOMER", isActive: true });
    expect(row.lastLoginAt).not.toBeNull();
    await request(app).post("/api/auth/register").send(cust).expect(409); // no duplicate

    // login reuses the same record and refreshes lastLoginAt
    await new Promise((r) => setTimeout(r, 20));
    await login(cust.email, cust.password);
    expect(await prisma.user.count()).toBe(before + 1);
    const after = await prisma.user.findUniqueOrThrow({ where: { email: cust.email } });
    expect(after.id).toBe(row.id);
    expect(after.lastLoginAt!.getTime()).toBeGreaterThan(row.lastLoginAt!.getTime());

    // profile updates are reflected in the admin list
    await a.patch("/api/auth/me").send({ name: "Cara Updated" }).expect(200);

    const admin = await login("admin@test.dev", "AdminPass123");
    const list = (await admin.get("/api/admin/customers").query({ q: "cara" }).expect(200)).body;
    expect(list.total).toBe(1);
    expect(list.customers[0]).toMatchObject({ id: row.id, name: "Cara Updated", email: cust.email, phone: cust.phone, status: "ACTIVE", orderCount: 0, totalSpentMinor: 0 });
    expect(list.customers[0].createdAt).toBeTruthy();
    expect(list.customers[0].lastLoginAt).toBeTruthy();
    expect(list.customers[0]).not.toHaveProperty("passwordHash");

    // spend counts non-cancelled orders only
    const o = (await a.post("/api/orders").send(checkout([{ productId: ice.id, quantity: 1 }])).expect(201)).body.order;
    let c = (await admin.get("/api/admin/customers").query({ q: cust.email }).expect(200)).body.customers[0];
    expect(c).toMatchObject({ orderCount: 1, totalSpentMinor: o.totalMinor });
    await a.patch(`/api/orders/${o.id}/status`).send({ status: "CANCELLED" }).expect(200);
    c = (await admin.get("/api/admin/customers").query({ q: "9123456780" }).expect(200)).body.customers[0];
    expect(c).toMatchObject({ orderCount: 1, totalSpentMinor: 0 });

    // pagination, filtering, validation; admins are never listed as customers
    const p1 = (await admin.get("/api/admin/customers").query({ pageSize: 1, page: 1 }).expect(200)).body;
    const p2 = (await admin.get("/api/admin/customers").query({ pageSize: 1, page: 2 }).expect(200)).body;
    expect(p1.customers).toHaveLength(1);
    expect(p2.customers[0].id).not.toBe(p1.customers[0].id);
    expect(p1.total).toBeGreaterThan(1);
    const all = (await admin.get("/api/admin/customers").query({ pageSize: 100 }).expect(200)).body.customers as { email: string }[];
    expect(all.map((x) => x.email)).not.toContain("admin@test.dev");
    expect((await admin.get("/api/admin/customers").query({ status: "disabled", q: "cara" }).expect(200)).body.total).toBe(0);
    await admin.get("/api/admin/customers").query({ pageSize: 1000 }).expect(400);

    // customers cannot read the list, only their own account
    await a.get("/api/admin/customers").expect(403);
    await request(app).get("/api/admin/customers").expect(401);
    expect((await a.get("/api/auth/me").expect(200)).body.user.email).toBe(cust.email);
  });

  it("blocks disabled accounts from logging in and from using an existing session", async () => {
    const a = await login(cust.email, cust.password);
    await prisma.user.update({ where: { email: cust.email }, data: { isActive: false } });
    expect((await a.get("/api/auth/me").expect(200)).body).toEqual({ user: null });
    await request(app).post("/api/auth/login").send({ email: cust.email, password: cust.password }).expect(403);
    const admin = await login("admin@test.dev", "AdminPass123");
    expect((await admin.get("/api/admin/customers").query({ status: "disabled" }).expect(200)).body.customers[0]).toMatchObject({ email: cust.email, status: "DISABLED" });
    await prisma.user.update({ where: { email: cust.email }, data: { isActive: true } });
    await login(cust.email, cust.password);
  });
});

describe("CORS and deployment health", () => {
  it("parses CLIENT_ORIGIN: trailing slash, paths, lists and spaces are tolerated; garbage is rejected", async () => {
    const { parseOrigins } = await import("../src/lib/origins.js");
    expect(parseOrigins("https://ice-cocktail-beta.vercel.app/")).toEqual(["https://ice-cocktail-beta.vercel.app"]); // the deployed value had a trailing slash
    expect(parseOrigins("https://a.vercel.app/path/x")).toEqual(["https://a.vercel.app"]);
    expect(parseOrigins(" https://a.vercel.app , http://localhost:5173/ ,https://a.vercel.app")).toEqual(["https://a.vercel.app", "http://localhost:5173"]);
    expect(parseOrigins("https://a.vercel.app\nhttps://b.vercel.app, https://c.vercel.app")).toEqual(["https://a.vercel.app", "https://b.vercel.app", "https://c.vercel.app"]); // pasted one per line
    expect(parseOrigins("")).toEqual([]);
    expect(() => parseOrigins("not a url")).toThrow(/invalid URL/);
    const { allowedOrigins } = await import("../src/lib/origins.js");
    const prod = ["https://ice-cocktail-beta.vercel.app"];
    expect(allowedOrigins(prod, "production")).toEqual(prod); // production: exactly what is configured, never localhost
    expect(allowedOrigins(prod, "test")).toEqual(prod);
    const dev = allowedOrigins(prod, "development");
    expect(dev).toEqual(expect.arrayContaining(["https://ice-cocktail-beta.vercel.app", "http://localhost:5173", "http://127.0.0.1:5173"]));
    expect(new Set(dev).size).toBe(dev.length);
  });
  it("matches Vercel preview URLs of one project only (strict patterns)", async () => {
    const { parseOriginPatterns, isOriginAllowed } = await import("../src/lib/origins.js");
    const exact = ["https://ice-cocktail-beta.vercel.app", "http://localhost:5173"];
    const pats = parseOriginPatterns("https://ice-cocktail-*-pankaj-kumars-projects-d26ce2ff.vercel.app");
    const ok = (o: string) => isOriginAllowed(o, exact, pats);
    expect(ok("https://ice-cocktail-beta.vercel.app")).toBe(true);
    expect(ok("http://localhost:5173")).toBe(true);
    expect(ok("https://ice-cocktail-1nv3miyq8-pankaj-kumars-projects-d26ce2ff.vercel.app")).toBe(true); // the blocked preview URL
    expect(ok("https://ice-cocktail-git-main-pankaj-kumars-projects-d26ce2ff.vercel.app")).toBe(true);
    expect(ok("https://ice-cocktail-1nv3miyq8-someone-elses-projects-aaaa.vercel.app")).toBe(false); // another team
    expect(ok("https://evil.vercel.app")).toBe(false);
    expect(ok("https://ice-cocktail-x-pankaj-kumars-projects-d26ce2ff.vercel.app.evil.com")).toBe(false); // suffix trick
    expect(ok("https://evil.com/ice-cocktail-x-pankaj-kumars-projects-d26ce2ff.vercel.app")).toBe(false);
    expect(ok("https://a.b.ice-cocktail-x-pankaj-kumars-projects-d26ce2ff.vercel.app")).toBe(false); // no extra labels
    expect(ok("http://ice-cocktail-x-pankaj-kumars-projects-d26ce2ff.vercel.app")).toBe(false); // https only
    expect(ok("https://ice-cocktail--pankaj-kumars-projects-d26ce2ff.vercel.app")).toBe(true); // empty hash still a valid label
    expect(ok("https://ice-cocktail-x-pankaj-kumars-projects-d26ce2ff.vercel.app:8443")).toBe(false); // ports never match
    for (const bad of ["https://*.vercel.app", "*", "https://*", "http://ice-cocktail-*-x.vercel.app", "https://a*b*c-team.vercel.app", "https://ice-*.com", "https://*.com"]) {
      expect(() => parseOriginPatterns(bad), bad).toThrow(/unsafe or invalid/);
    }
    expect(parseOriginPatterns(undefined)).toEqual([]);
  });
  it("allows the configured origin (exact match, with credentials) and not others", async () => {
    const ok = await request(app).options("/api/categories").set("Origin", "http://localhost:5173").set("Access-Control-Request-Method", "GET").expect(204);
    expect(ok.headers["access-control-allow-origin"]).toBe("http://localhost:5173");
    expect(ok.headers["access-control-allow-credentials"]).toBe("true");
    const other = await request(app).options("/api/categories").set("Origin", "https://evil.example").set("Access-Control-Request-Method", "GET");
    expect(other.headers["access-control-allow-origin"]).toBeUndefined();
    const plain = await request(app).get("/api/health").expect(200); // no Origin header: still served
    expect(plain.body).toEqual({ ok: true });
  });
  it("reports database readiness without leaking secrets", async () => {
    const r = await request(app).get("/api/health/db").expect(200);
    expect(r.body).toMatchObject({ ok: true, db: true });
    expect(typeof r.body.categories).toBe("number");
    expect(JSON.stringify(r.body)).not.toMatch(/postgres|password|DATABASE_URL/i);
  });
});

describe("database health diagnosis", () => {
  it("names the cause of a database failure without leaking connection details", async () => {
    const { classifyDbError } = await import("../src/lib/dbHealth.js");
    const mongo = classifyDbError({ name: "PrismaClientInitializationError", message: "Invalid `prisma.category.count()` invocation:\nerror: Error validating datasource `db`: the URL must start with the protocol `postgresql://` or `postgres://`." });
    expect(mongo).toMatchObject({ reason: "NOT_POSTGRES_URL", code: "PrismaClientInitializationError" });
    expect(mongo.hint).toMatch(/mongodb/i);
    expect(classifyDbError({ name: "PrismaClientInitializationError", message: "Can't reach database server at `db.internal.example:5432`" }).reason).toBe("UNREACHABLE");
    expect(classifyDbError({ name: "PrismaClientInitializationError", message: "Authentication failed against database server, the provided database credentials for `app` are not valid." }).reason).toBe("AUTH_FAILED");
    expect(classifyDbError({ name: "PrismaClientInitializationError", message: "Database `shop` does not exist on the database server" }).reason).toBe("DATABASE_MISSING");
    expect(classifyDbError({ code: "P2021", message: "The table `public.Category` does not exist" }).reason).toBe("TABLES_MISSING");
    expect(classifyDbError({ name: "SomethingElse", message: "boom" }).reason).toBe("UNKNOWN");
    // the host from the raw message must never appear in the response
    expect(JSON.stringify(classifyDbError({ name: "PrismaClientInitializationError", message: "Can't reach database server at `secret-host.internal:5432`" }))).not.toMatch(/secret-host|5432/);
  });
});
