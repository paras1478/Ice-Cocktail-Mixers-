import { useState } from "react";
import { Link } from "react-router-dom";
import { MapPin } from "lucide-react";
import { api, apiError } from "../lib/api";
import type { Order, OrderStatus } from "../lib/types";
import { formatAddress, formatDateTime, formatMoney, mapLink } from "../lib/format";
import { useToast } from "../context/ToastContext";
import { EmptyState, ErrorState, Skeleton, useAsync } from "../components/ui";

export const STATUS_LABEL: Record<OrderStatus, string> = {
  PLACED: "Placed", CONFIRMED: "Confirmed", PREPARING: "Preparing", OUT_FOR_DELIVERY: "Out for delivery", DELIVERED: "Delivered", CANCELLED: "Cancelled",
};
const FLOW: OrderStatus[] = ["PLACED", "CONFIRMED", "PREPARING", "OUT_FOR_DELIVERY", "DELIVERED"];

export function StatusBadge({ status }: { status: OrderStatus }) {
  const tone = status === "DELIVERED" ? "text-ok" : status === "CANCELLED" ? "text-danger" : "text-accent";
  return <span className={`chip ${tone}`}>{STATUS_LABEL[status]}</span>;
}

/** Status progress. There is no live GPS tracking: this only reflects the status our team has set. */
export function StatusTracker({ status }: { status: OrderStatus }) {
  if (status === "CANCELLED") return <p className="text-sm font-semibold text-danger">This order was cancelled.</p>;
  const at = FLOW.indexOf(status);
  return (
    <ol className="flex gap-1.5 overflow-x-auto" aria-label="Order progress">
      {FLOW.map((s, i) => <li key={s} aria-current={i === at ? "step" : undefined} className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold ${i <= at ? "bg-action text-on-action" : "bg-tint text-muted"}`}>{STATUS_LABEL[s]}</li>)}
    </ol>
  );
}

export function OrderAddress({ o }: { o: Order }) {
  return (
    <div className="text-sm">
      <p className="font-bold">{o.contactName} · {o.contactPhone}</p>
      <p className="text-ink-soft">{formatAddress({ house: o.addrHouse, line1: o.addrLine1, landmark: o.addrLandmark, area: o.addrArea, district: o.addrDistrict, city: o.addrCity, state: o.addrState, pincode: o.addrPincode })}</p>
      {o.addrLatitude !== null && o.addrLongitude !== null
        ? <a className="mt-1 inline-flex items-center gap-1 text-xs font-semibold underline" href={mapLink(o.addrLatitude, o.addrLongitude)} target="_blank" rel="noreferrer"><MapPin className="h-3.5 w-3.5" aria-hidden />Open map ({o.addrLatitude}, {o.addrLongitude})</a>
        : <p className="mt-1 text-xs text-muted">No GPS pin: manual address.</p>}
    </div>
  );
}

export default function Orders() {
  const toast = useToast();
  const { data, loading, error, reload } = useAsync(() => api.get<{ orders: Order[] }>("/orders").then((r) => r.data.orders), []);
  const [busy, setBusy] = useState<string | null>(null);

  const cancel = async (o: Order) => {
    if (!window.confirm(`Cancel order #${o.number}?`)) return;
    setBusy(o.id);
    try { await api.patch(`/orders/${o.id}/status`, { status: "CANCELLED" }); toast.success("Order cancelled"); reload(); }
    catch (e) { toast.error(apiError(e).message); } finally { setBusy(null); }
  };

  return (
    <div className="container-x py-8">
      <h1 className="text-3xl font-extrabold">My orders</h1>
      <div className="mt-6 space-y-4">
        {loading ? <Skeleton className="h-40" /> : error ? <ErrorState message={error} onRetry={reload} />
          : !data?.length ? <EmptyState title="No orders yet" body="Your orders will appear here once you place one." action={<Link to="/shop" className="btn-primary">Start shopping</Link>} />
          : data.map((o) => (
            <article key={o.id} className="card p-4 sm:p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div><h2 className="font-sans text-base font-extrabold">Order #{o.number}</h2><p className="text-xs text-muted">{formatDateTime(o.createdAt)}</p></div>
                <div className="flex items-center gap-3"><StatusBadge status={o.status} /><span className="font-extrabold">{formatMoney(o.totalMinor)}</span></div>
              </div>
              <div className="mt-3"><StatusTracker status={o.status} /></div>
              <ul className="mt-3 space-y-1 text-sm">{o.items.map((i) => <li key={i.id} className="flex justify-between gap-3"><span>{i.quantity} × {i.name}</span><span className="text-muted">{formatMoney(i.unitMinor * i.quantity)}</span></li>)}</ul>
              <div className="mt-3 rounded-xl bg-band p-3"><OrderAddress o={o} /></div>
              {(o.status === "PLACED" || o.status === "CONFIRMED") && <button className="btn-ghost mt-3" disabled={busy === o.id} onClick={() => cancel(o)}>{busy === o.id ? "Cancelling…" : "Cancel order"}</button>}
            </article>
          ))}
      </div>
    </div>
  );
}
