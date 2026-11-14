import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/db.js";
import { ah, parse } from "../lib/http.js";
import { requireAuth } from "../middleware/auth.js";
import { buildQuote } from "../services/checkout.js";
import { addCartItem, loadCart, removeCartItem, setCartItemQuantity } from "../services/cart.js";

export const cartRouter = Router();

const items = z.array(z.object({ productId: z.string().min(1), quantity: z.number().int().min(1).max(50) })).max(100);

// Public: authoritative quote for any list of items (guest carts and the checkout summary).
cartRouter.post(
  "/quote",
  ah(async (req, res) => {
    const b = parse(z.object({ items, code: z.string().max(40).optional() }), req.body);
    res.json(await prisma.$transaction((tx) => buildQuote(tx, b.items, b.code, false)));
  }),
);

cartRouter.get("/", requireAuth, ah(async (req, res) => res.json(await loadCart(req.user!.id))));

cartRouter.post(
  "/items",
  requireAuth,
  ah(async (req, res) => {
    const b = parse(z.object({ productId: z.string().min(1), quantity: z.number().int().min(1).max(50).default(1) }), req.body);
    res.status(201).json(await addCartItem(req.user!.id, b.productId, b.quantity));
  }),
);

cartRouter.patch(
  "/items/:id",
  requireAuth,
  ah(async (req, res) => {
    const b = parse(z.object({ quantity: z.number().int().min(1).max(50) }), req.body);
    res.json(await setCartItemQuantity(req.user!.id, req.params.id, b.quantity));
  }),
);

cartRouter.delete(
  "/items/:id",
  requireAuth,
  ah(async (req, res) => res.json(await removeCartItem(req.user!.id, req.params.id))),
);
