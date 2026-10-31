import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Clock, MapPin, Snowflake, Sparkles } from "lucide-react";
import { api } from "../lib/api";
import type { Bundle, Category, Product } from "../lib/types";
import { useLocationCtx } from "../context/LocationContext";
import { cleanPin, pincodeError } from "../lib/pincode";
import { formatMoney } from "../lib/format";
import { deliveryFeeText, useAppConfig } from "../lib/useAppConfig";
import { CoverImage, ErrorState, ProductGridSkeleton, Skeleton, useAsync } from "../components/ui";
import { ProductGrid } from "../components/ProductCard";
import { BundleGrid } from "./Bundles";

function Section({ title, to, children }: { title: string; to?: string; children: React.ReactNode }) {
  return (
    <section className="container-x mt-8 sm:mt-12" aria-label={title}>
      <div className="mb-3 flex sm:mb-5 items-end justify-between gap-4">
        <h2 className="text-xl font-extrabold sm:text-3xl">{title}</h2>
        {to && <Link to={to} className="inline-flex items-center gap-1 text-sm font-semibold text-accent hover:underline">View all <ArrowRight className="h-4 w-4" aria-hidden /></Link>}
      </div>
      {children}
    </section>
  );
}

/** PIN entry in the hero. It reuses the same lookup as the header dialog (loc.setPincode → /pincode/:pin), so the answer is the real coverage data. */
function HeroPin() {
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
  return (
    <div className="mt-5 max-w-md">
      <form onSubmit={submit} noValidate className="flex gap-2" aria-label="Check delivery">
        <label htmlFor="hero-pin" className="sr-only">PIN code</label>
        <div className="relative flex-1">
          <MapPin className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
          <input id="hero-pin" className="input !rounded-full pl-9" inputMode="numeric" autoComplete="postal-code" maxLength={6} placeholder="Enter PIN code" value={pin} aria-invalid={!!err} aria-describedby="hero-pin-msg"
            onChange={(e) => { setPin(cleanPin(e.target.value)); setErr(null); }} />
        </div>
        <button className="btn-add-solid shrink-0 px-5" disabled={busy}>Check</button>
      </form>
      <p id="hero-pin-msg" role="status" className="mt-2 min-h-5 text-sm font-semibold">{err ?? answer}</p>
      {fee && <p className="text-xs opacity-80">{fee}</p>}
    </div>
  );
}

export default function Home() {
  const loc = useLocationCtx();
  const cats = useAsync(() => api.get<{ categories: Category[] }>("/categories").then((r) => r.data.categories), []);
  // Best sellers are ranked by the catalogue's own popularity score. A failure is shown, with a retry, never hidden.
  const best = useAsync(() => api.get<{ products: Product[] }>("/products", { params: { sort: "popular", pageSize: 8 } }).then((r) => r.data.products), []);
  const bundles = useAsync(() => api.get<{ bundles: Bundle[] }>("/bundles").then((r) => r.data.bundles.slice(0, 4)), []);

  return (
    <>
      <section className="relative isolate overflow-hidden bg-header text-on-header">
        <img src="/img/hero-ice.jpg" alt="" aria-hidden width={1400} height={934} fetchPriority="high" className="absolute inset-0 -z-10 h-full w-full object-cover opacity-40" />
        <div className="absolute inset-0 -z-10 bg-gradient-to-r from-header via-header/80 to-transparent" />
        <div className="container-x py-7 sm:py-14">
          <p className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-bold uppercase tracking-widest text-badge"><Snowflake className="h-3.5 w-3.5" aria-hidden /> Ice &amp; cocktail mixers</p>
          <h1 className="mt-3 max-w-3xl text-3xl font-extrabold leading-tight sm:text-5xl">Party Ice &amp; Mixers, Delivered Fast.</h1>
          <p className="mt-2 max-w-xl text-sm opacity-90 sm:text-base">Food-grade party ice, craft tonic, club sodas, margarita mixes, bitters and citrus garnishes.</p>
          <HeroPin />
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Link to="/shop" className="btn-add-solid px-6">Shop now <ArrowRight className="h-4 w-4" aria-hidden /></Link>
            <button onClick={loc.openModal} className="hidden min-h-11 items-center gap-2 rounded-full border border-white/30 px-5 sm:inline-flex text-sm font-semibold hover:bg-white/10"><Clock className="h-4 w-4" aria-hidden />{loc.delivery?.serviceable ? `About ${loc.delivery.etaMinutes} min to ${loc.delivery.pincode}` : "Check delivery time"}</button>
          </div>
          <p className="mt-3 max-w-xl text-xs opacity-70">Our goal is about 10-minute delivery where we can. Actual times depend on your area and demand, and are shown once you enter your PIN code.</p>
        </div>
      </section>

      <Section title="Shop by category">
        {cats.loading ? <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 sm:gap-4">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-24 sm:h-32" />)}</div>
          : cats.error ? <ErrorState message={cats.error} onRetry={cats.reload} />
          : <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 sm:gap-4">
            {(cats.data ?? []).map((c) => (
              <li key={c.id}>
                <Link to={`/category/${c.slug}`} className="card group relative block aspect-[5/4] overflow-hidden bg-header transition hover:shadow-lift sm:aspect-[16/10]">
                  <CoverImage src={c.imageUrl} width={640} height={400} className="transition duration-300 group-hover:scale-105" />
                  <span className="relative flex h-full flex-col justify-end bg-gradient-to-t from-black/60 to-transparent p-2 text-white sm:p-3"><span className="font-display text-[13px] font-bold leading-tight drop-shadow sm:text-lg">{c.name}</span><span className="hidden text-xs opacity-90 sm:inline">{c.productCount > 0 ? `${c.productCount} item${c.productCount === 1 ? "" : "s"}` : "Coming soon"}</span></span>
                </Link>
              </li>
            ))}
          </ul>}
      </Section>

      <Section title="Best sellers" to="/shop?sort=popular">
        {best.loading ? <ProductGridSkeleton count={4} /> : best.error ? <ErrorState message={`Best sellers couldn't be loaded: ${best.error}`} onRetry={best.reload} />
          : (best.data ?? []).length === 0 ? <p className="card p-8 text-center text-muted">No products are listed yet.</p> : <ProductGrid products={best.data ?? []} />}
      </Section>

      <Section title="Party bundles" to="/category/party-bundles">
        {bundles.loading ? <ProductGridSkeleton count={2} /> : bundles.error ? <ErrorState message={bundles.error} onRetry={bundles.reload} /> : <BundleGrid bundles={bundles.data ?? []} />}
      </Section>

      <section className="container-x mt-10 grid gap-3 sm:mt-14 sm:grid-cols-3 sm:gap-4" aria-label="How it works">
        {[
          [Sparkles, "Pick your mixers", "Ice, tonic, soda, bitters and garnishes: the non-alcoholic essentials for a great night."],
          [Clock, "Check your PIN code", "We tell you honestly if we deliver to you and roughly how long it takes."],
          [Snowflake, "Stays cold", "Ice and chilled mixers are packed to arrive ready to pour."],
        ].map(([Icon, t, d]) => {
          const I = Icon as typeof Clock;
          return <div key={t as string} className="card p-5"><I className="h-6 w-6 text-accent" aria-hidden /><h3 className="mt-3 font-bold">{t as string}</h3><p className="mt-1 text-sm text-muted">{d as string}</p></div>;
        })}
      </section>
    </>
  );
}
