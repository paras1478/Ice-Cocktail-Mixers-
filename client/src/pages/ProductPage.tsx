import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ChevronDown, Clock, Heart, MapPin, ShoppingBag } from "lucide-react";
import { api } from "../lib/api";
import type { Product } from "../lib/types";
import { formatMoney } from "../lib/format";
import { useCart } from "../context/CartContext";
import { useWishlist } from "../context/WishlistContext";
import { useLocationCtx } from "../context/LocationContext";
import { useToast } from "../context/ToastContext";
import { ErrorState, ProductImage, QuantityStepper, Skeleton, useAsync } from "../components/ui";
import { ProductGrid } from "../components/ProductCard";
import { deliveryFeeText, useAppConfig } from "../lib/useAppConfig";

export default function ProductPage() {
  const { slug } = useParams();
  const cart = useCart();
  const wish = useWishlist();
  const toast = useToast();
  const { delivery, openModal } = useLocationCtx();
  const appCfg = useAppConfig();
  const [qty, setQty] = useState(1);
  const [imgIdx, setImgIdx] = useState(0);
  const { data, loading, error, reload } = useAsync(
    () => api.get<{ product: Product; related: Product[]; packs: Product[] }>(`/products/${slug}`).then((r) => { setQty(1); setImgIdx(0); return r.data; }),
    [slug],
  );

  // Room under the whole page (footer included) for the fixed mobile purchase bar, so it never covers content.
  useEffect(() => { document.body.classList.add("has-buy-bar"); return () => document.body.classList.remove("has-buy-bar"); }, []);

  if (loading) return <div className="container-x grid gap-8 py-10 md:grid-cols-2"><Skeleton className="aspect-square" /><div className="space-y-4"><Skeleton className="h-8 w-2/3" /><Skeleton className="h-6 w-1/3" /><Skeleton className="h-32" /></div></div>;
  if (error || !data) return <div className="container-x py-16"><ErrorState message={error ?? "Product not found"} onRetry={reload} /></div>;

  const p = data.product;
  const wished = wish.has(p.id);
  const inCart = cart.qtyOf(p.id);
  const max = Math.max(0, p.stock - inCart);
  const img = p.images[imgIdx] ?? p.images[0];

  return (
    <div className="container-x py-5 sm:py-8">
      <nav aria-label="Breadcrumb" className="mb-5 text-sm text-muted">
        <Link to="/" className="hover:underline">Home</Link> / {p.category && <><Link to={`/category/${p.category.slug}`} className="hover:underline">{p.category.name}</Link> / </>}<span className="text-ink">{p.name}</span>
      </nav>
      <div className="grid gap-8 md:grid-cols-2 lg:gap-14">
        <div>
          <div className={`overflow-hidden rounded-3xl ${img && !img.isPlaceholder ? "img-well" : "bg-tint"}`}><ProductImage src={img?.url} alt={img?.alt ?? p.name} width={600} height={600} sizes="(min-width:768px) 50vw, 100vw" eager className={`aspect-square w-full ${img && !img.isPlaceholder ? "object-contain p-6" : "object-cover"}`} /></div>
          {p.images.length > 1 && (
            <div className="mt-3 flex gap-2">
              {p.images.map((im, i) => (
                <button key={im.url} onClick={() => setImgIdx(i)} aria-label={`Show image ${i + 1}`} aria-pressed={i === imgIdx} className={`h-16 w-16 overflow-hidden rounded-xl border-2 ${i === imgIdx ? "border-action" : "border-transparent"}`}><ProductImage src={im.url} alt="" width={64} height={64} className="h-full w-full object-cover" /></button>
              ))}
            </div>
          )}
        </div>

        <div>
          <p className="text-sm font-semibold text-muted">{p.brand ? <span className="font-bold uppercase tracking-wide text-ink">{p.brand}</span> : null}{p.brand && p.category ? " · " : ""}{p.category?.name}</p>
          <h1 className="mt-1 text-2xl font-extrabold sm:text-4xl">{p.name}</h1>
          <p className="mt-1 text-muted">{p.packSize}</p>

          {data.packs.length > 1 && (
            <div className="mt-4" role="group" aria-label="Pack size">
              <p className="mb-1.5 text-sm font-bold">Pack size</p>
              <ul className="flex flex-wrap gap-2">
                {data.packs.map((k) => {
                  const on = k.id === p.id;
                  return (
                    <li key={k.id}>
                      <Link to={`/product/${k.slug}`} aria-current={on ? "true" : undefined}
                        className={`inline-flex min-h-11 flex-col justify-center rounded-xl border px-3.5 py-1.5 text-sm transition ${on ? "border-accent bg-tint font-bold" : "border-line hover:border-accent"} ${k.inStock ? "" : "opacity-60"}`}>
                        <span className="font-semibold">{k.packSize}</span>
                        <span className="text-xs text-muted">{formatMoney(k.priceMinor)}{k.inStock ? "" : " · out of stock"}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          <div className="mt-5 flex flex-wrap items-baseline gap-3">
            <span className="text-3xl font-extrabold text-accent">{formatMoney(p.priceMinor)}</span>
            {p.mrpMinor && p.mrpMinor > p.priceMinor && <><span className="text-lg text-muted line-through">{formatMoney(p.mrpMinor)}</span><span className="chip bg-badge text-badge-ink">{p.discountPercent}% off MRP</span></>}
          </div>
          <p className="mt-1 text-xs text-muted">{deliveryFeeText(appCfg, formatMoney) ?? "Delivery fee"} · taxes are calculated at checkout.</p>
          {p.priceStatus === "VERIFIED" && p.priceVerifiedAt ? (
            <p className="mt-1 text-xs text-muted">Price checked {new Date(p.priceVerifiedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}{p.priceSourceUrl ? <> · <a href={p.priceSourceUrl} target="_blank" rel="noreferrer" className="underline">source</a></> : null}</p>
          ) : (
            <p className="mt-2 rounded-xl bg-band p-3 text-xs font-semibold text-warn">Development sample price: not yet verified against a retailer or the pack.</p>
          )}
          <p className={`mt-4 text-sm font-bold ${!p.inStock ? "text-danger" : p.lowStock ? "text-warn" : "text-ok"}`}>{!p.inStock ? "Out of stock" : p.lowStock ? `Only ${p.stock} left` : "In stock"}</p>

          <div className="mt-6 flex flex-wrap items-center gap-3">
            {p.inStock && max > 0 && <QuantityStepper value={qty} max={max} label={p.name} onChange={(n) => setQty(Math.max(1, Math.min(n, max)))} />}
            <button className="btn-add-solid flex-1 px-8 py-3 sm:flex-none" disabled={!p.inStock || max === 0}
              onClick={() => { cart.add(p.id, qty, p.stock); toast.success(`${qty} × ${p.name} added to cart`); setQty(1); }}>
              <ShoppingBag className="h-4 w-4" aria-hidden /> {!p.inStock ? "Out of stock" : max === 0 ? "Max quantity in cart" : "Add to cart"}
            </button>
            <button aria-pressed={wished} aria-label={wished ? "Remove from wishlist" : "Add to wishlist"} onClick={() => toast.success(wish.toggle(p.id) ? "Saved to wishlist" : "Removed from wishlist")} className="grid h-11 w-11 place-items-center rounded-full border border-line hover:border-accent">
              <Heart className={`h-5 w-5 ${wished ? "fill-danger text-danger" : ""}`} aria-hidden />
            </button>
          </div>
          {inCart > 0 && <p className="mt-2 text-sm text-muted">{inCart} in your cart · <Link to="/cart" className="font-semibold underline">View cart</Link></p>}

          <div className="card mt-6 flex items-start gap-3 p-4">
            <Clock className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
            <div className="text-sm">
              {delivery?.serviceable ? <><p className="font-bold">Delivery to {delivery.areaName} ({delivery.pincode}) in about {delivery.etaMinutes} min</p><p className="text-muted">An estimate only; it can vary with demand.</p></>
                : delivery ? <p className="font-bold">We don&apos;t deliver to {delivery.pincode} yet.</p>
                : <p className="font-bold">Check delivery time for your area</p>}
              <button onClick={openModal} className="mt-1 inline-flex items-center gap-1 font-semibold underline underline-offset-2"><MapPin className="h-3.5 w-3.5" aria-hidden />{delivery ? "Change PIN code" : "Enter PIN code"}</button>
            </div>
          </div>

          <section className="mt-6 sm:mt-8" aria-labelledby="desc-h">
            <h2 id="desc-h" className="text-lg font-bold">About this product</h2>
            <p className="mt-2 text-ink-soft">{p.description || "No description available."}</p>
            {p.details && <><h3 className="mt-5 text-sm font-bold uppercase tracking-wide text-muted">Ingredients &amp; details</h3><p className="mt-1 text-ink-soft">{p.details}</p></>}
          </section>

          <details className="group mt-6 sm:mt-8" open aria-labelledby="spec-h">
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between">
              <h2 id="spec-h" className="text-lg font-bold">Product details</h2>
              <ChevronDown className="h-5 w-5 transition group-open:rotate-180" aria-hidden />
            </summary>
            <dl className="mt-3 divide-y divide-line overflow-hidden rounded-xl border border-line text-sm">
              {([
                ["Brand", p.brand ?? "Unbranded"],
                ["Category", p.category?.name],
                ["Pack size", p.packSize],
                ["SKU", p.sku],
                ["Availability", p.inStock ? (p.lowStock ? `Only ${p.stock} left` : "In stock") : "Out of stock"],
                ["Price", p.priceStatus === "VERIFIED" ? "Verified" : "Development sample (unverified)"],
              ] as [string, string | null | undefined][]).filter(([, v]) => v).map(([k, v]) => (
                <div key={k} className="grid grid-cols-[8.5rem_1fr] gap-3 bg-surface px-4 py-2.5"><dt className="text-muted">{k}</dt><dd className="font-semibold">{v}</dd></div>
              ))}
            </dl>
            {!p.details && <p className="mt-2 text-xs text-muted">Ingredients and nutrition are shown only when taken from the product&apos;s own label. They have not been verified for this item yet.</p>}
          </details>
          {p.images[0]?.isPlaceholder && (
            <p className="mt-6 rounded-lg bg-band p-3 text-xs text-muted">
              {p.images[0].url.includes("coming-soon") ? "Product photo coming soon." : "Representative photo, not necessarily the exact product."} Pack details may differ.
              {p.images[0].attribution && p.images[0].sourceUrl ? <> Photo: <a href={p.images[0].sourceUrl} target="_blank" rel="noreferrer" className="underline">{p.images[0].attribution}</a> · {p.images[0].license}</> : null}
            </p>
          )}
        </div>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 shadow-lift backdrop-blur md:hidden" data-testid="mobile-buy-bar">
        <div className="container-x flex items-center gap-3 py-2.5">
          <Link to="/cart" className="min-w-0 flex-1 text-xs leading-tight" aria-label={`View cart, ${cart.count} item${cart.count === 1 ? "" : "s"}`}>
            {cart.count > 0
              ? <><span className="block font-bold">{cart.count} item{cart.count === 1 ? "" : "s"} in cart</span><span className="block text-muted">{cart.quote ? `Subtotal ${formatMoney(cart.quote.totals.subtotalMinor)}` : "View cart"}</span></>
              : <><span className="block font-extrabold text-accent text-base">{formatMoney(p.priceMinor)}</span><span className="block text-muted">{p.packSize}</span></>}
          </Link>
          <button className="btn-add-solid shrink-0 px-6" disabled={!p.inStock || max === 0}
            onClick={() => { cart.add(p.id, qty, p.stock); toast.success(`${qty} × ${p.name} added to cart`); setQty(1); }}>
            <ShoppingBag className="h-4 w-4" aria-hidden /> {!p.inStock ? "Out of stock" : max === 0 ? "Max in cart" : "Add"}
          </button>
        </div>
      </div>

      {data.related.length > 0 && (
        <section className="mt-16" aria-labelledby="rel-h"><h2 id="rel-h" className="mb-6 text-2xl font-extrabold">You may also like</h2><ProductGrid products={data.related} /></section>
      )}
    </div>
  );
}
