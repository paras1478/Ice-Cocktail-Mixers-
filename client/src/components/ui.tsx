import { Component, useCallback, useEffect, useState, type ErrorInfo, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, Eye, EyeOff, Minus, Plus, RefreshCw, SearchX } from "lucide-react";
import { apiError } from "../lib/api";

export function Logo() {
  return (
    <Link to="/" className="flex flex-col leading-none" aria-label="Ice & Cocktail Mixers Express, home">
      <span className="font-script text-[26px] leading-none sm:text-[30px]">Ice &amp; Mixers</span>
      <span className="mt-1 text-[9px] font-semibold uppercase tracking-[0.22em] opacity-70">Express</span>
    </Link>
  );
}

export const Skeleton = ({ className = "" }: { className?: string }) => <div className={`skeleton ${className}`} aria-hidden />;

export function Spinner() {
  return <div role="status" aria-label="Loading" className="mx-auto h-8 w-8 animate-spin rounded-full border-4 border-line border-t-accent" />;
}

export function ProductGridSkeleton({ count = 8 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:gap-5 md:grid-cols-3 lg:grid-cols-4" role="status" aria-label="Loading products">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="card p-3">
          <Skeleton className="aspect-square w-full" />
          <Skeleton className="mt-3 h-4 w-3/4" />
          <Skeleton className="mt-2 h-3 w-1/3" />
          <Skeleton className="mt-4 h-10 w-full" />
        </div>
      ))}
    </div>
  );
}

export function EmptyState({ title, body, action }: { title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="card flex flex-col items-center gap-3 px-6 py-14 text-center">
      <span className="grid h-14 w-14 place-items-center rounded-full bg-tint"><SearchX className="h-7 w-7" aria-hidden /></span>
      <h2 className="text-lg font-bold">{title}</h2>
      {body && <p className="max-w-md text-sm text-muted">{body}</p>}
      {action}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="card flex flex-col items-center gap-3 px-6 py-12 text-center">
      <AlertTriangle className="h-8 w-8 text-danger" aria-hidden />
      <p className="font-semibold">{message}</p>
      {onRetry && <button className="btn-dark" onClick={onRetry}><RefreshCw className="h-4 w-4" aria-hidden /> Try again</button>}
    </div>
  );
}

export function FieldError({ id, message }: { id: string; message?: string }) {
  return message ? <p id={id} role="alert" className="mt-1 text-xs font-semibold text-danger">{message}</p> : null;
}

/** Password field with an eye button that shows or hides the typed text. It is hidden again whenever the field is re-rendered fresh (page load). */
export function PasswordInput({ id, value, onChange, autoComplete, invalid }: { id: string; value: string; onChange: (v: string) => void; autoComplete?: string; invalid?: boolean }) {
  const [shown, setShown] = useState(false);
  return (
    <div className="relative">
      <input id={id} type={shown ? "text" : "password"} className="input pr-11" autoComplete={autoComplete} value={value} aria-invalid={invalid} onChange={(e) => onChange(e.target.value)} />
      <button type="button" onClick={() => setShown((v) => !v)} aria-label={shown ? "Hide password" : "Show password"} aria-pressed={shown}
        className="absolute right-1.5 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-full text-muted hover:bg-tint hover:text-ink">
        {shown ? <EyeOff className="h-[18px] w-[18px]" aria-hidden /> : <Eye className="h-[18px] w-[18px]" aria-hidden />}
      </button>
    </div>
  );
}

export function QuantityStepper({ value, max, label, onChange }: { value: number; max: number; label: string; onChange: (n: number) => void }) {
  return (
    <div className="inline-flex items-center rounded-full border border-line bg-surface" role="group" aria-label={`Quantity of ${label}`}>
      <button type="button" className="grid h-10 w-10 place-items-center rounded-full hover:bg-tint" aria-label={`Decrease quantity of ${label}`} onClick={() => onChange(value - 1)}><Minus className="h-4 w-4" aria-hidden /></button>
      <span className="min-w-8 text-center text-sm font-extrabold" aria-live="polite">{value}</span>
      <button type="button" className="grid h-10 w-10 place-items-center rounded-full hover:bg-tint disabled:opacity-40" aria-label={`Increase quantity of ${label}`} disabled={value >= max} onClick={() => onChange(value + 1)}><Plus className="h-4 w-4" aria-hidden /></button>
    </div>
  );
}

export const FALLBACK_IMAGE = "/img/coming-soon.svg";

/** Product photo that falls back to a neutral placeholder if it fails to load. Never hides the failure from the alt text. */
export function ProductImage({ src, alt, className = "", width = 400, height = 400, sizes, eager = false }: {
  src?: string; alt: string; className?: string; width?: number; height?: number; sizes?: string; eager?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  return (
    <img
      src={failed || !src ? FALLBACK_IMAGE : src}
      alt={failed || !src ? `${alt} (photo unavailable)` : alt}
      width={width}
      height={height}
      sizes={sizes}
      loading={eager ? "eager" : "lazy"}
      decoding="async"
      onError={() => setFailed(true)}
      className={className}
    />
  );
}

/**
 * Background photo for a card or banner. It fills its (relatively positioned) parent with object-fit: cover and sits under a dark
 * gradient so overlaid text stays readable. If the image cannot load it renders nothing (the parent keeps its own background) and
 * tells the caller via onError; it never retries, so a missing file can't cause a request loop.
 */
export function CoverImage({ src, width = 800, height = 400, eager = false, className = "", onError }: { src?: string | null; width?: number; height?: number; eager?: boolean; className?: string; onError?: () => void }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  if (!src || failed) return null;
  return (
    <>
      <img src={src} alt="" aria-hidden width={width} height={height} loading={eager ? "eager" : "lazy"} decoding="async"
        onError={() => { setFailed(true); onError?.(); }} className={`absolute inset-0 h-full w-full object-cover ${className}`} />
      <span aria-hidden className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/35 to-black/15" />
    </>
  );
}

/** Async data hook with real loading/error states and a reload() that re-runs the request. */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [state, setState] = useState<{ data: T | null; loading: boolean; error: string | null }>({ data: null, loading: true, error: null });
  const [n, setN] = useState(0);
  useEffect(() => {
    let live = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    fn().then((data) => live && setState({ data, loading: false, error: null }))
      .catch((e) => live && setState({ data: null, loading: false, error: apiError(e).message }));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, n]);
  const reload = useCallback(() => setN((x) => x + 1), []);
  return { ...state, reload };
}

export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error(error, info.componentStack); }
  render() {
    if (!this.state.error) return this.props.children;
    return <div className="container-x py-16"><ErrorState message="Something went wrong displaying this page." onRetry={() => this.setState({ error: null })} /></div>;
  }
}
