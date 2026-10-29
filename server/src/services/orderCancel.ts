import { prisma } from "../lib/db.js";
import { HttpError } from "../lib/errors.js";
import { startRefund } from "./refunds.js";

/** Customers can cancel until the shop starts preparing the order. Admins can cancel until it is delivered. */
const CUSTOMER_CAN_CANCEL = ["PLACED", "CONFIRMED"];
const ADMIN_CAN_CANCEL = ["PLACED", "CONFIRMED", "PREPARING", "OUT_FOR_DELIVERY"];

const WHY: Record<string, string> = {
  PREPARING: "This order is already being prepared, so it can no longer be cancelled.",
  OUT_FOR_DELIVERY: "This order is already out for delivery, so it can no longer be cancelled.",
  DELIVERED: "This order has already been delivered, so it can no longer be cancelled.",
};

export interface CancelResult {
  /** false when the order was already cancelled (a repeated request): nothing changed a second time. */
  changed: boolean;
}

/**
 * Cancels an order. The status is checked on the server inside a transaction and changed with a conditional update, so two
 * simultaneous requests cannot both succeed or restock twice. A paid online order then gets its refund requested from Razorpay;
 * the cancellation itself never fails because of the refund, and repeating the request retries a refund that was not accepted yet.
 * Payment and order records are kept (nothing is deleted).
 */
export async function cancelOrder(orderId: string, actor: { id: string; role: "CUSTOMER" | "ADMIN" }, reason?: string): Promise<CancelResult> {
  const isAdmin = actor.role === "ADMIN";
  const result = await prisma.$transaction(async (tx) => {
    const o = await tx.order.findUnique({ where: { id: orderId }, include: { items: true } });
    if (!o || (!isAdmin && o.userId !== actor.id)) throw new HttpError(404, "Order not found"); // 404 for other people's orders
    if (o.status === "CANCELLED") return { changed: false };
    const allowed = isAdmin ? ADMIN_CAN_CANCEL : CUSTOMER_CAN_CANCEL;
    if (!allowed.includes(o.status)) throw new HttpError(409, WHY[o.status] ?? "This order can no longer be cancelled.");
    const r = await tx.order.updateMany({
      where: { id: o.id, status: o.status }, // fails if the status changed since it was read
      data: { status: "CANCELLED", cancelledAt: new Date(), cancelledBy: isAdmin ? "ADMIN" : "CUSTOMER", cancelReason: reason?.trim().slice(0, 200) || null },
    });
    if (r.count !== 1) {
      const now = await tx.order.findUniqueOrThrow({ where: { id: o.id }, select: { status: true } });
      if (now.status === "CANCELLED") return { changed: false };
      throw new HttpError(409, WHY[now.status] ?? "This order changed just now. Please refresh and try again.");
    }
    for (const i of o.items) await tx.product.update({ where: { id: i.productId }, data: { stock: { increment: i.quantity } } });
    return { changed: true };
  });
  // Outside the transaction (it calls the payment provider). Also runs on a repeated request so a refund that was not accepted is retried.
  await startRefund(orderId);
  return result;
}
