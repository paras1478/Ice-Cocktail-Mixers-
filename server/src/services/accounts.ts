import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import type { PrismaClient, User } from "@prisma/client";
import { HttpError } from "../lib/errors.js";

/**
 * Account credentials (email + password hash) can live in MongoDB Atlas. Everything relational (orders, carts, addresses)
 * keeps referencing a minimal profile row in PostgreSQL that has the SAME id; that row never holds a password in this mode.
 * Without MONGODB_URI no store is configured and accounts work exactly as before (PostgreSQL only).
 */
export interface Account {
  id: string;
  email: string;
  name: string;
  phone: string | null;
  passwordHash: string;
}

export class DuplicateAccountError extends Error {
  constructor() {
    super("duplicate account");
  }
}
export class AccountStoreUnavailable extends Error {
  constructor() {
    super("account store unavailable");
  }
}

export interface CredentialStore {
  readonly kind: string;
  findByEmail(email: string): Promise<Account | null>;
  findById(id: string): Promise<Account | null>;
  /** Throws DuplicateAccountError when the email or id already exists. */
  insert(account: Account): Promise<void>;
  update(id: string, patch: Partial<Pick<Account, "name" | "phone" | "passwordHash">>): Promise<void>;
  remove(id: string): Promise<void>;
}

let store: CredentialStore | null = null;
export const setCredentialStore = (s: CredentialStore | null) => {
  store = s;
};
export const credentialStore = () => store;

/** Stored in the PostgreSQL profile row of a MongoDB-backed account. It is not a hash, so it can never match any password. */
export const NO_LOCAL_PASSWORD = "!credentials-in-mongodb";
const isBcrypt = (h: string) => /^\$2[aby]\$\d{2}\$/.test(h);

const newId = () => randomBytes(12).toString("hex"); // 24-hex id, same format as a MongoDB ObjectId

const unavailable = () => new HttpError(503, "Sign-in is temporarily unavailable. Please try again in a moment.");
const wrongLogin = () => new HttpError(401, "Incorrect email or password");

/** Maps store failures to API errors: duplicates are 409, outages are a safe 503 (details were already logged without credentials). */
async function guard<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof DuplicateAccountError) throw new HttpError(409, "An account with this email already exists");
    if (e instanceof AccountStoreUnavailable) throw unavailable();
    throw e;
  }
}

export interface NewAccount {
  name: string;
  email: string;
  password: string;
  phone?: string;
}

export async function registerAccount(prisma: PrismaClient, input: NewAccount): Promise<User> {
  const exists = () => new HttpError(409, "An account with this email already exists");
  const hash = await bcrypt.hash(input.password, 12);
  if (!store) {
    if (await prisma.user.findUnique({ where: { email: input.email } })) throw exists();
    return prisma.user.create({ data: { name: input.name, email: input.email, phone: input.phone, passwordHash: hash } });
  }
  const s = store;
  if (await prisma.user.findUnique({ where: { email: input.email } })) throw exists();
  const id = newId();
  // 1. credentials in MongoDB (its unique email index is the guard against duplicates, even under concurrent sign-ups)
  await guard(() => s.insert({ id, email: input.email, name: input.name, phone: input.phone ?? null, passwordHash: hash }));
  // 2. the relational profile with the same id; undo step 1 if it fails so no half-created account is left behind
  try {
    return await prisma.user.create({ data: { id, name: input.name, email: input.email, phone: input.phone ?? null, passwordHash: NO_LOCAL_PASSWORD } });
  } catch (e) {
    await s.remove(id).catch(() => undefined);
    if ((e as { code?: string }).code === "P2002") throw exists();
    throw e;
  }
}

/** Returns the PostgreSQL user for valid credentials. Existing PostgreSQL-only accounts are copied into MongoDB on their first sign-in. */
export async function authenticate(prisma: PrismaClient, email: string, password: string): Promise<User> {
  const pg = await prisma.user.findUnique({ where: { email } });
  if (!store) {
    if (!pg || !(await bcrypt.compare(password, pg.passwordHash))) throw wrongLogin();
    return pg;
  }
  const s = store;
  let account = await guard(() => s.findByEmail(email));
  if (!account) {
    // Legacy account (created before MongoDB was enabled): verify against the old hash, then migrate it with the SAME id.
    if (!pg || !isBcrypt(pg.passwordHash) || !(await bcrypt.compare(password, pg.passwordHash))) throw wrongLogin();
    account = { id: pg.id, email: pg.email, name: pg.name, phone: pg.phone, passwordHash: pg.passwordHash };
    await guard(() => s.insert(account!)).catch((e) => {
      if (!(e instanceof HttpError && e.status === 409)) throw e; // already migrated by a concurrent sign-in
    });
    return pg;
  }
  if (!(await bcrypt.compare(password, account.passwordHash))) throw wrongLogin();
  if (pg) return pg;
  // Credentials exist but the profile row does not (an interrupted sign-up): complete it.
  return prisma.user.create({ data: { id: account.id, email: account.email, name: account.name, phone: account.phone, passwordHash: NO_LOCAL_PASSWORD } });
}

export async function updateProfile(prisma: PrismaClient, userId: string, patch: { name?: string; phone?: string | null }): Promise<User> {
  const user = await prisma.user.update({ where: { id: userId }, data: patch });
  if (store) {
    const s = store;
    // Accounts not migrated yet are copied (from this updated row) on their next sign-in.
    if (await guard(() => s.findById(userId))) await guard(() => s.update(userId, patch));
  }
  return user;
}

export async function changePassword(prisma: PrismaClient, userId: string, currentPassword: string | undefined, newPassword: string): Promise<void> {
  const invalid = () => new HttpError(400, "Current password is incorrect");
  const pg = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const hash = await bcrypt.hash(newPassword, 12);
  if (!store) {
    if (!currentPassword || !(await bcrypt.compare(currentPassword, pg.passwordHash))) throw invalid();
    await prisma.user.update({ where: { id: userId }, data: { passwordHash: hash } });
    return;
  }
  const s = store;
  const account = await guard(() => s.findById(userId));
  const currentHash = account?.passwordHash ?? (isBcrypt(pg.passwordHash) ? pg.passwordHash : null);
  if (!currentPassword || !currentHash || !(await bcrypt.compare(currentPassword, currentHash))) throw invalid();
  if (account) await guard(() => s.update(userId, { passwordHash: hash }));
  else await guard(() => s.insert({ id: pg.id, email: pg.email, name: pg.name, phone: pg.phone, passwordHash: hash }));
  // The old PostgreSQL hash must not remain usable: PostgreSQL no longer holds this account's password.
  await prisma.user.update({ where: { id: userId }, data: { passwordHash: NO_LOCAL_PASSWORD } });
}
