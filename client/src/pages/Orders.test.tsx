import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import Orders, { canCancel, paymentLabel, refundInfo } from "./Orders";
import type { Order } from "../lib/types";

const get = vi.fn();
const post = vi.fn();
vi.mock("../lib/api", () => ({
  api: { get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a) },
  apiError: (e: { message?: string; response?: { status?: number } }) => ({ message: e.message ?? "error", status: e.response?.status, fields: {} }),
}));
const toast = { success: vi.fn(), error: vi.fn() };
vi.mock("../context/ToastContext", () => ({ useToast: () => toast }));
const cart = { addMany: vi.fn() };
vi.mock("../context/CartContext", () => ({ useCart: () => cart }));
vi.mock("../lib/payOnline", () => ({ payForOrder: vi.fn() }));

const base = (o: Partial<Order>): Order => ({
  id: "o1", number: 101, status: "PLACED", subtotalMinor: 12000, discountMinor: 0, deliveryMinor: 0, taxMinor: 2160, totalMinor: 14160, contactName: "Asha Rao", contactPhone: "9876543210",
  addrHouse: "12", addrLine1: "Test Street", addrLandmark: null, addrArea: "Sector 54", addrDistrict: "Gurgaon", addrCity: "Gurgaon", addrState: "Haryana", addrPincode: "122018", addrType: "HOME",
  addrLatitude: 28.43, addrLongitude: 77.1, addrConfirmedAt: null, instructions: null, estimatedDeliveryAt: null, createdAt: "2026-10-28T10:00:00Z", updatedAt: "2026-10-28T10:00:00Z",
  items: [{ id: "i1", productId: "p1", name: "Party Ice", unitMinor: 6000, quantity: 2, image: "/img/ice.jpg" }],
  payment: { method: "ONLINE", status: "PAID", amountMinor: 14160, paidAt: "2026-10-28T10:01:00Z", refundStatus: null },
  ...o,
});

const show = (orders: Order[]) => {
  get.mockResolvedValue({ data: { orders } });
  return render(<MemoryRouter><Orders /></MemoryRouter>);
};
beforeEach(() => { get.mockReset(); post.mockReset(); toast.success.mockClear(); toast.error.mockClear(); cart.addMany.mockClear(); });

describe("cancel eligibility (shown to the customer; the server enforces it too)", () => {
  it("offers Cancel order for Placed and Confirmed orders, including online-paid ones, and not once preparing or later", async () => {
    show([
      base({ id: "a", number: 1, status: "PLACED" }),
      base({ id: "b", number: 2, status: "CONFIRMED" }),
      base({ id: "c", number: 3, status: "PREPARING" }),
      base({ id: "d", number: 4, status: "OUT_FOR_DELIVERY" }),
      base({ id: "e", number: 5, status: "DELIVERED" }),
      base({ id: "f", number: 6, status: "CANCELLED" }),
    ]);
    await screen.findByTestId("order-1");
    for (const [n, expected] of [[1, true], [2, true], [3, false], [4, false], [5, false], [6, false]] as const) {
      expect(within(screen.getByTestId(`order-${n}`)).queryByTestId("cancel-order") !== null, `order ${n}`).toBe(expected);
    }
    expect(canCancel({ status: "PLACED" })).toBe(true);
    expect(canCancel({ status: "PREPARING" })).toBe(false);
    // Reorder is offered for finished orders only
    expect(within(screen.getByTestId("order-5")).getByRole("button", { name: /Reorder/ })).toBeInTheDocument();
    expect(within(screen.getByTestId("order-1")).queryByRole("button", { name: /Reorder/ })).toBeNull();
  });
});

describe("cancelling", () => {
  it("asks for confirmation, explains the refund for a paid online order, and updates only after the backend confirms", async () => {
    show([base({})]);
    post.mockResolvedValue({ data: { alreadyCancelled: false, order: base({ status: "CANCELLED", cancelledAt: "2026-10-28T12:00:00Z", cancelReason: "Changed my mind", cancelledBy: "CUSTOMER", payment: { method: "ONLINE", status: "PAID", amountMinor: 14160, refundStatus: "PROCESSING", refundId: "rfnd_1" } }) } });
    fireEvent.click(await screen.findByTestId("cancel-order"));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent(/Cancel this order/);
    expect(dialog).toHaveTextContent(/full refund/);
    expect(dialog).toHaveTextContent(/only complete once the payment provider confirms/);
    expect(post).not.toHaveBeenCalled(); // nothing happens before the customer confirms
    fireEvent.change(screen.getByLabelText(/Reason/), { target: { value: "Changed my mind" } });
    fireEvent.click(screen.getByRole("button", { name: "Yes, cancel order" }));
    await waitFor(() => expect(post).toHaveBeenCalledWith("/orders/o1/cancel", { reason: "Changed my mind" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByTestId("cancelled-note")).toHaveTextContent(/Order cancelled/);
    expect(screen.getByTestId("cancelled-note")).toHaveTextContent(/Changed my mind/);
    expect(screen.getByTestId("refund-info")).toHaveTextContent("Refund processing");
    expect(screen.getByTestId("refund-info")).not.toHaveTextContent("completed");
    expect(screen.queryByTestId("cancel-order")).toBeNull();
    expect(toast.success).toHaveBeenCalled();
  });

  it("does not send a second request when the confirm button is pressed again while the first is running", async () => {
    show([base({ payment: { method: "COD", status: "PENDING", amountMinor: 14160 } })]);
    let release: (v: unknown) => void = () => undefined;
    post.mockReturnValue(new Promise((r) => { release = r; }));
    fireEvent.click(await screen.findByTestId("cancel-order"));
    expect(screen.getByRole("dialog")).toHaveTextContent(/no payment has been taken/);
    const confirm = screen.getByRole("button", { name: "Yes, cancel order" });
    fireEvent.click(confirm);
    fireEvent.click(screen.getByRole("button", { name: /Cancelling/ }));
    expect(post).toHaveBeenCalledTimes(1);
    release({ data: { alreadyCancelled: false, order: base({ status: "CANCELLED", payment: { method: "COD", status: "PENDING", amountMinor: 14160 } }) } });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("keeps the dialog open with the server's message when cancellation is refused, and lets the customer retry after a network error", async () => {
    show([base({ payment: { method: "COD", status: "PENDING", amountMinor: 14160 } })]);
    post.mockRejectedValueOnce(Object.assign(new Error("This order is already being prepared, so it can no longer be cancelled."), { response: { status: 409 } }));
    fireEvent.click(await screen.findByTestId("cancel-order"));
    fireEvent.click(screen.getByRole("button", { name: "Yes, cancel order" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/already being prepared/);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    post.mockRejectedValueOnce(new Error("Network Error"));
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Network Error")).toBeInTheDocument();
    post.mockResolvedValueOnce({ data: { alreadyCancelled: false, order: base({ status: "CANCELLED", payment: { method: "COD", status: "PENDING", amountMinor: 14160 } }) } });
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByTestId("cancelled-note")).toBeInTheDocument();
  });

  it("closes without cancelling when the customer chooses to keep the order or presses Escape", async () => {
    show([base({})]);
    fireEvent.click(await screen.findByTestId("cancel-order"));
    fireEvent.click(screen.getByRole("button", { name: "Keep order" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByTestId("cancel-order"));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(post).not.toHaveBeenCalled();
  });
});

describe("refund states and payment labels (only what the backend reported)", () => {
  it("maps each provider-reported refund state to clear wording", () => {
    const p = (refundStatus: NonNullable<Order["payment"]>["refundStatus"]) => ({ method: "ONLINE" as const, status: "PAID", amountMinor: 1, refundStatus, refundedAt: "2026-10-30T09:00:00Z" });
    expect(refundInfo(p("REQUESTED"))?.title).toBe("Refund initiated");
    expect(refundInfo(p("PROCESSING"))?.title).toBe("Refund processing");
    expect(refundInfo(p("COMPLETED"))?.title).toBe("Refund completed");
    expect(refundInfo(p("FAILED"))?.title).toBe("Refund needs attention");
    expect(refundInfo(p(null))).toBeNull();
    expect(refundInfo(null)).toBeNull();
  });
  it("labels payments honestly", () => {
    expect(paymentLabel({ payment: { method: "ONLINE", status: "PAID", amountMinor: 1 } }).text).toBe("Paid online");
    expect(paymentLabel({ payment: { method: "ONLINE", status: "REFUNDED", amountMinor: 1 } }).text).toBe("Refunded");
    expect(paymentLabel({ payment: { method: "ONLINE", status: "PENDING", amountMinor: 1 } }).text).toBe("Payment pending");
    expect(paymentLabel({ payment: { method: "COD", status: "PENDING", amountMinor: 1 } }).text).toBe("Cash on delivery");
  });
  it("shows the refund box on the card and can check the provider's status", async () => {
    const cancelled = base({ status: "CANCELLED", payment: { method: "ONLINE", status: "PAID", amountMinor: 14160, refundStatus: "PROCESSING", refundId: "rfnd_1" } });
    show([cancelled]);
    expect(await screen.findByTestId("refund-info")).toHaveTextContent("Refund processing");
    post.mockResolvedValue({ data: { order: { ...cancelled, payment: { ...cancelled.payment!, status: "REFUNDED", refundStatus: "COMPLETED", refundedAt: "2026-10-30T09:00:00Z" } } } });
    fireEvent.click(screen.getByRole("button", { name: "Check refund status" }));
    await waitFor(() => expect(screen.getByTestId("refund-info")).toHaveTextContent("Refund completed"));
    expect(post).toHaveBeenCalledWith("/orders/o1/refund/refresh");
    expect(screen.getByTestId("payment-label")).toHaveTextContent("Refunded");
  });
});

describe("card content", () => {
  it("shows number, date, total, payment status, thumbnail, address with a map link, and expandable details", async () => {
    show([base({})]);
    const card = await screen.findByTestId("order-101");
    expect(card).toHaveTextContent("Your order");
    expect(within(card).getByTestId("payment-label")).toHaveTextContent("Paid online");
    expect(within(card).getByAltText("Party Ice")).toHaveAttribute("src", "/img/ice.jpg");
    expect(within(card).getByRole("link", { name: /Open map/ })).toHaveAttribute("href", expect.stringContaining("openstreetmap.org"));
    expect(within(card).getByRole("list", { name: "Order progress" }).querySelectorAll("li")).toHaveLength(5);
    expect(within(card).queryByTestId("order-details")).toBeNull();
    fireEvent.click(within(card).getByRole("button", { name: /View details/ }));
    expect(within(card).getByTestId("order-details")).toHaveTextContent(/Subtotal/);
  });
});
