import { Link } from "react-router-dom";
import { ArrowRight, Clock, Snowflake, Sparkles } from "lucide-react";
import { api } from "../lib/api";
import type { Bundle, Category, Product } from "../lib/types";
import { useLocationCtx } from "../context/LocationContext";
import { CoverImage, ErrorState, ProductGridSkeleton, Skeleton, useAsync } from "../components/ui";
import { ProductGrid } from "../components/ProductCard";
import { BundleGrid } from "./Bundles";

function Section({ title, to, children }: { title: string; to?: string; children: React.ReactNode }) {
  return (
    <section className="container-x mt-14" aria-label={title}>
      <div className="mb-5 flex items-end justify-between gap-4">
        <h2 className="text-2xl font-extrabold sm:text-3xl">{title}</h2>
        {to && <Link to={to} className="inline-flex items-center gap-1 text-sm font-semibold text-accent hover:underline">View all <ArrowRight className="h-4 w-4" aria-hidden /></Link>}
      </div>
      {children}
    </section>
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
        <div className="container-x py-16 sm:py-24">
          <p className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-bold uppercase tracking-widest text-badge"><Snowflake className="h-3.5 w-3.5" aria-hidden /> Ice &amp; cocktail mixers</p>
          <h1 className="mt-4 max-w-2xl text-4xl font-extrabold leading-tight sm:text-6xl">Everything cold, clear and ready for the party.</h1>
          <p className="mt-4 max-w-xl text-lg opacity-90">Food-grade party ice, craft tonic, flavoured club sodas, margarita mixes, bitters and dehydrated citrus garnishes, delivered fast.</p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link to="/shop" className="btn-add-solid px-7 py-3 text-base">Shop now <ArrowRight className="h-4 w-4" aria-hidden /></Link>
            <button onClick={loc.openModal} className="inline-flex min-h-11 items-center gap-2 rounded-full border border-white/30 px-5 text-sm font-semibold hover:bg-white/10"><Clock className="h-4 w-4" aria-hidden />{loc.delivery?.serviceable ? `About ${loc.delivery.etaMinutes} min to ${loc.delivery.pincode}` : "Check delivery time"}</button>
          </div>
          <p className="mt-4 max-w-xl text-xs opacity-70">Our goal is about 10-minute delivery where we can. Actual times depend on your area and demand, and are shown once you enter your PIN code.</p>
        </div>
      </section>

      <Section title="Shop by category">
        {cats.loading ? <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-32" />)}</div>
          : cats.error ? <ErrorState message={cats.error} onRetry={cats.reload} />
          : <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
            {(cats.data ?? []).map((c) => (
              <li key={c.id}>
                <Link to={`/category/${c.slug}`} className="card group relative block aspect-[4/3] overflow-hidden bg-header sm:aspect-[16/10]">
                  <CoverImage src={c.imageUrl} width={640} height={400} className="transition duration-300 group-hover:scale-105" />
                  <span className="relative flex h-full flex-col justify-end p-3 text-white"><span className="font-display text-lg font-bold leading-tight drop-shadow">{c.name}</span><span className="text-xs opacity-90">{c.productCount > 0 ? `${c.productCount} item${c.productCount === 1 ? "" : "s"}` : "Coming soon"}</span></span>
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

      <section className="container-x mt-14 grid gap-4 sm:grid-cols-3" aria-label="How it works">
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
