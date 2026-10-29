import { afterEach, describe, expect, it, vi } from "vitest";
import { payForOrder, PaymentNotCompleted } from "./payOnline";

const post = vi.fn();
vi.mock("./api", () => ({ api: { post: (...a: unknown[]) => post(...a) } }));

const gatewayOrder = { keyId: "rzp_test_public", razorpayOrderId: "order_X", amountMinor: 12345, currency: "INR", orderId: "o1", orderNumber: 7, prefill: { name: "A", email: "a@b.c", contact: "9876543210" } };
type Opts = { key: string; amount: number; order_id: string; handler: (r: object) => void; modal: { ondismiss: () => void } };
let captured: Opts | null = null;
function fakeRazorpay(behaviour: (o: Opts) => void) {
  window.Razorpay = class { constructor(o: Opts) { captured = o; } on() {} open() { behaviour(captured!); } } as never;
}
afterEach(() => { delete window.Razorpay; captured = null; post.mockReset(); });

describe("payForOrder", () => {
  it("opens checkout with the server's amount and public key, then has the server verify the result", async () => {
    post.mockResolvedValueOnce({ data: gatewayOrder }).mockResolvedValueOnce({ data: { order: { id: "o1", payment: { status: "PAID" } } } });
    fakeRazorpay((o) => o.handler({ razorpay_order_id: "order_X", razorpay_payment_id: "pay_Y", razorpay_signature: "sig" }));
    const order = await payForOrder("o1");
    expect(captured).toMatchObject({ key: "rzp_test_public", amount: 12345, order_id: "order_X" });
    expect(post).toHaveBeenNthCalledWith(1, "/payments/razorpay/order", { orderId: "o1" }); // no amount is sent from the browser
    expect(post).toHaveBeenNthCalledWith(2, "/payments/razorpay/verify", { orderId: "o1", razorpay_order_id: "order_X", razorpay_payment_id: "pay_Y", razorpay_signature: "sig" });
    expect(order.payment?.status).toBe("PAID");
  });

  it("reports a closed payment window as 'not completed' without calling verify", async () => {
    post.mockResolvedValueOnce({ data: gatewayOrder });
    fakeRazorpay((o) => o.modal.ondismiss());
    await expect(payForOrder("o1")).rejects.toBeInstanceOf(PaymentNotCompleted);
    expect(post).toHaveBeenCalledTimes(1);
  });
});
