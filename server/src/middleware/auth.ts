import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { env } from "../lib/env.js";
import { prisma } from "../lib/db.js";
import { HttpError } from "../lib/errors.js";

export interface AuthUser {
  id: string;
  role: "CUSTOMER" | "ADMIN";
}

declare module "express-serve-static-core" {
  interface Request {
    user?: AuthUser;
  }
}

export const COOKIE = "token";
export const cookieOptions = {
  httpOnly: true,
  sameSite: env.COOKIE_SAMESITE,
  // SameSite=None is only accepted by browsers together with Secure.
  secure: env.NODE_ENV === "production" || env.COOKIE_SAMESITE === "none",
  maxAge: 7 * 24 * 60 * 60 * 1000,
  path: "/",
};

export function signToken(user: AuthUser) {
  return jwt.sign(user, env.JWT_SECRET, { expiresIn: "7d" });
}

async function resolveUser(req: Request): Promise<AuthUser | undefined> {
  const token = req.cookies?.[COOKIE];
  if (!token) return undefined;
  try {
    const p = jwt.verify(token, env.JWT_SECRET) as AuthUser;
    // Re-read the role from the database so demoted/deleted users lose access immediately.
    const u = await prisma.user.findUnique({ where: { id: p.id }, select: { id: true, role: true } });
    return u ?? undefined;
  } catch {
    return undefined;
  }
}

export async function optionalAuth(req: Request, _res: Response, next: NextFunction) {
  try {
    req.user = await resolveUser(req);
    next();
  } catch (e) {
    next(e);
  }
}

export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  try {
    req.user = await resolveUser(req);
    if (!req.user) throw new HttpError(401, "Please log in");
    next();
  } catch (e) {
    next(e);
  }
}

export async function requireAdmin(req: Request, _res: Response, next: NextFunction) {
  try {
    req.user = await resolveUser(req);
    if (!req.user) throw new HttpError(401, "Please log in");
    if (req.user.role !== "ADMIN") throw new HttpError(403, "Admin access required");
    next();
  } catch (e) {
    next(e);
  }
}
