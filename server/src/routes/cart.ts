import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/db.js";
import { ah, parse } from "../lib/http.js";
import { HttpError } from "../lib/errors.js";
import { requireAuth } from "../middleware/auth.js";
import { isPublic } from "../lib/publish.js";
import { buildQuote } from "../services/checkout.js";

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

async function loadCart(userId: string) {
  const cart = await prisma.cart.upsert({ where: { userId }, update: {}, create: { userId } });
  const rows = await prisma.cartItem.findMany({
    where: { cartId: cart.id, product: { isActive: true } },
    include: { product: { include: { images: true } } },
    orderBy: { id: "asc" },
  });
  return {
    id: cart.id,
    items: rows.map((r) => ({
      id: r.id,
      productId: r.productId,
      quantity: r.quantity,
      name: r.product.name,
      packSize: r.product.packSize,
      unitMinor: r.product.priceMinor,
      stock: r.product.stock,
      image: [...r.product.images].sort((a, b) => a.sortOrder - b.sortOrder)[0]?.url,
    })),
  };
}

cartRouter.get("/", requireAuth, ah(async (req, res) => res.json(await loadCart(req.user!.id))));

cartRouter.post(
  "/items",
  requireAuth,
  ah(async (req, res) => {
    const b = parse(z.object({ productId: z.string().min(1), quantity: z.number().int().min(1).max(50).default(1) }), req.body);
    const product = await prisma.product.findUnique({ where: { id: b.productId }, include: { category: true } });
    if (!product || !isPublic(product)) throw new HttpError(404, "Product not found");
    const cart = await prisma.cart.upsert({ where: { userId: req.user!.id }, update: {}, create: { userId: req.user!.id } });
    const existing = await prisma.cartItem.findUnique({ where: { cartId_productId: { cartId: cart.id, productId: b.productId } } });
    const quantity = (existing?.quantity ?? 0) + b.quantity;
    if (quantity > product.stock) throw new HttpError(409, product.stock === 0 ? "Out of stock" : `Only ${product.stock} left in stock`);
    await prisma.cartItem.upsert({
      where: { cartId_productId: { cartId: cart.id, productId: b.productId } },
      update: { quantity },
      create: { cartId: cart.id, productId: b.productId, quantity },
    });
    res.status(201).json(await loadCart(req.user!.id));
  }),
);

cartRouter.patch(
  "/items/:id",
  requireAuth,
  ah(async (req, res) => {
    const b = parse(z.object({ quantity: z.number().int().min(1).max(50) }), req.body);
    const item = await prisma.cartItem.findFirst({ where: { id: req.params.id, cart: { userId: req.user!.id } }, include: { product: true } });
    if (!item) throw new HttpError(404, "Cart item not found");
    if (b.quantity > item.product.stock) throw new HttpError(409, `Only ${item.product.stock} left in stock`);
    await prisma.cartItem.update({ where: { id: item.id }, data: { quantity: b.quantity } });
    res.json(await loadCart(req.user!.id));
  }),
);

cartRouter.delete(
  "/items/:id",
  requireAuth,
  ah(async (req, res) => {
    const r = await prisma.cartItem.deleteMany({ where: { id: req.params.id, cart: { userId: req.user!.id } } });
    if (!r.count) throw new HttpError(404, "Cart item not found");
    res.json(await loadCart(req.user!.id));
  }),
);
