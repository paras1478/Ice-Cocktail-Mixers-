-- Order cancellation details and refund tracking. Additive only: no existing data is changed or removed.
CREATE TYPE "RefundStatus" AS ENUM ('REQUESTED', 'PROCESSING', 'COMPLETED', 'FAILED');

ALTER TABLE "Order" ADD COLUMN "cancelledAt" TIMESTAMP(3);
ALTER TABLE "Order" ADD COLUMN "cancelReason" TEXT;
ALTER TABLE "Order" ADD COLUMN "cancelledBy" TEXT;

ALTER TABLE "Payment" ADD COLUMN "refundId" TEXT;
ALTER TABLE "Payment" ADD COLUMN "refundStatus" "RefundStatus";
ALTER TABLE "Payment" ADD COLUMN "refundedAt" TIMESTAMP(3);
ALTER TABLE "Payment" ADD COLUMN "refundFailureReason" TEXT;

CREATE UNIQUE INDEX "Payment_refundId_key" ON "Payment"("refundId");
