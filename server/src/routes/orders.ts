import { Router } from "express";
import { OrderStatus, Prisma } from "@prisma/client";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { prisma } from "../lib/db.js";
import { ah, parse } from "../lib/http.js";
import { HttpError } from "../lib/errors.js";
import { env } from "../lib/env.js";
import { requireAuth } from "../middleware/auth.js";
import { buildQuote } from "../services/checkout.js";
import { addressFields, checkCoords, COORD_MESSAGE, hasPlace, normalizeAddress, PLACE_MESSAGE, serviceability } from "../lib/address.js";

export const orderRouter = Router();
orderRouter.use(requireAuth);

const orderLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: env.NODE_ENV === "test" ? 1000 : 20,
  message: { error: "Too many orders, please try again later" },
});

const include = { items: true, payment: true } as const;

const createBody = z.object({
  items: z.array(z.object({ productId: z.string().min(1), quantity: z.number().int().min(1).max(50) })).min(1, "Your cart is empty").max(100),
  code: z.string().max(40).optional(),
  contactName: z.string().trim().min(2).max(80),
  contactPhone: z.string().regex(/^[6-9]\d{9}$/, "Enter a valid 10-digit mobile number"),
  address: addressFields.refine(checkCoords, { message: COORD_MESSAGE, path: ["latitude"] }).refine(hasPlace, { message: PLACE_MESSAGE, path: ["district"] }),
  addressId: z.string().min(1).optional(), // an unchanged saved address this order is linked to
  saveAddress: z.boolean().optional(),
  addressConfirmed: z.boolean().refine((v) => v === true, { message: "Please confirm your delivery address" }),
  instructions: z.string().trim().max(300).optional(),
  paymentMethod: z.enum(["COD", "CARD"]),
  // The total the customer saw. If prices changed since, we refuse rather than charge a different amount.
  expectedTotalMinor: z.number().int().min(0).optional(),
});
// NOTE: totals are intentionally absent from the schema, so clients cannot supply prices.

orderRouter.post(
  "/",
  orderLimiter,
  ah(async (req, res) => {
    const b = parse(createBody, req.body);
    if (b.paymentMethod === "COD" && env.ENABLE_COD !== "true") throw new HttpError(400, "Cash on delivery is not available");
    if (b.paymentMethod === "CARD") throw new HttpError(501, env.STRIPE_SECRET_KEY ? "Card payment provider integration is not implemented yet" : "Card payments are not configured on this server");

    const area = await serviceability(b.address.pincode);
    if (!area.serviceable)
      throw new HttpError(422, area.reason === "paused" ? `Delivery to ${area.pincode} is temporarily paused` : "Sorry, we don't deliver to this pincode yet");
    const a = normalizeAddress(b.address);
    const userId = req.user!.id;

    const order = await prisma.$transaction(
      async (tx) => {
        const q = await buildQuote(tx, b.items, b.code, true);
        if (b.expectedTotalMinor !== undefined && b.expectedTotalMinor !== q.totals.totalMinor)
          throw new HttpError(409, "Prices or fees changed since you last checked. Please review your updated total.", { totalMinor: q.totals.totalMinor });
        // Atomic conditional decrement guards against overselling under concurrency.
        for (const l of q.lines) {
          const r = await tx.product.updateMany({ where: { id: l.productId, isActive: true, stock: { gte: l.quantity } }, data: { stock: { decrement: l.quantity } } });
          if (r.count !== 1) throw new HttpError(409, `${l.name} just went out of stock`, [{ productId: l.productId, message: `${l.name} just went out of stock` }]);
        }
        if (q.discountId) {
          const d = await tx.discount.findUniqueOrThrow({ where: { id: q.discountId } });
          const r = await tx.discount.updateMany({ where: { id: d.id, ...(d.maxUses !== null ? { usedCount: { lt: d.maxUses } } : {}) }, data: { usedCount: { increment: 1 } } });
          if (r.count !== 1) throw new HttpError(400, "This discount code is fully redeemed");
        }
        // Link to a saved address only if it is the customer's own; optionally save a new one.
        let addressId: string | null = null;
        if (b.addressId) addressId = (await tx.address.findFirst({ where: { id: b.addressId, userId }, select: { id: true } }))?.id ?? null;
        else if (b.saveAddress) {
          const first = (await tx.address.count({ where: { userId } })) === 0;
          const saved = await tx.address.create({
            data: { userId, label: "Home", type: a.type, recipientName: b.contactName, phone: b.contactPhone, house: a.house, line1: a.line1, landmark: a.landmark ?? null, area: a.area, district: a.district, city: a.city, state: a.state, stateCode: a.stateCode, pincode: a.pincode, latitude: a.latitude ?? null, longitude: a.longitude ?? null, confirmedAt: new Date(), isDefault: first },
          });
          addressId = saved.id;
        }
        const created = await tx.order.create({
          data: {
            userId,
            subtotalMinor: q.totals.subtotalMinor,
            discountMinor: q.totals.discountMinor,
            deliveryMinor: q.totals.deliveryMinor,
            taxMinor: q.totals.taxMinor,
            totalMinor: q.totals.totalMinor,
            discountId: q.discountId,
            contactName: b.contactName,
            contactPhone: b.contactPhone,
            // Immutable snapshot of exactly what the customer confirmed.
            addrHouse: a.house, addrLine1: a.line1, addrLandmark: a.landmark ?? null, addrArea: a.area, addrDistrict: a.district, addrCity: a.city, addrState: a.state, addrStateCode: a.stateCode, addrPincode: a.pincode,
            addrType: a.type, addrLatitude: a.latitude ?? null, addrLongitude: a.longitude ?? null, addrConfirmedAt: new Date(),
            addressId,
            instructions: b.instructions,
            estimatedDeliveryAt: new Date(Date.now() + area.etaMinutes * 60_000),
            items: { create: q.lines.map((l) => ({ productId: l.productId, name: l.name, unitMinor: l.unitMinor, quantity: l.quantity })) },
            payment: { create: { method: b.paymentMethod, amountMinor: q.totals.totalMinor, status: "PENDING" } },
          },
          include,
        });
        await tx.cartItem.deleteMany({ where: { cart: { userId } } });
        return created;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
    );
    res.status(201).json({ order });
  }),
);

orderRouter.get(
  "/",
  ah(async (req, res) => {
    const all = req.query.all === "true" && req.user!.role === "ADMIN";
    const status = z.nativeEnum(OrderStatus).optional().parse(req.query.status || undefined);
    const orders = await prisma.order.findMany({
      where: { ...(all ? {} : { userId: req.user!.id }), ...(status ? { status } : {}) },
      orderBy: { createdAt: "desc" },
      include: { ...include, user: { select: { id: true, name: true, email: true, phone: true } } },
      take: 200,
    });
    res.json({ orders });
  }),
);

orderRouter.get(
  "/:id",
  ah(async (req, res) => {
    const o = await prisma.order.findUnique({ where: { id: req.params.id }, include: { ...include, user: { select: { id: true, name: true, email: true, phone: true } } } });
    // 404 (not 403) for other people's orders so ids cannot be probed.
    if (!o || (o.userId !== req.user!.id && req.user!.role !== "ADMIN")) throw new HttpError(404, "Order not found");
    res.json({ order: o });
  }),
);

const FLOW: OrderStatus[] = ["PLACED", "CONFIRMED", "PREPARING", "OUT_FOR_DELIVERY", "DELIVERED"];

async function setStatus(id: string, next: OrderStatus, isAdmin: boolean, userId: string) {
  return prisma.$transaction(async (tx) => {
    const o = await tx.order.findUnique({ where: { id }, include: { items: true, payment: true } });
    if (!o || (!isAdmin && o.userId !== userId)) throw new HttpError(404, "Order not found");
    if (o.status === "DELIVERED" || o.status === "CANCELLED") throw new HttpError(409, `Order is already ${o.status.toLowerCase()}`);
    if (next === "CANCELLED") {
      if (!isAdmin && o.status !== "PLACED" && o.status !== "CONFIRMED") throw new HttpError(409, "This order can no longer be cancelled");
      for (const i of o.items) await tx.product.update({ where: { id: i.productId }, data: { stock: { increment: i.quantity } } });
    } else if (FLOW.indexOf(next) !== FLOW.indexOf(o.status) + 1) {
      throw new HttpError(409, `Cannot move order from ${o.status} to ${next}`);
    }
    if (next === "DELIVERED" && o.payment?.method === "COD") await tx.payment.update({ where: { orderId: o.id }, data: { status: "PAID" } });
    return tx.order.update({ where: { id }, data: { status: next }, include: { items: true, payment: true } });
  });
}

orderRouter.patch(
  "/:id/status",
  ah(async (req, res) => {
    const { status } = parse(z.object({ status: z.nativeEnum(OrderStatus) }), req.body);
    const isAdmin = req.user!.role === "ADMIN";
    // Customers may only cancel their own orders; every other transition is admin-only.
    if (!isAdmin && status !== "CANCELLED") throw new HttpError(403, "Admin access required");
    res.json({ order: await setStatus(req.params.id, status, isAdmin, req.user!.id) });
  }),
);
