import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, ArrowUpRight, Boxes, Citrus, CupSoda, Droplet, MapPin, Martini, Package, Pipette, Plus, Sparkles, Truck, UtensilsCrossed, type LucideIcon } from "lucide-react";
import { api } from "../lib/api";
import type { Bundle, Category, Product } from "../lib/types";
import { useLocationCtx } from "../context/LocationContext";
import { useCart } from "../context/CartContext";
import { useToast } from "../context/ToastContext";
import { cleanPin, pincodeError } from "../lib/pincode";
import { formatMoney } from "../lib/format";
import { deliveryFeeText, useAppConfig } from "../lib/useAppConfig";
import { ErrorState, ProductGridSkeleton, Skeleton, useAsync } from "../components/ui";
import { ProductGrid } from "../components/ProductCard";
import { BundleGrid } from "./Bundles";

const eyebrow = "text-[10px] font-semibold uppercase tracking-[0.16em] text-muted";

/** Section with the design's small eyebrow, script heading and optional link on the right. `label` is the region name. */
function Section({ label, eyebrowText, title, plainTitle, to, toLabel, className = "", children }: { label: string; eyebrowText?: string; title: string; plainTitle?: boolean; to?: string; toLabel?: string; className?: string; children: ReactNode }) {
  return (
    <section className={`py-8 sm:py-12 ${className}`} aria-label={label}>
      <div className="container-x">
        <div className="mb-5 flex items-end justify-between gap-4 sm:mb-7">
          <div>
            {eyebrowText && <p className={eyebrow}>{eyebrowText}</p>}
            <h2 className={plainTitle ? "mt-1 text-base font-bold sm:text-lg" : "font-script mt-1 text-3xl leading-tight sm:text-4xl"}>{title}</h2>
          </div>
          {to && <Link to={to} className="inline-flex shrink-0 items-center gap-1 text-xs font-bold hover:underline sm:text-sm">{toLabel ?? "Shop all"} <ArrowUpRight className="h-4 w-4" aria-hidden /></Link>}
        </div>
        {children}
      </div>
    </section>
  );
}

/** PIN entry. It reuses the same lookup as the header dialog (loc.setPincode → /pincode/:pin), so the answer is the real coverage data. */
function PinForm({ idPrefix, label, buttonLabel, tone }: { idPrefix: string; label: string; buttonLabel: string; tone: "hero" | "cta" }) {
  const loc = useLocationCtx();
  const cfg = useAppConfig();
  const [pin, setPin] = useState(loc.pincode ?? "");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const bad = pincodeError(pin);
    if (bad) return setErr(bad);
    setErr(null); setBusy(true);
    try { await loc.setPincode(pin); } catch { /* shown through loc.status below */ } finally { setBusy(false); }
  };
  const d = loc.delivery;
  const answer = busy || loc.status === "checking" ? "Checking…"
    : loc.status === "error" ? "Unable to verify delivery. Please try again."
    : d?.serviceable ? `Delivering to ${d.areaName} in about ${d.etaMinutes} min (an estimate).`
    : d ? (d.reason === "paused" ? `Delivery to ${d.pincode} is temporarily paused.` : "Sorry, delivery is not available in this area.")
    : null;
  const fee = deliveryFeeText(cfg, formatMoney);
  const msg = err ?? answer;
  const hero = tone === "hero";
  return (
    <div className={hero ? "mt-6 max-w-lg" : "w-full max-w-lg"}>
      <form onSubmit={submit} noValidate className="flex items-stretch gap-2 rounded-2xl bg-surface p-1.5 shadow-sm ring-1 ring-line" aria-label="Check delivery">
        <label htmlFor={`${idPrefix}-pin`} className="sr-only">{label}</label>
        <div className="relative min-w-0 flex-1">
          <MapPin className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
          <input id={`${idPrefix}-pin`} className="h-full min-h-11 w-full rounded-xl bg-transparent pl-9 pr-2 text-sm text-ink placeholder:text-muted focus:outline-none" inputMode="numeric" autoComplete="postal-code" maxLength={6} placeholder="Enter PIN code" value={pin} aria-invalid={!!err}
            aria-describedby={`${idPrefix}-pin-msg`} onChange={(e) => { setPin(cleanPin(e.target.value)); setErr(null); }} />
        </div>
        <button className="shrink-0 rounded-xl bg-[#1c0f08] px-4 text-sm font-bold text-[#f8f5ed] transition hover:opacity-90 disabled:opacity-60" disabled={busy} aria-label={hero ? undefined : "Check availability for your delivery area"}>{buttonLabel}</button>
      </form>
      {hero
        ? <p id={`${idPrefix}-pin-msg`} role="status" className="mt-2 min-h-5 text-sm font-semibold">{msg}</p>
        : <p id={`${idPrefix}-pin-msg`} aria-live="polite" className="mt-2 min-h-5 text-sm font-semibold">{msg}</p>}
      {fee && hero && <p className="text-xs opacity-80">{fee}</p>}
      <p className="mt-1 text-[11px] text-muted">Delivery availability and timing depend on your PIN and demand.</p>
    </div>
  );
}

const ICONS: Record<string, LucideIcon> = {
  "ice-bags": Package, "tonic-water": CupSoda, "club-soda": Droplet, "margarita-mixes": Martini,
  bitters: Pipette, "citrus-garnishes": Citrus, "party-bundles": Boxes, "party-essentials": UtensilsCrossed,
};

/** Best-sellers filters: each one is a set of the store's own category slugs, so the filter never invents products. */
const FILTERS: { label: string; slugs?: string[] }[] = [
  { label: "Best sellers" },
  { label: "Ice & chill", slugs: ["ice-bags"] },
  { label: "Mixers", slugs: ["tonic-water", "club-soda", "margarita-mixes"] },
  { label: "Finishing touches", slugs: ["bitters", "citrus-garnishes", "party-essentials"] },
];

/** The ice-bag panel: the first two ice products from the catalogue, never made-up ones. Hidden when the catalogue has none. */
function IceFeature({ products }: { products: Product[] }) {
  const cart = useCart();
  const toast = useToast();
  const ice = products.filter((p) => p.category?.slug === "ice-bags" && p.inStock).slice(0, 2);
  if (ice.length === 0) return null;
  return (
    <section className="container-x py-6 sm:py-10" aria-label="Ice bags">
      <div className="grid overflow-hidden rounded-[28px] bg-feature text-on-feature shadow-lift md:grid-cols-[minmax(0,0.9fr)_minmax(0,1.5fr)]">
        <div className="relative h-48 md:h-auto">
          <img src="/img/stock/ice-bucket.jpg" alt="" aria-hidden loading="lazy" width={640} height={480} className="absolute inset-0 h-full w-full object-cover" />
        </div>
        <div className="p-6 sm:p-9 md:py-10">
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] opacity-70">The foundation of every pour</p>
          <h2 className="font-script mt-1 text-3xl sm:text-4xl">Keep the good times cold.</h2>
          <p className="mt-3 max-w-md text-sm opacity-80">A quiet night in or a house full of friends. Pick the ice bag that belongs on your guest list.</p>
          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            {ice.map((p) => (
              <div key={p.id} className="rounded-2xl bg-feature-card p-4 text-on-feature-card">
                <p className="text-xs opacity-70">{p.brand ?? "Ice"}</p>
                <p className="mt-0.5 text-sm font-semibold">{p.name} · {p.packSize}</p>
                <div className="mt-4 flex items-center justify-between">
                  <span className="text-lg font-extrabold">{formatMoney(p.priceMinor)}</span>
                  <button className="btn-add" aria-label={`Add ${p.name} to cart from the ice feature`} onClick={() => { cart.add(p.id, 1, p.stock); toast.success(`${p.name} added to cart`); }}>Add +</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

const EXTRAS: { slug: string; name: string; text: string }[] = [
  { slug: "citrus-garnishes", name: "Citrus garnishes", text: "Lime wheels, orange slices and a final flourish." },
  { slug: "bitters", name: "Bitters", text: "Small drops. A whole new dimension." },
  { slug: "party-essentials", name: "Party essentials", text: "The practical little things that make hosting easier." },
];

const FAQS: [string, string][] = [
  ["Do you deliver to my area?", "Enter your PIN code to check delivery availability. Service and timing depend on your location and current demand."],
  ["How soon can my order arrive?", "Delivery timing is shown once you enter your PIN code. It is an estimate, not a guarantee."],
  ["Are these alcoholic products?", "No. We stock non-alcoholic essentials: ice, mixers, garnishes and finishing touches."],
  ["How should I store the ice?", "Keep it in the freezer or an insulated cooler until you are ready to pour."],
  ["Can I see what's in a bundle?", "Yes. Every bundle lists exactly what is inside before you add it to your cart."],
];

export default function Home() {
  const cats = useAsync(() => api.get<{ categories: Category[] }>("/categories").then((r) => r.data.categories), []);
  // Best sellers are ranked by the catalogue's own popularity score. A failure is shown, with a retry, never hidden.
  const best = useAsync(() => api.get<{ products: Product[] }>("/products", { params: { sort: "popular", pageSize: 24 } }).then((r) => r.data.products), []);
  const bundles = useAsync(() => api.get<{ bundles: Bundle[] }>("/bundles").then((r) => r.data.bundles.slice(0, 4)), []);
  const [filter, setFilter] = useState(0);
  const shown = useMemo(() => {
    const slugs = FILTERS[filter].slugs;
    const all = best.data ?? [];
    return (slugs ? all.filter((p) => p.category && slugs.includes(p.category.slug)) : all).slice(0, 8);
  }, [best.data, filter]);

  return (
    <>
      <section className="container-x pt-5 sm:pt-6">
        <div className="grid overflow-hidden rounded-[28px] bg-hero-panel shadow-lift md:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)]">
          <div className="p-6 sm:p-10">
            <p className={eyebrow}>The host&apos;s essentials, delivered</p>
            <h1 className="font-script mt-3 text-5xl leading-[1.05] sm:text-6xl">A good evening starts with ice.</h1>
            <p className="mt-4 max-w-sm text-sm text-muted">Ice, mixers and the finishing touches. All the ingredients for your kind of gathering.</p>
            <PinForm idPrefix="hero" label="PIN code" buttonLabel="Check availability" tone="hero" />
            <Link to="/shop" className="btn-add-solid mt-5 !px-6">Shop the essentials <ArrowRight className="h-4 w-4" aria-hidden /></Link>
          </div>
          <img src="/img/hero-ice.jpg" alt="" aria-hidden width={1400} height={934} fetchPriority="high" className="hidden h-full min-h-[22rem] w-full object-cover md:block" />
        </div>
      </section>

      <Section label="Shop by category" title="What's on the menu?" plainTitle>
        {cats.loading ? <div className="grid grid-cols-4 gap-2 sm:gap-3 lg:grid-cols-8">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-20 sm:h-24" />)}</div>
          : cats.error ? <ErrorState message={cats.error} onRetry={cats.reload} />
          : <ul className="grid grid-cols-4 gap-2 sm:gap-3 lg:grid-cols-8">
            {(cats.data ?? []).map((c) => {
              const Icon = ICONS[c.slug] ?? Sparkles;
              return (
                <li key={c.id}>
                  <Link to={`/category/${c.slug}`} className="group flex h-full min-h-20 flex-col items-center justify-center gap-2 rounded-2xl bg-tile px-1 py-3 text-center ring-1 ring-line transition hover:-translate-y-0.5 hover:shadow-lift sm:min-h-24">
                    <Icon className="h-5 w-5 text-ink-soft transition group-hover:text-ink sm:h-6 sm:w-6" aria-hidden />
                    <span className="text-[11px] font-semibold leading-tight sm:text-xs">{c.name}</span>
                    {c.productCount === 0 && <span className="sr-only">Coming soon</span>}
                  </Link>
                </li>
              );
            })}
          </ul>}
      </Section>

      <Section label="Best sellers" eyebrowText="The every-gathering edit" title="Stock the good stuff." to="/shop?sort=popular" className="!pt-2">
        <div className="mb-5 flex flex-wrap gap-2" role="group" aria-label="Filter best sellers">
          {FILTERS.map((f, i) => (
            <button key={f.label} type="button" aria-pressed={filter === i} onClick={() => setFilter(i)}
              className={`rounded-full border px-3.5 py-1 text-xs font-semibold transition ${filter === i ? "border-ink bg-ink text-canvas" : "border-line hover:border-ink/50"}`}>{f.label}</button>
          ))}
        </div>
        {best.loading ? <ProductGridSkeleton count={4} /> : best.error ? <ErrorState message={`Best sellers couldn't be loaded: ${best.error}`} onRetry={best.reload} />
          : (best.data ?? []).length === 0 ? <p className="card p-8 text-center text-muted">No products are listed yet.</p>
          : shown.length === 0 ? <p className="card p-8 text-center text-muted">Nothing in this group right now.</p> : <ProductGrid products={shown} />}
      </Section>

      <Section label="Party bundles" eyebrowText="Less planning, more pouring" title="Good company. Great combinations." to="/category/party-bundles" toLabel="Explore bundles" className="bg-band">
        {bundles.loading ? <ProductGridSkeleton count={2} /> : bundles.error ? <ErrorState message={bundles.error} onRetry={bundles.reload} /> : <BundleGrid bundles={bundles.data ?? []} />}
      </Section>

      <IceFeature products={best.data ?? []} />

      <section className="container-x py-8 sm:py-12" aria-label="Finishing touches">
        <div className="grid items-center gap-8 md:grid-cols-[minmax(0,0.8fr)_minmax(0,1.3fr)_minmax(0,1fr)] md:gap-10">
          <div>
            <p className={eyebrow}>The little extras</p>
            <h2 className="font-script mt-1 text-3xl leading-tight sm:text-4xl">Finish with a flourish.</h2>
            <p className="mt-3 max-w-xs text-sm text-muted">The twist, the garnish, the perfectly placed straw. Make the last detail count.</p>
          </div>
          <ul className="divide-y divide-line border-y border-line">
            {EXTRAS.map((x) => (
              <li key={x.slug}>
                <Link to={`/category/${x.slug}`} className="flex items-center justify-between gap-4 py-4 hover:opacity-80">
                  <span><span className="block text-sm font-bold">{x.name}</span><span className="block text-xs text-muted">{x.text}</span></span>
                  <ArrowUpRight className="h-4 w-4 shrink-0" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
          <img src="/img/stock/bitters-glass-bottles.jpg" alt="" aria-hidden loading="lazy" width={640} height={420} className="hidden h-56 w-full rounded-2xl object-cover md:block" />
        </div>
      </section>

      <section className="bg-strip py-8 sm:py-11" id="how-it-works" aria-label="How it works">
        <div className="container-x">
          <p className={eyebrow}>From your list to your door</p>
          <h2 className="font-script mt-1 text-3xl leading-tight sm:text-4xl">A few steps to a well-stocked evening.</h2>
          <ol className="mt-6 grid gap-5 sm:grid-cols-3 sm:gap-10">
            {([
              [MapPin, "01 / Start with your PIN", "Check whether delivery is available at your location."],
              [Package, "02 / Build your gathering", "Choose your ice, mixers and all the little extras."],
              [Truck, "03 / Check, then check out", "Review availability, delivery timing and charges before ordering."],
            ] as [LucideIcon, string, string][]).map(([I, t, d]) => (
              <li key={t} className="flex items-start gap-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-surface ring-1 ring-line"><I className="h-4 w-4" aria-hidden /></span>
                <span><span className="block text-sm font-bold">{t}</span><span className="mt-0.5 block text-xs text-muted">{d}</span></span>
              </li>
            ))}
          </ol>
          <p className="mt-6 text-[11px] text-muted">Delivery timing depends on location, product availability and demand.</p>
        </div>
      </section>

      <section className="container-x py-10 sm:py-14" aria-label="Questions">
        <div className="grid gap-8 md:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)] md:gap-24">
          <div>
            <p className={eyebrow}>A few useful details</p>
            <h2 className="font-script mt-1 text-3xl leading-tight sm:text-4xl">Before the first pour.</h2>
            <p className="mt-3 max-w-xs text-sm text-muted">Non-alcoholic essentials. Straightforward answers. A little less to think about.</p>
            <Link to="/policy/delivery" className="mt-5 inline-flex items-center gap-1 text-sm font-bold hover:underline">Visit help centre <ArrowUpRight className="h-4 w-4" aria-hidden /></Link>
          </div>
          <div className="divide-y divide-line border-y border-line">
            {FAQS.map(([q, a], i) => (
              <details key={q} className="group py-4" open={i === 0}>
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-sm font-bold"><span>{q}</span><Plus className="h-4 w-4 shrink-0 transition group-open:rotate-45" aria-hidden /></summary>
                <p className="mt-2 max-w-xl text-sm text-muted">{a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-cta py-9 sm:py-11" aria-label="Check your delivery area">
        <div className="container-x grid items-center gap-6 md:grid-cols-2 md:gap-16">
          <div>
            <p className={eyebrow}>Your next gathering starts here</p>
            <h2 className="font-script mt-1 text-3xl leading-tight sm:text-4xl">Let&apos;s get your place stocked.</h2>
            <p className="mt-2 text-sm text-muted">Start with your PIN. We&apos;ll take it from there.</p>
          </div>
          <PinForm idPrefix="cta" label="Delivery PIN code" buttonLabel="Check availability" tone="cta" />
        </div>
      </section>
    </>
  );
}
