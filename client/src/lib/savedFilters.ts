import type { Sort } from "./filters";

// Price / stock / sort choices are remembered for the browser tab so they carry between listings (category pages, shop).
// Search text and category are deliberately NOT remembered.
const KEY = "icx_filters";

export interface SavedFilters {
  minPrice?: number;
  maxPrice?: number;
  inStock: boolean;
  sort: Sort;
}

const SORTS: Sort[] = ["popular", "price_asc", "price_desc", "newest"];
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : undefined);

export function loadSavedFilters(): SavedFilters | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const v = JSON.parse(raw);
    const f: SavedFilters = { minPrice: num(v.minPrice), maxPrice: num(v.maxPrice), inStock: v.inStock === true, sort: SORTS.includes(v.sort) ? v.sort : "popular" };
    return f.minPrice === undefined && f.maxPrice === undefined && !f.inStock && f.sort === "popular" ? null : f;
  } catch {
    return null;
  }
}

/** Pass null to forget everything (used by "Clear all filters"). */
export function saveFilters(f: SavedFilters | null) {
  try {
    if (!f || (f.minPrice === undefined && f.maxPrice === undefined && !f.inStock && f.sort === "popular")) sessionStorage.removeItem(KEY);
    else sessionStorage.setItem(KEY, JSON.stringify(f));
  } catch { /* storage unavailable */ }
}
