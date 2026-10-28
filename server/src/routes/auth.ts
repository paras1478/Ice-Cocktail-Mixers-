import { Router } from "express";
import bcrypt from "bcryptjs";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { prisma } from "../lib/db.js";
import { ah, parse } from "../lib/http.js";
import { HttpError } from "../lib/errors.js";
import { env } from "../lib/env.js";
import { COOKIE, cookieOptions, requireAuth, signToken } from "../middleware/auth.js";

export const authRouter = Router();

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: env.NODE_ENV === "test" ? 1000 : 30,
  message: { error: "Too many attempts. Please try again in a few minutes." },
});

const publicUser = (u: { id: string; email: string; name: string; phone: string | null; role: "CUSTOMER" | "ADMIN" }) => ({
  id: u.id, email: u.email, name: u.name, phone: u.phone, role: u.role,
});

const phone = z.string().regex(/^[6-9]\d{9}$/, "Enter a valid 10-digit mobile number");

authRouter.post(
  "/register",
  limiter,
  ah(async (req, res) => {
    const b = parse(
      z.object({
        name: z.string().trim().min(2, "Enter your name").max(80),
        email: z.string().trim().toLowerCase().email("Enter a valid email"),
        password: z.string().min(8, "Use at least 8 characters").max(100),
        phone: phone.optional().or(z.literal("").transform(() => undefined)),
      }),
      req.body,
    );
    if (await prisma.user.findUnique({ where: { email: b.email } })) throw new HttpError(409, "An account with this email already exists");
    const user = await prisma.user.create({ data: { name: b.name, email: b.email, phone: b.phone, passwordHash: await bcrypt.hash(b.password, 12) } });
    res.cookie(COOKIE, signToken({ id: user.id, role: user.role }), cookieOptions).status(201).json({ user: publicUser(user) });
  }),
);

authRouter.post(
  "/login",
  limiter,
  ah(async (req, res) => {
    const b = parse(z.object({ email: z.string().trim().toLowerCase().email(), password: z.string().min(1) }), req.body);
    const user = await prisma.user.findUnique({ where: { email: b.email } });
    // Same message for unknown email and wrong password so accounts cannot be probed.
    if (!user || !(await bcrypt.compare(b.password, user.passwordHash))) throw new HttpError(401, "Incorrect email or password");
    res.cookie(COOKIE, signToken({ id: user.id, role: user.role }), cookieOptions).json({ user: publicUser(user) });
  }),
);

authRouter.post("/logout", (_req, res) => {
  res.clearCookie(COOKIE, { ...cookieOptions, maxAge: undefined }).json({ ok: true });
});

authRouter.get(
  "/me",
  requireAuth,
  ah(async (req, res) => {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } });
    res.json({ user: publicUser(user) });
  }),
);

authRouter.patch(
  "/me",
  requireAuth,
  ah(async (req, res) => {
    const b = parse(
      z.object({
        name: z.string().trim().min(2).max(80).optional(),
        phone: phone.nullable().optional(),
        currentPassword: z.string().optional(),
        newPassword: z.string().min(8).max(100).optional(),
      }),
      req.body,
    );
    const data: { name?: string; phone?: string | null; passwordHash?: string } = {};
    if (b.name) data.name = b.name;
    if (b.phone !== undefined) data.phone = b.phone;
    if (b.newPassword) {
      const u = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } });
      if (!b.currentPassword || !(await bcrypt.compare(b.currentPassword, u.passwordHash))) throw new HttpError(400, "Current password is incorrect");
      data.passwordHash = await bcrypt.hash(b.newPassword, 12);
    }
    res.json({ user: publicUser(await prisma.user.update({ where: { id: req.user!.id }, data })) });
  }),
);
