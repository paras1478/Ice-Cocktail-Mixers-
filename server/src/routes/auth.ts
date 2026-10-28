import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { prisma } from "../lib/db.js";
import { ah, parse } from "../lib/http.js";
import { HttpError } from "../lib/errors.js";
import { env } from "../lib/env.js";
import { authenticate, changePassword, registerAccount, updateProfile } from "../services/accounts.js";
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
    const user = await registerAccount(prisma, { name: b.name, email: b.email, password: b.password, phone: b.phone });
    res.cookie(COOKIE, signToken({ id: user.id, role: user.role }), cookieOptions).status(201).json({ user: publicUser(user) });
  }),
);

authRouter.post(
  "/login",
  limiter,
  ah(async (req, res) => {
    const b = parse(z.object({ email: z.string().trim().toLowerCase().email(), password: z.string().min(1) }), req.body);
    // Same message for unknown email and wrong password so accounts cannot be probed.
    const user = await authenticate(prisma, b.email, b.password);
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
    if (b.newPassword) await changePassword(prisma, req.user!.id, b.currentPassword, b.newPassword);
    const profile: { name?: string; phone?: string | null } = {};
    if (b.name) profile.name = b.name;
    if (b.phone !== undefined) profile.phone = b.phone;
    res.json({ user: publicUser(await updateProfile(prisma, req.user!.id, profile)) });
  }),
);
