import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import { createApp } from "../src/app.js";
import { prisma } from "../src/lib/db.js";
import { AccountStoreUnavailable, DuplicateAccountError, NO_LOCAL_PASSWORD, setCredentialStore, type Account, type CredentialStore } from "../src/services/accounts.js";
import { sanitize } from "../src/lib/mongo.js";

/** In-memory stand-in for the MongoDB store: same contract, incl. a unique email index. (The real store is exercised against Atlas separately.) */
class FakeStore implements CredentialStore {
  readonly kind = "fake";
  docs = new Map<string, Account>();
  down = false;
  failInsert = false;
  private check() {
    if (this.down) throw new AccountStoreUnavailable();
  }
  async findByEmail(email: string) { this.check(); return [...this.docs.values()].find((d) => d.email === email.toLowerCase()) ?? null; }
  async findById(id: string) { this.check(); return this.docs.get(id) ?? null; }
  async insert(a: Account) {
    this.check();
    if (this.failInsert) throw new AccountStoreUnavailable();
    if (this.docs.has(a.id) || [...this.docs.values()].some((d) => d.email === a.email.toLowerCase())) throw new DuplicateAccountError();
    this.docs.set(a.id, { ...a, email: a.email.toLowerCase() });
  }
  async update(id: string, patch: Partial<Account>) { this.check(); const d = this.docs.get(id); if (d) this.docs.set(id, { ...d, ...patch }); }
  async remove(id: string) { this.docs.delete(id); }
}

const app = createApp();
const store = new FakeStore();
const PW = "S3cret-pass!";
let n = 0;
const email = () => `acct${Date.now()}${++n}@gmail.test`;

beforeAll(() => setCredentialStore(store));
afterAll(async () => { setCredentialStore(null); await prisma.$disconnect(); });
afterEach(() => { store.down = false; store.failInsert = false; });

describe("accounts stored in MongoDB (credential store)", () => {
  it("registers: credentials go to the store, a password-less profile with the same id goes to PostgreSQL", async () => {
    const e = email();
    const res = await request(app).post("/api/auth/register").send({ name: "Mongo User", email: e.toUpperCase(), password: PW }).expect(201);
    expect(res.body.user).toEqual({ id: expect.any(String), email: e, name: "Mongo User", phone: null, role: "CUSTOMER" }); // only the fields the frontend needs
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|\$2[aby]\$/);
    const doc = [...store.docs.values()].find((d) => d.email === e)!;
    expect(doc.id).toBe(res.body.user.id);
    expect(doc.passwordHash).toMatch(/^\$2[aby]\$12\$/); // bcrypt, cost 12
    expect(await bcrypt.compare(PW, doc.passwordHash)).toBe(true);
    const pg = await prisma.user.findUniqueOrThrow({ where: { email: e } });
    expect(pg.id).toBe(doc.id);
    expect(pg.passwordHash).toBe(NO_LOCAL_PASSWORD); // no password, hashed or not, in PostgreSQL
    expect(JSON.stringify([...store.docs.values()]) + JSON.stringify(pg)).not.toContain(PW); // never plaintext anywhere
  });

  it("prevents duplicate accounts (case-insensitive) in both stores", async () => {
    const e = email();
    await request(app).post("/api/auth/register").send({ name: "First User", email: e, password: PW }).expect(201);
    const again = await request(app).post("/api/auth/register").send({ name: "Second User", email: e.toUpperCase(), password: PW }).expect(409);
    expect(again.body.error).toMatch(/already exists/);
    expect([...store.docs.values()].filter((d) => d.email === e)).toHaveLength(1);
    expect(await prisma.user.count({ where: { email: e } })).toBe(1);
    // concurrent sign-ups for one new address: exactly one wins
    const e2 = email();
    const results = await Promise.all(Array.from({ length: 4 }, () => request(app).post("/api/auth/register").send({ name: "Racer", email: e2, password: PW })));
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(3);
    expect(await prisma.user.count({ where: { email: e2 } })).toBe(1);
  });

  it("validates input on the backend before touching either store", async () => {
    const before = store.docs.size;
    for (const body of [{ name: "A", email: "x@y.test", password: PW }, { name: "Okay Name", email: "not-an-email", password: PW }, { name: "Okay Name", email: email(), password: "short" }, { name: "Okay Name", email: email(), password: PW, phone: "12345" }])
      await request(app).post("/api/auth/register").send(body).expect(400);
    expect(store.docs.size).toBe(before);
  });

  it("logs in from the store; wrong password and unknown email give the same generic error", async () => {
    const e = email();
    await request(app).post("/api/auth/register").send({ name: "Login User", email: e, password: PW }).expect(201);
    const ok = await request(app).post("/api/auth/login").send({ email: e, password: PW }).expect(200);
    expect(String(ok.headers["set-cookie"])).toMatch(/token=.*HttpOnly/);
    const wrong = await request(app).post("/api/auth/login").send({ email: e, password: "nope-nope" }).expect(401);
    const unknown = await request(app).post("/api/auth/login").send({ email: email(), password: PW }).expect(401);
    expect(wrong.body.error).toBe(unknown.body.error);
  });

  it("migrates an existing PostgreSQL-only account on first sign-in, keeping its id and not deleting anything", async () => {
    const e = email();
    const legacy = await prisma.user.create({ data: { email: e, name: "Legacy User", phone: "9876543210", passwordHash: await bcrypt.hash(PW, 4) } });
    expect(store.docs.has(legacy.id)).toBe(false);
    await request(app).post("/api/auth/login").send({ email: e, password: "wrong-pass-1" }).expect(401);
    expect(store.docs.has(legacy.id)).toBe(false); // a failed attempt migrates nothing
    const res = await request(app).post("/api/auth/login").send({ email: e, password: PW }).expect(200);
    expect(res.body.user.id).toBe(legacy.id);
    const doc = store.docs.get(legacy.id)!;
    expect(doc).toMatchObject({ email: e, name: "Legacy User", phone: "9876543210" });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: legacy.id } })).name).toBe("Legacy User"); // PostgreSQL row untouched
    await request(app).post("/api/auth/login").send({ email: e, password: PW }).expect(200); // second sign-in uses the store
  });

  it("keeps data across 'restarts': a fresh app instance still signs the user in (data lives in the stores, not in memory)", async () => {
    const e = email();
    await request(app).post("/api/auth/register").send({ name: "Persist User", email: e, password: PW }).expect(201);
    const second = createApp();
    await request(second).post("/api/auth/login").send({ email: e, password: PW }).expect(200);
  });

  it("changes profile and password in the store; the old password stops working and PostgreSQL holds none", async () => {
    const e = email();
    const agent = request.agent(app);
    const reg = await agent.post("/api/auth/register").send({ name: "Edit User", email: e, password: PW }).expect(201);
    const upd = await agent.patch("/api/auth/me").send({ name: "Edited Name", phone: "9123456780" }).expect(200);
    expect(upd.body.user).toMatchObject({ name: "Edited Name", phone: "9123456780" });
    expect(store.docs.get(reg.body.user.id)).toMatchObject({ name: "Edited Name", phone: "9123456780" });
    await agent.patch("/api/auth/me").send({ currentPassword: "wrong-current", newPassword: "Brand-new-pass1" }).expect(400);
    await agent.patch("/api/auth/me").send({ currentPassword: PW, newPassword: "Brand-new-pass1" }).expect(200);
    await request(app).post("/api/auth/login").send({ email: e, password: PW }).expect(401);
    await request(app).post("/api/auth/login").send({ email: e, password: "Brand-new-pass1" }).expect(200);
    expect((await prisma.user.findUniqueOrThrow({ where: { email: e } })).passwordHash).toBe(NO_LOCAL_PASSWORD);
  });

  it("a legacy account that changes its password is migrated with the new hash and its old PostgreSQL hash is neutralised", async () => {
    const e = email();
    const legacy = await prisma.user.create({ data: { email: e, name: "Legacy Pw", passwordHash: await bcrypt.hash(PW, 4) } });
    const agent = request.agent(app);
    await agent.post("/api/auth/login").send({ email: e, password: PW }).expect(200);
    store.docs.delete(legacy.id); // simulate "not migrated yet"
    await agent.patch("/api/auth/me").send({ currentPassword: PW, newPassword: "Another-pass-9" }).expect(200);
    expect(await bcrypt.compare("Another-pass-9", store.docs.get(legacy.id)!.passwordHash)).toBe(true);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: legacy.id } })).passwordHash).toBe(NO_LOCAL_PASSWORD);
    await request(app).post("/api/auth/login").send({ email: e, password: PW }).expect(401);
  });

  it("when MongoDB is down: a safe 503 with no leaked details, and no half-created account", async () => {
    store.down = true;
    const e = email();
    const reg = await request(app).post("/api/auth/register").send({ name: "Outage User", email: e, password: PW }).expect(503);
    expect(reg.body.error).toMatch(/temporarily unavailable/);
    expect(JSON.stringify(reg.body)).not.toMatch(/mongo|stack|atlas|credential/i);
    expect(await prisma.user.count({ where: { email: e } })).toBe(0);
    await request(app).post("/api/auth/login").send({ email: e, password: PW }).expect(503);
    store.down = false;
    store.failInsert = true;
    await request(app).post("/api/auth/register").send({ name: "Outage User", email: e, password: PW }).expect(503);
    expect(await prisma.user.count({ where: { email: e } })).toBe(0);
  });

  it("an interrupted sign-up (credentials stored, profile missing) is completed at the next login", async () => {
    const e = email();
    const id = randomBytes(12).toString("hex"); // unique per run: a fixed id would collide with a row left by an earlier run
    await store.insert({ id, email: e, name: "Half Made", phone: null, passwordHash: await bcrypt.hash(PW, 4) });
    const res = await request(app).post("/api/auth/login").send({ email: e, password: PW }).expect(200);
    expect(res.body.user.id).toBe(id);
    expect(await prisma.user.count({ where: { id } })).toBe(1);
  });
});

describe("connection string safety", () => {
  it("never lets credentials reach logs", () => {
    const s = sanitize(new Error("bad auth for mongodb+srv://someUser:somePass@cluster0.example.mongodb.net/db failed"));
    expect(s).not.toMatch(/someUser|somePass/);
    expect(s).toContain("mongodb+srv://<credentials>@cluster0.example.mongodb.net");
    expect(sanitize("mongodb://u:p@host:27017/")).toBe("mongodb://<credentials>@host:27017/");
  });
  it("MONGODB_URI is read only from the backend environment, never from VITE_ files or source", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const root = path.resolve(__dirname, "../..");
    for (const f of ["client/.env", "client/.env.example", "client/.env.production", "server/.env.example"]) {
      const text = fs.existsSync(path.join(root, f)) ? fs.readFileSync(path.join(root, f), "utf8") : "";
      expect(text, f).not.toMatch(/mongodb(\+srv)?:\/\/[^<\s"']+:[^<\s"']+@/); // no URI with real-looking credentials
    }
    const clientSrc = fs.readdirSync(path.join(root, "client/src/lib")).map((f) => fs.readFileSync(path.join(root, "client/src/lib", f), "utf8")).join("\n");
    expect(clientSrc).not.toMatch(/MONGODB_URI/);
  });
});
