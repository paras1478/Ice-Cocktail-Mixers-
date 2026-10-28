import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import { createApp } from "../src/app.js";
import { prisma } from "../src/lib/db.js";
import { clearPostalCache } from "../src/lib/geo.js";
import { STATE_COUNT, stateCodeFor } from "../src/lib/states.js";

const app = createApp();

// Realistic India Post answers for PINs in many different states / union territories (the provider is mocked; the live API is covered by a manual run).
const OFFICES: Record<string, { state: string; district: string; offices: string[] }> = {
  "400001": { state: "Maharashtra", district: "Mumbai", offices: ["Mumbai GPO", "Fort", "Horniman Circle"] },
  "600001": { state: "Tamil Nadu", district: "Chennai", offices: ["Chennai G.P.O.", "Parrys"] },
  "682001": { state: "Kerala", district: "Ernakulam", offices: ["Ernakulam H.O."] },
  "700001": { state: "West Bengal", district: "Kolkata", offices: ["Kolkata G.P.O.", "Dalhousie Square"] },
  "560001": { state: "Karnataka", district: "Bangalore", offices: ["Bangalore G.P.O.", "Cubbon Park"] },
  "190001": { state: "Jammu & Kashmir", district: "Srinagar", offices: ["Srinagar G.P.O."] },
  "744101": { state: "Andaman & Nicobar", district: "South Andaman", offices: ["Port Blair"] },
  "605001": { state: "Pondicherry", district: "Puducherry", offices: ["Puducherry H.O."] },
  "781001": { state: "Assam", district: "Kamrup Metropolitan", offices: ["Guwahati H.O."] },
  "737101": { state: "Sikkim", district: "East Sikkim", offices: ["Gangtok H.O."] },
  "825313": { state: "Jharkhand", district: "Hazaribag", offices: ["Banahappa", "Bedam", "Daroo"] },
  "110001": { state: "Delhi", district: "Central Delhi", offices: ["Connaught Place", "Baroda House"] },
};

const upstream = (pin: string) => {
  const o = OFFICES[pin];
  if (!o) return { ok: true, json: async () => [{ Message: "No records found", Status: "Error", PostOffice: null }] };
  return { ok: true, json: async () => [{ Status: "Success", PostOffice: o.offices.map((Name) => ({ Name, District: o.district, State: o.state, Block: "NA" })) }] };
};
const mockUpstream = () => vi.fn((url: string) => Promise.resolve(upstream(url.split("/").pop()!)));

let admin: ReturnType<typeof request.agent>;
let user: ReturnType<typeof request.agent>;

beforeAll(async () => {
  await prisma.serviceArea.deleteMany({ where: { pincode: { notIn: ["110001", "600001"] } } }); // coverage data left by other test files
  await prisma.serviceArea.upsert({ where: { pincode: "110001" }, update: { isActive: true }, create: { pincode: "110001", areaName: "Connaught Place", city: "Delhi", state: "Delhi", etaMinutes: 35 } });
  await prisma.serviceArea.upsert({ where: { pincode: "600001" }, update: { isActive: false }, create: { pincode: "600001", areaName: "Chennai", state: "Tamil Nadu", etaMinutes: 40, isActive: false } });
  await prisma.user.upsert({ where: { email: "pin-admin@test.dev" }, update: {}, create: { email: "pin-admin@test.dev", name: "Pin Admin", role: "ADMIN", passwordHash: await bcrypt.hash("AdminPass123", 4) } });
  await prisma.user.upsert({ where: { email: "pin-user@test.dev" }, update: {}, create: { email: "pin-user@test.dev", name: "Pin User", passwordHash: await bcrypt.hash("password123", 4) } });
  admin = request.agent(app);
  await admin.post("/api/auth/login").send({ email: "pin-admin@test.dev", password: "AdminPass123" }).expect(200);
  user = request.agent(app);
  await user.post("/api/auth/login").send({ email: "pin-user@test.dev", password: "password123" }).expect(200);
});
afterAll(() => prisma.$disconnect());
afterEach(() => { vi.unstubAllGlobals(); clearPostalCache(); });

describe("state codes", () => {
  it("maps every state and union territory, including the names India Post uses", () => {
    expect(STATE_COUNT).toBe(36);
    const cases: [string, string][] = [
      ["Maharashtra", "MH"], ["Tamil Nadu", "TN"], ["Kerala", "KL"], ["West Bengal", "WB"], ["Karnataka", "KA"], ["Jharkhand", "JH"], ["Delhi", "DL"], ["NCT of Delhi", "DL"],
      ["Jammu & Kashmir", "JK"], ["Jammu and Kashmir", "JK"], ["Andaman & Nicobar", "AN"], ["Andaman and Nicobar Islands", "AN"], ["Pondicherry", "PY"], ["Puducherry", "PY"],
      ["Odisha", "OD"], ["Orissa", "OD"], ["Telangana", "TS"], ["Uttarakhand", "UK"], ["Dadra & Nagar Haveli", "DH"], ["Daman & Diu", "DH"], ["Ladakh", "LA"], ["Lakshadweep", "LD"], ["Chandigarh", "CH"], ["  tamil   nadu ", "TN"],
    ];
    for (const [name, code] of cases) expect(stateCodeFor(name), name).toBe(code);
    expect(stateCodeFor("Atlantis")).toBeNull();
    expect(stateCodeFor("")).toBeNull();
    expect(stateCodeFor(null)).toBeNull();
  });
});

describe("nationwide postal lookup (not limited to any state or city)", () => {
  it.each(Object.keys(OFFICES))("resolves %s from the provider data without a hardcoded list", async (pin) => {
    vi.stubGlobal("fetch", mockUpstream());
    const o = OFFICES[pin];
    const r = (await request(app).get(`/api/pincode/${pin}`).expect(200)).body;
    expect(r.pincode).toBe(pin);
    expect(typeof r.pincode).toBe("string");
    expect(r.postal).toMatchObject({ status: "found", state: o.state, district: o.district });
    expect(r.postal.stateCode).toBe(stateCodeFor(o.state));
    expect(r.postal.stateCode).toMatch(/^[A-Z]{2}$/);
    expect(r.postal.offices.map((x: { name: string }) => x.name)).toEqual(o.offices);
  });

  it("returns every post office when a PIN has several, so the customer can choose", async () => {
    vi.stubGlobal("fetch", mockUpstream());
    const r = (await request(app).get("/api/pincode/825313").expect(200)).body;
    expect(r.postal.offices).toHaveLength(3);
    expect(r.postal.offices.every((o: { stateCode: string }) => o.stateCode === "JH")).toBe(true);
  });

  it("reports a well-formed PIN the provider does not know as not_found (a valid-looking number is not assumed real)", async () => {
    vi.stubGlobal("fetch", mockUpstream());
    const r = (await request(app).get("/api/pincode/999999").expect(200)).body;
    expect(r.postal).toEqual({ status: "not_found" });
    expect(r.delivery.serviceable).toBe(false);
  });

  it("rejects malformed PINs before calling the provider", async () => {
    const f = mockUpstream();
    vi.stubGlobal("fetch", f);
    for (const bad of ["12345", "1234567", "012345", "abcdef", "12 345"]) await request(app).get(`/api/pincode/${encodeURIComponent(bad)}`).expect(400);
    expect(f).not.toHaveBeenCalled();
  });
});

describe("serviceability is separate from the postal result", () => {
  it("never marks a valid PIN serviceable just because it exists", async () => {
    vi.stubGlobal("fetch", mockUpstream());
    const pins = Object.keys(OFFICES);
    const results = await Promise.all(pins.map(async (p) => [p, (await request(app).get(`/api/pincode/${p}`).expect(200)).body] as const));
    for (const [p, r] of results) {
      expect(r.postal.status).toBe("found");
      if (p === "110001") expect(r.delivery).toMatchObject({ serviceable: true, etaMinutes: 35, areaName: "Connaught Place" });
      else if (p === "600001") expect(r.delivery).toEqual({ serviceable: false, pincode: p, reason: "paused" });
      else expect(r.delivery).toEqual({ serviceable: false, pincode: p, reason: "not_covered" });
    }
    expect(results.filter(([, r]) => r.delivery.serviceable)).toHaveLength(1);
  });
});

describe("caching", () => {
  it("serves repeat lookups from cache (no second upstream call) while still checking delivery live", async () => {
    const f = mockUpstream();
    vi.stubGlobal("fetch", f);
    await request(app).get("/api/pincode/110001").expect(200);
    await request(app).get("/api/pincode/110001").expect(200);
    expect(f).toHaveBeenCalledTimes(1);
    await prisma.serviceArea.update({ where: { pincode: "110001" }, data: { isActive: false } });
    expect((await request(app).get("/api/pincode/110001")).body.delivery.reason).toBe("paused"); // coverage change visible immediately
    await prisma.serviceArea.update({ where: { pincode: "110001" }, data: { isActive: true } });
    expect(f).toHaveBeenCalledTimes(1);
  });
  it("shares one upstream request between identical concurrent lookups", async () => {
    const f = mockUpstream();
    vi.stubGlobal("fetch", f);
    await Promise.all(Array.from({ length: 8 }, () => request(app).get("/api/pincode/700001").expect(200)));
    expect(f).toHaveBeenCalledTimes(1);
  });
  it("caches not-found answers too, but never caches failures", async () => {
    const f = vi.fn().mockRejectedValueOnce(new Error("network down")).mockImplementation((url: string) => Promise.resolve(upstream(url.split("/").pop()!)));
    vi.stubGlobal("fetch", f);
    expect((await request(app).get("/api/pincode/560001")).body.postal.status).toBe("unavailable"); // failure
    expect((await request(app).get("/api/pincode/560001")).body.postal.status).toBe("found"); // retried, not cached
    await request(app).get("/api/pincode/560001");
    expect(f).toHaveBeenCalledTimes(2);
    await request(app).get("/api/pincode/888888");
    await request(app).get("/api/pincode/888888");
    expect(f).toHaveBeenCalledTimes(3); // the not-found answer was cached
  });
});

describe("failures are reported honestly", () => {
  const status = async (pin: string) => (await request(app).get(`/api/pincode/${pin}`).expect(200)).body;
  it("network error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("getaddrinfo ENOTFOUND")));
    const r = await status("400001");
    expect(r.postal.status).toBe("unavailable");
    expect(r.postal.message).toMatch(/unavailable.*enter the area, district and state manually/i);
    expect(r.delivery.serviceable).toBe(false);
  });
  it("timeout", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(Object.assign(new Error("aborted"), { name: "TimeoutError" })));
    expect((await status("400001")).postal.message).toMatch(/timed out/);
  });
  it("HTTP error from the provider", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 503 }));
    expect((await status("400001")).postal.message).toMatch(/HTTP 503/);
  });
  it("garbage response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ not: "an array" }) }));
    expect((await status("400001")).postal.message).toMatch(/unexpected response/);
  });
  it("still answers delivery for a PIN we cover when the postal service is down", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("down")));
    const r = await status("110001");
    expect(r.postal.status).toBe("unavailable");
    expect(r.delivery.serviceable).toBe(true);
  });
});

describe("checkout stores the confirmed address, with the state code, for any state", () => {
  it("snapshots the address and does not change it when the saved address is edited", async () => {
    const ice = await prisma.category.upsert({ where: { slug: "ice-bags" }, update: {}, create: { slug: "ice-bags", name: "Ice Bags" } });
    const p = await prisma.product.upsert({ where: { slug: "pin-test-ice" }, update: { stock: 50 }, create: { slug: "pin-test-ice", name: "PIN Test Ice", packSize: "1 kg", priceMinor: 6000, stock: 50, categoryId: ice.id } });
    const address = { house: "7", line1: "Connaught Place", area: "Baroda House", district: "Central Delhi", state: "Delhi", pincode: "110001", landmark: "Near Hanuman Mandir", latitude: 28.63, longitude: 77.22 };
    const body = { items: [{ productId: p.id, quantity: 1 }], contactName: "Pin User", contactPhone: "9876543210", address, addressConfirmed: true, paymentMethod: "COD", saveAddress: true };
    const o = (await user.post("/api/orders").send(body).expect(201)).body.order;
    expect(o).toMatchObject({ addrStateCode: "DL", addrState: "Delhi", addrDistrict: "Central Delhi", addrArea: "Baroda House", addrPincode: "110001", addrLatitude: 28.63, addrLongitude: 77.22, contactPhone: "9876543210" });
    const saved = (await user.get("/api/addresses").expect(200)).body.addresses.find((a: { id: string }) => a.id === o.addressId);
    expect(saved.stateCode).toBe("DL");
    await user.put(`/api/addresses/${saved.id}`).send({ ...address, house: "EDITED", state: "Haryana", pincode: "122018", label: "Home" }).expect(200);
    const again = (await user.get(`/api/orders/${o.id}`).expect(200)).body.order;
    expect(again).toMatchObject({ addrHouse: "7", addrState: "Delhi", addrStateCode: "DL", addrPincode: "110001" });
    const seen = (await admin.get(`/api/orders/${o.id}`).expect(200)).body.order;
    expect(seen).toMatchObject({ addrHouse: "7", addrArea: "Baroda House", addrPincode: "110001" });
  });
  it("refuses to order to a PIN we do not deliver to, whatever state it is in", async () => {
    const p = await prisma.product.findUniqueOrThrow({ where: { slug: "pin-test-ice" } });
    for (const pincode of ["400001", "600001", "682001"])
      await user.post("/api/orders").send({ items: [{ productId: p.id, quantity: 1 }], contactName: "Pin User", contactPhone: "9876543210", address: { house: "1", line1: "Some road", district: "Xx", state: "Yy", pincode }, addressConfirmed: true, paymentMethod: "COD" }).expect(422);
  });
});
