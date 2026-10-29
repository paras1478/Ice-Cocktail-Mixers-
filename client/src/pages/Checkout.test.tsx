import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import Checkout from "./Checkout";
import type { Order, Quote } from "../lib/types";

// ---- API: routed by URL, recorded so the tests can assert exactly what the page sent ----
type Reply = unknown | ((body: unknown) => unknown);
const routes: { get: Record<string, Reply>; post: Record<string, Reply> } = { get: {}, post: {} };
const calls: { method: "get" | "post"; url: string; body?: unknown }[] = [];
const reply = async (method: "get" | "post", url: string, body?: unknown) => {
  calls.push({ method, url, body });
  const key = Object.keys(routes[method]).find((k) => url === k || (k.endsWith("*") && url.startsWith(k.slice(0, -1))));
  if (!key) throw Object.assign(new Error(`unexpected ${method} ${url}`), { response: { status: 404 } });
  const r = routes[method][key];
  const v = await (typeof r === "function" ? (r as (b: unknown) => unknown)(body) : r);
  if (v instanceof Error) throw v;
  return { data: v };
};
vi.mock("../lib/api", () => ({
  api: { get: (u: string) => reply("get", u), post: (u: string, b?: unknown) => reply("post", u, b) },
  apiError: (e: { message?: string; response?: { status?: number } }) => ({ message: e.message ?? "error", status: e.response?.status, fields: {} }),
}));
vi.mock("../components/LocationMap", () => ({ default: () => <div data-testid="location-map" /> }));

// ---- contexts ----
const quote: Quote = {
  lines: [{ productId: "p1", name: "Party Ice", packSize: "5 kg", unitMinor: 6000, quantity: 2, stock: 9 }],
  issues: [], totals: { subtotalMinor: 12000, discountMinor: 0, deliveryMinor: 0, taxMinor: 2160, totalMinor: 14160 }, discountCode: null, discountMessage: null,
};
const cart = { items: [{ productId: "p1", quantity: 2 }], quote, quoteError: null as string | null, code: "", applyCode: vi.fn(), clear: vi.fn(), refresh: vi.fn() };
vi.mock("../context/CartContext", () => ({ useCart: () => cart }));
vi.mock("../context/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1", name: "Asha Rao", email: "asha@example.com", phone: "9876543210", role: "CUSTOMER" } }) }));
vi.mock("../context/LocationContext", () => ({ useLocationCtx: () => ({ pincode: "122018", setPincode: async () => undefined }) }));

const savedAddress = { id: "a1", label: "Home", type: "HOME", recipientName: "Asha Rao", phone: "9876543210", house: "12", line1: "Test Street, Sector 54", landmark: null, area: "Sector 54", district: "Gurgaon", city: "Gurgaon", state: "Haryana", stateCode: "IN-HR", pincode: "122018", latitude: null, longitude: null, confirmedAt: null, isDefault: true };
const placedOrder = (method: "COD" | "ONLINE", payment: object = {}): Order => ({
  id: "o1", number: 101, status: "PLACED", subtotalMinor: 12000, discountMinor: 0, deliveryMinor: 0, taxMinor: 2160, totalMinor: 14160, contactName: "Asha Rao", contactPhone: "9876543210",
  addrHouse: "12", addrLine1: "Test Street, Sector 54", addrLandmark: null, addrArea: "Sector 54", addrDistrict: "Gurgaon", addrCity: "Gurgaon", addrState: "Haryana", addrPincode: "122018", addrType: "HOME",
  addrLatitude: null, addrLongitude: null, addrConfirmedAt: null, instructions: null, estimatedDeliveryAt: null, createdAt: "2026-10-30T10:00:00Z", updatedAt: "2026-10-30T10:00:00Z",
  items: [{ id: "i1", productId: "p1", name: "Party Ice", unitMinor: 6000, quantity: 2 }],
  payment: { method, status: "PENDING", amountMinor: 14160, ...payment },
});
const gatewayOrder = { keyId: "rzp_test_public", razorpayOrderId: "order_ABC", amountMinor: 14160, currency: "INR", orderId: "o1", orderNumber: 101, prefill: { name: "Asha Rao", email: "asha@example.com", contact: "9876543210" } };

// ---- a stand-in for Razorpay Checkout ----
type RzOptions = { key: string; amount: number; currency: string; order_id: string; prefill: { method?: string }; handler: (r: object) => void; modal: { ondismiss: () => void } };
let opened: RzOptions[] = [];
let failedHandlers: ((r: { error?: { description?: string } }) => void)[] = [];
beforeEach(() => {
  opened = []; failedHandlers = []; calls.length = 0;
  window.Razorpay = class {
    private o: RzOptions;
    constructor(o: RzOptions) { this.o = o; }
    on(_e: string, cb: (r: { error?: { description?: string } }) => void) { failedHandlers.push(cb); }
    open() { opened.push(this.o); }
  } as never;
  routes.get = { "/config": { currency: "INR", payments: { cod: true, card: false, online: true } }, "/addresses": { addresses: [savedAddress] }, "/pincode/*": { pincode: "122018", postal: { status: "not_found" }, delivery: { serviceable: true, pincode: "122018", areaName: "Sector 54", city: "Gurgaon", state: "Haryana", etaMinutes: 14, isSample: false } } };
  routes.post = { "/addresses/validate": { serviceable: true, pincode: "122018", areaName: "Sector 54", city: "Gurgaon", state: "Haryana", etaMinutes: 14, isSample: false } };
  cart.quote = quote; cart.quoteError = null; cart.clear.mockClear();
});

const posts = (url: string) => calls.filter((c) => c.method === "post" && c.url === url);

/** Walks Contact -> Address -> Review & pay like a customer. */
async function toReview() {
  render(<MemoryRouter><Checkout /></MemoryRouter>);
  fireEvent.click(await screen.findByRole("button", { name: "Continue" }));
  await screen.findByRole("heading", { name: "Delivery address" });
  await waitFor(() => expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  await screen.findByRole("heading", { name: /Review/ });
  await waitFor(() => expect(screen.getByTestId("pay-UPI")).toBeEnabled());
}
const confirmAddress = () => fireEvent.click(screen.getByTestId("confirm-address"));
const payButton = () => screen.getByRole("button", { name: /Pay securely|Place order/ });

describe("checkout: the pay button never fails silently", () => {
  it("says what is missing, focuses it, and sends nothing when the address is not confirmed", async () => {
    await toReview();
    fireEvent.click(screen.getByTestId("pay-UPI"));
    fireEvent.click(payButton());
    expect(await screen.findByTestId("checkout-error")).toHaveTextContent(/tick .*confirm this delivery address/);
    expect(document.activeElement).toBe(screen.getByTestId("confirm-address"));
    expect(posts("/orders")).toHaveLength(0);
    confirmAddress();
    expect(screen.queryByTestId("checkout-error")).toBeNull();
  });
});

describe("checkout: online payment (UPI / card / net banking)", () => {
  it.each([["UPI", "upi"], ["CARD", "card"], ["NETBANKING", "netbanking"]])("%s: saves the order, opens Razorpay with the server's order id, amount and public key, and confirms only after the server verifies", async (choice, method) => {
    routes.post["/orders"] = { order: placedOrder("ONLINE") };
    routes.post["/payments/razorpay/order"] = gatewayOrder;
    routes.post["/payments/razorpay/verify"] = { order: placedOrder("ONLINE", { status: "PAID", paidAt: "2026-10-30T10:01:00Z" }), status: "paid" };
    await toReview();
    fireEvent.click(screen.getByTestId(`pay-${choice}`));
    confirmAddress();
    fireEvent.click(payButton());
    await waitFor(() => expect(opened).toHaveLength(1));
    expect(posts("/orders")[0].body).toMatchObject({ paymentMethod: "ONLINE", expectedTotalMinor: 14160, addressConfirmed: true });
    expect(posts("/payments/razorpay/order")[0].body).toEqual({ orderId: "o1" }); // no amount from the browser
    expect(opened[0]).toMatchObject({ key: "rzp_test_public", amount: 14160, currency: "INR", order_id: "order_ABC", prefill: { method } });
    expect(JSON.stringify(opened[0])).not.toMatch(/secret/i);
    expect(screen.getByText(/Processing your payment|Complete your payment/)).toBeInTheDocument(); // not "paid" yet
    expect(cart.clear).not.toHaveBeenCalled();
    // Razorpay reports success: the browser sends it to the server, which answers with the paid order
    opened[0].handler({ razorpay_order_id: "order_ABC", razorpay_payment_id: "pay_XYZ", razorpay_signature: "sig" });
    expect(await screen.findByRole("heading", { name: "Payment successful" })).toBeInTheDocument();
    expect(posts("/payments/razorpay/verify")[0].body).toEqual({ orderId: "o1", razorpay_order_id: "order_ABC", razorpay_payment_id: "pay_XYZ", razorpay_signature: "sig" });
    expect(screen.getByTestId("order-number")).toHaveTextContent("#101");
    expect(cart.clear).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("link", { name: "Continue shopping" })).toBeInTheDocument();
  });

  it("a cancelled payment keeps the cart and the saved order, and Retry reopens Razorpay for the same order (no second order)", async () => {
    routes.post["/orders"] = { order: placedOrder("ONLINE") };
    routes.post["/payments/razorpay/order"] = gatewayOrder;
    await toReview();
    confirmAddress();
    fireEvent.click(screen.getByTestId("pay-CARD"));
    fireEvent.click(payButton());
    await waitFor(() => expect(opened).toHaveLength(1));
    opened[0].modal.ondismiss();
    expect(await screen.findByRole("heading", { name: "Payment cancelled" })).toBeInTheDocument();
    expect(cart.clear).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Retry payment" }));
    await waitFor(() => expect(opened).toHaveLength(2));
    expect(posts("/orders")).toHaveLength(1);
  });

  it("a failed payment says so and offers Retry", async () => {
    routes.post["/orders"] = { order: placedOrder("ONLINE") };
    routes.post["/payments/razorpay/order"] = gatewayOrder;
    await toReview();
    confirmAddress();
    fireEvent.click(screen.getByTestId("pay-UPI"));
    fireEvent.click(payButton());
    await waitFor(() => expect(failedHandlers).toHaveLength(1));
    failedHandlers[0]({ error: { description: "Payment declined by bank" } });
    expect(await screen.findByRole("heading", { name: "Payment failed" })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Payment declined by bank");
    expect(screen.getByRole("button", { name: "Retry payment" })).toBeEnabled();
  });

  it("shows a clear error (not silence) when the backend cannot start the payment, and keeps the order for later", async () => {
    routes.post["/orders"] = { order: placedOrder("ONLINE") };
    routes.post["/payments/razorpay/order"] = Object.assign(new Error("Online payments are not available right now."), { response: { status: 503 } });
    await toReview();
    confirmAddress();
    fireEvent.click(screen.getByTestId("pay-UPI"));
    fireEvent.click(payButton());
    expect(await screen.findByRole("heading", { name: "We could not start the payment" })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Online payments are not available right now.");
    expect(screen.getByRole("button", { name: "Retry payment" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Pay later from My orders/ })).toBeInTheDocument();
    expect(opened).toHaveLength(0);
  });

  it("shows a clear error when the Razorpay window itself cannot load", async () => {
    delete window.Razorpay;
    const real = document.head.appendChild.bind(document.head);
    vi.spyOn(document.head, "appendChild").mockImplementation(((el: Node) => { setTimeout(() => (el as HTMLScriptElement).onerror?.(new Event("error")), 0); return real(document.createComment("blocked")); }) as never);
    routes.post["/orders"] = { order: placedOrder("ONLINE") };
    routes.post["/payments/razorpay/order"] = gatewayOrder;
    await toReview();
    confirmAddress();
    fireEvent.click(screen.getByTestId("pay-UPI"));
    fireEvent.click(payButton());
    expect(await screen.findByRole("alert")).toHaveTextContent(/payment window could not be loaded/);
    vi.restoreAllMocks();
  });

  it("does not send a second order when the pay button is pressed twice quickly", async () => {
    let release: (v: unknown) => void = () => undefined;
    routes.post["/orders"] = () => new Promise((r) => { release = r; }) as never;
    routes.post["/payments/razorpay/order"] = gatewayOrder;
    await toReview();
    confirmAddress();
    fireEvent.click(screen.getByTestId("pay-UPI"));
    const button = payButton();
    fireEvent.click(button);
    fireEvent.click(button); // a second click while the first request runs
    expect(button).toBeDisabled();
    expect(button).toHaveTextContent(/Preparing payment/);
    expect(posts("/orders")).toHaveLength(1);
    release({ order: placedOrder("ONLINE") });
    await waitFor(() => expect(opened).toHaveLength(1));
  });
});

describe("checkout: cash on delivery and missing configuration", () => {
  it("COD uses the existing order workflow and never opens Razorpay", async () => {
    routes.post["/orders"] = { order: placedOrder("COD") };
    await toReview();
    fireEvent.click(screen.getByTestId("pay-COD"));
    confirmAddress();
    fireEvent.click(screen.getByRole("button", { name: /Place order/ }));
    expect(await screen.findByRole("heading", { name: "Order placed" })).toBeInTheDocument();
    expect(posts("/orders")[0].body).toMatchObject({ paymentMethod: "COD" });
    expect(posts("/payments/razorpay/order")).toHaveLength(0);
    expect(opened).toHaveLength(0);
    expect(cart.clear).toHaveBeenCalledTimes(1);
  });

  it("when online payment is not configured the online methods stay visible with the reason, and COD still works", async () => {
    routes.get["/config"] = { currency: "INR", payments: { cod: true, card: false, online: false } };
    routes.post["/orders"] = { order: placedOrder("COD") };
    render(<MemoryRouter><Checkout /></MemoryRouter>);
    fireEvent.click(await screen.findByRole("button", { name: "Continue" }));
    await screen.findByRole("heading", { name: "Delivery address" });
    await waitFor(() => expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await screen.findByRole("heading", { name: /Review/ });
    await waitFor(() => expect(screen.getByTestId("pay-COD")).toHaveAttribute("aria-checked", "true"));
    for (const id of ["UPI", "CARD", "NETBANKING"]) expect(screen.getByTestId(`pay-${id}`)).toBeDisabled();
    expect(screen.getAllByText(/isn't set up for this store yet/).length).toBe(3);
    confirmAddress();
    fireEvent.click(screen.getByRole("button", { name: /Place order/ }));
    expect(await screen.findByRole("heading", { name: "Order placed" })).toBeInTheDocument();
  });
});
