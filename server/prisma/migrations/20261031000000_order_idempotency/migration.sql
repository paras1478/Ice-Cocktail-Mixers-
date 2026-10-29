-- Idempotency key for order creation (prevents duplicate orders from double submits and retried requests). Additive only.
ALTER TABLE "Order" ADD COLUMN "clientRequestId" TEXT;
CREATE UNIQUE INDEX "Order_userId_clientRequestId_key" ON "Order"("userId", "clientRequestId");
