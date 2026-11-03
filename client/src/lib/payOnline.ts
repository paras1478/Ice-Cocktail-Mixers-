import { api } from "./api";
import type { Order } from "./types";

/** Razorpay Standard Checkout (UPI and cards). Only the PUBLIC key id is ever used in the browser; the secret stays on the server. */
interface CheckoutSuccess { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string }
interface CheckoutOptions {
  key: string; amount: number; currency: string; order_id: string; name: string; description: string;
  /** `method` opens the window on that tab (UPI / card / net banking); the customer can still switch. */
  prefill: { name: string; email: string; contact: string; method?: "upi" | "card" | "netbanking" };
  theme: { color: string };
  handler: (r: CheckoutSuccess) => void;
  modal: { ondismiss: () => void; confirm_close: boolean };
}
interface RazorpayInstance { open: () => void; on: (event: "payment.failed", cb: (r: { error?: { description?: string } }) => void) => void }
declare global { interface Window { Razorpay?: new (o: CheckoutOptions) => RazorpayInstance } }

const SCRIPT = "https://checkout.razorpay.com/v1/checkout.js";

/** The customer closed the payment window, or the payment failed: the order is kept so they can pay again. */
export class PaymentNotCompleted extends Error {
  constructor(message: string, public kind: "cancelled" | "failed") { super(message); }
}

export type OnlineMethod = "UPI" | "CARD" | "NETBANKING";
const tab = (m: OnlineMethod) => m.toLowerCase() as "upi" | "card" | "netbanking";

export function loadCheckout(): Promise<void> {
  if (window.Razorpay) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = SCRIPT;
    s.async = true;
    s.onload = () => (window.Razorpay ? resolve() : reject(new Error("The payment window could not be loaded.")));
    s.onerror = () => reject(new Error("The payment window could not be loaded. Check your connection and try again."));
    document.head.appendChild(s);
  });
}

interface GatewayOrder { keyId: string; razorpayOrderId: string; amountMinor: number; currency: string; orderId: string; orderNumber: number; prefill: { name: string; email: string; contact: string } }

/**
 * Pays an already-placed online order: asks the server for the gateway order (amount decided server-side), opens Razorpay,
 * then sends the result to the server, which verifies the signature and the real payment status before marking the order paid.
 * Resolves with the paid order. Rejects with PaymentNotCompleted (window closed / payment failed) or the API error.
 */
export async function payForOrder(orderId: string, choice?: OnlineMethod): Promise<Order> {
  const { data: g } = await api.post<GatewayOrder>("/payments/razorpay/order", { orderId });
  await loadCheckout();
  const result = await new Promise<CheckoutSuccess>((resolve, reject) => {
    const rz = new window.Razorpay!({
      key: g.keyId, amount: g.amountMinor, currency: g.currency, order_id: g.razorpayOrderId,
      name: "Ice & Mixers Express", description: "Your order", prefill: { ...g.prefill, ...(choice ? { method: tab(choice) } : {}) }, theme: { color: "#d97706" },
      handler: resolve,
      modal: { ondismiss: () => reject(new PaymentNotCompleted("Payment was cancelled. Your order is saved and nothing was charged: you can pay again.", "cancelled")), confirm_close: true },
    });
    rz.on("payment.failed", (r) => reject(new PaymentNotCompleted(r.error?.description ? `Payment failed: ${r.error.description}` : "Payment failed. You can try again.", "failed")));
    rz.open();
  });
  const { data } = await api.post<{ order: Order }>("/payments/razorpay/verify", { orderId, ...result });
  return data.order;
}
