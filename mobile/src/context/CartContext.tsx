import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, errMsg } from "../lib/api";
import type { CartEntry, Quote } from "../lib/types";

interface CartApi {
  items: CartEntry[];
  count: number;
  quote: Quote | null;
  quoteLoading: boolean;
  quoteError: string | null;
  code: string;
  setCode: (c: string) => void;
  qtyOf: (productId: string) => number;
  setQty: (productId: string, qty: number, stock?: number) => void;
  clear: () => void;
}
const Ctx = createContext<CartApi | null>(null);

export function CartProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<CartEntry[]>([]);
  const [code, setCode] = useState("");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);

  // The server is the only authority on prices, stock, discounts, fees and tax.
  useEffect(() => {
    if (!items.length) {
      setQuote(null);
      setQuoteError(null);
      return;
    }
    let cancelled = false;
    setQuoteLoading(true);
    const t = setTimeout(() => {
      api
        .post<Quote>("/cart/quote", { items, code: code || undefined })
        .then((r) => {
          if (!cancelled) {
            setQuote(r.data);
            setQuoteError(null);
          }
        })
        .catch((e) => {
          if (!cancelled) setQuoteError(errMsg(e));
        })
        .finally(() => {
          if (!cancelled) setQuoteLoading(false);
        });
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [items, code]);

  const qtyOf = useCallback((id: string) => items.find((i) => i.productId === id)?.quantity ?? 0, [items]);
  const setQty = useCallback((productId: string, qty: number, stock?: number) => {
    const q = Math.max(0, Math.min(qty, 50, stock ?? 50));
    setItems((cur) =>
      q === 0
        ? cur.filter((i) => i.productId !== productId)
        : cur.some((i) => i.productId === productId)
          ? cur.map((i) => (i.productId === productId ? { ...i, quantity: q } : i))
          : [...cur, { productId, quantity: q }],
    );
  }, []);
  const clear = useCallback(() => {
    setItems([]);
    setCode("");
  }, []);
  const count = items.reduce((n, i) => n + i.quantity, 0);

  const value = useMemo(
    () => ({ items, count, quote, quoteLoading, quoteError, code, setCode, qtyOf, setQty, clear }),
    [items, count, quote, quoteLoading, quoteError, code, qtyOf, setQty, clear],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCart() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useCart outside CartProvider");
  return c;
}
