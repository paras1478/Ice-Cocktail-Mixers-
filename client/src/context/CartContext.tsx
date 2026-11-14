import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, apiError } from "../lib/api";
import { addItem, itemCount, mergeCarts, parseStoredCart, reconcileCarts, removeItem, setQuantity, type CartEntry } from "../lib/cart";
import type { Quote } from "../lib/types";
import { useAuth } from "./AuthContext";
import { useToast } from "./ToastContext";

const KEY = "icx_cart";
const CODE_KEY = "icx_code";

interface CartApi {
  items: CartEntry[];
  count: number;
  quote: Quote | null;
  quoteLoading: boolean;
  quoteError: string | null;
  code: string;
  applyCode: (code: string) => void;
  qtyOf: (productId: string) => number;
  add: (productId: string, qty?: number, stock?: number) => void;
  addMany: (entries: CartEntry[]) => void;
  setQty: (productId: string, qty: number, stock?: number) => void;
  remove: (productId: string) => void;
  clear: () => void;
  refresh: () => void;
  /** Replaces the browser cart with the saved server cart (used after the voice assistant changed it on the server). */
  syncFromServer: () => Promise<void>;
}

const Ctx = createContext<CartApi | null>(null);
const readStore = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };

export function CartProvider({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const toast = useToast();
  const [items, setItems] = useState<CartEntry[]>(() => parseStoredCart(readStore(KEY)));
  const [code, setCode] = useState(() => readStore(CODE_KEY) ?? "");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const syncedFor = useRef<string | null>(null);

  useEffect(() => {
    try { localStorage.setItem(KEY, JSON.stringify(items)); localStorage.setItem(CODE_KEY, code); } catch { /* storage unavailable */ }
  }, [items, code]);

  // Authoritative quote from the server (prices, stock, discounts, fees, tax).
  useEffect(() => {
    if (!items.length) { setQuote(null); setQuoteError(null); return; }
    let cancelled = false;
    setQuoteLoading(true);
    const t = setTimeout(() => {
      api.post<Quote>("/cart/quote", { items, code: code || undefined })
        .then((r) => { if (!cancelled) { setQuote(r.data); setQuoteError(null); } })
        .catch((e) => { if (!cancelled) setQuoteError(apiError(e).message); })
        .finally(() => { if (!cancelled) setQuoteLoading(false); });
    }, 200);
    return () => { cancelled = true; clearTimeout(t); };
  }, [items, code, tick]);

  // Once the quote reports a product as no longer available, drop it so the cart never holds unbuyable lines.
  useEffect(() => {
    if (!quote) return;
    const gone = quote.issues.filter((i) => /no longer available/.test(i.message)).map((i) => i.productId);
    if (gone.length && items.some((i) => gone.includes(i.productId))) setItems((cur) => cur.filter((i) => !gone.includes(i.productId)));
  }, [quote]); // eslint-disable-line react-hooks/exhaustive-deps

  // On login / page load: reconcile the browser cart with the saved server cart (idempotent: max per product, never a sum).
  useEffect(() => {
    if (loading) return;
    if (!user) { syncedFor.current = null; return; }
    if (syncedFor.current === user.id) return;
    syncedFor.current = user.id;
    (async () => {
      try {
        const server = (await api.get("/cart")).data.items as CartEntry[];
        const merged = reconcileCarts(server.map((i) => ({ productId: i.productId, quantity: i.quantity })), items);
        setItems(merged);
        for (const m of merged) {
          const have = server.find((s) => s.productId === m.productId)?.quantity ?? 0;
          if (m.quantity > have) await api.post("/cart/items", { productId: m.productId, quantity: m.quantity - have }).catch(() => undefined);
        }
      } catch { /* the server cart is best-effort; the local cart stays authoritative for the UI */ }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, loading]);

  const mirror = useCallback(async (fn: () => Promise<unknown>) => { if (user) await fn().catch(() => undefined); }, [user]);

  const serverItemId = useCallback(async (productId: string) => {
    const r = await api.get("/cart");
    return (r.data.items as { id: string; productId: string }[]).find((i) => i.productId === productId)?.id;
  }, []);

  const stockOf = useCallback((id: string, given?: number) => given ?? quote?.lines.find((l) => l.productId === id)?.stock, [quote]);

  const add = useCallback((productId: string, qty = 1, stock?: number) => {
    const s = stockOf(productId, stock);
    const have = items.find((i) => i.productId === productId)?.quantity ?? 0;
    if (s !== undefined && have + qty > s) {
      toast.error(s === 0 ? "This item is out of stock" : `Only ${s} available`);
      if (have >= s) return;
    }
    setItems((cur) => addItem(cur, productId, qty, s));
    mirror(() => api.post("/cart/items", { productId, quantity: qty }));
  }, [items, mirror, stockOf, toast]);

  const addMany = useCallback((entries: CartEntry[]) => {
    setItems((cur) => mergeCarts(cur, entries));
    for (const e of entries) mirror(() => api.post("/cart/items", { productId: e.productId, quantity: e.quantity }));
  }, [mirror]);

  const setQty = useCallback((productId: string, qty: number, stock?: number) => {
    const s = stockOf(productId, stock);
    if (s !== undefined && qty > s) toast.error(`Only ${s} available`);
    setItems((cur) => setQuantity(cur, productId, qty, s));
    mirror(async () => {
      const id = await serverItemId(productId);
      if (!id) return;
      if (qty <= 0) await api.delete(`/cart/items/${id}`);
      else await api.patch(`/cart/items/${id}`, { quantity: Math.min(qty, s ?? qty) });
    });
  }, [mirror, serverItemId, stockOf, toast]);

  const remove = useCallback((productId: string) => {
    setItems((cur) => removeItem(cur, productId));
    mirror(async () => { const id = await serverItemId(productId); if (id) await api.delete(`/cart/items/${id}`); });
  }, [mirror, serverItemId]);

  const clear = useCallback(() => { setItems([]); setCode(""); }, []);

  const syncFromServer = useCallback(async () => {
    if (!user) return;
    try {
      const server = (await api.get("/cart")).data.items as { productId: string; quantity: number }[];
      setItems(server.map((i) => ({ productId: i.productId, quantity: i.quantity })));
    } catch { /* keep the current cart; the next page load reconciles it */ }
  }, [user]);

  const value = useMemo<CartApi>(() => ({
    items, count: itemCount(items), quote, quoteLoading, quoteError, code,
    applyCode: (c) => setCode(c.trim().toUpperCase()),
    qtyOf: (id) => items.find((i) => i.productId === id)?.quantity ?? 0,
    add, addMany, setQty, remove, clear, refresh: () => setTick((t) => t + 1), syncFromServer,
  }), [items, quote, quoteLoading, quoteError, code, add, addMany, setQty, remove, clear, syncFromServer]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCart() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useCart outside CartProvider");
  return c;
}
