import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Check, ChevronDown, MapPin, RotateCcw } from "lucide-react";
import { api, apiError } from "../lib/api";
import { payForOrder } from "../lib/payOnline";
import type { Order, OrderStatus } from "../lib/types";
import { formatAddress, formatDateTime, formatMoney, mapLink } from "../lib/format";
import { useToast } from "../context/ToastContext";
import { useCart } from "../context/CartContext";
import { EmptyState, ErrorState, ProductImage, Skeleton, Spinner, useAsync } from "../components/ui";

export const STATUS_LABEL: Record<OrderStatus, string> = {
  PLACED: "Placed", CONFIRMED: "Confirmed", PREPARING: "Preparing", OUT_FOR_DELIVERY: "Out for delivery", DELIVERED: "Delivered", CANCELLED: "Cancelled",
};
const FLOW: OrderStatus[] = ["PLACED", "CONFIRMED", "PREPARING", "OUT_FOR_DELIVERY", "DELIVERED"];

/** Customers can cancel until the shop starts preparing the order (the server enforces the same rule). */
export const canCancel = (o: Pick<Order, "status">) => o.status === "PLACED" || o.status === "CONFIRMED";

export function StatusBadge({ status }: { status: OrderStatus }) {
  const tone = status === "DELIVERED" ? "text-ok" : status === "CANCELLED" ? "text-danger" : "text-accent";
  return <span className={`chip ${tone}`}>{STATUS_LABEL[status]}</span>;
}

/** Status progress. There is no live GPS tracking: this only reflects the status our team has set. */
export function StatusTracker({ status }: { status: OrderStatus }) {
  if (status === "CANCELLED") return null;
  const at = FLOW.indexOf(status);
  return (
    <ol className="grid grid-cols-5" aria-label="Order progress">
      {FLOW.map((s, i) => (
        <li key={s} aria-current={i === at ? "step" : undefined} className="relative flex min-w-0 flex-col items-center text-center">
          {i < FLOW.length - 1 && <span aria-hidden className={`absolute left-1/2 top-3 h-0.5 w-full ${i < at ? "bg-action" : "bg-line"}`} />}
          <span className={`relative z-10 grid h-6 w-6 place-items-center rounded-full text-[11px] font-bold ${i < at ? "bg-action text-on-action" : i === at ? "bg-action text-on-action ring-4 ring-tint" : "bg-tint text-muted"}`}>
            {i < at ? <Check className="h-3.5 w-3.5" aria-hidden /> : i + 1}
          </span>
          <span className={`mt-1.5 hyphens-auto px-0.5 text-[10px] leading-tight sm:text-xs ${i <= at ? "font-bold text-ink" : "text-muted"}`}>{STATUS_LABEL[s]}</span>
        </li>
      ))}
    </ol>
  );
}

export function OrderAddress({ o }: { o: Order }) {
  return (
    <div className="text-sm">
      <p className="font-bold">{o.contactName} · {o.contactPhone}</p>
      <p className="text-ink-soft">{formatAddress({ house: o.addrHouse, line1: o.addrLine1, landmark: o.addrLandmark, area: o.addrArea, district: o.addrDistrict, city: o.addrCity, state: o.addrState, pincode: o.addrPincode })}</p>
      {o.addrLatitude !== null && o.addrLongitude !== null
        ? <a className="mt-1 inline-flex items-center gap-1 text-xs font-semibold underline" href={mapLink(o.addrLatitude, o.addrLongitude)} target="_blank" rel="noreferrer"><MapPin className="h-3.5 w-3.5" aria-hidden />Open map (GPS pin)</a>
        : <p className="mt-1 text-xs text-muted">No GPS pin: manual address.</p>}
    </div>
  );
}

/** How the customer paid, in words. Refunds are described separately and only from what the backend / Razorpay reported. */
export function paymentLabel(o: Pick<Order, "payment">): { text: string; tone: "ok" | "danger" | "muted" } {
  const p = o.payment;
  if (!p) return { text: "Payment unknown", tone: "muted" };
  if (p.method === "COD") return p.status === "PAID" ? { text: "Paid in cash", tone: "ok" } : { text: "Cash on delivery", tone: "muted" };
  if (p.status === "REFUNDED") return { text: "Refunded", tone: "ok" };
  if (p.status === "PAID") return { text: "Paid online", tone: "ok" };
  if (p.status === "FAILED") return { text: "Payment failed", tone: "danger" };
  return { text: "Payment pending", tone: "danger" };
}

export function refundInfo(p: Order["payment"]): { title: string; body: string; tone: "ok" | "danger" | "muted" } | null {
  if (!p || !p.refundStatus) return null;
  switch (p.refundStatus) {
    case "REQUESTED": return { title: "Refund initiated", body: "We are sending your refund request to the payment provider. This page will show its progress; you don't need to do anything.", tone: "muted" };
    case "PROCESSING": return { title: "Refund processing", body: "The payment provider has accepted your refund and is processing it. Banks usually take about 5–7 business days to show it.", tone: "muted" };
    case "COMPLETED": return { title: "Refund completed", body: `The payment provider confirmed your refund${p.refundedAt ? ` on ${formatDateTime(p.refundedAt)}` : ""}. It goes back to your original payment method.`, tone: "ok" };
    case "FAILED": return { title: "Refund needs attention", body: "The payment provider could not complete this refund. Our team has been notified and will contact you; you can also reach out to us with your order number.", tone: "danger" };
    default: return null;
  }
}

const REASONS = ["Ordered by mistake", "Found a better price elsewhere", "Delivery will take too long", "Changed my mind", "Other"];

function CancelDialog({ order, busy, error, onConfirm, onClose }: { order: Order; busy: boolean; error: string | null; onConfirm: (reason: string) => void; onClose: () => void }) {
  const [reason, setReason] = useState("");
  const keep = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    keep.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !busy) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);
  const paidOnline = order.payment?.method === "ONLINE" && order.payment.status === "PAID";
  return (
    <div className="fixed inset-0 z-[80] grid place-items-end bg-scrim/60 p-0 sm:place-items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div role="dialog" aria-modal="true" aria-labelledby="cancel-title" className="card w-full max-w-md rounded-b-none p-5 sm:rounded-b-[var(--radius-card)] sm:p-6">
        <h2 id="cancel-title" className="text-lg font-extrabold">Cancel this order?</h2>
        <p className="mt-2 text-sm text-ink-soft">
          {paidOnline
            ? <>You paid <b>{formatMoney(order.totalMinor)}</b> online. When you cancel, we ask Razorpay for a full refund to your original payment method. The refund is only complete once the payment provider confirms it, and banks usually take about 5–7 business days.</>
            : order.payment?.method === "ONLINE" ? "No payment was taken for this order, so there is nothing to refund." : "This is a cash on delivery order, so no payment has been taken."}
        </p>
        <label htmlFor="cancel-reason" className="label mt-4">Reason (optional)</label>
        <select id="cancel-reason" className="input" value={reason} onChange={(e) => setReason(e.target.value)} disabled={busy}>
          <option value="">Select a reason</option>
          {REASONS.map((r) => <option key={r}>{r}</option>)}
        </select>
        {error && <p role="alert" className="mt-3 rounded-xl bg-band p-3 text-sm font-semibold text-danger">{error}</p>}
        <div className="mt-5 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button ref={keep} type="button" className="btn-ghost" onClick={onClose} disabled={busy}>Keep order</button>
          <button type="button" className="btn-primary !bg-danger" onClick={() => onConfirm(reason)} disabled={busy}>{busy ? <span className="inline-flex items-center gap-2"><Spinner /> Cancelling…</span> : error ? "Try again" : "Yes, cancel order"}</button>
        </div>
      </div>
    </div>
  );
}

function OrderCard({ o, onChange, onCancel, busy }: { o: Order; onChange: (o: Order) => void; onCancel: (o: Order) => void; busy: boolean }) {
  const toast = useToast();
  const cart = useCart();
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const [working, setWorking] = useState<"pay" | "refund" | null>(null);
  const pay = paymentLabel(o);
  const refund = refundInfo(o.payment);
  const unpaidOnline = o.payment?.method === "ONLINE" && o.payment.status !== "PAID" && o.payment.status !== "REFUNDED" && o.status !== "CANCELLED";
  const cancelled = o.status === "CANCELLED";

  const payNow = async () => {
    setWorking("pay");
    try { onChange(await payForOrder(o.id)); toast.success(`Payment received for your order`); }
    catch (e) { toast.error(e instanceof Error && !("response" in e) ? e.message : apiError(e).message); }
    finally { setWorking(null); }
  };
  const checkRefund = async () => {
    setWorking("refund");
    try { onChange((await api.post<{ order: Order }>(`/orders/${o.id}/refund/refresh`)).data.order); }
    catch (e) { toast.error(apiError(e).message); }
    finally { setWorking(null); }
  };
  const reorder = () => {
    cart.addMany(o.items.map((i) => ({ productId: i.productId, quantity: i.quantity })));
    toast.success("Items added to your cart. Anything no longer available is removed automatically.");
    nav("/cart");
  };

  return (
    <article className="card overflow-hidden" aria-label={`Order ${o.number}`} data-testid={`order-${o.number}`}>
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line bg-band/60 px-4 py-3 sm:px-5">
        <div>
          <h2 className="font-sans text-base font-extrabold">Your order</h2>
          <p className="text-xs text-muted">Placed {formatDateTime(o.createdAt)}</p>
        </div>
        <div className="text-right">
          <p className="text-lg font-extrabold leading-tight">{formatMoney(o.totalMinor)}</p>
          <p className="mt-1 flex items-center justify-end gap-2 text-xs"><StatusBadge status={o.status} /><span className={`font-bold ${pay.tone === "ok" ? "text-ok" : pay.tone === "danger" ? "text-danger" : "text-muted"}`} data-testid="payment-label">{pay.text}</span></p>
        </div>
      </header>

      <div className="space-y-4 px-4 py-4 sm:px-5">
        {cancelled ? (
          <div className="rounded-xl border border-danger/30 bg-band p-3 text-sm" data-testid="cancelled-note">
            <p className="font-bold text-danger">Order cancelled</p>
            <p className="text-ink-soft">{formatDateTime(o.cancelledAt ?? o.updatedAt)}{o.cancelledBy === "ADMIN" ? " · cancelled by our team" : ""}{o.cancelReason ? ` · Reason: ${o.cancelReason}` : ""}</p>
          </div>
        ) : <StatusTracker status={o.status} />}

        {refund && (
          <div className={`rounded-xl border p-3 text-sm ${refund.tone === "ok" ? "border-ok/40" : refund.tone === "danger" ? "border-danger/40" : "border-line"} bg-surface`} data-testid="refund-info" role="status">
            <p className={`font-bold ${refund.tone === "ok" ? "text-ok" : refund.tone === "danger" ? "text-danger" : ""}`}>{refund.title}</p>
            <p className="mt-0.5 text-ink-soft">{refund.body}</p>
            {(o.payment?.refundStatus === "PROCESSING" || o.payment?.refundStatus === "REQUESTED") && (
              <button type="button" className="btn-ghost mt-2 !min-h-9" onClick={checkRefund} disabled={working === "refund"}>{working === "refund" ? "Checking…" : "Check refund status"}</button>
            )}
          </div>
        )}

        <ul className="divide-y divide-line">
          {o.items.map((i) => (
            <li key={i.id} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
              <ProductImage src={i.image ?? undefined} alt={i.name} width={56} height={56} className="h-14 w-14 shrink-0 rounded-xl border border-line object-cover" />
              <span className="min-w-0 flex-1 text-sm"><span className="block font-semibold leading-snug">{i.name}</span><span className="text-xs text-muted">Qty {i.quantity} × {formatMoney(i.unitMinor)}</span></span>
              <span className="text-sm font-bold">{formatMoney(i.unitMinor * i.quantity)}</span>
            </li>
          ))}
        </ul>

        <div className="rounded-xl bg-band p-3"><OrderAddress o={o} /></div>

        {open && (
          <dl className="space-y-1.5 rounded-xl border border-line p-3 text-sm" data-testid="order-details">
            <div className="flex justify-between"><dt>Subtotal</dt><dd className="font-semibold">{formatMoney(o.subtotalMinor)}</dd></div>
            {o.discountMinor > 0 && <div className="flex justify-between text-ok"><dt>Discount</dt><dd className="font-semibold">−{formatMoney(o.discountMinor)}</dd></div>}
            <div className="flex justify-between"><dt>Delivery fee</dt><dd className="font-semibold">{o.deliveryMinor === 0 ? "Free" : formatMoney(o.deliveryMinor)}</dd></div>
            <div className="flex justify-between"><dt>Taxes</dt><dd className="font-semibold">{formatMoney(o.taxMinor)}</dd></div>
            <div className="flex justify-between border-t border-line pt-2 font-extrabold"><dt>Total</dt><dd>{formatMoney(o.totalMinor)}</dd></div>
            <div className="flex justify-between text-xs text-muted"><dt>Payment</dt><dd>{o.payment?.method === "ONLINE" ? "Online (UPI / card / net banking)" : "Cash on delivery"}{o.payment?.paidAt ? ` · paid ${formatDateTime(o.payment.paidAt)}` : ""}</dd></div>
            {o.instructions && <p className="pt-1 text-xs text-muted">Delivery note: {o.instructions}</p>}
          </dl>
        )}
      </div>

      <footer className="flex flex-col gap-2 border-t border-line px-4 py-3 sm:flex-row sm:flex-wrap sm:items-center sm:px-5">
        {unpaidOnline && <button className="btn-add-solid w-full sm:w-auto" disabled={working === "pay" || busy} onClick={payNow}>{working === "pay" ? "Opening payment…" : `Pay ${formatMoney(o.totalMinor)} now`}</button>}
        {canCancel(o) && <button className="btn-ghost w-full border-danger/50 text-danger sm:w-auto" disabled={busy || working !== null} onClick={() => onCancel(o)} data-testid="cancel-order">Cancel order</button>}
        {cancelled || o.status === "DELIVERED" ? <button className="btn-ghost w-full sm:w-auto" onClick={reorder}><RotateCcw className="h-4 w-4" aria-hidden />Reorder</button> : null}
        <button type="button" className="btn-ghost w-full sm:ml-auto sm:w-auto" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? "Hide details" : "View details"}<ChevronDown className={`h-4 w-4 transition ${open ? "rotate-180" : ""}`} aria-hidden /></button>
      </footer>
    </article>
  );
}

export default function Orders() {
  const toast = useToast();
  const { data, loading, error, reload } = useAsync(() => api.get<{ orders: Order[] }>("/orders").then((r) => r.data.orders), []);
  // What the server just confirmed, shown immediately; replaced by the refetched list.
  const [patched, setPatched] = useState<Record<string, Order>>({});
  const [target, setTarget] = useState<Order | null>(null);
  const [busy, setBusy] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const inFlight = useRef(false);
  useEffect(() => { setPatched({}); }, [data]);

  const apply = (o: Order) => setPatched((p) => ({ ...p, [o.id]: { ...(data?.find((x) => x.id === o.id) ?? o), ...o } }));

  const confirmCancel = async (reason: string) => {
    if (!target || inFlight.current) return; // a second click while the request is running does nothing
    inFlight.current = true;
    setBusy(true);
    setCancelError(null);
    try {
      const r = await api.post<{ order: Order; alreadyCancelled: boolean }>(`/orders/${target.id}/cancel`, { reason: reason || undefined });
      apply(r.data.order); // only now, after the backend confirmed it
      toast.success(r.data.alreadyCancelled ? "This order was already cancelled" : `Order #${target.number} cancelled`);
      setTarget(null);
      reload();
    } catch (e) {
      const info = apiError(e);
      setCancelError(info.message);
      if (info.status === 409 || info.status === 404) reload(); // the order changed: show its real state
    } finally { inFlight.current = false; setBusy(false); }
  };

  return (
    <div className="container-x py-8">
      <h1 className="text-3xl font-extrabold">My orders</h1>
      <div className="mt-6 space-y-5">
        {loading ? <Skeleton className="h-64" /> : error ? <ErrorState message={error} onRetry={reload} />
          : !data?.length ? <EmptyState title="No orders yet" body="Your orders will appear here once you place one." action={<Link to="/shop" className="btn-primary">Start shopping</Link>} />
          : data.map((o) => <OrderCard key={o.id} o={patched[o.id] ?? o} onChange={apply} onCancel={(x) => { setCancelError(null); setTarget(x); }} busy={busy} />)}
      </div>
      {target && <CancelDialog order={patched[target.id] ?? target} busy={busy} error={cancelError} onConfirm={confirmCancel} onClose={() => { setTarget(null); setCancelError(null); }} />}
    </div>
  );
}
