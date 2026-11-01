import { Link, useLocation } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import type { Category } from "../lib/types";
import { Skeleton } from "./ui";

/** Navigation links, driven entirely by the categories the API returns (the approved store categories). */
export function CategoryNav({ categories, loading, error, onRetry }: { categories?: Category[] | null; loading?: boolean; error?: string | null; onRetry?: () => void }) {
  const { pathname } = useLocation();
  const active = pathname.startsWith("/category/") ? decodeURIComponent(pathname.split("/")[2] ?? "") : "";
  return (
    <div className="border-b border-line bg-header">
      <div className="container-x flex items-center gap-6">
        <nav aria-label="Product categories" className="min-w-0 flex-1">
          <ul className="flex items-center justify-between gap-6 overflow-x-auto py-3 text-sm [scrollbar-width:none]">
            {loading ? Array.from({ length: 8 }).map((_, i) => <li key={i}><Skeleton className="h-5 w-24 rounded-full" /></li>)
              : error ? <li className="flex items-center gap-3 text-sm text-danger" role="alert">Categories failed to load. <button className="font-semibold underline" onClick={onRetry}>Retry</button></li>
              : (categories ?? []).map((c) => {
                const on = active === c.slug;
                return (
                  <li key={c.id} className="shrink-0">
                    <Link to={`/category/${c.slug}`} aria-current={on ? "page" : undefined}
                      className={`whitespace-nowrap border-b-2 pb-0.5 font-medium transition ${on ? "border-ink font-bold" : "border-transparent text-ink-soft hover:border-ink/40 hover:text-ink"}`}>
                      {c.name}
                    </Link>
                  </li>
                );
              })}
          </ul>
        </nav>
        <Link to="/shop" className="hidden shrink-0 items-center gap-1.5 text-sm font-bold hover:underline sm:inline-flex">Shop all <ArrowRight className="h-3.5 w-3.5" aria-hidden /></Link>
      </div>
    </div>
  );
}
