import { useEffect, useId, useState } from "react";
import { RotateCcw } from "lucide-react";
import { formatMoney } from "../lib/format";

/** Parses a rupee amount typed by the customer. Blank means "no limit"; anything else must be a non-negative number with up to 2 decimals. */
export function parseRupees(v: string): { value?: number; error?: string } {
  const t = v.trim();
  if (t === "") return {};
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return { error: "Enter a valid amount, like 150 or 99.50" };
  return { value: Number(t) };
}

/** Checks a Min/Max pair. */
export function validatePriceRange(min: string, max: string): { min?: number; max?: number; errors: { min?: string; max?: string; range?: string } } {
  const a = parseRupees(min);
  const b = parseRupees(max);
  const errors: { min?: string; max?: string; range?: string } = {};
  if (a.error) errors.min = a.error;
  if (b.error) errors.max = b.error;
  if (!errors.min && !errors.max && a.value !== undefined && b.value !== undefined && a.value > b.value) errors.range = "Minimum price can't be higher than the maximum.";
  return { min: a.value, max: b.value, errors };
}

const fmt = (n?: number) => (n === undefined ? "" : String(n));

interface Props {
  /** Applied values (rupees). */
  min?: number;
  max?: number;
  /** Cheapest / dearest listed price in minor units, from the catalogue (drives the slider). Null while unknown or when nothing is listed. */
  bounds: { minMinor: number; maxMinor: number } | null;
  onApply: (min?: number, max?: number) => void;
  /** Clears only the price filter. */
  onReset: () => void;
  /** Clears every filter (search, category, stock, price). Hidden when nothing is applied. */
  onClearAll?: () => void;
  anyFilterActive?: boolean;
}

/** Price filter: separate Min / Max inputs, validation, an optional range slider over the real catalogue prices, Apply and Reset. */
export function PriceFilter({ min, max, bounds, onApply, onReset, onClearAll, anyFilterActive }: Props) {
  const id = useId();
  const [minText, setMinText] = useState(fmt(min));
  const [maxText, setMaxText] = useState(fmt(max));
  const [touched, setTouched] = useState(false);
  useEffect(() => { setMinText(fmt(min)); setMaxText(fmt(max)); setTouched(false); }, [min, max]);

  const { min: pMin, max: pMax, errors } = validatePriceRange(minText, maxText);
  const invalid = !!(errors.min || errors.max || errors.range);
  const lo = bounds ? Math.floor(bounds.minMinor / 100) : 0;
  const hi = bounds ? Math.ceil(bounds.maxMinor / 100) : 0;
  const sliderOn = !!bounds && hi > lo;
  const curMin = Math.min(Math.max(pMin ?? lo, lo), hi);
  const curMax = Math.max(Math.min(pMax ?? hi, hi), lo);
  const dirty = minText.trim() !== fmt(min) || maxText.trim() !== fmt(max);
  const applied = min !== undefined || max !== undefined;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (invalid) return;
    onApply(pMin, pMax);
  };
  const setClean = (v: string, set: (s: string) => void) => { set(v.replace(/[^\d.]/g, "")); setTouched(false); };
  const showErr = (m?: string) => touched || !!m ? m : undefined;

  const input = "w-full min-h-11 rounded-xl border border-line bg-canvas pl-7 pr-3 text-[15px] text-ink placeholder:text-muted/70 focus:border-accent aria-[invalid=true]:border-danger";

  return (
    <form onSubmit={submit} noValidate aria-label="Filter by price" className="space-y-3">
      <fieldset>
        <legend className="mb-2.5 flex w-full items-baseline justify-between text-sm font-bold">
          <span>Price (₹)</span>
          {bounds && <span className="text-xs font-medium text-muted">{formatMoney(bounds.minMinor)} – {formatMoney(bounds.maxMinor)}</span>}
        </legend>

        <div className="grid grid-cols-2 gap-3">
          {([["Min", minText, setMinText, errors.min, "min"], ["Max", maxText, setMaxText, errors.max, "max"]] as const).map(([label, val, set, err, key]) => (
            <div key={key}>
              <label htmlFor={`${id}-${key}`} className="mb-1 block text-xs font-semibold text-muted">{label}</label>
              <div className="relative">
                <span aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted">₹</span>
                <input id={`${id}-${key}`} className={input} inputMode="decimal" autoComplete="off" placeholder={label === "Min" ? (bounds ? String(lo) : "0") : (bounds ? String(hi) : "Any")}
                  value={val} aria-invalid={!!showErr(err) || (!!errors.range && key === "max")} aria-describedby={`${id}-err`}
                  onChange={(e) => setClean(e.target.value, set)} />
              </div>
            </div>
          ))}
        </div>

        <div id={`${id}-err`} aria-live="polite" className="min-h-5">
          {(showErr(errors.min) || showErr(errors.max) || errors.range) && <p role="alert" className="mt-1.5 text-xs font-semibold text-danger">{errors.range ?? errors.min ?? errors.max}</p>}
        </div>

        {sliderOn && (
          <div className="mt-1" role="group" aria-label="Price range slider">
            <div className="relative h-6">
              <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-line" />
              <div className="absolute top-1/2 h-1 -translate-y-1/2 rounded-full bg-accent" style={{ left: `${((curMin - lo) / (hi - lo)) * 100}%`, right: `${100 - ((curMax - lo) / (hi - lo)) * 100}%` }} />
              {/* Two overlaid range inputs; only their thumbs take pointer events. */}
              <input type="range" aria-label="Minimum price" min={lo} max={hi} step={1} value={curMin} className="price-thumb" onChange={(e) => { setMinText(String(Math.min(Number(e.target.value), curMax))); setTouched(false); }} />
              <input type="range" aria-label="Maximum price" min={lo} max={hi} step={1} value={curMax} className="price-thumb" onChange={(e) => { setMaxText(String(Math.max(Number(e.target.value), curMin))); setTouched(false); }} />
            </div>
            <div className="mt-1 flex justify-between text-[11px] text-muted"><span>₹{lo}</span><span>₹{hi}</span></div>
          </div>
        )}
      </fieldset>

      <div className="flex gap-2">
        <button type="submit" className="btn-add-solid flex-1" disabled={!dirty && applied} aria-label="Apply price filter">Apply Price</button>
        <button type="button" className="btn-ghost shrink-0" onClick={() => { onReset(); setTouched(false); }} disabled={!applied && !minText && !maxText} aria-label="Reset price filter"><RotateCcw className="h-4 w-4" aria-hidden /> Reset</button>
      </div>
      {anyFilterActive && onClearAll && <button type="button" className="w-full text-center text-sm font-semibold text-accent underline underline-offset-2" onClick={onClearAll}>Clear all filters</button>}
    </form>
  );
}
