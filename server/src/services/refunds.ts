import { prisma } from "../lib/db.js";
import { createRefund, fetchRefund, type RazorpayRefund } from "../lib/razorpay.js";

/**
 * Refunds of cancelled, paid online orders. Every state shown to the customer mirrors what Razorpay reported:
 * REQUESTED  = we are asking Razorpay for the refund (not accepted yet, e.g. a temporary network problem, safe to retry)
 * PROCESSING = Razorpay accepted it and reports it as pending
 * COMPLETED  = Razorpay reports it as processed (only then does the payment become REFUNDED)
 * FAILED     = Razorpay reports it as failed (needs our team)
 */
const STATUS = { pending: "PROCESSING", processed: "COMPLETED", failed: "FAILED" } as const;

/** Records what the provider says about a refund. Idempotent, and never moves a completed refund backwards. */
export async function applyRefund(paymentRowId: string, refund: Pick<RazorpayRefund, "id" | "status">): Promise<void> {
  const refundStatus = STATUS[refund.status];
  if (!refundStatus) return;
  const done = refundStatus === "COMPLETED";
  try {
    await prisma.payment.updateMany({
      where: { id: paymentRowId, OR: [{ refundStatus: null }, { refundStatus: { not: "COMPLETED" } }] },
      data: {
        refundId: refund.id,
        refundStatus,
        refundFailureReason: refundStatus === "FAILED" ? "The payment provider could not complete this refund." : null,
        ...(done ? { status: "REFUNDED", refundedAt: new Date() } : {}),
      },
    });
  } catch (e) {
    if ((e as { code?: string }).code !== "P2002") throw e; // this refund id is already recorded on another row
  }
}

/**
 * Asks Razorpay to refund a cancelled order's captured payment in full. Safe to call repeatedly: the claim below and Razorpay's
 * idempotency key guarantee at most one refund. Never throws: a failed attempt leaves REQUESTED so it can be retried.
 * `retryFailed` (admin only) lets a provider-failed refund be requested again.
 */
export async function startRefund(orderId: string, retryFailed = false): Promise<void> {
  try {
    const p = await prisma.payment.findUnique({ where: { orderId } });
    if (!p || p.method !== "ONLINE" || !p.providerPaymentId) return;
    if (p.status !== "PAID" && !(retryFailed && p.refundStatus === "FAILED")) return; // only a captured payment is refunded
    if (p.refundStatus === "COMPLETED" || p.refundStatus === "PROCESSING") return;
    if (p.refundStatus === "FAILED" && !retryFailed) return;
    // Claim it: two simultaneous requests cannot both proceed.
    if (p.refundStatus === null || p.refundStatus === "FAILED") {
      const claim = await prisma.payment.updateMany({ where: { id: p.id, refundStatus: p.refundStatus }, data: { refundStatus: "REQUESTED", refundFailureReason: null } });
      if (claim.count !== 1) return;
    }
    try {
      const key = p.refundStatus === "FAILED" ? `refund_${p.id}_retry_${Date.now()}` : `refund_${p.id}`;
      await applyRefund(p.id, await createRefund(p.providerPaymentId, p.amountMinor, key, { orderId }));
    } catch (e) {
      await prisma.payment.updateMany({ where: { id: p.id, refundStatus: "REQUESTED" }, data: { refundFailureReason: "We could not reach the payment provider yet. The refund request will be retried." } });
      console.error(`[refund] request for order ${orderId} not accepted:`, e instanceof Error ? e.message : "unknown error");
    }
  } catch (e) {
    console.error(`[refund] could not start for order ${orderId}:`, e instanceof Error ? e.message.split("\n")[0] : "unknown error");
  }
}

/** Pulls the refund's real status from Razorpay (for a customer or admin pressing "Check status"). */
export async function refreshRefund(orderId: string): Promise<void> {
  const p = await prisma.payment.findUnique({ where: { orderId } });
  if (!p || (p.refundStatus !== "PROCESSING" && p.refundStatus !== "REQUESTED")) return;
  if (!p.refundId) return void (await startRefund(orderId));
  try {
    await applyRefund(p.id, await fetchRefund(p.refundId));
  } catch (e) {
    console.error(`[refund] status check for order ${orderId} failed:`, e instanceof Error ? e.message : "unknown error");
  }
}
