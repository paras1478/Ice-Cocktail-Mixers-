-- Additive: customer account status and last-login tracking on the existing "User" table.
ALTER TABLE "User" ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "User" ADD COLUMN "lastLoginAt" TIMESTAMP(3);
CREATE INDEX "User_role_createdAt_idx" ON "User"("role", "createdAt");
