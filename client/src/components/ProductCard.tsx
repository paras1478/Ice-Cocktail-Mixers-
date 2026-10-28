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
    <article className="card group relative flex flex-col overflow-hidden p-2.5 transition duration-200 hover:-translate-y-0.5 hover:shadow-lift sm:p-3">
      <div className={`relative overflow-hidden rounded-xl ${img && !img.isPlaceholder ? "bg-[#f3e9d8]" : "bg-tint"}`}>
        <Link to={`/product/${p.slug}`} tabIndex={-1} aria-hidden>
          <ProductImage src={img?.url} alt={img?.alt ?? p.name} sizes="(min-width:1024px) 25vw, 50vw"
            className={`aspect-square w-full transition duration-300 group-hover:scale-105 ${img && !img.isPlaceholder ? "object-contain p-3" : "object-cover"} ${p.inStock ? "" : "opacity-50 grayscale"}`} />
        </Link>
        {p.discountPercent > 0 && <span className="absolute left-2 top-2 rounded-full bg-badge px-2 py-0.5 text-[11px] font-bold text-badge-ink">{p.discountPercent}% OFF</span>}
        <button
          type="button"
          aria-pressed={wished}
          aria-label={wished ? `Remove ${p.name} from wishlist` : `Add ${p.name} to wishlist`}
          onClick={() => toast.success(wish.toggle(p.id) ? "Saved to wishlist" : "Removed from wishlist")}
          className="absolute right-2 top-2 z-10 grid h-9 w-9 place-items-center rounded-full bg-surface/90 text-ink shadow-sm hover:bg-surface"
        >
          <Heart className={`h-[18px] w-[18px] ${wished ? "fill-danger text-danger" : ""}`} aria-hidden />
        </button>
      </div>

      <div className="mt-3 flex flex-1 flex-col px-0.5">
        <p className="text-xs font-medium text-muted">{p.brand ? <><span className="font-bold uppercase tracking-wide">{p.brand}</span> · </> : null}{p.packSize}</p>
        <h3 className="mt-0.5 line-clamp-2 min-h-[2.5rem] text-sm font-bold leading-5 sm:text-[15px]">
          <Link to={`/product/${p.slug}`} className="after:absolute after:inset-0 after:content-['']">{p.name}</Link>
        </h3>
        <div className="mt-1.5 flex items-baseline gap-2">
          <span className="text-base font-extrabold text-accent">{formatMoney(p.priceMinor)}</span>
          {p.mrpMinor && p.mrpMinor > p.priceMinor && <span className="text-xs text-muted line-through">{formatMoney(p.mrpMinor)}</span>}
        </div>
        {p.priceStatus === "SAMPLE" && <p className="mt-0.5 text-[11px] font-semibold text-warn">Sample price · unverified</p>}
        <p className={`mt-1 text-xs font-semibold ${!p.inStock ? "text-danger" : p.lowStock ? "text-warn" : "text-ok"}`}>
          {!p.inStock ? "Out of stock" : p.lowStock ? `Only ${p.stock} left` : "In stock"}
        </p>
      </div>

      <div className="relative z-10 mt-3">
        {!p.inStock ? (
          <button className="btn-ghost w-full" disabled>Out of stock</button>
        ) : qty > 0 ? (
          <div className="flex justify-center [&>div]:w-full [&>div]:justify-between"><QuantityStepper value={qty} max={p.stock} label={p.name} onChange={(n) => cart.setQty(p.id, n, p.stock)} /></div>
        ) : (
          <button className="btn-add w-full" onClick={() => { cart.add(p.id, 1, p.stock); toast.success(`${p.name} added to cart`); }} aria-label={`Add ${p.name} to cart`}>Add</button>
        )}
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
