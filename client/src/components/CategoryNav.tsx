import { Link, useLocation } from "react-router-dom";
import type { Category } from "../lib/types";
import { Skeleton } from "./ui";

/** Navigation pills, driven entirely by the categories the API returns (the approved store categories). */
export function CategoryNav({ categories, loading, error, onRetry }: { categories?: Category[] | null; loading?: boolean; error?: string | null; onRetry?: () => void }) {
  const { pathname } = useLocation();
  const active = pathname.startsWith("/category/") ? decodeURIComponent(pathname.split("/")[2] ?? "") : "";
  return (
    <nav aria-label="Product categories" className="border-b border-line bg-surface">
      <ul className="container-x flex gap-2 overflow-x-auto py-2.5 [scrollbar-width:none]">
        {loading ? Array.from({ length: 8 }).map((_, i) => <li key={i}><Skeleton className="h-9 w-28 rounded-full" /></li>)
          : error ? <li className="flex items-center gap-3 text-sm text-danger" role="alert">Categories failed to load. <button className="font-semibold underline" onClick={onRetry}>Retry</button></li>
          : (categories ?? []).map((c) => {
            const on = active === c.slug;
            return (
              <li key={c.id} className="shrink-0">
                <Link to={`/category/${c.slug}`} aria-current={on ? "page" : undefined}
                  className={`inline-flex min-h-9 items-center rounded-full border px-3.5 text-sm font-semibold transition ${on ? "border-action bg-action text-on-action" : "border-line bg-surface hover:border-accent hover:bg-tint"}`}>
                  {c.name}
                </Link>
              </li>
            );
          })}
      </ul>
    </nav>
  );
}
