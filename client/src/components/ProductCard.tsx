import { Link } from "react-router-dom";
import { Heart } from "lucide-react";
import type { Product } from "../lib/types";
import { formatMoney } from "../lib/format";
import { useCart } from "../context/CartContext";
import { useWishlist } from "../context/WishlistContext";
import { useToast } from "../context/ToastContext";
import { ProductImage, QuantityStepper } from "./ui";

export function ProductCard({ product: p }: { product: Product }) {
  const cart = useCart();
  const wish = useWishlist();
  const toast = useToast();
  const qty = cart.qtyOf(p.id);
  const wished = wish.has(p.id);
  const img = p.images[0];

  return (
    <article className="card group relative flex flex-col overflow-hidden transition duration-200 hover:-translate-y-0.5 hover:shadow-lift">
      <div className={`relative overflow-hidden ${img && !img.isPlaceholder ? "img-well" : "bg-tint"}`}>
        <Link to={`/product/${p.slug}`} tabIndex={-1} aria-hidden>
          <ProductImage src={img?.url} alt={img?.alt ?? p.name} sizes="(min-width:1024px) 25vw, 50vw"
            className={`aspect-[4/3] w-full transition duration-300 group-hover:scale-105 ${img && !img.isPlaceholder ? "object-contain p-3" : "object-cover"} ${p.inStock ? "" : "opacity-50 grayscale"}`} />
        </Link>
        {p.discountPercent > 0 && <span className="absolute left-3 top-3 rounded-full bg-badge px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-badge-ink">{p.discountPercent}% OFF</span>}
        <button
          type="button"
          aria-pressed={wished}
          aria-label={wished ? `Remove ${p.name} from wishlist` : `Add ${p.name} to wishlist`}
          onClick={() => toast.success(wish.toggle(p.id) ? "Saved to wishlist" : "Removed from wishlist")}
          className="absolute right-2.5 top-2.5 z-10 grid h-8 w-8 place-items-center rounded-full bg-surface/90 text-ink shadow-sm hover:bg-surface"
        >
          <Heart className={`h-4 w-4 ${wished ? "fill-danger text-danger" : ""}`} aria-hidden />
        </button>
      </div>

      <div className="flex flex-1 flex-col p-3.5 sm:p-4">
        <h3 className="line-clamp-2 min-h-[2.5rem] text-sm font-semibold leading-5 sm:text-[15px]">
          <Link to={`/product/${p.slug}`} className="after:absolute after:inset-0 after:content-['']">{p.name}</Link>
        </h3>
        <p className="mt-0.5 text-xs text-muted">{p.brand ? <><span className="font-semibold uppercase tracking-wide">{p.brand}</span> · </> : null}{p.packSize}</p>
        {(!p.inStock || p.lowStock) && <p className={`mt-1 text-xs font-semibold ${!p.inStock ? "text-danger" : "text-warn"}`}>{!p.inStock ? "Out of stock" : `Only ${p.stock} left`}</p>}
        {p.inStock && !p.lowStock && <p className="sr-only">In stock</p>}
        {p.priceStatus === "SAMPLE" && <p className="mt-0.5 text-[11px] font-semibold text-warn">Sample price · unverified</p>}

        <div className="relative z-10 mt-auto flex items-end justify-between gap-2 pt-4">
          <div className="flex items-baseline gap-1.5">
            <span className="text-lg font-extrabold">{formatMoney(p.priceMinor)}</span>
            {p.mrpMinor && p.mrpMinor > p.priceMinor && <span className="text-xs text-muted line-through">{formatMoney(p.mrpMinor)}</span>}
          </div>
          {!p.inStock ? (
            <button className="btn-ghost !min-h-9 !px-3 text-xs" disabled>Out of stock</button>
          ) : qty > 0 ? (
            <QuantityStepper value={qty} max={p.stock} label={p.name} onChange={(n) => cart.setQty(p.id, n, p.stock)} />
          ) : (
            <button className="btn-add" onClick={() => { cart.add(p.id, 1, p.stock); toast.success(`${p.name} added to cart`); }} aria-label={`Add ${p.name} to cart`}>Add +</button>
          )}
        </div>
      </div>
    </article>
  );
}

export function ProductGrid({ products }: { products: Product[] }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:gap-5 md:grid-cols-3 lg:grid-cols-4">
      {products.map((p) => <ProductCard key={p.id} product={p} />)}
    </div>
  );
}
