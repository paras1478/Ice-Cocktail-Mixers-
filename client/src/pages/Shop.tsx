import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { ChevronLeft, ChevronRight, SlidersHorizontal, X } from "lucide-react";
import { api } from "../lib/api";
import type { Bundle, Category, Product } from "../lib/types";
import { filtersToApiQuery, filtersToParams, parseFilters, type ShopFilters, type Sort } from "../lib/filters";
import { loadSavedFilters, saveFilters } from "../lib/savedFilters";
import { CoverImage, EmptyState, ErrorState, ProductGridSkeleton, Skeleton, useAsync } from "../components/ui";
import { ProductGrid } from "../components/ProductCard";
import { PriceFilter } from "../components/PriceFilter";
import { BundleGrid } from "./Bundles";

const PAGE_SIZE = 12;
type Bounds = { minMinor: number; maxMinor: number } | null;

function FilterPanel({ f, cats, forced, bounds, anyActive, onChange, onClearAll }: {
  f: ShopFilters; cats: Category[]; forced?: string; bounds: Bounds; anyActive: boolean; onChange: (p: Partial<ShopFilters>) => void; onClearAll: () => void;
}) {
  return (
    <div className="space-y-6">
      {!forced && (
        <fieldset>
          <legend className="mb-2 text-sm font-bold">Category</legend>
          <div className="space-y-1">
            <label className="flex min-h-9 items-center gap-2 text-sm"><input type="radio" name="cat" checked={!f.category} onChange={() => onChange({ category: "" })} /> All products</label>
            {cats.filter((c) => c.slug !== "party-bundles").map((c) => (
              <label key={c.id} className="flex min-h-9 items-center gap-2 text-sm">
                <input type="radio" name="cat" checked={f.category === c.slug} onChange={() => onChange({ category: c.slug })} /> {c.name} <span className="text-muted">({c.productCount})</span>
              </label>
            ))}
          </div>
        </fieldset>
      )}
      <PriceFilter min={f.minPrice} max={f.maxPrice} bounds={bounds} anyFilterActive={anyActive}
        onApply={(minPrice, maxPrice) => onChange({ minPrice, maxPrice })} onReset={() => onChange({ minPrice: undefined, maxPrice: undefined })} onClearAll={onClearAll} />
      <label className="flex min-h-9 items-center gap-2 text-sm font-semibold">
        <input type="checkbox" checked={f.inStock} onChange={(e) => onChange({ inStock: e.target.checked })} /> In stock only
      </label>
    </div>
  );
}

export default function Shop() {
  const { slug } = useParams();
  const [sp, setSp] = useSearchParams();
  const [drawer, setDrawer] = useState(false);
  const f = parseFilters(sp, slug);
  const cats = useAsync(() => api.get<{ categories: Category[] }>("/categories").then((r) => r.data.categories), []);
  const category = cats.data?.find((c) => c.slug === (slug ?? f.category));
  const isBundles = slug === "party-bundles";

  // Carry the price / stock / sort choices from one listing to the next (per browser tab). Search text and category are never carried,
  // and a price range is only carried when it overlaps this listing's real prices (otherwise it would just show an empty page).
  useEffect(() => {
    const hasAny = f.minPrice !== undefined || f.maxPrice !== undefined || f.inStock || f.sort !== "popular";
    if (hasAny || isBundles) return;
    const saved = loadSavedFilters();
    if (!saved) return;
    let live = true;
    (async () => {
      let carry = saved;
      if (saved.minPrice !== undefined || saved.maxPrice !== undefined) {
        try {
          const { data } = await api.get<{ minMinor: number | null; maxMinor: number | null }>("/products/price-range", { params: { category: slug } });
          const lo = (data.minMinor ?? 0) / 100, hi = (data.maxMinor ?? 0) / 100;
          const overlaps = data.minMinor !== null && (saved.maxPrice === undefined || saved.maxPrice >= lo) && (saved.minPrice === undefined || saved.minPrice <= hi);
          if (!overlaps) carry = { ...saved, minPrice: undefined, maxPrice: undefined };
        } catch { /* keep the saved filters; the listing shows its own error if the API is down */ }
      }
      if (live) setSp(filtersToParams({ ...f, ...carry, page: 1 }, !slug), { replace: true });
    })();
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);
  useEffect(() => { if (!isBundles) saveFilters({ minPrice: f.minPrice, maxPrice: f.maxPrice, inStock: f.inStock, sort: f.sort }); }, [f.minPrice, f.maxPrice, f.inStock, f.sort, isBundles]);

  const res = useAsync(
    () => isBundles ? Promise.resolve(null) : api.get<{ products: Product[]; total: number; totalPages: number }>("/products", { params: filtersToApiQuery(f, PAGE_SIZE) }).then((r) => r.data),
    [sp.toString(), slug],
  );
  const range = useAsync(
    () => isBundles ? Promise.resolve(null) : api.get<{ minMinor: number | null; maxMinor: number | null }>("/products/price-range", { params: { category: slug ?? (f.category || undefined), q: f.q || undefined } }).then((r) => r.data),
    [slug, f.category, f.q],
  );
  const bounds: Bounds = range.data && range.data.minMinor !== null && range.data.maxMinor !== null ? { minMinor: range.data.minMinor, maxMinor: range.data.maxMinor } : null;
  const bundles = useAsync(() => (isBundles ? api.get<{ bundles: Bundle[] }>("/bundles").then((r) => r.data.bundles) : Promise.resolve(null)), [isBundles]);

  // Any change except paging resets to page 1.
  const update = (patch: Partial<ShopFilters>) => setSp(filtersToParams({ ...f, page: 1, ...patch }, !slug));
  const clearAll = () => { saveFilters(null); setSp(new URLSearchParams()); };
  const chips: [string, () => void][] = [];
  if (f.q) chips.push([`“${f.q}”`, () => update({ q: "" })]);
  if (f.category && !slug) chips.push([category?.name ?? f.category, () => update({ category: "" })]);
  if (f.minPrice !== undefined || f.maxPrice !== undefined) chips.push([`₹${f.minPrice ?? 0} – ${f.maxPrice !== undefined ? "₹" + f.maxPrice : "any"}`, () => update({ minPrice: undefined, maxPrice: undefined })]);
  if (f.inStock) chips.push(["In stock", () => update({ inStock: false })]);

  if (slug && !category && cats.data)
    return <div className="container-x py-16"><EmptyState title="Category not found" body="That category doesn't exist or has been removed." action={<Link to="/shop" className="btn-primary">Browse all products</Link>} /></div>;
  const data = res.data;
  const title = category?.name ?? (f.q ? `Results for “${f.q}”` : "All products");
  const panel = <FilterPanel f={f} cats={cats.data ?? []} forced={slug} bounds={bounds} anyActive={chips.length > 0 || f.sort !== "popular"} onChange={update} onClearAll={clearAll} />;

  return (
    <div className="container-x py-8">
      <nav aria-label="Breadcrumb" className="mb-3 text-sm text-muted"><Link to="/" className="hover:underline">Home</Link> / <span className="text-ink">{category?.name ?? "Shop"}</span></nav>
      {slug && !category ? <Skeleton className="h-10 w-56" /> : category?.imageUrl ? (
        <header className="relative isolate overflow-hidden rounded-2xl bg-topbar text-white" data-testid="category-banner">
          <CoverImage src={category.imageUrl} width={1200} height={300} eager />
          <div className="relative px-5 py-8 sm:px-8 sm:py-12">
            <h1 className="text-3xl font-extrabold drop-shadow sm:text-4xl">{title}</h1>
            {category.description && <p className="mt-2 max-w-2xl text-white/90">{category.description}</p>}
          </div>
        </header>
      ) : (
        <>
          <h1 className="text-3xl font-extrabold sm:text-4xl">{title}</h1>
          {category?.description && <p className="mt-2 max-w-2xl text-muted">{category.description}</p>}
        </>
      )}

      {isBundles ? (
        <div className="mt-8">{bundles.loading ? <ProductGridSkeleton count={4} /> : bundles.error ? <ErrorState message={bundles.error} onRetry={bundles.reload} /> : <BundleGrid bundles={bundles.data ?? []} />}</div>
      ) : (
        <div className="mt-6 grid gap-8 lg:grid-cols-[270px_1fr]">
          <aside className="hidden lg:block" aria-label="Filters"><div className="card sticky top-28 p-5">{panel}</div></aside>
          <div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-muted" role="status" aria-live="polite">{res.loading ? "Loading…" : `${data?.total ?? 0} product${data?.total === 1 ? "" : "s"}`}</p>
              <div className="flex items-center gap-2">
                <button className="btn-ghost lg:hidden" onClick={() => setDrawer(true)}><SlidersHorizontal className="h-4 w-4" aria-hidden /> Filters{chips.length ? ` (${chips.length})` : ""}</button>
                <label className="sr-only" htmlFor="sort">Sort by</label>
                <select id="sort" className="input w-auto" value={f.sort} onChange={(e) => update({ sort: e.target.value as Sort })}>
                  <option value="popular">Most popular</option>
                  <option value="price_asc">Price: low to high</option>
                  <option value="price_desc">Price: high to low</option>
                  <option value="newest">Newest</option>
                </select>
              </div>
            </div>
            {chips.length > 0 && (
              <ul className="mt-3 flex flex-wrap gap-2" aria-label="Active filters">
                {chips.map(([label, clear]) => <li key={label}><button onClick={clear} className="chip gap-1.5 hover:bg-secondary" aria-label={`Remove filter ${label}`}>{label}<X className="h-3 w-3" aria-hidden /></button></li>)}
              </ul>
            )}
            <div className="mt-5">
              {res.loading ? <ProductGridSkeleton count={8} />
                : res.error ? <ErrorState message={res.error} onRetry={res.reload} />
                : data && data.products.length === 0 ? (
                  <EmptyState title="No products found" body={f.q ? `Nothing matches “${f.q}” with these filters. Try a shorter search or clear some filters.` : "No products match these filters."}
                    action={<button className="btn-dark" onClick={clearAll}>Clear all filters</button>} />
                ) : <ProductGrid products={data?.products ?? []} />}
            </div>
            {data && data.totalPages > 1 && (
              <nav aria-label="Pagination" className="mt-8 flex items-center justify-center gap-3">
                <button className="btn-ghost" disabled={f.page <= 1} onClick={() => setSp(filtersToParams({ ...f, page: f.page - 1 }, !slug))}><ChevronLeft className="h-4 w-4" aria-hidden /> Prev</button>
                <span className="text-sm font-semibold" aria-current="page">Page {f.page} of {data.totalPages}</span>
                <button className="btn-ghost" disabled={f.page >= data.totalPages} onClick={() => setSp(filtersToParams({ ...f, page: f.page + 1 }, !slug))}>Next <ChevronRight className="h-4 w-4" aria-hidden /></button>
              </nav>
            )}
          </div>
        </div>
      )}

      {drawer && (
        <div className="fixed inset-0 z-[65] bg-scrim/50 lg:hidden" onMouseDown={(e) => e.target === e.currentTarget && setDrawer(false)}>
          <div role="dialog" aria-modal="true" aria-label="Filters" className="rise absolute inset-x-0 bottom-0 max-h-[88vh] overflow-auto rounded-t-3xl bg-surface p-6">
            <div className="mb-4 flex items-center justify-between"><h2 className="text-lg font-extrabold">Filters</h2><button aria-label="Close filters" onClick={() => setDrawer(false)} className="rounded-full p-2 hover:bg-tint"><X className="h-5 w-5" /></button></div>
            {panel}
            <button className="btn-primary mt-6 w-full" onClick={() => setDrawer(false)}>Show {data?.total ?? ""} products</button>
          </div>
        </div>
      )}
    </div>
  );
}
