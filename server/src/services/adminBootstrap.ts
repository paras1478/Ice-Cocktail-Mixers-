import bcrypt from "bcryptjs";
import type { PrismaClient } from "@prisma/client";

const DEFAULT_ADMIN_PASSWORD = "ChangeMe123!";

export type AdminBootstrapResult = "skipped" | "already-admin" | "promoted" | "created" | "needs-password" | "reset";

/**
 * Makes sure the owner's admin account exists, using SEED_ADMIN_EMAIL (and SEED_ADMIN_PASSWORD for a brand-new account).
 * - existing customer account with that email: role becomes ADMIN, nothing else changes (password, orders and addresses are kept)
 * - no account yet: created only when a strong, non-default password is provided
 * - reset = true (SEED_ADMIN_RESET=true) is the recovery switch for a forgotten admin password: it also sets the password of an existing account
 *   from SEED_ADMIN_PASSWORD (strong, non-default) and makes it ADMIN. Remove the variable afterwards so the password is not reset on every start.
 * Never deletes anything, and never prints credentials. Only someone who can set the backend environment can trigger it.
 */
export async function ensureAdmin(prisma: PrismaClient, email: string | undefined, password: string | undefined, reset = false): Promise<AdminBootstrapResult> {
  const e = email?.trim().toLowerCase();
  if (!e) return "skipped";
  const existing = await prisma.user.findUnique({ where: { email: e } });
  const strong = !!password && password.length >= 8 && password !== DEFAULT_ADMIN_PASSWORD;
  if (existing && reset) {
    if (!strong) return "needs-password";
    await prisma.user.update({ where: { id: existing.id }, data: { role: "ADMIN", passwordHash: await bcrypt.hash(password!, 12) } });
    return "reset";
  }
  if (existing) {
    if (existing.role === "ADMIN") return "already-admin";
    await prisma.user.update({ where: { id: existing.id }, data: { role: "ADMIN" } });
    return "promoted";
  }
  if (!strong) return "needs-password";
  await prisma.user.create({ data: { email: e, name: "Store Admin", role: "ADMIN", passwordHash: await bcrypt.hash(password!, 12) } });
  return "created";
}
