import bcrypt from "bcryptjs";
import type { Prisma, PrismaClient, User } from "@prisma/client";
import { HttpError } from "../lib/errors.js";

/** Customer accounts live in the PostgreSQL `User` table (email, bcrypt password hash, profile), next to their orders, carts and addresses. */
export interface NewAccount {
  name: string;
  email: string;
  password: string;
  phone?: string;
}

const exists = () => new HttpError(409, "An account with this email already exists");
const wrongLogin = () => new HttpError(401, "Incorrect email or password");

export async function registerAccount(prisma: PrismaClient, input: NewAccount): Promise<User> {
  const hash = await bcrypt.hash(input.password, 12);
  if (await prisma.user.findUnique({ where: { email: input.email } })) throw exists();
  try {
    // Registering signs the customer in, so the first login time is recorded too.
    return await prisma.user.create({ data: { name: input.name, email: input.email, phone: input.phone ?? null, passwordHash: hash, lastLoginAt: new Date() } });
  } catch (e) {
    if ((e as { code?: string }).code === "P2002") throw exists(); // a concurrent sign-up with the same email won the race
    throw e;
  }
}

/** Returns the user for valid credentials. */
export async function authenticate(prisma: PrismaClient, email: string, password: string): Promise<User> {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) throw wrongLogin();
  if (!user.isActive) throw new HttpError(403, "This account has been disabled. Please contact support.");
  // The existing record is reused (looked up by its unique email); only the login time changes.
  return prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
}

export interface CustomerQuery {
  q?: string;
  status?: "active" | "disabled";
  sort?: "joined" | "lastLogin" | "name";
  page: number;
  pageSize: number;
}

/** One page of customers (role CUSTOMER) with their order count and total spent (cancelled orders excluded), straight from PostgreSQL. */
export async function listCustomers(prisma: PrismaClient, query: CustomerQuery) {
  const q = query.q?.trim();
  const where: Prisma.UserWhereInput = {
    role: "CUSTOMER",
    ...(query.status ? { isActive: query.status === "active" } : {}),
    ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { email: { contains: q, mode: "insensitive" } }, { phone: { contains: q } }] } : {}),
  };
  const orderBy: Prisma.UserOrderByWithRelationInput[] =
    query.sort === "name" ? [{ name: "asc" }, { id: "asc" }]
    : query.sort === "lastLogin" ? [{ lastLoginAt: { sort: "desc", nulls: "last" } }, { id: "asc" }]
    : [{ createdAt: "desc" }, { id: "asc" }];
  const [total, users] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({ where, orderBy, skip: (query.page - 1) * query.pageSize, take: query.pageSize }),
  ]);
  const ids = users.map((u) => u.id);
  const [counts, spent] = ids.length
    ? await Promise.all([
        prisma.order.groupBy({ by: ["userId"], where: { userId: { in: ids } }, _count: { _all: true } }),
        prisma.order.groupBy({ by: ["userId"], where: { userId: { in: ids }, status: { not: "CANCELLED" } }, _sum: { totalMinor: true } }),
      ])
    : [[], []];
  const orderCount = new Map(counts.map((c) => [c.userId, c._count._all]));
  const totalSpent = new Map(spent.map((s) => [s.userId, s._sum.totalMinor ?? 0]));
  return {
    total,
    page: query.page,
    pageSize: query.pageSize,
    customers: users.map((u) => ({
      id: u.id, name: u.name, email: u.email, phone: u.phone,
      status: u.isActive ? "ACTIVE" : "DISABLED",
      createdAt: u.createdAt, lastLoginAt: u.lastLoginAt,
      orderCount: orderCount.get(u.id) ?? 0,
      totalSpentMinor: totalSpent.get(u.id) ?? 0,
    })),
  };
}

export function updateProfile(prisma: PrismaClient, userId: string, patch: { name?: string; phone?: string | null }): Promise<User> {
  return prisma.user.update({ where: { id: userId }, data: patch });
}

export async function changePassword(prisma: PrismaClient, userId: string, currentPassword: string | undefined, newPassword: string): Promise<void> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (!currentPassword || !(await bcrypt.compare(currentPassword, user.passwordHash))) throw new HttpError(400, "Current password is incorrect");
  await prisma.user.update({ where: { id: userId }, data: { passwordHash: await bcrypt.hash(newPassword, 12) } });
}
