import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/db.js";
import { ah, parse } from "../lib/http.js";
import { HttpError } from "../lib/errors.js";
import { requireAuth } from "../middleware/auth.js";
import { addressBody, addressFields, checkCoords, COORD_MESSAGE, hasPlace, normalizeAddress, PLACE_MESSAGE, serviceability } from "../lib/address.js";

export const addressRouter = Router();

// Public: format + coordinate + serviceability check for an address being typed (used by checkout).
addressRouter.post(
  "/validate",
  ah(async (req, res) => {
    const a = parse(addressFields.refine(checkCoords, { message: COORD_MESSAGE, path: ["latitude"] }).refine(hasPlace, { message: PLACE_MESSAGE, path: ["district"] }), req.body);
    res.json(await serviceability(a.pincode));
  }),
);

addressRouter.use(requireAuth);

addressRouter.get(
  "/",
  ah(async (req, res) => {
    res.json({ addresses: await prisma.address.findMany({ where: { userId: req.user!.id }, orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }] }) });
  }),
);

addressRouter.post(
  "/",
  ah(async (req, res) => {
    const { confirmed, ...raw } = parse(addressBody, req.body);
    const b = normalizeAddress(raw);
    const userId = req.user!.id;
    const first = (await prisma.address.count({ where: { userId } })) === 0;
    const address = await prisma.$transaction(async (tx) => {
      const makeDefault = b.isDefault ?? first;
      if (makeDefault) await tx.address.updateMany({ where: { userId }, data: { isDefault: false } });
      return tx.address.create({ data: { ...b, isDefault: makeDefault, userId, confirmedAt: confirmed ? new Date() : null } });
    });
    res.status(201).json({ address });
  }),
);

addressRouter.put(
  "/:id",
  ah(async (req, res) => {
    const { confirmed, ...raw } = parse(addressBody, req.body);
    const b = normalizeAddress(raw);
    const userId = req.user!.id;
    const own = await prisma.address.findFirst({ where: { id: req.params.id, userId } });
    if (!own) throw new HttpError(404, "Address not found");
    const address = await prisma.$transaction(async (tx) => {
      if (b.isDefault) await tx.address.updateMany({ where: { userId, id: { not: own.id } }, data: { isDefault: false } });
      return tx.address.update({
        where: { id: own.id },
        data: { ...b, latitude: b.latitude ?? null, longitude: b.longitude ?? null, ...(confirmed ? { confirmedAt: new Date() } : {}) },
      });
    });
    res.json({ address });
  }),
);

addressRouter.delete(
  "/:id",
  ah(async (req, res) => {
    const id = z.string().min(1).parse(req.params.id);
    // Past orders keep their own address snapshot, so deleting a saved address never alters order history.
    const r = await prisma.address.deleteMany({ where: { id, userId: req.user!.id } });
    if (!r.count) throw new HttpError(404, "Address not found");
    res.status(204).end();
  }),
);
