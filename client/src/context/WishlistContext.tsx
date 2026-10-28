import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

const KEY = "icx_wishlist";
const Ctx = createContext<{ ids: string[]; has: (id: string) => boolean; toggle: (id: string) => boolean } | null>(null);

const read = (): string[] => {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch { return []; }
};

export function WishlistProvider({ children }: { children: ReactNode }) {
  const [ids, setIds] = useState<string[]>(read);
  useEffect(() => { try { localStorage.setItem(KEY, JSON.stringify(ids)); } catch { /* storage unavailable */ } }, [ids]);
  const has = useCallback((id: string) => ids.includes(id), [ids]);
  /** Returns true when the product is now saved. */
  const toggle = useCallback((id: string) => {
    const on = !ids.includes(id);
    setIds((cur) => (on ? [...cur, id] : cur.filter((x) => x !== id)));
    return on;
  }, [ids]);
  const value = useMemo(() => ({ ids, has, toggle }), [ids, has, toggle]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWishlist() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useWishlist outside WishlistProvider");
  return c;
}
