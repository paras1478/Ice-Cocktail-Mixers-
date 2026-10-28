import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { Clock, LayoutDashboard, LogOut, MapPin, Moon, ShoppingCart, Sun, User as UserIcon, X } from "lucide-react";
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

/** Customer-facing delivery strip. Never rendered inside admin routes. */
function DeliveryBanner() {
  const loc = useLocationCtx();
  let text: ReactNode;
  if (loc.status === "checking") text = "Checking delivery…";
  else if (loc.delivery?.serviceable) text = <>Delivering to <b>{loc.delivery.areaName}</b> ({loc.delivery.pincode}) in about <b>{loc.delivery.etaMinutes} min</b> <span className="opacity-75">· an estimate, not a guarantee</span></>;
  else if (loc.status === "unavailable") text = <>Sorry, delivery is not available in this area (<b>{loc.pincode}</b>).</>;
  else if (loc.status === "error") text = <>Unable to verify delivery. Please try again. <button className="underline" onClick={() => loc.retry()}>Retry</button></>;
  else text = "Enter your PIN code to see if we deliver to you and how long it takes.";
  return (
    <div className="bg-header text-on-header" data-testid="delivery-banner">
      <div className="container-x flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2 text-xs sm:text-sm">
        <p className="flex items-center gap-2"><Clock className="h-4 w-4 shrink-0 text-badge" aria-hidden />{text}</p>
        <button onClick={loc.openModal} className="inline-flex items-center gap-1 font-semibold text-badge underline underline-offset-2"><MapPin className="h-3.5 w-3.5" aria-hidden />{loc.pincode ? "Change PIN code" : "Enter PIN code"}</button>
      </div>
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

const iconBtn = "relative grid h-10 w-10 place-items-center rounded-full hover:bg-white/10";

function Header({ admin }: { admin: boolean }) {
  const { user, logout } = useAuth();
  const { count } = useCart();
  const { theme, toggle } = useTheme();
  const nav = useNavigate();
  return (
    <header className="sticky top-0 z-40 bg-header text-on-header shadow-md">
      <div className="container-x flex items-center gap-3 py-2.5">
        <Logo />
        {!admin && <div className="mx-2 hidden max-w-xl flex-1 md:block"><SearchBar /></div>}
        {admin && <span className="chip ml-2 bg-badge text-badge-ink">Admin</span>}
        <div className="ml-auto flex items-center gap-1">
          <button onClick={toggle} className={iconBtn} aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}>{theme === "dark" ? <Sun className="h-5 w-5" aria-hidden /> : <Moon className="h-5 w-5" aria-hidden />}</button>
          {user?.role === "ADMIN" && <Link to="/admin" className={iconBtn} aria-label="Admin dashboard"><LayoutDashboard className="h-5 w-5" aria-hidden /></Link>}
          {user ? (
            <>
              <Link to="/account" className={iconBtn} aria-label="My account"><UserIcon className="h-5 w-5" aria-hidden /></Link>
              <button className={iconBtn} aria-label="Log out" onClick={async () => { await logout(); nav("/"); }}><LogOut className="h-5 w-5" aria-hidden /></button>
            </>
          ) : <Link to="/login" className="rounded-full px-3 py-2 text-sm font-semibold hover:bg-white/10">Log in</Link>}
          {!admin && (
            <Link to="/cart" className={iconBtn} aria-label={`Cart, ${count} item${count === 1 ? "" : "s"}`}>
              <ShoppingCart className="h-5 w-5" aria-hidden />
              {count > 0 && <span className="absolute -right-0.5 -top-0.5 grid h-5 min-w-5 place-items-center rounded-full bg-badge px-1 text-[11px] font-extrabold text-badge-ink" data-testid="cart-count">{count}</span>}
            </Link>
          )}
        </div>
      </div>
      {!admin && <div className="container-x pb-2.5 md:hidden"><SearchBar /></div>}
    </header>
  );
}

function Footer() {
  return (
    <footer className="mt-16 bg-header text-on-header">
      <div className="container-x grid gap-8 py-10 text-sm sm:grid-cols-3">
        <div><Logo /><p className="mt-3 max-w-xs opacity-80">Party ice, craft tonic, club soda, margarita mixes, bitters and citrus garnishes, delivered fast. Delivery times are estimates, not guarantees.</p></div>
        <div><h2 className="mb-2 font-sans text-sm font-bold uppercase tracking-wide text-badge">Shop</h2><ul className="space-y-1.5 opacity-90"><li><Link to="/category/ice-bags">Ice bags</Link></li><li><Link to="/category/tonic-water">Tonic water</Link></li><li><Link to="/category/party-bundles">Party bundles</Link></li></ul></div>
        <div><h2 className="mb-2 font-sans text-sm font-bold uppercase tracking-wide text-badge">Help</h2><ul className="space-y-1.5 opacity-90"><li><Link to="/orders">My orders</Link></li><li><Link to="/policy/delivery">Delivery information</Link></li><li><Link to="/policy/returns">Returns &amp; refunds</Link></li><li><Link to="/policy/privacy">Privacy</Link></li><li><Link to="/policy/terms">Terms</Link></li></ul></div>
      </div>
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
      <Header admin={admin} />
      {!admin && <DeliveryBanner />}
      {!admin && <CategoryNav categories={cats.data} loading={cats.loading} error={cats.error} onRetry={cats.reload} />}
      <main id="main" className="flex-1"><ErrorBoundary><Outlet /></ErrorBoundary></main>
      <Footer />
      <LocationModal />
    </div>
  );
}

export { NavLink };
