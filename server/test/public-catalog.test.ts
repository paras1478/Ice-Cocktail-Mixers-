import { afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/lib/db.js";

const app = createApp();
afterAll(() => prisma.$disconnect());

describe("public catalogue vs protected routes (no cookie, i.e. a logged-out visitor)", () => {
  it("serves categories, products and bundles without logging in", async () => {
    const cats = await request(app).get("/api/categories").expect(200);
    expect(Array.isArray(cats.body.categories)).toBe(true);
    const prods = await request(app).get("/api/products?sort=popular&pageSize=8").expect(200);
    expect(Array.isArray(prods.body.products)).toBe(true);
    expect(prods.body).toMatchObject({ page: 1, pageSize: 8 });
    const bundles = await request(app).get("/api/bundles").expect(200);
    expect(Array.isArray(bundles.body.bundles)).toBe(true);
  });
  it("still protects the account and cart endpoints with a clean 401", async () => {
    await request(app).get("/api/auth/me").expect(401);
    await request(app).get("/api/cart").expect(401);
    await request(app).get("/api/orders").expect(401);
  });
});
