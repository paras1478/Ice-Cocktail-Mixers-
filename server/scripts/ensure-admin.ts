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
  "needs-password": "[admin] no account exists for SEED_ADMIN_EMAIL yet. Sign up with that email on the site (it is promoted at the next start), or set SEED_ADMIN_PASSWORD (8+ characters, not the default) to create it.",
} as const;

const prisma = new PrismaClient();
ensureAdmin(prisma, process.env.SEED_ADMIN_EMAIL, process.env.SEED_ADMIN_PASSWORD, process.env.SEED_ADMIN_RESET === "true")
  .then((r) => messages[r] && console.log(messages[r]))
  .catch((e) => console.error("[admin] could not check the admin account (the server will still start):", e instanceof Error ? e.message.split("\n")[0] : "unknown error"))
  .finally(() => prisma.$disconnect());
