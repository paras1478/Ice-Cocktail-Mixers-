// Runs before the server starts. Does nothing unless SEED_ADMIN_EMAIL is set. See src/services/adminBootstrap.ts.
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { ensureAdmin } from "../src/services/adminBootstrap.js";

const messages = {
  skipped: "",
  "already-admin": "[admin] admin account is in place.",
  promoted: "[admin] the existing account for SEED_ADMIN_EMAIL is now an admin (log out and back in).",
  created: "[admin] admin account created for SEED_ADMIN_EMAIL.",
  reset: "[admin] the password of the SEED_ADMIN_EMAIL account was reset from SEED_ADMIN_PASSWORD. Remove SEED_ADMIN_RESET now, or it is reset again on every start.",
  "needs-password": "[admin] no account exists for SEED_ADMIN_EMAIL yet, and SEED_ADMIN_PASSWORD is missing, shorter than 8 characters or the default (ChangeMe123!), so none was created. Set a strong SEED_ADMIN_PASSWORD in the environment and redeploy, or sign up with that email on the site (it is promoted to admin at the next start).",
} as const;

// What the environment looks like, so a failed admin setup can be diagnosed from the Render logs. Never prints the password (only whether it is acceptable).
const mask = (e?: string) => (e?.trim() ? e.trim().replace(/^(.{2}).*(@.*)$/, "$1***$2") : "(not set)");
const pw = process.env.SEED_ADMIN_PASSWORD;
const pwState = !pw ? "not set" : pw === "ChangeMe123!" ? "REJECTED (it is the public default)" : pw.length < 8 ? `REJECTED (only ${pw.length} characters, need 8+)` : `ok (${pw.length} characters)`;
console.log(`[admin] SEED_ADMIN_EMAIL=${mask(process.env.SEED_ADMIN_EMAIL)} | SEED_ADMIN_PASSWORD ${pwState} | SEED_ADMIN_RESET=${process.env.SEED_ADMIN_RESET === "true"}`);

const prisma = new PrismaClient();
ensureAdmin(prisma, process.env.SEED_ADMIN_EMAIL, process.env.SEED_ADMIN_PASSWORD, process.env.SEED_ADMIN_RESET === "true")
  .then((r) => messages[r] && console.log(messages[r]))
  .catch((e) => console.error("[admin] could not check the admin account (the server will still start):", e instanceof Error ? e.message.split("\n")[0] : "unknown error"))
  .finally(() => prisma.$disconnect());
