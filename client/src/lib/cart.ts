// Pure cart helpers (no React) so they can be unit-tested.
export interface CartEntry {
  productId: string;
  quantity: number;
}

export const MAX_QTY = 50;

export const clampQty = (qty: number, stock?: number) => Math.max(0, Math.min(Math.floor(qty), MAX_QTY, stock ?? MAX_QTY));

export function addItem(items: CartEntry[], productId: string, qty = 1, stock?: number): CartEntry[] {
  const existing = items.find((i) => i.productId === productId);
  const next = clampQty((existing?.quantity ?? 0) + qty, stock);
  if (next <= 0) return items;
  return existing ? items.map((i) => (i.productId === productId ? { ...i, quantity: next } : i)) : [...items, { productId, quantity: next }];
}

/** Setting a quantity of 0 (or less) removes the line. */
export function setQuantity(items: CartEntry[], productId: string, qty: number, stock?: number): CartEntry[] {
  const next = clampQty(qty, stock);
  if (next <= 0) return items.filter((i) => i.productId !== productId);
  return items.map((i) => (i.productId === productId ? { ...i, quantity: next } : i));
}

export const removeItem = (items: CartEntry[], productId: string) => items.filter((i) => i.productId !== productId);

export const itemCount = (items: CartEntry[]) => items.reduce((n, i) => n + i.quantity, 0);

export const mergeCarts = (a: CartEntry[], b: CartEntry[]): CartEntry[] => b.reduce((acc, i) => addItem(acc, i.productId, i.quantity), a);

/**
 * Reconcile the saved server cart with the browser cart after login / page load.
 * Idempotent: takes the LARGER quantity per product, so running it on every page load never inflates quantities
 * (summing would double every line on each refresh, because the server cart mirrors the local one).
 */
export function reconcileCarts(server: CartEntry[], local: CartEntry[]): CartEntry[] {
  const merged = new Map<string, number>();
  for (const i of [...server, ...local]) merged.set(i.productId, Math.max(merged.get(i.productId) ?? 0, i.quantity));
  return [...merged].filter(([, q]) => q > 0).map(([productId, quantity]) => ({ productId, quantity: clampQty(quantity) }));
}

export function parseStoredCart(raw: string | null): CartEntry[] {
  try {
    const v = JSON.parse(raw ?? "[]");
    if (!Array.isArray(v)) return [];
    return v
      .filter((i) => i && typeof i.productId === "string" && Number.isInteger(i.quantity) && i.quantity > 0)
      .map((i) => ({ productId: i.productId, quantity: clampQty(i.quantity) }));
  } catch {
    return [];
  }
}
