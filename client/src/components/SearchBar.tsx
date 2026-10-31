import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Search } from "lucide-react";
import { api } from "../lib/api";
import type { Product } from "../lib/types";
import { formatMoney } from "../lib/format";

interface Suggestion { key: string; label: string; sub?: string; to: string }

export function SearchBar() {
  const nav = useNavigate();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Suggestion[]>([]);
  const [active, setActive] = useState(-1);
  const box = useRef<HTMLDivElement>(null);
  const listId = useId();

  useEffect(() => {
    const term = q.trim();
    if (!term) { setItems([]); return; }
    let live = true;
    const t = setTimeout(() => {
      api.get<{ products: Product[]; categories: { id: string; slug: string; name: string }[] }>("/search/suggest", { params: { q: term } })
        .then((r) => {
          if (!live) return;
          setItems([
            ...r.data.categories.map((c) => ({ key: `c-${c.id}`, label: c.name, sub: "Category", to: `/category/${c.slug}` })),
            ...r.data.products.map((p) => ({ key: `p-${p.id}`, label: p.name, sub: `${p.packSize} · ${formatMoney(p.priceMinor)}`, to: `/product/${p.slug}` })),
          ]);
          setActive(-1);
        })
        .catch(() => live && setItems([])); // suggestions are optional; the full search still works
    }, 220);
    return () => { live = false; clearTimeout(t); };
  }, [q]);

  useEffect(() => {
    const close = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const go = (to: string) => { setOpen(false); nav(to); };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (active >= 0 && items[active]) return go(items[active].to);
    const term = q.trim();
    if (term) go(`/shop?q=${encodeURIComponent(term)}`);
  };

  return (
    <div ref={box} className="relative w-full">
      <form role="search" onSubmit={submit} className="relative">
        <label htmlFor="site-search" className="sr-only">Search products</label>
        <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
        <input
          id="site-search" type="search" value={q} autoComplete="off" placeholder="Search ice, mixers…"
          role="combobox" aria-expanded={open && items.length > 0} aria-controls={listId} aria-autocomplete="list"
          onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, items.length - 1)); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, -1)); }
            else if (e.key === "Escape") setOpen(false);
          }}
          className="input rounded-full pl-11 pr-4 text-ink"
        />
      </form>
      {open && items.length > 0 && (
        <ul id={listId} role="listbox" className="card absolute inset-x-0 top-full z-50 mt-2 max-h-80 overflow-auto p-1.5 text-ink">
          {items.map((s, i) => (
            <li key={s.key} role="option" aria-selected={i === active}>
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => go(s.to)}
                className={`flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm ${i === active ? "bg-tint" : "hover:bg-tint"}`}>
                <span className="font-semibold">{s.label}</span><span className="text-xs text-muted">{s.sub}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
