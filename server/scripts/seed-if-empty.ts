// First-deploy helper (Render's free plan has no Shell). Runs before the server starts. On by default; set AUTO_SEED_IF_EMPTY=false to disable.
// It seeds ONLY when there are no products, categories or bundles at all, so a database holding real shop data is never touched.
// Once any catalogue data exists it does nothing, so it is safe on every start.
import "dotenv/config";
import { PrismaClient } from "@prisma/client";

async function main() {
  if (process.env.AUTO_SEED_IF_EMPTY === "false") return;
  const prisma = new PrismaClient();
  try {
    const [products, categories, bundles] = await Promise.all([prisma.product.count(), prisma.category.count(), prisma.bundle.count()]);
    if (products + categories + bundles > 0) return console.log("[seed] catalogue already has data: nothing to do.");
    console.log("[seed] catalogue is empty: seeding categories, products, bundles and delivery areas from prisma/catalog.ts");
    await prisma.$disconnect();
    await import("../prisma/seed.js"); // the existing seed: upserts only, never touches orders or customers
  } finally {
    await prisma.$disconnect().catch(() => undefined);
  }
}

main().catch((e) => console.error("[seed] failed (the server will still start):", e instanceof Error ? e.message.split("\n")[0] : "unknown error"));
