import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { LayoutDashboard, LogOut, MapPin, Moon, Package, ShoppingBag, Sun, User as UserIcon, X } from "lucide-react";
import { api } from "../lib/api";
import type { Category } from "../lib/types";
import { cleanPin, pincodeError } from "../lib/pincode";
import { useAuth } from "../context/AuthContext";
import { useCart } from "../context/CartContext";
import { useLocationCtx } from "../context/LocationContext";
import { useTheme } from "../context/ThemeContext";
import { CategoryNav } from "./CategoryNav";
import { SearchBar } from "./SearchBar";
import { ErrorBoundary, FieldError, Logo, useAsync } from "./ui";
import { PinFeedback } from "./DeliveryInfo";
import { VoiceAssistant } from "./VoiceAssistant";

/** Slim announcement bar. It shows the brand line until a PIN code is checked, then the honest delivery estimate. Never rendered inside admin routes. */
function DeliveryBanner() {
  const loc = useLocationCtx();
  let text: ReactNode;
  if (loc.status === "checking") text = "Checking delivery…";
  else if (loc.delivery?.serviceable) text = <>Delivering to <b>{loc.delivery.areaName}</b> ({loc.delivery.pincode}) in about <b>{loc.delivery.etaMinutes} min</b> <span className="opacity-75">· an estimate, not a guarantee</span></>;
  else if (loc.status === "unavailable") text = <>Sorry, delivery is not available in this area (<b>{loc.pincode}</b>).</>;
  else if (loc.status === "error") text = <>Unable to verify delivery. Please try again. <button className="underline" onClick={() => loc.retry()}>Retry</button></>;
  else text = <span className="font-semibold uppercase tracking-[0.14em]">Good ice. Great mixers. Better gatherings.</span>;
  return (
    <div className="bg-topbar text-on-topbar" data-testid="delivery-banner">
      <p className="container-x py-1.5 text-center text-[11px] sm:text-xs">{text}</p>
    </div>
  );
}

function LocationModal() {
  const loc = useLocationCtx();
  const [pin, setPin] = useState(loc.pincode ?? "");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { if (loc.modalOpen) { setPin(loc.pincode ?? ""); setErr(null); setTimeout(() => input.current?.focus(), 30); } }, [loc.modalOpen, loc.pincode]);
  useEffect(() => {
    if (!loc.modalOpen) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && loc.closeModal();
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [loc]);

  const run = async (p: string) => {
    setBusy(true); setErr(null);
    try { await loc.setPincode(p); } catch { /* the failure is shown through loc.status / loc.error */ } finally { setBusy(false); }
  };
  // Look up automatically once six valid digits are entered (short debounce); older requests are ignored by the context.
  useEffect(() => {
    if (!loc.modalOpen || pincodeError(pin) || pin === loc.pincode) return;
    const t = setTimeout(() => run(pin), 400);
    return () => clearTimeout(t);
  }, [pin, loc.modalOpen]); // eslint-disable-line react-hooks/exhaustive-deps
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const bad = pincodeError(pin);
    if (bad) return setErr(bad);
    await run(pin);
  };
  // Hooks must all run before this point: the modal renders nothing while closed.
  const complete = pin.length === 6 && !pincodeError(pin);
  const done = complete && loc.pincode === pin && (loc.status === "serviceable" || loc.status === "unavailable");
  const feedbackStatus = !complete ? "idle" : loc.status === "error" && !busy ? "error" : done ? "done" : "looking"; // a pending debounce also counts as looking
  if (!loc.modalOpen) return null;

  return (
    <div className="fixed inset-0 z-[70] grid place-items-end bg-scrim/60 sm:place-items-center" onMouseDown={(e) => e.target === e.currentTarget && loc.closeModal()}>
      <div role="dialog" aria-modal="true" aria-labelledby="loc-h" className="rise card w-full max-w-md rounded-b-none p-6 sm:rounded-b-[1.25rem]">
        <div className="flex items-start justify-between"><h2 id="loc-h" className="text-xl font-extrabold">Where should we deliver?</h2><button aria-label="Close" onClick={loc.closeModal} className="rounded-full p-2 hover:bg-tint"><X className="h-5 w-5" /></button></div>
        <p className="mt-1 text-sm text-muted">Enter your 6-digit PIN code. We&apos;ll look up the area and check whether we really deliver there.</p>
        <form onSubmit={submit} className="mt-4" noValidate>
          <label htmlFor="loc-pin" className="label">PIN code</label>
          <div className="flex gap-2">
            <input id="loc-pin" ref={input} className="input" inputMode="numeric" autoComplete="postal-code" maxLength={6} value={pin} aria-invalid={!!err} aria-describedby="loc-err"
              onChange={(e) => { setPin(cleanPin(e.target.value)); setErr(null); }} placeholder="e.g. 122018" />
            <button className="btn-primary shrink-0" disabled={busy}>{busy ? "Checking…" : "Check"}</button>
          </div>
          <FieldError id="loc-err" message={err ?? undefined} />
        </form>
        <div className="mt-4" aria-live="polite">
          <PinFeedback status={feedbackStatus} postal={done ? loc.postal : null} delivery={done ? loc.delivery : null} error={loc.error} onRetry={() => run(pin)} />
        </div>
        {loc.delivery?.serviceable && <button className="btn-add-solid mt-4 w-full" onClick={loc.closeModal}>Continue shopping</button>}
      </div>
    </div>
  );
}

const iconBtn = "relative grid h-9 w-9 shrink-0 place-items-center rounded-full hover:bg-tint sm:h-10 sm:w-10";
const textBtn = "relative inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-sm font-semibold hover:bg-tint";
const compact = "max-sm:w-9 max-sm:justify-center max-sm:px-0";

/** Always-visible delivery control in the header: the saved PIN (and estimate when we deliver), or a plain "Enter PIN code". Opens the existing PIN dialog. */
function DeliverTo({ className = "" }: { className?: string }) {
  const loc = useLocationCtx();
  const eta = loc.delivery?.serviceable ? ` · ${loc.delivery.etaMinutes} min` : "";
  return (
    <button onClick={loc.openModal} data-testid="deliver-to" aria-label={loc.pincode ? `Deliver to ${loc.pincode}. Change PIN code` : "Enter PIN code to check delivery"}
      className={`${className} min-h-10 shrink-0 items-center gap-2 rounded-full px-1 text-left transition hover:opacity-80`}>
      <MapPin className="h-4 w-4 shrink-0 text-ink" aria-hidden />
      <span className="leading-tight">
        <span className="block text-[10px] font-semibold uppercase tracking-wider text-muted">Delivering to</span>
        <span className="block text-sm font-bold">{loc.pincode ? `${loc.pincode}${eta}` : "Enter PIN code"}</span>
      </span>
    </button>
  );
}

function Header({ admin }: { admin: boolean }) {
  const { user, logout } = useAuth();
  const { count } = useCart();
  const { theme, toggle } = useTheme();
  const nav = useNavigate();
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-header text-on-header">
      <div className="container-x flex items-center gap-3 py-3 sm:gap-6 sm:py-4">
        <div className="min-w-0 shrink-0"><Logo /></div>
        {!admin && <DeliverTo className="hidden md:inline-flex" />}
        {!admin && <div className="mx-2 hidden max-w-lg flex-1 md:block"><SearchBar /></div>}
        {admin && <span className="chip ml-2 bg-badge text-badge-ink">Admin</span>}
        <div className="ml-auto flex shrink-0 items-center gap-0.5 sm:gap-1">
          <button onClick={toggle} className={`${textBtn} ${compact}`} aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}>{theme === "dark" ? <Sun className="h-[18px] w-[18px]" aria-hidden /> : <Moon className="h-[18px] w-[18px]" aria-hidden />}<span className="hidden lg:inline" data-testid="theme-label">{theme === "dark" ? "Dark" : "Light"}</span></button>
          {user?.role === "ADMIN" && <Link to="/admin" className={iconBtn} aria-label="Admin dashboard"><LayoutDashboard className="h-5 w-5" aria-hidden /></Link>}
          {user ? (
            <>
              <Link to="/account" className={`${textBtn} ${compact}`} aria-label="My account"><UserIcon className="h-[18px] w-[18px]" aria-hidden /><span className="hidden lg:inline">Account</span></Link>
              <button className={iconBtn} aria-label="Log out" onClick={async () => { await logout(); nav("/"); }}><LogOut className="h-5 w-5" aria-hidden /></button>
            </>
          ) : <Link to="/login" className={textBtn}><UserIcon className="h-[18px] w-[18px]" aria-hidden /><span className="hidden sm:inline">Log in</span></Link>}
          {!admin && (
            <Link to="/orders" className={`${textBtn} ${compact}`} aria-label="My orders"><Package className="h-[18px] w-[18px]" aria-hidden /><span className="hidden lg:inline">My orders</span></Link>
          )}
          {!admin && (
            <Link to="/cart" className={`${textBtn} ${compact}`} aria-label={`Cart, ${count} item${count === 1 ? "" : "s"}`}>
              <ShoppingBag className="h-[18px] w-[18px]" aria-hidden />
              <span className="hidden sm:inline" aria-hidden>Cart ({count})</span>
              {count > 0 && <span className="absolute -right-0.5 -top-0.5 grid h-5 min-w-5 place-items-center rounded-full bg-badge px-1 text-[11px] font-extrabold text-badge-ink sm:hidden" aria-hidden>{count}</span>}
              <span className="sr-only" data-testid="cart-count">{count}</span>
            </Link>
          )}
        </div>
      </div>
      {!admin && <div className="container-x flex flex-col gap-2 pb-3 md:hidden"><DeliverTo className="inline-flex" /><SearchBar /></div>}
    </header>
  );
}

function Footer({ categories }: { categories?: Category[] | null }) {
  const shop = (categories ?? []).filter((c) => c.slug !== "party-bundles" && c.slug !== "party-essentials").slice(0, 6);
  const head = "mb-3 text-xs font-bold uppercase tracking-[0.14em] opacity-70";
  return (
    <footer className="bg-footer text-on-footer">
      <div className="container-x grid gap-8 py-10 text-sm sm:grid-cols-2 sm:py-12 lg:grid-cols-[1.4fr_1fr_1fr_1fr] lg:gap-16">
        <div><Logo /><p className="mt-4 max-w-xs text-sm opacity-80">Good ice. Great mixers. The little things that bring everyone together.</p><p className="mt-3 max-w-xs text-xs opacity-60">A non-alcoholic ice &amp; mixers store. Delivery times are estimates, not guarantees.</p></div>
        <div><h2 className={head}>Shop</h2><ul className="space-y-2 opacity-90">{shop.map((c) => <li key={c.id}><Link to={`/category/${c.slug}`} className="hover:underline">{c.name}</Link></li>)}</ul></div>
        <div><h2 className={head}>Gather</h2><ul className="space-y-2 opacity-90"><li><Link to="/category/party-bundles" className="hover:underline">Party bundles</Link></li><li><Link to="/category/party-essentials" className="hover:underline">Party essentials</Link></li><li><Link to="/shop" className="hover:underline">Shop all products</Link></li><li><Link to="/policy/delivery" className="hover:underline">How delivery works</Link></li></ul></div>
        <div><h2 className={head}>Good to know</h2><ul className="space-y-2 opacity-90"><li><Link to="/orders" className="hover:underline">My orders</Link></li><li><Link to="/policy/delivery" className="hover:underline">Delivery information</Link></li><li><Link to="/policy/returns" className="hover:underline">Returns &amp; refunds</Link></li><li><Link to="/policy/privacy" className="hover:underline">Privacy</Link></li><li><Link to="/policy/terms" className="hover:underline">Terms</Link></li></ul></div>
      </div>
      <div className="border-t border-white/15"><p className="container-x py-4 text-[11px] opacity-60">© {new Date().getFullYear()} Ice &amp; Mixers Express. Product photography is representative.</p></div>
    </footer>
  );
}

export function Layout() {
  const { pathname } = useLocation();
  const admin = pathname.startsWith("/admin");
  const cats = useAsync(() => api.get<{ categories: Category[] }>("/categories").then((r) => r.data.categories), []);
  useEffect(() => { window.scrollTo(0, 0); }, [pathname]);
  return (
    <div className="flex min-h-screen flex-col">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-[90] focus:rounded-lg focus:bg-surface focus:px-3 focus:py-2">Skip to content</a>
      {!admin && <DeliveryBanner />}
      <Header admin={admin} />
      {!admin && <CategoryNav categories={cats.data} loading={cats.loading} error={cats.error} onRetry={cats.reload} />}
      <main id="main" className="flex-1"><ErrorBoundary><Outlet /></ErrorBoundary></main>
      <Footer categories={cats.data} />
      <LocationModal />
      {!admin && <VoiceAssistant />}
    </div>
  );
}

export { NavLink };
