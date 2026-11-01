/**
 * One-off: copies customer accounts (email, name, phone, bcrypt hash) from the old MongoDB "users" collection into PostgreSQL, so they can
 * sign in without MongoDB. Only adds missing rows and fills in placeholder passwords; it never deletes anything, in either database.
 * Needs MONGODB_URI (and optionally MONGODB_DB) in the environment, plus DATABASE_URL:  npx tsx scripts/migrate-mongo-users.ts
 */
import "dotenv/config";
import mongoose from "mongoose";
import { PrismaClient } from "@prisma/client";

const uri = process.env.MONGODB_URI;
if (!uri) {
  console.log("MONGODB_URI is not set: nothing to migrate.");
  process.exit(0);
}

const prisma = new PrismaClient();
const conn = mongoose.createConnection(uri, { dbName: process.env.MONGODB_DB || "icemixers", serverSelectionTimeoutMS: 8000 });
try {
  await conn.asPromise();
  const docs = await conn.db!.collection("users").find({}).toArray();
  let created = 0, updated = 0, skipped = 0;
  for (const d of docs) {
    const email = String(d.email).trim().toLowerCase();
    const passwordHash = String(d.passwordHash ?? "");
    if (!/^\$2[aby]\$\d{2}\$/.test(passwordHash)) { skipped++; continue; }
    const existing = await prisma.user.findUnique({ where: { email } });
    if (!existing) {
      await prisma.user.create({ data: { id: String(d._id), email, name: String(d.name), phone: d.phone ?? null, passwordHash } });
      created++;
    } else if (!/^\$2[aby]\$\d{2}\$/.test(existing.passwordHash)) {
      await prisma.user.update({ where: { id: existing.id }, data: { passwordHash } });
      updated++;
    } else skipped++;
  }
  console.log(`Mongo users: ${docs.length} | created in PostgreSQL: ${created} | passwords restored: ${updated} | left as is: ${skipped}`);
} finally {
  await conn.close();
  await prisma.$disconnect();
}
