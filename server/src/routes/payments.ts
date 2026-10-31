import { Router, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { prisma } from "../lib/db.js";
import { env } from "../lib/env.js";
import { HttpError } from "../lib/errors.js";
import { ah, parse } from "../lib/http.js";
import { capturePayment, createGatewayOrder, fetchPayment, razorpayConfig, verifyPaymentSignature, verifyWebhookSignature, type RazorpayPayment } from "../lib/razorpay.js";
import { requireAuth } from "../middleware/auth.js";
import { applyRefund, startRefund } from "../services/refunds.js";

export const paymentRouter = Router();

const limiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: env.NODE_ENV === "test" ? 1000 : 60,
  message: { error: "Too many payment attempts. Please wait a few minutes." },
});

const include = { items: true, payment: true } as const;

export type SettleResult = "paid" | "already-paid" | "duplicate" | "failed" | "ignored";

/**
 * The single place a payment changes state, shared by the browser callback and the webhook, so both are idempotent and agree.
 * A payment is accepted only if Razorpay itself reports it as captured for OUR gateway order with the amount and currency we expect.
 * Nothing the browser sends decides the outcome.
 */
export async function settlePayment(gateway: RazorpayPayment): Promise<SettleResult> {
  if (!gateway.order_id) return "ignored";
  const row = await prisma.payment.findUnique({ where: { providerOrderId: gateway.order_id } });
  if (!row) return "ignored"; // not an order of this shop
  if (gateway.amount !== row.amountMinor || gateway.currency !== "INR") {
    console.error(`[razorpay] amount/currency mismatch for payment on order ${row.orderId}: refusing to settle`);
    return "ignored";
  }
  if (gateway.status === "captured") {
    if (row.status === "PAID") return row.providerPaymentId === gateway.id ? "already-paid" : "duplicate";
    try {
      const r = await prisma.payment.updateMany({
        where: { id: row.id, status: { in: ["PENDING", "FAILED"] } },
        data: { status: "PAID", providerPaymentId: gateway.id, paidAt: new Date(), failureReason: null },
      });
      if (r.count === 1) {
        // A payment that lands after the order was cancelled (e.g. the customer paid in another tab) is refunded, never kept.
        const o = await prisma.order.findUnique({ where: { id: row.orderId }, select: { status: true } });
        if (o?.status === "CANCELLED") await startRefund(row.orderId);
        return "paid";
      }
    } catch (e) {
      if ((e as { code?: string }).code !== "P2002") throw e; // this payment id is already recorded on another row
    }
    const now = await prisma.payment.findUnique({ where: { id: row.id } });
    return now?.status === "PAID" && now.providerPaymentId === gateway.id ? "already-paid" : "duplicate";
  }
  if (gateway.status === "failed") {
    // A failed attempt can be retried on the same gateway order, so this only records the reason; a later success still wins.
    const r = await prisma.payment.updateMany({ where: { id: row.id, status: "PENDING" }, data: { status: "FAILED", failureReason: (gateway.error_description ?? "Payment failed").slice(0, 200) } });
    return r.count === 1 ? "failed" : "ignored";
  }
  return "ignored";
}

async function ownOnlineOrder(orderId: string, userId: string) {
  const order = await prisma.order.findFirst({ where: { id: orderId, userId }, include: { payment: true, user: { select: { email: true } } } });
  if (!order) throw new HttpError(404, "Order not found"); // 404 for other people's orders too
  if (!order.payment || order.payment.method !== "ONLINE") throw new HttpError(400, "This order is not an online-payment order");
  return { order, payment: order.payment };
}

paymentRouter.get("/config", (_req, res) => {
  const cfg = razorpayConfig();
  res.json({ enabled: cfg !== null, testMode: cfg ? !cfg.live : null }); // never the key secret; the public key id is only returned with a payment order
});

paymentRouter.post(
  "/razorpay/order",
  requireAuth,
  limiter,
  ah(async (req, res) => {
    const cfg = razorpayConfig();
    if (!cfg) throw new HttpError(503, "Online payments are not available right now.");
    const { orderId } = parse(z.object({ orderId: z.string().min(1) }), req.body);
    const { order, payment } = await ownOnlineOrder(orderId, req.user!.id);
    if (order.status === "CANCELLED") throw new HttpError(409, "This order was cancelled");
    if (payment.status === "PAID") throw new HttpError(409, "This order is already paid");

    let gatewayOrderId = payment.providerOrderId;
    if (!gatewayOrderId) {
      // The amount comes from the order stored on the server (itself computed from server-side prices), never from the browser.
      const g = await createGatewayOrder(payment.amountMinor, `order_${order.number}`, { orderId: order.id, orderNumber: String(order.number) });
      const saved = await prisma.payment.updateMany({ where: { id: payment.id, providerOrderId: null }, data: { providerOrderId: g.id } });
      gatewayOrderId = saved.count === 1 ? g.id : (await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).providerOrderId; // lost a race: reuse the winner
    }
    res.json({
      keyId: cfg.keyId,
      razorpayOrderId: gatewayOrderId,
      amountMinor: payment.amountMinor,
      currency: "INR",
      orderId: order.id,
      orderNumber: order.number,
      testMode: !cfg.live,
      prefill: { name: order.contactName, email: order.user.email, contact: order.contactPhone },
    });
  }),
);

paymentRouter.post(
  "/razorpay/verify",
  requireAuth,
  limiter,
  ah(async (req, res) => {
    const b = parse(
      z.object({ orderId: z.string().min(1), razorpay_order_id: z.string().min(1), razorpay_payment_id: z.string().min(1), razorpay_signature: z.string().min(1) }),
      req.body,
    );
    const { order, payment } = await ownOnlineOrder(b.orderId, req.user!.id);
    if (!payment.providerOrderId || payment.providerOrderId !== b.razorpay_order_id) throw new HttpError(400, "Payment verification failed");
    if (!verifyPaymentSignature(b.razorpay_order_id, b.razorpay_payment_id, b.razorpay_signature)) throw new HttpError(400, "Payment verification failed");

    // The signature proves Razorpay issued this payment id for our gateway order. Now ask Razorpay for the real status and amount.
    let gateway = await fetchPayment(b.razorpay_payment_id);
    if (gateway.order_id !== payment.providerOrderId) throw new HttpError(400, "Payment verification failed");
    if (gateway.status === "authorized") gateway = await capturePayment(gateway.id, payment.amountMinor); // accounts with manual capture

    const result = await settlePayment(gateway);
    if (result === "duplicate") throw new HttpError(409, "This order was already paid with a different payment");
    if (result === "ignored" && gateway.status !== "captured" && gateway.status !== "failed") throw new HttpError(409, "Your payment is still being processed. Please check My orders in a moment.");
    if (gateway.status === "failed" || result === "failed") throw new HttpError(402, "The payment failed. You can try again.");
    if (result === "ignored") throw new HttpError(409, "We could not confirm this payment. If money was deducted it will be reconciled automatically.");
    const fresh = await prisma.order.findUniqueOrThrow({ where: { id: order.id }, include });
    res.json({ order: fresh, status: result });
  }),
);

/** Webhook: mounted in app.ts with a RAW body parser (the signature covers the exact bytes). Always answers 200 for events it understood, so Razorpay does not retry them. */
export async function razorpayWebhook(req: Request, res: Response) {
  if (!env.RAZORPAY_WEBHOOK_SECRET) return void res.status(503).json({ error: "Webhook is not configured" });
  const raw = req.body;
  if (!Buffer.isBuffer(raw) || !verifyWebhookSignature(raw, req.header("x-razorpay-signature"))) return void res.status(400).json({ error: "Invalid signature" });
  let event: { event?: string; payload?: { payment?: { entity?: RazorpayPayment }; refund?: { entity?: { id: string; payment_id?: string; status: "pending" | "processed" | "failed" } } } };
  try {
    event = JSON.parse(raw.toString("utf8"));
  } catch {
    return void res.status(400).json({ error: "Invalid payload" });
  }
  // A retried delivery carries the same event id: acknowledge it without reprocessing. The id is stored only AFTER successful processing,
  // so a delivery that failed midway is retried by Razorpay and processed then. (State changes are also idempotent on their own.)
  const eventId = req.header("x-razorpay-event-id")?.slice(0, 100);
  if (eventId && (await prisma.webhookEvent.findUnique({ where: { id: eventId } }))) return void res.json({ ok: true, duplicate: true });
  const entity = event.payload?.payment?.entity;
  if (entity && (event.event === "payment.captured" || event.event === "order.paid" || event.event === "payment.failed")) {
    try {
      await settlePayment(entity);
    } catch (e) {
      console.error("[razorpay] webhook processing failed:", e instanceof Error ? e.message.split("\n")[0] : "unknown error");
      return void res.status(500).json({ error: "Processing failed" }); // Razorpay retries later
    }
  }
  const refund = event.payload?.refund?.entity;
  if (refund && (event.event === "refund.created" || event.event === "refund.processed" || event.event === "refund.failed")) {
    try {
      const row = await prisma.payment.findFirst({ where: { OR: [{ refundId: refund.id }, ...(refund.payment_id ? [{ providerPaymentId: refund.payment_id }] : [])] } });
      if (row) await applyRefund(row.id, refund); // the provider's word, recorded as is; repeated deliveries change nothing
    } catch (e) {
      console.error("[razorpay] refund webhook processing failed:", e instanceof Error ? e.message.split("\n")[0] : "unknown error");
      return void res.status(500).json({ error: "Processing failed" });
    }
  }
  if (eventId) await prisma.webhookEvent.create({ data: { id: eventId, event: String(event.event ?? "").slice(0, 60) } }).catch(() => undefined); // a concurrent duplicate already stored it
  res.json({ ok: true });
}
