import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { createApp } from "../src/app.js";
import { prisma } from "../src/lib/db.js";

const app = createApp();
const PW = "Idem-Test-Pass1";
let n = 0;
const email = () => `idem${Date.now()}${++n}@gmail.test`;
let product = { id: "" };
const stockOf = async () => (await prisma.product.findUniqueOrThrow({ where: { id: product.id } })).stock;
const body = (extra: object = {}) => ({
  items: [{ productId: product.id, quantity: 2 }], contactName: "Idem Customer", contactPhone: "9876543210", addressConfirmed: true, paymentMethod: "COD",
  address: { house: "12", line1: "Test Street, Sector 54", city: "Gurgaon", state: "Haryana", pincode: "122018" }, ...extra,
});
async function signedUp() {
  const a = request.agent(app);
  await a.post("/api/auth/register").send({ name: "Idem Customer", email: email(), password: PW }).expect(201);
  return a;
}

beforeAll(async () => {
  const cat = await prisma.category.upsert({ where: { slug: "ice-bags" }, update: {}, create: { slug: "ice-bags", name: "Ice Bags", sortOrder: 0 } });
  await prisma.serviceArea.upsert({ where: { pincode: "122018" }, update: { isActive: true }, create: { pincode: "122018", areaName: "Sector 54", city: "Gurgaon", state: "Haryana", etaMinutes: 14 } });
  await prisma.discount.upsert({ where: { code: "IDEMTEN" }, update: {}, create: { code: "IDEMTEN", type: "PERCENT", value: 10 } });
  await prisma.discount.upsert({ where: { code: "IDEMOLD" }, update: {}, create: { code: "IDEMOLD", type: "PERCENT", value: 10, expiresAt: new Date(Date.now() - 86_400_000) } });
  await prisma.discount.upsert({ where: { code: "IDEMBIG" }, update: {}, create: { code: "IDEMBIG", type: "FIXED", value: 5000, minSubtotalMinor: 100_000_000 } });
  product = await prisma.product.create({ data: { slug: `idem-ice-${Date.now()}`, name: "Idempotency Ice", packSize: "1 kg", priceMinor: 6000, stock: 1000, categoryId: cat.id } });
});
afterAll(() => prisma.$disconnect());

describe("order creation is idempotent", () => {
  it("the same request id never creates a second order or takes stock twice", async () => {
    const a = await signedUp();
    const before = await stockOf();
    const requestId = randomUUID();
    const first = await a.post("/api/orders").send(body({ requestId })).expect(201);
    const again = await a.post("/api/orders").send(body({ requestId })).expect(200);
    expect(again.body.duplicate).toBe(true);
    expect(again.body.order.id).toBe(first.body.order.id);
    expect(await stockOf()).toBe(before - 2);
    expect((await a.get("/api/orders").expect(200)).body.orders).toHaveLength(1);
  });

  it("simultaneous identical requests produce exactly one order", async () => {
    const a = await signedUp();
    const before = await stockOf();
    const requestId = randomUUID();
    const results = await Promise.all(Array.from({ length: 5 }, () => a.post("/api/orders").send(body({ requestId }))));
    expect(results.every((r) => r.status === 200 || r.status === 201)).toBe(true);
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(new Set(results.map((r) => r.body.order.id)).size).toBe(1);
    expect(await stockOf()).toBe(before - 2);
    expect(await prisma.order.count({ where: { clientRequestId: requestId } })).toBe(1);
  });

  it("different request ids, or none at all, still create separate orders (a customer may genuinely order twice)", async () => {
    const a = await signedUp();
    const one = await a.post("/api/orders").send(body({ requestId: randomUUID() })).expect(201);
    const two = await a.post("/api/orders").send(body({ requestId: randomUUID() })).expect(201);
    const three = await a.post("/api/orders").send(body()).expect(201);
    expect(new Set([one.body.order.id, two.body.order.id, three.body.order.id]).size).toBe(3);
  });

  it("one customer's request id cannot return another customer's order", async () => {
    const a = await signedUp();
    const b = await signedUp();
    const requestId = randomUUID();
    const ao = (await a.post("/api/orders").send(body({ requestId })).expect(201)).body.order;
    const bo = (await b.post("/api/orders").send(body({ requestId })).expect(201)).body.order;
    expect(bo.id).not.toBe(ao.id);
  });
});

describe("discount codes at checkout (a coupon is optional: a bad one is ignored, never applied, never blocks the order)", () => {
  const FULL = 2 * 6000 + 2900 + Math.round((2 * 6000 * 1800) / 10000); // subtotal + delivery fee + tax, no discount

  it.each([
    ["an unknown code", "FALT50", /Invalid discount code/],
    ["an expired code", "IDEMOLD", /expired/],
    ["a code whose minimum order is not met", "IDEMBIG", /Minimum order/],
  ])("%s is ignored: the order is created at the full original amount and the reason is reported", async (_name, code, message) => {
    const a = await signedUp();
    const res = await a.post("/api/orders").send(body({ code })).expect(201);
    expect(res.body.couponMessage).toMatch(message);
    expect(res.body.order).toMatchObject({ discountMinor: 0, discountId: null, subtotalMinor: 12000, deliveryMinor: 2900, totalMinor: FULL });
    expect(res.body.order.payment.amountMinor).toBe(FULL); // what would be charged
  });

  it("the quote also ignores the bad code with a message, and the order total equals the quote total", async () => {
    const a = await signedUp();
    const quote = await request(app).post("/api/cart/quote").send({ items: [{ productId: product.id, quantity: 2 }], code: "FALT50" }).expect(200);
    expect(quote.body).toMatchObject({ discountCode: null, discountMessage: "Invalid discount code" });
    expect(quote.body.totals).toMatchObject({ discountMinor: 0, totalMinor: FULL });
    const order = (await a.post("/api/orders").send(body({ code: "FALT50", expectedTotalMinor: quote.body.totals.totalMinor })).expect(201)).body.order;
    expect(order.totalMinor).toBe(quote.body.totals.totalMinor);
  });

  it("no coupon at all (absent, empty or null) works and reports no coupon message", async () => {
    const a = await signedUp();
    for (const extra of [{}, { code: "" }]) {
      const res = await a.post("/api/orders").send(body(extra)).expect(201);
      expect(res.body.couponMessage).toBeNull();
      expect(res.body.order.totalMinor).toBe(FULL);
    }
  });

  it("a valid code is applied by the server itself and matches the quote; an unknown code is never swapped for another discount", async () => {
    const a = await signedUp();
    const quote = (await request(app).post("/api/cart/quote").send({ items: [{ productId: product.id, quantity: 2 }], code: "IDEMTEN" }).expect(200)).body;
    expect(quote.discountCode).toBe("IDEMTEN");
    const res = await a.post("/api/orders").send(body({ code: "IDEMTEN", expectedTotalMinor: quote.totals.totalMinor })).expect(201);
    expect(res.body.couponMessage).toBeNull();
    expect(res.body.order.discountMinor).toBe(1200); // 10% of 12000, calculated on the server
    expect(res.body.order.totalMinor).toBe(quote.totals.totalMinor);
    const lower = await a.post("/api/orders").send(body({ code: "idemten ", expectedTotalMinor: quote.totals.totalMinor })).expect(201); // codes are matched case-insensitively
    expect(lower.body.order.discountMinor).toBe(1200);
  });

  it("if a coupon stops being valid after the customer saw their total, the order is not placed at a different amount: they are asked to review the new total", async () => {
    const a = await signedUp();
    await prisma.discount.upsert({ where: { code: "IDEMGONE" }, update: { isActive: true }, create: { code: "IDEMGONE", type: "PERCENT", value: 20 } });
    const quote = (await request(app).post("/api/cart/quote").send({ items: [{ productId: product.id, quantity: 2 }], code: "IDEMGONE" }).expect(200)).body;
    await prisma.discount.update({ where: { code: "IDEMGONE" }, data: { isActive: false } }); // switched off meanwhile
    const res = await a.post("/api/orders").send(body({ code: "IDEMGONE", expectedTotalMinor: quote.totals.totalMinor })).expect(409);
    expect(res.body.error).toMatch(/Prices or fees changed/);
    expect((await a.get("/api/orders").expect(200)).body.orders).toHaveLength(0);
  });
});
