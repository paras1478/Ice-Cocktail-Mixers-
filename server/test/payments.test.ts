import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import { createHmac } from "node:crypto";
import { createApp } from "../src/app.js";
import { prisma } from "../src/lib/db.js";
import { verifyPaymentSignature, verifyWebhookSignature } from "../src/lib/razorpay.js";

// The Razorpay API is mocked (these tests never contact Razorpay). The credentials below come from vitest.config.ts and are fake.
const KEY_SECRET = "unit_test_secret_value";
const WEBHOOK_SECRET = "unit_webhook_secret";
const sign = (orderId: string, paymentId: string) => createHmac("sha256", KEY_SECRET).update(`${orderId}|${paymentId}`).digest("hex");
const webhookSig = (raw: string) => createHmac("sha256", WEBHOOK_SECRET).update(raw).digest("hex");

interface GatewayPayment { id: string; order_id: string | null; status: string; amount: number; currency: string; error_description?: string }
const gateway = { orders: 0, created: [] as { amount: number; receipt: string; auth: string }[], payments: new Map<string, GatewayPayment>(), captureCalls: 0 };
function mockRazorpay() {
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: { method?: string; body?: string; headers?: Record<string, string> }) => {
    const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } });
    const path = String(url).replace("https://api.razorpay.com/v1", "");
    if (path === "/orders" && init?.method === "POST") {
      const b = JSON.parse(init.body!);
      gateway.created.push({ amount: b.amount, receipt: b.receipt, auth: init.headers!.authorization });
      return json({ id: `order_TEST${++gateway.orders}`, amount: b.amount, currency: b.currency, status: "created" });
    }
    const cap = /^\/payments\/([^/]+)\/capture$/.exec(path);
    if (cap && init?.method === "POST") {
      gateway.captureCalls++;
      const p = gateway.payments.get(cap[1])!;
      p.status = "captured";
      return json(p);
    }
    const one = /^\/payments\/([^/]+)$/.exec(path);
    if (one) return gateway.payments.has(one[1]) ? json(gateway.payments.get(one[1])) : json({ error: { code: "BAD_REQUEST_ERROR" } }, 400);
    return json({ error: { code: "NOT_FOUND" } }, 404);
  }));
}

const app = createApp();
const PW = "Pay-Test-Pass1";
let n = 0;
const email = () => `pay${Date.now()}${++n}@gmail.test`;
let product = { id: "" };
const body = (extra: object = {}) => ({
  items: [{ productId: product.id, quantity: 2 }], contactName: "Pay Customer", contactPhone: "9876543210", addressConfirmed: true, paymentMethod: "ONLINE",
  address: { house: "12", line1: "Test Street, Sector 54", city: "Gurgaon", state: "Haryana", pincode: "122018" }, ...extra,
});

async function signedUp() {
  const a = request.agent(app);
  await a.post("/api/auth/register").send({ name: "Pay Customer", email: email(), password: PW }).expect(201);
  return a;
}
async function placeOnline(a: ReturnType<typeof request.agent>, extra: object = {}) {
  const o = (await a.post("/api/orders").send(body(extra)).expect(201)).body.order;
  const g = (await a.post("/api/payments/razorpay/order").send({ orderId: o.id }).expect(200)).body;
  return { order: o, gw: g as { razorpayOrderId: string; amountMinor: number } };
}
const gatewayPay = (id: string, orderId: string, amount: number, status = "captured", extra: object = {}): GatewayPayment => {
  const p = { id, order_id: orderId, status, amount, currency: "INR", ...extra };
  gateway.payments.set(id, p);
  return p;
};
const payRow = (orderId: string) => prisma.payment.findUniqueOrThrow({ where: { orderId } });

beforeAll(async () => {
  const cat = await prisma.category.upsert({ where: { slug: "ice-bags" }, update: {}, create: { slug: "ice-bags", name: "Ice Bags", sortOrder: 0 } });
  await prisma.serviceArea.upsert({ where: { pincode: "122018" }, update: { isActive: true }, create: { pincode: "122018", areaName: "Sector 54", city: "Gurgaon", state: "Haryana", etaMinutes: 14 } });
  product = await prisma.product.create({ data: { slug: `pay-ice-${Date.now()}`, name: "Payment Test Ice", packSize: "1 kg", priceMinor: 6000, stock: 500, categoryId: cat.id } });
});
afterEach(() => { vi.unstubAllGlobals(); gateway.created.length = 0; gateway.payments.clear(); gateway.captureCalls = 0; });
afterAll(() => prisma.$disconnect());

describe("signature verification", () => {
  it("accepts only the HMAC of order_id|payment_id made with the key secret", () => {
    expect(verifyPaymentSignature("order_A", "pay_B", sign("order_A", "pay_B"))).toBe(true);
    expect(verifyPaymentSignature("order_A", "pay_B", sign("order_A", "pay_C"))).toBe(false);
    expect(verifyPaymentSignature("order_A", "pay_B", "")).toBe(false);
    expect(verifyPaymentSignature("order_A", "pay_B", sign("order_A", "pay_B"), "other-secret")).toBe(false);
    expect(verifyPaymentSignature("order_A", "pay_B", "short")).toBe(false);
  });
  it("verifies webhook signatures over the exact raw body", () => {
    const raw = '{"event":"payment.captured"}';
    expect(verifyWebhookSignature(Buffer.from(raw), webhookSig(raw))).toBe(true);
    expect(verifyWebhookSignature(Buffer.from(raw + " "), webhookSig(raw))).toBe(false);
    expect(verifyWebhookSignature(Buffer.from(raw), undefined)).toBe(false);
  });
});

describe("creating the online payment", () => {
  it("advertises online payments without exposing any secret", async () => {
    const cfg = (await request(app).get("/api/config").expect(200)).body;
    expect(cfg.payments.online).toBe(true);
    expect(JSON.stringify(cfg)).not.toContain(KEY_SECRET);
    expect((await request(app).get("/api/payments/config").expect(200)).body).toEqual({ enabled: true, testMode: true });
  });

  it("charges the server-computed total, ignores any amount from the browser, and reuses the gateway order on retry", async () => {
    mockRazorpay();
    const a = await signedUp();
    const o = (await a.post("/api/orders").send(body({ amountMinor: 1, totalMinor: 1, amount: 1 })).expect(201)).body.order;
    expect(o.payment).toMatchObject({ method: "ONLINE", status: "PENDING" });
    const first = await a.post("/api/payments/razorpay/order").send({ orderId: o.id, amount: 1 }).expect(200);
    expect(first.body).toMatchObject({ keyId: "rzp_test_unitkey", amountMinor: o.totalMinor, currency: "INR", orderNumber: o.number, testMode: true });
    expect(first.body.amountMinor).toBeGreaterThan(1);
    expect(JSON.stringify(first.body)).not.toContain(KEY_SECRET);
    expect(gateway.created).toHaveLength(1);
    expect(gateway.created[0].amount).toBe(o.totalMinor); // from the stored order, not from the request
    expect(gateway.created[0].auth).toBe("Basic " + Buffer.from(`rzp_test_unitkey:${KEY_SECRET}`).toString("base64"));
    const again = await a.post("/api/payments/razorpay/order").send({ orderId: o.id }).expect(200);
    expect(again.body.razorpayOrderId).toBe(first.body.razorpayOrderId);
    expect(gateway.created).toHaveLength(1); // no second gateway order for the same order
  });

  it("an invalid coupon is ignored and Razorpay is asked for the full original amount", async () => {
    mockRazorpay();
    const a = await signedUp();
    const o = (await a.post("/api/orders").send(body({ code: "FALT50" })).expect(201));
    expect(o.body.couponMessage).toBe("Invalid discount code");
    expect(o.body.order.discountMinor).toBe(0);
    const g = (await a.post("/api/payments/razorpay/order").send({ orderId: o.body.order.id }).expect(200)).body;
    expect(g.amountMinor).toBe(o.body.order.totalMinor);
    expect(gateway.created.at(-1)!.amount).toBe(2 * 6000 + 2900 + Math.round((2 * 6000 * 1800) / 10000)); // subtotal + delivery + tax, no discount
  });

  it("never exposes or creates payments for someone else's order, and rejects cash-on-delivery orders", async () => {
    mockRazorpay();
    const owner = await signedUp();
    const other = await signedUp();
    const o = (await owner.post("/api/orders").send(body()).expect(201)).body.order;
    await other.post("/api/payments/razorpay/order").send({ orderId: o.id }).expect(404);
    await request(app).post("/api/payments/razorpay/order").send({ orderId: o.id }).expect(401);
    const cod = (await owner.post("/api/orders").send(body({ paymentMethod: "COD" })).expect(201)).body.order;
    await owner.post("/api/payments/razorpay/order").send({ orderId: cod.id }).expect(400);
    expect(cod.payment).toMatchObject({ method: "COD", status: "PENDING" }); // cash on delivery is unchanged
  });
});

describe("verifying the payment (browser callback)", () => {
  it("rejects a forged or mismatched signature and leaves the order unpaid", async () => {
    mockRazorpay();
    const a = await signedUp();
    const { order, gw } = await placeOnline(a);
    gatewayPay("pay_REAL1", gw.razorpayOrderId, gw.amountMinor);
    const cb = (over: object) => a.post("/api/payments/razorpay/verify").send({ orderId: order.id, razorpay_order_id: gw.razorpayOrderId, razorpay_payment_id: "pay_REAL1", razorpay_signature: sign(gw.razorpayOrderId, "pay_REAL1"), ...over });
    expect((await cb({ razorpay_signature: "0".repeat(64) })).status).toBe(400);
    expect((await cb({ razorpay_signature: sign(gw.razorpayOrderId, "pay_OTHER") })).status).toBe(400);
    expect((await cb({ razorpay_order_id: "order_SOMEONEELSE" })).status).toBe(400);
    expect((await payRow(order.id)).status).toBe("PENDING");
  });

  it("marks the order paid only after Razorpay confirms the captured amount, is idempotent, and shows it to the admin", async () => {
    mockRazorpay();
    const a = await signedUp();
    const { order, gw } = await placeOnline(a);
    gatewayPay("pay_OK1", gw.razorpayOrderId, gw.amountMinor);
    const send = () => a.post("/api/payments/razorpay/verify").send({ orderId: order.id, razorpay_order_id: gw.razorpayOrderId, razorpay_payment_id: "pay_OK1", razorpay_signature: sign(gw.razorpayOrderId, "pay_OK1") });
    const ok = await send();
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ status: "paid", order: { id: order.id, payment: { status: "PAID", method: "ONLINE" } } });
    expect(await payRow(order.id)).toMatchObject({ status: "PAID", providerPaymentId: "pay_OK1", providerOrderId: gw.razorpayOrderId });
    expect((await payRow(order.id)).paidAt).not.toBeNull();
    // duplicate callback (double click / reload): same result, nothing changes
    const dup = await send();
    expect(dup.status).toBe(200);
    expect(dup.body.status).toBe("already-paid");
    expect(await prisma.order.count({ where: { id: order.id } })).toBe(1);
    // a different payment id for an already-paid order is refused
    gatewayPay("pay_OK2", gw.razorpayOrderId, gw.amountMinor);
    const second = await a.post("/api/payments/razorpay/verify").send({ orderId: order.id, razorpay_order_id: gw.razorpayOrderId, razorpay_payment_id: "pay_OK2", razorpay_signature: sign(gw.razorpayOrderId, "pay_OK2") });
    expect(second.status).toBe(409);
    expect((await payRow(order.id)).providerPaymentId).toBe("pay_OK1");
    // the admin Orders dashboard lists it with its payment
    await prisma.user.upsert({ where: { email: "pay-admin@test.dev" }, update: {}, create: { email: "pay-admin@test.dev", name: "Admin", role: "ADMIN", passwordHash: await bcrypt.hash(PW, 4) } });
    const admin = request.agent(app);
    await admin.post("/api/auth/login").send({ email: "pay-admin@test.dev", password: PW }).expect(200);
    const seen = (await admin.get("/api/orders?all=true").expect(200)).body.orders.find((o: { id: string }) => o.id === order.id);
    expect(seen.payment).toMatchObject({ method: "ONLINE", status: "PAID" });
  });

  it("refuses an amount that differs from the order, and a payment that belongs to another gateway order", async () => {
    mockRazorpay();
    const a = await signedUp();
    const { order, gw } = await placeOnline(a);
    gatewayPay("pay_LOW", gw.razorpayOrderId, 100); // captured, but only 1 rupee
    const low = await a.post("/api/payments/razorpay/verify").send({ orderId: order.id, razorpay_order_id: gw.razorpayOrderId, razorpay_payment_id: "pay_LOW", razorpay_signature: sign(gw.razorpayOrderId, "pay_LOW") });
    expect(low.status).toBe(409);
    expect((await payRow(order.id)).status).toBe("PENDING");
    gatewayPay("pay_ELSEWHERE", "order_NOTMINE", gw.amountMinor);
    const wrong = await a.post("/api/payments/razorpay/verify").send({ orderId: order.id, razorpay_order_id: gw.razorpayOrderId, razorpay_payment_id: "pay_ELSEWHERE", razorpay_signature: sign(gw.razorpayOrderId, "pay_ELSEWHERE") });
    expect(wrong.status).toBe(400);
    expect((await payRow(order.id)).status).toBe("PENDING");
  });

  it("records a failed payment, keeps the order, and lets a retry succeed on the same order", async () => {
    mockRazorpay();
    const a = await signedUp();
    const { order, gw } = await placeOnline(a);
    gatewayPay("pay_BAD", gw.razorpayOrderId, gw.amountMinor, "failed", { error_description: "Payment declined by bank" });
    const failed = await a.post("/api/payments/razorpay/verify").send({ orderId: order.id, razorpay_order_id: gw.razorpayOrderId, razorpay_payment_id: "pay_BAD", razorpay_signature: sign(gw.razorpayOrderId, "pay_BAD") });
    expect(failed.status).toBe(402);
    expect(await payRow(order.id)).toMatchObject({ status: "FAILED", failureReason: "Payment declined by bank", providerPaymentId: null });
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("PLACED"); // the order is kept for a retry
    const again = await a.post("/api/payments/razorpay/order").send({ orderId: order.id }).expect(200);
    expect(again.body.razorpayOrderId).toBe(gw.razorpayOrderId);
    gatewayPay("pay_RETRY", gw.razorpayOrderId, gw.amountMinor);
    await a.post("/api/payments/razorpay/verify").send({ orderId: order.id, razorpay_order_id: gw.razorpayOrderId, razorpay_payment_id: "pay_RETRY", razorpay_signature: sign(gw.razorpayOrderId, "pay_RETRY") }).expect(200);
    expect(await payRow(order.id)).toMatchObject({ status: "PAID", providerPaymentId: "pay_RETRY", failureReason: null });
  });

  it("captures an authorized payment on the server before confirming it, and reports a payment that is still pending", async () => {
    mockRazorpay();
    const a = await signedUp();
    const { order, gw } = await placeOnline(a);
    gatewayPay("pay_AUTH", gw.razorpayOrderId, gw.amountMinor, "authorized");
    await a.post("/api/payments/razorpay/verify").send({ orderId: order.id, razorpay_order_id: gw.razorpayOrderId, razorpay_payment_id: "pay_AUTH", razorpay_signature: sign(gw.razorpayOrderId, "pay_AUTH") }).expect(200);
    expect(gateway.captureCalls).toBe(1);
    expect((await payRow(order.id)).status).toBe("PAID");
    const b = await signedUp();
    const second = await placeOnline(b);
    gatewayPay("pay_WAIT", second.gw.razorpayOrderId, second.gw.amountMinor, "created");
    const wait = await b.post("/api/payments/razorpay/verify").send({ orderId: second.order.id, razorpay_order_id: second.gw.razorpayOrderId, razorpay_payment_id: "pay_WAIT", razorpay_signature: sign(second.gw.razorpayOrderId, "pay_WAIT") });
    expect(wait.status).toBe(409);
    expect((await payRow(second.order.id)).status).toBe("PENDING");
  });

  it("lets a customer cancel a paid online order, which keeps the payment record and starts a refund (covered in cancel-refund.test.ts)", async () => {
    mockRazorpay();
    const a = await signedUp();
    const { order, gw } = await placeOnline(a);
    gatewayPay("pay_CANCELPAID" + order.number, gw.razorpayOrderId, gw.amountMinor);
    await a.post("/api/payments/razorpay/verify").send({ orderId: order.id, razorpay_order_id: gw.razorpayOrderId, razorpay_payment_id: "pay_CANCELPAID" + order.number, razorpay_signature: sign(gw.razorpayOrderId, "pay_CANCELPAID" + order.number) }).expect(200);
    const res = await a.post(`/api/orders/${order.id}/cancel`).expect(200);
    expect(res.body.order.status).toBe("CANCELLED");
    expect((await payRow(order.id)).status).not.toBe("PENDING"); // the payment record is kept, never deleted
    // an unpaid online order can still be cancelled (and its stock is returned)
    const c = (await a.post("/api/orders").send(body()).expect(201)).body.order;
    await a.patch(`/api/orders/${c.id}/status`).send({ status: "CANCELLED" }).expect(200);
  });
});

describe("webhook", () => {
  const post = (payload: object, signature?: string) => {
    const raw = JSON.stringify(payload);
    return request(app).post("/api/payments/razorpay/webhook").set("content-type", "application/json").set("x-razorpay-signature", signature ?? webhookSig(raw)).send(raw);
  };
  const event = (name: string, p: GatewayPayment) => ({ event: name, payload: { payment: { entity: p } } });

  it("rejects missing or wrong signatures without changing anything", async () => {
    mockRazorpay();
    const a = await signedUp();
    const { order, gw } = await placeOnline(a);
    const ev = event("payment.captured", { id: "pay_WH0", order_id: gw.razorpayOrderId, status: "captured", amount: gw.amountMinor, currency: "INR" });
    expect((await post(ev, "0".repeat(64))).status).toBe(400);
    expect((await request(app).post("/api/payments/razorpay/webhook").set("content-type", "application/json").send(JSON.stringify(ev))).status).toBe(400);
    expect((await payRow(order.id)).status).toBe("PENDING");
  });

  it("confirms a captured payment once, however many times Razorpay delivers it", async () => {
    mockRazorpay();
    const a = await signedUp();
    const { order, gw } = await placeOnline(a);
    const ev = event("payment.captured", { id: "pay_WH1", order_id: gw.razorpayOrderId, status: "captured", amount: gw.amountMinor, currency: "INR" });
    expect((await post(ev)).status).toBe(200);
    expect((await post(ev)).status).toBe(200);
    expect((await post(event("order.paid", ev.payload.payment.entity))).status).toBe(200);
    expect(await payRow(order.id)).toMatchObject({ status: "PAID", providerPaymentId: "pay_WH1" });
    // a late "failed" event for another attempt cannot undo a paid order
    await post(event("payment.failed", { id: "pay_WH_LATE", order_id: gw.razorpayOrderId, status: "failed", amount: gw.amountMinor, currency: "INR" })).expect(200);
    expect((await payRow(order.id)).status).toBe("PAID");
    // the browser callback arriving after the webhook is a harmless repeat
    gatewayPay("pay_WH1", gw.razorpayOrderId, gw.amountMinor);
    const cb = await a.post("/api/payments/razorpay/verify").send({ orderId: order.id, razorpay_order_id: gw.razorpayOrderId, razorpay_payment_id: "pay_WH1", razorpay_signature: sign(gw.razorpayOrderId, "pay_WH1") });
    expect(cb.status).toBe(200);
    expect(cb.body.status).toBe("already-paid");
  });

  it("records failures, ignores wrong amounts and unknown orders, and still answers 200 so Razorpay does not retry", async () => {
    mockRazorpay();
    const a = await signedUp();
    const { order, gw } = await placeOnline(a);
    await post(event("payment.captured", { id: "pay_WH_LOW", order_id: gw.razorpayOrderId, status: "captured", amount: 1, currency: "INR" })).expect(200);
    expect((await payRow(order.id)).status).toBe("PENDING");
    await post(event("payment.failed", { id: "pay_WH_F", order_id: gw.razorpayOrderId, status: "failed", amount: gw.amountMinor, currency: "INR", error_description: "Card declined" })).expect(200);
    expect(await payRow(order.id)).toMatchObject({ status: "FAILED", failureReason: "Card declined" });
    await post(event("payment.captured", { id: "pay_WH_X", order_id: "order_UNKNOWN", status: "captured", amount: 5, currency: "INR" })).expect(200);
    await post({ event: "refund.created", payload: {} }).expect(200);
  });
});
