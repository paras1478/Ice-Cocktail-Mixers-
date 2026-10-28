// Shop filters live in the URL so they survive refresh, back/forward and sharing.
export type Sort = "popular" | "price_asc" | "price_desc" | "newest";

export interface ShopFilters {
  q: string;
  category: string;
  minPrice?: number; // rupees (UI unit)
  maxPrice?: number;
  inStock: boolean;
  sort: Sort;
  page: number;
}

const SORTS: Sort[] = ["popular", "price_asc", "price_desc", "newest"];

export function parseFilters(sp: URLSearchParams, forcedCategory?: string): ShopFilters {
  const num = (k: string) => {
    const v = sp.get(k);
    return v !== null && v !== "" && Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : undefined;
  };
  const sort = sp.get("sort") as Sort;
  return {
    q: sp.get("q")?.trim() ?? "",
    category: forcedCategory ?? sp.get("category") ?? "",
    minPrice: num("min"),
    maxPrice: num("max"),
    inStock: sp.get("inStock") === "1",
    sort: SORTS.includes(sort) ? sort : "popular",
    page: Math.max(1, Math.floor(num("page") ?? 1)),
  };
}

export function filtersToParams(f: Partial<ShopFilters>, keepCategory = true): URLSearchParams {
  const sp = new URLSearchParams();
  if (f.q) sp.set("q", f.q);
  if (keepCategory && f.category) sp.set("category", f.category);
  if (f.minPrice !== undefined) sp.set("min", String(f.minPrice));
  if (f.maxPrice !== undefined) sp.set("max", String(f.maxPrice));
  if (f.inStock) sp.set("inStock", "1");
  if (f.sort && f.sort !== "popular") sp.set("sort", f.sort);
  if (f.page && f.page > 1) sp.set("page", String(f.page));
  return sp;
}

/** Translate UI filters (rupees) into the API query (minor units). */
export function filtersToApiQuery(f: ShopFilters, pageSize: number) {
  return {
    q: f.q || undefined,
    category: f.category || undefined,
    minPrice: f.minPrice !== undefined ? Math.round(f.minPrice * 100) : undefined,
    maxPrice: f.maxPrice !== undefined ? Math.round(f.maxPrice * 100) : undefined,
    inStock: f.inStock ? "true" : undefined,
    sort: f.sort,
    page: f.page,
    pageSize,
  };
}
