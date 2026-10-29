import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import { createHmac } from "node:crypto";
import { createApp } from "../src/app.js";
import { prisma } from "../src/lib/db.js";

// Razorpay is mocked (nothing here contacts it). Credentials come from vitest.config.ts and are fake.
const RUN = Date.now(); // gateway ids are unique per run, as at Razorpay (the test database keeps rows between runs)
const KEY_SECRET = "unit_test_secret_value";
const WEBHOOK_SECRET = "unit_webhook_secret";
const sign = (o: string, p: string) => createHmac("sha256", KEY_SECRET).update(`${o}|${p}`).digest("hex");
const webhookSig = (raw: string) => createHmac("sha256", WEBHOOK_SECRET).update(raw).digest("hex");

interface Refund { id: string; payment_id: string; amount: number; status: "pending" | "processed" | "failed" }
const rz = {
  orders: 0,
  refundSeq: Date.now(), // refund ids are unique, as at Razorpay (never reused between tests)
  payments: new Map<string, { id: string; order_id: string; status: string; amount: number; currency: string }>(),
  refunds: [] as Refund[],
  refundCalls: [] as { paymentId: string; amount: number; key: string }[],
  byKey: new Map<string, Refund>(),
  refundDown: false,
  refundFetchStatus: "processed" as Refund["status"],
};
function mockRazorpay() {
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: { method?: string; body?: string; headers?: Record<string, string> }) => {
    const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } });
    const path = String(url).replace("https://api.razorpay.com/v1", "");
    if (path === "/orders" && init?.method === "POST") return json({ id: `order_CR${RUN}_${++rz.orders}`, amount: JSON.parse(init.body!).amount, currency: "INR", status: "created" });
    const refundCall = /^\/payments\/([^/]+)\/refund$/.exec(path);
    if (refundCall && init?.method === "POST") {
      if (rz.refundDown) return json({ error: { code: "SERVER_ERROR" } }, 500);
      const key = init.headers!["X-Refund-Idempotency"];
      const body = JSON.parse(init.body!);
      rz.refundCalls.push({ paymentId: refundCall[1], amount: body.amount, key });
      const existing = rz.byKey.get(key);
      if (existing) return json(existing); // Razorpay returns the same refund for a repeated idempotency key
      const r: Refund = { id: `rfnd_${++rz.refundSeq}`, payment_id: refundCall[1], amount: body.amount, status: "pending" };
      rz.refunds.push(r);
      rz.byKey.set(key, r);
      return json(r);
    }
    const oneRefund = /^\/refunds\/([^/]+)$/.exec(path);
    if (oneRefund) {
      const r = rz.refunds.find((x) => x.id === oneRefund[1]);
      return r ? json({ ...r, status: rz.refundFetchStatus }) : json({ error: { code: "NOT_FOUND" } }, 404);
    }
    const pay = /^\/payments\/([^/]+)$/.exec(path);
    if (pay) return rz.payments.has(pay[1]) ? json(rz.payments.get(pay[1])) : json({ error: { code: "BAD_REQUEST_ERROR" } }, 400);
    return json({ error: { code: "NOT_FOUND" } }, 404);
  }));
}

const app = createApp();
const PW = "Cancel-Test-Pass1";
let n = 0;
const email = () => `cancel${Date.now()}${++n}@gmail.test`;
let product = { id: "" };
const stockOf = async () => (await prisma.product.findUniqueOrThrow({ where: { id: product.id } })).stock;
const body = (paymentMethod: "COD" | "ONLINE", quantity = 2) => ({
  items: [{ productId: product.id, quantity }], contactName: "Cancel Customer", contactPhone: "9876543210", addressConfirmed: true, paymentMethod,
  address: { house: "12", line1: "Test Street, Sector 54", city: "Gurgaon", state: "Haryana", pincode: "122018" },
});
type Agent = ReturnType<typeof request.agent>;
async function signedUp(): Promise<Agent> {
  const a = request.agent(app);
  await a.post("/api/auth/register").send({ name: "Cancel Customer", email: email(), password: PW }).expect(201);
  return a;
}
const placeCod = async (a: Agent) => (await a.post("/api/orders").send(body("COD")).expect(201)).body.order;
let payN = 0;
async function placePaidOnline(a: Agent) {
  const order = (await a.post("/api/orders").send(body("ONLINE")).expect(201)).body.order;
  const gw = (await a.post("/api/payments/razorpay/order").send({ orderId: order.id }).expect(200)).body;
  const payId = `pay_CR${RUN}_${++payN}`;
  rz.payments.set(payId, { id: payId, order_id: gw.razorpayOrderId, status: "captured", amount: gw.amountMinor, currency: "INR" });
  await a.post("/api/payments/razorpay/verify").send({ orderId: order.id, razorpay_order_id: gw.razorpayOrderId, razorpay_payment_id: payId, razorpay_signature: sign(gw.razorpayOrderId, payId) }).expect(200);
  return { order, payId, gatewayOrderId: gw.razorpayOrderId as string };
}
const payRow = (orderId: string) => prisma.payment.findUniqueOrThrow({ where: { orderId } });
const setStatus = (id: string, status: "PLACED" | "CONFIRMED" | "PREPARING" | "OUT_FOR_DELIVERY" | "DELIVERED") => prisma.order.update({ where: { id }, data: { status } });
const hook = (event: string, payload: object) => {
  const raw = JSON.stringify({ event, payload });
  return request(app).post("/api/payments/razorpay/webhook").set("content-type", "application/json").set("x-razorpay-signature", webhookSig(raw)).send(raw);
};
async function adminAgent(): Promise<Agent> {
  await prisma.user.upsert({ where: { email: "cancel-admin@test.dev" }, update: {}, create: { email: "cancel-admin@test.dev", name: "Admin", role: "ADMIN", passwordHash: await bcrypt.hash(PW, 4) } });
  const a = request.agent(app);
  await a.post("/api/auth/login").send({ email: "cancel-admin@test.dev", password: PW }).expect(200);
  return a;
}

beforeAll(async () => {
  const cat = await prisma.category.upsert({ where: { slug: "ice-bags" }, update: {}, create: { slug: "ice-bags", name: "Ice Bags", sortOrder: 0 } });
  await prisma.serviceArea.upsert({ where: { pincode: "122018" }, update: { isActive: true }, create: { pincode: "122018", areaName: "Sector 54", city: "Gurgaon", state: "Haryana", etaMinutes: 14 } });
  product = await prisma.product.create({ data: { slug: `cancel-ice-${Date.now()}`, name: "Cancel Test Ice", packSize: "1 kg", priceMinor: 6000, stock: 1000, categoryId: cat.id } });
});
afterEach(() => {
  vi.unstubAllGlobals();
  Object.assign(rz, { refundDown: false, refundFetchStatus: "processed" });
  rz.refunds.length = 0; rz.refundCalls.length = 0; rz.byKey.clear(); rz.payments.clear();
});
afterAll(() => prisma.$disconnect());

describe("cancelling a cash-on-delivery order", () => {
  it("cancels a Placed order, restores stock once, keeps the record, and treats a repeated request as already done", async () => {
    mockRazorpay();
    const a = await signedUp();
    const before = await stockOf();
    const o = await placeCod(a);
    expect(await stockOf()).toBe(before - 2);
    const first = await a.post(`/api/orders/${o.id}/cancel`).send({ reason: "Ordered by mistake" }).expect(200);
    expect(first.body.alreadyCancelled).toBe(false);
    expect(first.body.order).toMatchObject({ status: "CANCELLED", cancelReason: "Ordered by mistake", cancelledBy: "CUSTOMER", payment: { method: "COD" } });
    expect(first.body.order.cancelledAt).toBeTruthy();
    expect(await stockOf()).toBe(before);
    const again = await a.post(`/api/orders/${o.id}/cancel`).expect(200);
    expect(again.body.alreadyCancelled).toBe(true);
    expect(await stockOf()).toBe(before); // not restocked twice
    expect(rz.refundCalls).toHaveLength(0); // nothing was paid, so no refund
    expect(await prisma.order.count({ where: { id: o.id } })).toBe(1); // the order is kept
    expect((await a.get("/api/orders").expect(200)).body.orders.find((x: { id: string }) => x.id === o.id).status).toBe("CANCELLED");
  });

  it("allows Confirmed orders, and refuses Preparing, Out for delivery and Delivered ones on the server", async () => {
    mockRazorpay();
    const a = await signedUp();
    const ok = await placeCod(a);
    await setStatus(ok.id, "CONFIRMED");
    await a.post(`/api/orders/${ok.id}/cancel`).expect(200);
    for (const status of ["PREPARING", "OUT_FOR_DELIVERY", "DELIVERED"] as const) {
      const o = await placeCod(a);
      await setStatus(o.id, status);
      const stock = await stockOf();
      const res = await a.post(`/api/orders/${o.id}/cancel`).expect(409);
      expect(res.body.error).toMatch(/can no longer be cancelled/);
      expect((await prisma.order.findUniqueOrThrow({ where: { id: o.id } })).status).toBe(status);
      expect(await stockOf()).toBe(stock);
      await a.patch(`/api/orders/${o.id}/status`).send({ status: "CANCELLED" }).expect(409); // the older endpoint obeys the same rule
    }
  });

  it("only the owner (or an admin) can cancel, and login is required", async () => {
    mockRazorpay();
    const owner = await signedUp();
    const other = await signedUp();
    const o = await placeCod(owner);
    await other.post(`/api/orders/${o.id}/cancel`).expect(404);
    await request(app).post(`/api/orders/${o.id}/cancel`).expect(401);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: o.id } })).status).toBe("PLACED");
    const admin = await adminAgent();
    const res = await admin.post(`/api/orders/${o.id}/cancel`).send({ reason: "Out of stock" }).expect(200);
    expect(res.body.order).toMatchObject({ status: "CANCELLED", cancelledBy: "ADMIN" });
  });

  it("simultaneous cancellations change the order once and restock once", async () => {
    mockRazorpay();
    const a = await signedUp();
    const before = await stockOf();
    const o = await placeCod(a);
    const results = await Promise.all(Array.from({ length: 5 }, () => a.post(`/api/orders/${o.id}/cancel`)));
    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(results.filter((r) => r.body.alreadyCancelled === false)).toHaveLength(1);
    expect(await stockOf()).toBe(before);
  });
});

describe("cancelling a paid online order (refund)", () => {
  it("requests exactly one full refund from Razorpay, shows it as processing, and only a provider confirmation completes it", async () => {
    mockRazorpay();
    const a = await signedUp();
    const { order, payId } = await placePaidOnline(a);
    const res = await a.post(`/api/orders/${order.id}/cancel`).expect(200);
    expect(rz.refundCalls).toEqual([{ paymentId: payId, amount: order.totalMinor, key: expect.stringMatching(/^refund_/) }]);
    expect(res.body.order.payment).toMatchObject({ status: "PAID", refundStatus: "PROCESSING", refundId: rz.refunds[0].id }); // not "refunded" until Razorpay says so
    expect(res.body.order.payment.refundedAt).toBeNull();
    // a repeated request does not refund again
    await a.post(`/api/orders/${order.id}/cancel`).expect(200);
    expect(rz.refundCalls).toHaveLength(1);
    // the provider confirms
    await hook("refund.processed", { refund: { entity: { id: rz.refunds[0].id, payment_id: payId, amount: order.totalMinor, status: "processed" } } }).expect(200);
    expect(await payRow(order.id)).toMatchObject({ status: "REFUNDED", refundStatus: "COMPLETED" });
    expect((await payRow(order.id)).refundedAt).not.toBeNull();
    // a late or repeated "pending" event never moves a completed refund backwards
    await hook("refund.created", { refund: { entity: { id: rz.refunds[0].id, payment_id: payId, amount: order.totalMinor, status: "pending" } } }).expect(200);
    expect(await payRow(order.id)).toMatchObject({ status: "REFUNDED", refundStatus: "COMPLETED" });
    // the admin sees the same
    const admin = await adminAgent();
    const seen = (await admin.get("/api/orders?all=true").expect(200)).body.orders.find((o: { id: string }) => o.id === order.id);
    expect(seen).toMatchObject({ status: "CANCELLED", payment: { refundStatus: "COMPLETED", status: "REFUNDED" } });
  });

  it("keeps the order cancelled when Razorpay does not accept the refund request, shows 'initiated', and the next request completes it without double refunding", async () => {
    mockRazorpay();
    const a = await signedUp();
    const { order } = await placePaidOnline(a);
    rz.refundDown = true;
    const down = await a.post(`/api/orders/${order.id}/cancel`).expect(200);
    expect(down.body.order.status).toBe("CANCELLED");
    expect(down.body.order.payment).toMatchObject({ status: "PAID", refundStatus: "REQUESTED", refundId: null });
    expect(down.body.order.payment.refundFailureReason).toBeTruthy();
    rz.refundDown = false;
    const retry = await a.post(`/api/orders/${order.id}/cancel`).expect(200);
    expect(retry.body.alreadyCancelled).toBe(true);
    expect(retry.body.order.payment).toMatchObject({ refundStatus: "PROCESSING", refundId: rz.refunds[0].id });
    expect(rz.refunds).toHaveLength(1);
  });

  it("records a provider-reported failure, never pretends it completed, and lets only an admin retry it", async () => {
    mockRazorpay();
    const a = await signedUp();
    const { order, payId } = await placePaidOnline(a);
    await a.post(`/api/orders/${order.id}/cancel`).expect(200);
    await hook("refund.failed", { refund: { entity: { id: rz.refunds[0].id, payment_id: payId, amount: order.totalMinor, status: "failed" } } }).expect(200);
    expect(await payRow(order.id)).toMatchObject({ status: "PAID", refundStatus: "FAILED" });
    await a.post(`/api/orders/${order.id}/refund/retry`).expect(403);
    const admin = await adminAgent();
    const res = await admin.post(`/api/orders/${order.id}/refund/retry`).expect(200);
    expect(res.body.order.payment.refundStatus).toBe("PROCESSING");
    expect(rz.refunds).toHaveLength(2); // a new refund was requested only because the first one failed
  });

  it("'Check status' asks Razorpay and records its answer, for the owner only", async () => {
    mockRazorpay();
    const a = await signedUp();
    const other = await signedUp();
    const { order } = await placePaidOnline(a);
    await a.post(`/api/orders/${order.id}/cancel`).expect(200);
    await other.post(`/api/orders/${order.id}/refund/refresh`).expect(404);
    rz.refundFetchStatus = "pending";
    expect((await a.post(`/api/orders/${order.id}/refund/refresh`).expect(200)).body.order.payment.refundStatus).toBe("PROCESSING");
    rz.refundFetchStatus = "processed";
    const done = await a.post(`/api/orders/${order.id}/refund/refresh`).expect(200);
    expect(done.body.order.payment).toMatchObject({ refundStatus: "COMPLETED", status: "REFUNDED" });
  });

  it("many simultaneous cancellations still produce one refund", async () => {
    mockRazorpay();
    const a = await signedUp();
    const { order } = await placePaidOnline(a);
    const results = await Promise.all(Array.from({ length: 5 }, () => a.post(`/api/orders/${order.id}/cancel`)));
    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(rz.refunds).toHaveLength(1);
    expect((await payRow(order.id)).refundStatus).toBe("PROCESSING");
  });

  it("an admin can cancel an order that is already being prepared, and a paid one is refunded", async () => {
    mockRazorpay();
    const a = await signedUp();
    const { order } = await placePaidOnline(a);
    await setStatus(order.id, "PREPARING");
    await a.post(`/api/orders/${order.id}/cancel`).expect(409); // the customer cannot
    const admin = await adminAgent();
    const res = await admin.patch(`/api/orders/${order.id}/status`).send({ status: "CANCELLED" }).expect(200);
    expect(res.body.order).toMatchObject({ status: "CANCELLED", cancelledBy: "ADMIN", payment: { refundStatus: "PROCESSING" } });
    await setStatus(order.id, "DELIVERED").catch(() => undefined);
  });
});

describe("unpaid online orders and late payments", () => {
  it("cancelling an unpaid online order needs no refund, and a payment that arrives afterwards is refunded automatically", async () => {
    mockRazorpay();
    const a = await signedUp();
    const order = (await a.post("/api/orders").send(body("ONLINE")).expect(201)).body.order;
    const gw = (await a.post("/api/payments/razorpay/order").send({ orderId: order.id }).expect(200)).body;
    const res = await a.post(`/api/orders/${order.id}/cancel`).expect(200);
    expect(res.body.order).toMatchObject({ status: "CANCELLED", payment: { status: "PENDING", refundStatus: null } });
    expect(rz.refundCalls).toHaveLength(0);
    // the customer paid in another window just before cancelling: Razorpay's webhook arrives later
    await hook("payment.captured", { payment: { entity: { id: `pay_LATE${RUN}`, order_id: gw.razorpayOrderId, status: "captured", amount: gw.amountMinor, currency: "INR" } } }).expect(200);
    expect(await payRow(order.id)).toMatchObject({ status: "PAID", providerPaymentId: `pay_LATE${RUN}`, refundStatus: "PROCESSING" });
    expect(rz.refundCalls).toEqual([{ paymentId: `pay_LATE${RUN}`, amount: gw.amountMinor, key: expect.any(String) }]);
  });
});

describe("order list", () => {
  it("includes a thumbnail field for every item", async () => {
    mockRazorpay();
    const a = await signedUp();
    const o = await placeCod(a);
    const row = (await a.get("/api/orders").expect(200)).body.orders.find((x: { id: string }) => x.id === o.id);
    expect(row.items[0]).toHaveProperty("image");
    expect(row.items[0]).not.toHaveProperty("product");
  });
});
