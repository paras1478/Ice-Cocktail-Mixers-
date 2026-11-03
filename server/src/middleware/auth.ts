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
  // Browsers send the session cookie; the mobile app sends the same JWT as "Authorization: Bearer <token>".
  const bearer = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization ?? "")?.[1];
  const token = req.cookies?.[COOKIE] ?? bearer;
  if (!token) return undefined;
  try {
    const p = jwt.verify(token, env.JWT_SECRET) as AuthUser;
    // Re-read the role from the database so demoted/deleted users lose access immediately.
    const u = await prisma.user.findUnique({ where: { id: p.id }, select: { id: true, role: true, isActive: true } });
    // A disabled account loses access immediately, even with a still-valid cookie.
    return u?.isActive ? { id: u.id, role: u.role } : undefined;
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
