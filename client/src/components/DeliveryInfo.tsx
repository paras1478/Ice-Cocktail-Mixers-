import { CheckCircle2, Info, Loader2, RefreshCw, XCircle } from "lucide-react";
import type { Delivery, PostalResult } from "../lib/types";
import type { LookupStatus } from "../lib/usePincodeLookup";

/** Whether we deliver. This comes from our own coverage table, never from the postal lookup. */
export function DeliveryResult({ delivery }: { delivery: Delivery | null }) {
  if (!delivery) return null;
  if (delivery.serviceable)
    return (
      <p role="status" className="flex items-start gap-2 rounded-xl bg-tint p-3 text-sm font-semibold text-ok">
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <span>Delivery available to {delivery.areaName} ({delivery.pincode}), usually in about {delivery.etaMinutes} min. This is an estimate, not a guarantee.{delivery.isSample ? " (Sample coverage data.)" : ""}</span>
      </p>
    );
  return (
    <p role="status" className="flex items-start gap-2 rounded-xl bg-tint p-3 text-sm font-semibold text-danger">
      <XCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <span>{delivery.reason === "paused" ? `Delivery to ${delivery.pincode} is temporarily paused.` : "Sorry, delivery is not available in this area."}</span>
    </p>
  );
}

/** Postal area / district / state for a PIN, plus a clear message when the lookup could not be completed. */
export function PostalSuggestions({ postal }: { postal: PostalResult | null }) {
  if (!postal) return null;
  if (postal.status === "found")
    return (
      <p role="status" className="flex items-start gap-2 text-xs text-muted"><Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
        <span>Area and state detected: {postal.offices.slice(0, 3).map((o) => o.name).join(", ")}{postal.offices.length > 3 ? "…" : ""} · {postal.district}, {postal.state}</span></p>
    );
  if (postal.status === "not_found")
    return <p role="status" className="flex items-start gap-2 text-xs text-warn"><Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden /><span>The postal service has no record of this PIN code. Check it, or enter the area, district and state manually.</span></p>;
  return <p role="alert" className="flex items-start gap-2 text-xs text-warn"><Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden /><span>{postal.message}</span></p>;
}

/** The one place the PIN states are worded: invalid / looking / detected / available / not available / unable to verify. */
export function PinFeedback({ status, postal, delivery, error, onRetry }: {
  status: LookupStatus; postal: PostalResult | null; delivery: Delivery | null; error: string | null; onRetry: () => void;
}) {
  if (status === "idle") return <p className="text-xs text-muted">Enter a valid 6-digit PIN code.</p>;
  if (status === "looking") return <p role="status" className="flex items-center gap-2 text-xs text-muted"><Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />Looking up location…</p>;
  if (status === "error")
    return (
      <div role="alert" className="flex flex-wrap items-center gap-3 rounded-xl bg-tint p-3 text-sm font-semibold text-warn">
        <span>Unable to verify delivery. Please try again.</span>
        <button type="button" className="btn-ghost !min-h-9" onClick={onRetry}><RefreshCw className="h-3.5 w-3.5" aria-hidden /> Retry</button>
        {error && <span className="w-full text-xs font-normal text-muted">{error}</span>}
      </div>
    );
  return <div className="space-y-2"><PostalSuggestions postal={postal} /><DeliveryResult delivery={delivery} /></div>;
}
