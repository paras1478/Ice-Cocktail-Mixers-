import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "./env.js";
import { HttpError } from "./errors.js";

/**
 * Razorpay Standard Checkout, server side. Uses the official REST API (https://api.razorpay.com/v1) with HTTP Basic auth,
 * so no extra dependency is needed. The key secret and webhook secret are read from the backend environment only and are never logged.
 */
const API = "https://api.razorpay.com/v1";

export interface RazorpayConfig {
  keyId: string;
  keySecret: string;
  live: boolean;
}

/** null when online payments are not configured (or a live key was supplied without RAZORPAY_ALLOW_LIVE=true). */
export function razorpayConfig(): RazorpayConfig | null {
  const keyId = env.RAZORPAY_KEY_ID;
  const keySecret = env.RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret) return null;
  const live = keyId.startsWith("rzp_live_");
  if (live && env.RAZORPAY_ALLOW_LIVE !== "true") return null; // test mode must be verified before live payments are switched on
  return { keyId, keySecret, live };
}

export const onlinePaymentsEnabled = () => razorpayConfig() !== null;

const safeEqual = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};
const hmac = (secret: string, data: string | Buffer) => createHmac("sha256", secret).update(data).digest("hex");

/** Checkout callback signature: HMAC-SHA256(secret, "<razorpay_order_id>|<razorpay_payment_id>"), hex. */
export function verifyPaymentSignature(orderId: string, paymentId: string, signature: string, secret = razorpayConfig()?.keySecret): boolean {
  if (!secret || !orderId || !paymentId || !signature) return false;
  return safeEqual(hmac(secret, `${orderId}|${paymentId}`), signature);
}

/** Webhook signature: HMAC-SHA256(webhook secret, EXACT raw request body), hex, in the X-Razorpay-Signature header. */
export function verifyWebhookSignature(rawBody: Buffer, signature: string | undefined, secret = env.RAZORPAY_WEBHOOK_SECRET): boolean {
  if (!secret || !signature) return false;
  return safeEqual(hmac(secret, rawBody), signature);
}

export interface RazorpayPayment {
  id: string;
  order_id: string | null;
  status: "created" | "authorized" | "captured" | "refunded" | "failed";
  amount: number;
  currency: string;
  error_description?: string | null;
}

async function call<T>(path: string, init?: { method: "POST"; body: object; headers?: Record<string, string> }): Promise<T> {
  const cfg = razorpayConfig();
  if (!cfg) throw new HttpError(503, "Online payments are not available right now.");
  let res: Response;
  try {
    res = await fetch(API + path, {
      method: init?.method ?? "GET",
      headers: { authorization: "Basic " + Buffer.from(`${cfg.keyId}:${cfg.keySecret}`).toString("base64"), "content-type": "application/json", ...init?.headers },
      body: init ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new HttpError(502, "The payment provider could not be reached. Please try again.");
  }
  if (!res.ok) {
    // Never echo the provider's body or our credentials; log only the status and Razorpay's error code.
    const detail = (await res.json().catch(() => null)) as { error?: { code?: string } } | null;
    console.error(`[razorpay] ${init?.method ?? "GET"} ${path.replace(/pay_[A-Za-z0-9]+/, "pay_…")} -> ${res.status} ${detail?.error?.code ?? ""}`);
    throw new HttpError(502, "The payment provider rejected the request. Please try again.");
  }
  return (await res.json()) as T;
}

export const createGatewayOrder = (amountMinor: number, receipt: string, notes: Record<string, string>) =>
  call<{ id: string; amount: number; currency: string; status: string }>("/orders", { method: "POST", body: { amount: amountMinor, currency: "INR", receipt, notes } });

export const fetchPayment = (paymentId: string) => call<RazorpayPayment>(`/payments/${encodeURIComponent(paymentId)}`);

export const capturePayment = (paymentId: string, amountMinor: number) =>
  call<RazorpayPayment>(`/payments/${encodeURIComponent(paymentId)}/capture`, { method: "POST", body: { amount: amountMinor, currency: "INR" } });

export interface RazorpayRefund {
  id: string;
  payment_id: string;
  amount: number;
  status: "pending" | "processed" | "failed";
}

/** Full refund of a captured payment. The idempotency key makes a repeated request return the same refund instead of refunding twice. */
export const createRefund = (paymentId: string, amountMinor: number, idempotencyKey: string, notes: Record<string, string>) =>
  call<RazorpayRefund>(`/payments/${encodeURIComponent(paymentId)}/refund`, { method: "POST", body: { amount: amountMinor, speed: "normal", notes }, headers: { "X-Refund-Idempotency": idempotencyKey } });

export const fetchRefund = (refundId: string) => call<RazorpayRefund>(`/refunds/${encodeURIComponent(refundId)}`);
