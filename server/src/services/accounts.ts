import bcrypt from "bcryptjs";
import type { PrismaClient, User } from "@prisma/client";
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
    return await prisma.user.create({ data: { name: input.name, email: input.email, phone: input.phone ?? null, passwordHash: hash } });
  } catch (e) {
    if ((e as { code?: string }).code === "P2002") throw exists(); // a concurrent sign-up with the same email won the race
    throw e;
  }
}

/** Returns the user for valid credentials. */
export async function authenticate(prisma: PrismaClient, email: string, password: string): Promise<User> {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) throw wrongLogin();
  return user;
}

export function updateProfile(prisma: PrismaClient, userId: string, patch: { name?: string; phone?: string | null }): Promise<User> {
  return prisma.user.update({ where: { id: userId }, data: patch });
}

export async function changePassword(prisma: PrismaClient, userId: string, currentPassword: string | undefined, newPassword: string): Promise<void> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (!currentPassword || !(await bcrypt.compare(currentPassword, user.passwordHash))) throw new HttpError(400, "Current password is incorrect");
  await prisma.user.update({ where: { id: userId }, data: { passwordHash: await bcrypt.hash(newPassword, 12) } });
}
