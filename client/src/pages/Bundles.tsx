import { ChevronDown, Package } from "lucide-react";
import type { Bundle } from "../lib/types";
import { formatMoney } from "../lib/format";
import { useCart } from "../context/CartContext";
import { useToast } from "../context/ToastContext";
import { EmptyState, ProductImage } from "../components/ui";

export function BundleGrid({ bundles }: { bundles: Bundle[] }) {
  const cart = useCart();
  const toast = useToast();
  if (!bundles.length) return <EmptyState title="No bundles right now" body="Check back soon for curated party kits." />;
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {bundles.map((b) => (
        <article key={b.id} className="card flex flex-col p-4 sm:p-5">
          <div className="flex items-start justify-between gap-3">
            <div><h3 className="flex items-center gap-2 text-lg font-extrabold"><Package className="h-5 w-5 text-accent" aria-hidden />{b.name}</h3><p className="mt-1 text-sm text-muted">{b.description}</p></div>
            <div className="text-right"><p className="text-xl font-extrabold text-accent">{formatMoney(b.priceMinor)}</p>
              {b.savingsMinor > 0 && <p className="text-xs"><span className="text-muted line-through">{formatMoney(b.regularMinor)}</span> <span className="font-bold text-ok">Save {formatMoney(b.savingsMinor)}</span></p>}</div>
          </div>
          <details className="group mt-3 rounded-xl border border-line px-3 py-2">
            <summary className="flex min-h-9 cursor-pointer list-none items-center justify-between text-sm font-semibold">
              <span>What&apos;s included ({b.items.length} item{b.items.length === 1 ? "" : "s"})</span>
              <ChevronDown className="h-4 w-4 transition group-open:rotate-180" aria-hidden />
            </summary>
          <ul className="mt-3 grid gap-2 text-sm">
            {b.items.map((i) => (
              <li key={i.productId} className="flex items-center gap-3">
                <ProductImage src={i.image} alt={i.name} width={40} height={40} className="h-10 w-10 rounded-lg bg-tint object-cover" />
                <span className="flex-1">{i.quantity} × {i.name} <span className="text-muted">· {i.packSize}</span></span>
                {!i.inStock && <span className="text-xs font-semibold text-danger">Unavailable</span>}
              </li>
            ))}
          </ul>
          </details>
          <button className="btn-add-solid mt-4 w-full" disabled={!b.inStock}
            onClick={() => { cart.addMany(b.items.map((i) => ({ productId: i.productId, quantity: i.quantity }))); toast.success(`${b.name} added to cart`); }}>
            {b.inStock ? "Add bundle to cart" : "Some items unavailable"}
          </button>
        </article>
      ))}
    </div>
  );
}
