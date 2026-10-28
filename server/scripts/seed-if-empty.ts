// Optional first-deploy helper (Render's free plan has no Shell). Runs before the server starts and only acts when AUTO_SEED_IF_EMPTY=true.
// It seeds ONLY when there are no products, categories or bundles at all, so a database holding real shop data is never touched.
// After the first successful run, remove AUTO_SEED_IF_EMPTY (or leave it: it does nothing once data exists).
import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const DEFAULT_ADMIN_PASSWORD = "ChangeMe123!";

async function main() {
  if (process.env.AUTO_SEED_IF_EMPTY !== "true") return;
  const prisma = new PrismaClient();
  try {
    const [products, categories, bundles] = await Promise.all([prisma.product.count(), prisma.category.count(), prisma.bundle.count()]);
    if (products + categories + bundles > 0) return console.log("[seed] catalogue already has data: nothing to do.");
    const pw = process.env.SEED_ADMIN_PASSWORD;
    if (process.env.NODE_ENV === "production" && (!pw || pw === DEFAULT_ADMIN_PASSWORD || pw.length < 8)) {
      return console.error("[seed] skipped: set SEED_ADMIN_PASSWORD (8+ characters, not the default) in the environment before seeding in production.");
    }
    console.log("[seed] catalogue is empty: seeding categories, products, bundles and delivery areas from prisma/catalog.ts");
    await prisma.$disconnect();
    await import("../prisma/seed.js"); // the existing seed: upserts only, never touches orders or customers
  } finally {
    await prisma.$disconnect().catch(() => undefined);
  }
}

main().catch((e) => console.error("[seed] failed (the server will still start):", e instanceof Error ? e.message.split("\n")[0] : "unknown error"));
