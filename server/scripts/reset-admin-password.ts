/**
 * One-off, run by the owner: sets the password (and ADMIN role) of the account for SEED_ADMIN_EMAIL, or creates it if it does not exist.
 * Nothing else is touched: orders, addresses and other users are kept. The password is never printed.
 *
 *   DATABASE_URL=<Render external URL ?sslmode=require> SEED_ADMIN_EMAIL=you@example.com SEED_ADMIN_PASSWORD='a strong password' npx tsx scripts/reset-admin-password.ts --yes
 */
import "dotenv/config";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

const email = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase();
const password = process.env.SEED_ADMIN_PASSWORD;
const url = process.env.DATABASE_URL ?? "";
const host = (() => { try { return new URL(url).host; } catch { return "(invalid DATABASE_URL)"; } })();

if (!email || !password) throw new Error("Set SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD.");
if (password.length < 8 || password === "ChangeMe123!") throw new Error("Choose a password of at least 8 characters that is not the default.");
console.log(`Database host: ${host}\nAdmin email:   ${email}`);
if (!process.argv.includes("--yes")) {
  console.log("Check the host above is the database you mean, then run again with --yes.");
  process.exit(0);
}

const prisma = new PrismaClient();
try {
  const passwordHash = await bcrypt.hash(password, 12);
  const user = await prisma.user.upsert({
    where: { email },
    update: { passwordHash, role: "ADMIN" },
    create: { email, name: "Store Admin", role: "ADMIN", passwordHash },
  });
  console.log(`Done: ${user.email} can now log in as admin with the password you set.`);
} finally {
  await prisma.$disconnect();
}
