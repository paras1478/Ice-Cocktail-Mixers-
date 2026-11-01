import { ChevronDown } from "lucide-react";
import type { Bundle } from "../lib/types";
import { formatMoney } from "../lib/format";
import { useCart } from "../context/CartContext";
import { useToast } from "../context/ToastContext";
import { EmptyState, ProductImage } from "../components/ui";

// Bundles without their own photo borrow one of the store's stock images, so the cards are never empty.
const FALLBACK_PHOTOS = ["/img/stock/category-party-bundles.jpg", "/img/stock/category-margarita-mixes.jpg", "/img/stock/ice-cubes.jpg", "/img/stock/category-tonic-water.jpg"];

export function BundleGrid({ bundles }: { bundles: Bundle[] }) {
  const cart = useCart();
  const toast = useToast();
  if (!bundles.length) return <EmptyState title="No bundles right now" body="Check back soon for curated party kits." />;
  return (
    <div className="grid gap-4 sm:grid-cols-2 sm:gap-5 lg:grid-cols-4">
      {bundles.map((b, n) => (
        <article key={b.id} className="card flex flex-col overflow-hidden">
          <div className="relative aspect-[313/205] overflow-hidden bg-tint">
            <ProductImage src={b.imageUrl ?? FALLBACK_PHOTOS[n % FALLBACK_PHOTOS.length]} alt={b.name} width={640} height={420} className="h-full w-full object-cover" />
          </div>
          <div className="flex flex-1 flex-col p-4">
            <h3 className="font-serif text-2xl leading-tight">{b.name}</h3>
            <p className="mt-1 line-clamp-2 text-xs text-muted">{b.description}</p>
            <details className="group mt-3 border-t border-line pt-2">
              <summary className="flex min-h-8 cursor-pointer list-none items-center justify-between text-xs font-bold">
                <span>What&apos;s included ({b.items.length} item{b.items.length === 1 ? "" : "s"})</span>
                <ChevronDown className="h-4 w-4 transition group-open:rotate-180" aria-hidden />
              </summary>
              <ul className="mt-2 grid gap-2 text-xs">
                {b.items.map((i) => (
                  <li key={i.productId} className="flex items-center gap-2.5">
                    <ProductImage src={i.image} alt={i.name} width={36} height={36} className="h-9 w-9 rounded-lg bg-tint object-cover" />
                    <span className="flex-1">{i.quantity} × {i.name} <span className="text-muted">· {i.packSize}</span></span>
                    {!i.inStock && <span className="font-semibold text-danger">Unavailable</span>}
                  </li>
                ))}
              </ul>
            </details>
            <div className="mt-auto flex items-end justify-between gap-2 pt-4">
              <div>
                <p className="text-lg font-extrabold">{formatMoney(b.priceMinor)}</p>
                {b.savingsMinor > 0 && <p className="text-[11px]"><span className="text-muted line-through">{formatMoney(b.regularMinor)}</span> <span className="font-bold text-ok">Save {formatMoney(b.savingsMinor)}</span></p>}
              </div>
              <button className="btn-add" disabled={!b.inStock} aria-label={b.inStock ? `Add ${b.name} bundle to cart` : `${b.name}: some items unavailable`}
                onClick={() => { cart.addMany(b.items.map((i) => ({ productId: i.productId, quantity: i.quantity }))); toast.success(`${b.name} added to cart`); }}>
                {b.inStock ? "Add kit +" : "Unavailable"}
              </button>
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}
