import { afterAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/lib/db.js";

// Google itself is not called in tests: the verifier is replaced, the account logic and the route are real.
vi.mock("../src/lib/google.js", () => ({
  googleClientIds: () => ["web-client"],
  verifyGoogleAccessToken: async (t: string) => ({ email: "Google.User@Test.dev", name: "Gina Google" }),
  verifyGoogleIdToken: async (t: string) => {
    if (t.startsWith("bad")) { const { HttpError } = await import("../src/lib/errors.js"); throw new HttpError(401, "Google sign-in failed. Please try again."); }
    return { email: "Google.User@Test.dev", name: "Gina Google" };
  },
}));

const app = createApp();
const EMAIL = "google.user@test.dev";
afterAll(async () => { await prisma.user.deleteMany({ where: { email: EMAIL } }); await prisma.$disconnect(); });

describe("POST /api/auth/google", () => {
  it("creates a customer on first sign-in, reuses it afterwards, and returns a session", async () => {
    const a = request.agent(app);
    const first = await a.post("/api/auth/google").send({ idToken: "good-token-0000000000000" }).expect(200);
    expect(first.body.user).toMatchObject({ email: EMAIL, name: "Gina Google", role: "CUSTOMER" });
    expect(first.body.token).toBeTruthy();
    expect((await a.get("/api/auth/me").expect(200)).body.user.email).toBe(EMAIL);
    const second = await request(app).post("/api/auth/google").send({ idToken: "good-token-0000000000000" }).expect(200);
    expect(second.body.user.id).toBe(first.body.user.id);
    expect(await prisma.user.count({ where: { email: EMAIL } })).toBe(1);
  });
  it("rejects a token Google does not accept, and a missing token", async () => {
    await request(app).post("/api/auth/google").send({ idToken: "bad-token-00000000000000" }).expect(401);
    await request(app).post("/api/auth/google").send({}).expect(400);
  });
  it("a disabled account cannot sign in with Google", async () => {
    await prisma.user.update({ where: { email: EMAIL }, data: { isActive: false } });
    await request(app).post("/api/auth/google").send({ idToken: "good-token-0000000000000" }).expect(403);
  });
});
