import { prisma } from "../lib/db.js";
import { HttpError } from "../lib/errors.js";
import { isPublic } from "../lib/publish.js";

/** The customer's saved server cart. Shared by the cart routes and the voice assistant so both follow exactly the same rules. */
export async function loadCart(userId: string) {
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

/** Adds `quantity` of a product (on top of what is already in the cart). Only approved, purchasable products, and never more than the stock. */
export async function addCartItem(userId: string, productId: string, quantity: number) {
  const product = await prisma.product.findUnique({ where: { id: productId }, include: { category: true } });
  if (!product || !isPublic(product)) throw new HttpError(404, "Product not found");
  const cart = await prisma.cart.upsert({ where: { userId }, update: {}, create: { userId } });
  const existing = await prisma.cartItem.findUnique({ where: { cartId_productId: { cartId: cart.id, productId } } });
  const total = (existing?.quantity ?? 0) + quantity;
  if (total > product.stock) throw new HttpError(409, product.stock === 0 ? "Out of stock" : `Only ${product.stock} left in stock`);
  await prisma.cartItem.upsert({
    where: { cartId_productId: { cartId: cart.id, productId } },
    update: { quantity: total },
    create: { cartId: cart.id, productId, quantity: total },
  });
  return loadCart(userId);
}

/** Sets the quantity of one of THIS customer's cart lines (another customer's line is "not found"). */
export async function setCartItemQuantity(userId: string, itemId: string, quantity: number) {
  const item = await prisma.cartItem.findFirst({ where: { id: itemId, cart: { userId } }, include: { product: true } });
  if (!item) throw new HttpError(404, "Cart item not found");
  if (quantity > item.product.stock) throw new HttpError(409, `Only ${item.product.stock} left in stock`);
  await prisma.cartItem.update({ where: { id: item.id }, data: { quantity } });
  return loadCart(userId);
}

export async function removeCartItem(userId: string, itemId: string) {
  const r = await prisma.cartItem.deleteMany({ where: { id: itemId, cart: { userId } } });
  if (!r.count) throw new HttpError(404, "Cart item not found");
  return loadCart(userId);
}
