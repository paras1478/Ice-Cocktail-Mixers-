import { afterAll, describe, expect, it } from "vitest";
import bcrypt from "bcryptjs";
import { prisma } from "../src/lib/db.js";
import { ensureAdmin } from "../src/services/adminBootstrap.js";

afterAll(() => prisma.$disconnect());
const mail = () => `boot${Date.now()}${Math.floor(Math.random() * 1e6)}@owner.test`;

describe("ensureAdmin (production admin bootstrap)", () => {
  it("does nothing without an email", async () => {
    expect(await ensureAdmin(prisma, undefined, "Strong-Pass-1")).toBe("skipped");
  });
  it("promotes an existing customer without touching their password or data", async () => {
    const email = mail();
    const hash = await bcrypt.hash("Customer-Pass-1", 4);
    const u = await prisma.user.create({ data: { email, name: "Owner", passwordHash: hash } });
    expect(await ensureAdmin(prisma, email.toUpperCase(), undefined)).toBe("promoted");
    expect(await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).toMatchObject({ role: "ADMIN", passwordHash: hash, name: "Owner" });
    expect(await ensureAdmin(prisma, email, undefined)).toBe("already-admin");
  });
  it("creates a new admin only with a strong, non-default password", async () => {
    const email = mail();
    expect(await ensureAdmin(prisma, email, undefined)).toBe("needs-password");
    expect(await ensureAdmin(prisma, email, "ChangeMe123!")).toBe("needs-password");
    expect(await ensureAdmin(prisma, email, "short")).toBe("needs-password");
    expect(await prisma.user.count({ where: { email } })).toBe(0);
    expect(await ensureAdmin(prisma, email, "Strong-Pass-1")).toBe("created");
    const u = await prisma.user.findUniqueOrThrow({ where: { email } });
    expect(u.role).toBe("ADMIN");
    expect(await bcrypt.compare("Strong-Pass-1", u.passwordHash)).toBe(true);
  });
  it("resets an existing admin's password only when the reset switch is on and the password is strong", async () => {
    const email = mail();
    const u = await prisma.user.create({ data: { email, name: "Owner", role: "ADMIN", passwordHash: await bcrypt.hash("Old-Pass-123", 4) } });
    expect(await ensureAdmin(prisma, email, "New-Pass-1234")).toBe("already-admin"); // no switch: nothing changes
    expect(await bcrypt.compare("Old-Pass-123", (await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).passwordHash)).toBe(true);
    expect(await ensureAdmin(prisma, email, "ChangeMe123!", true)).toBe("needs-password"); // weak: nothing changes
    expect(await bcrypt.compare("Old-Pass-123", (await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).passwordHash)).toBe(true);
    expect(await ensureAdmin(prisma, email, "New-Pass-1234", true)).toBe("reset");
    const after = await prisma.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(after.role).toBe("ADMIN");
    expect(await bcrypt.compare("New-Pass-1234", after.passwordHash)).toBe(true);
  });
});
