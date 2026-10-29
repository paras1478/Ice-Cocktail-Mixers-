import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ShoppingBag, Tag, Trash2 } from "lucide-react";
import { useCart } from "../context/CartContext";
import { useAuth } from "../context/AuthContext";
import { formatMoney } from "../lib/format";
import { EmptyState, ErrorState, ProductImage, QuantityStepper, Skeleton } from "../components/ui";
import type { Quote } from "../lib/types";

export function OrderTotals({ quote }: { quote: Quote }) {
  const t = quote.totals;
  const row = "flex justify-between text-sm";
  return (
    <dl className="space-y-2.5">
      <div className={row}><dt>Subtotal</dt><dd className="font-semibold">{formatMoney(t.subtotalMinor)}</dd></div>
      {t.discountMinor > 0 && <div className={`${row} text-ok`}><dt>Discount{quote.discountCode ? ` (${quote.discountCode})` : ""}</dt><dd className="font-semibold">−{formatMoney(t.discountMinor)}</dd></div>}
      <div className={row}><dt>Delivery fee</dt><dd className="font-semibold">{t.deliveryMinor === 0 ? "Free" : formatMoney(t.deliveryMinor)}</dd></div>
      <div className={row}><dt>Taxes</dt><dd className="font-semibold">{formatMoney(t.taxMinor)}</dd></div>
      <div className="flex justify-between border-t border-line pt-3 text-lg font-extrabold"><dt>Total</dt><dd data-testid="grand-total">{formatMoney(t.totalMinor)}</dd></div>
    </dl>
  );
}

export function DiscountBox() {
  const cart = useCart();
  const [val, setVal] = useState(cart.code);
  const submit = (e: FormEvent) => { e.preventDefault(); cart.applyCode(val); };
  return (
    <form onSubmit={submit} className="mt-1">
      <label htmlFor="code" className="label">Discount code</label>
      <div className="flex gap-2">
        <input id="code" className="input uppercase" value={val} onChange={(e) => setVal(e.target.value)} placeholder="Enter code" autoComplete="off" />
        <button className="btn-ghost shrink-0">Apply</button>
      </div>
      {cart.code && cart.quote?.discountMessage && (
        <p role="status" className="mt-1.5 text-xs font-medium text-warn" data-testid="coupon-notice">
          {cart.quote.discountMessage === "Invalid discount code" ? "Invalid coupon." : `${cart.quote.discountMessage}.`} No discount is applied, and you can continue without one. Try another code or
          <button type="button" className="ml-1 underline" onClick={() => { setVal(""); cart.applyCode(""); }}>remove this code</button>.
        </p>
      )}
      {cart.code && cart.quote?.discountCode && (
        <p className="mt-1.5 flex items-center gap-1.5 text-xs font-semibold text-ok"><Tag className="h-3.5 w-3.5" aria-hidden /> {cart.quote.discountCode} applied
          <button type="button" className="ml-1 underline" onClick={() => { setVal(""); cart.applyCode(""); }}>Remove</button></p>
      )}
    </form>
  );
}

export default function CartPage() {
  const cart = useCart();
  const { user } = useAuth();
  const nav = useNavigate();
  const q = cart.quote;
  const blocked = !q || q.issues.length > 0;

  if (!cart.items.length)
    return <div className="container-x py-16"><EmptyState title="Your cart is empty" body="Add some ice and mixers to get the party started." action={<Link to="/shop" className="btn-primary">Start shopping</Link>} /></div>;

  return (
    <div className="container-x py-8">
      <h1 className="text-3xl font-extrabold">Your cart</h1>
      {cart.quoteError && <div className="mt-4"><ErrorState message={cart.quoteError} onRetry={cart.refresh} /></div>}
      <div className="mt-6 grid gap-8 lg:grid-cols-[1fr_380px]">
        <ul className="space-y-3">
          {!q ? cart.items.map((i) => <li key={i.productId}><Skeleton className="h-28" /></li>) : q.lines.map((l) => {
            const issue = q.issues.find((x) => x.productId === l.productId);
            return (
              <li key={l.productId} className="card flex gap-4 p-3 sm:p-4">
                <ProductImage src={l.image} alt={`${l.name}, ${l.packSize}`} width={96} height={96} className="h-20 w-20 shrink-0 rounded-xl bg-tint object-cover sm:h-24 sm:w-24" />
                <div className="flex min-w-0 flex-1 flex-col">
                  <div className="flex justify-between gap-2">
                    <div className="min-w-0"><p className="truncate font-bold">{l.name}</p><p className="text-sm text-muted">{l.packSize} · {formatMoney(l.unitMinor)} each</p></div>
                    <p className="font-extrabold">{formatMoney(l.unitMinor * l.quantity)}</p>
                  </div>
                  {issue && <p role="alert" className="mt-1 text-xs font-semibold text-danger">{issue.message}</p>}
                  <div className="mt-auto flex items-center justify-between pt-2">
                    <QuantityStepper value={l.quantity} max={l.stock} label={l.name} onChange={(n) => cart.setQty(l.productId, n, l.stock)} />
                    <button onClick={() => cart.remove(l.productId)} className="inline-flex min-h-11 items-center gap-1.5 px-2 text-sm font-semibold text-muted hover:text-danger" aria-label={`Remove ${l.name} from cart`}><Trash2 className="h-4 w-4" aria-hidden /> Remove</button>
                  </div>
                </div>
              </li>
            );
          })}
          {q?.issues.filter((i) => !q.lines.some((l) => l.productId === i.productId)).map((i) => (
            <li key={i.productId} className="card flex items-center justify-between p-4"><p role="alert" className="text-sm font-semibold text-danger">{i.message}</p><button className="btn-ghost" onClick={() => cart.remove(i.productId)}>Remove</button></li>
          ))}
        </ul>

        <aside className="card h-fit p-5 lg:sticky lg:top-28" aria-label="Order summary">
          <h2 className="mb-4 text-lg font-extrabold">Order summary</h2>
          {q ? <OrderTotals quote={q} /> : <Skeleton className="h-40" />}
          <div className="mt-5"><DiscountBox /></div>
          <button className="btn-primary mt-5 w-full py-3 text-base" disabled={blocked || cart.quoteLoading} onClick={() => nav(user ? "/checkout" : "/login", { state: { from: "/checkout" } })}>
            <ShoppingBag className="h-4 w-4" aria-hidden /> {user ? "Proceed to checkout" : "Log in to checkout"}
          </button>
          {q && q.issues.length > 0 && <p className="mt-2 text-center text-xs text-danger">Fix the items above to continue.</p>}
          <p className="mt-3 text-center text-xs text-muted">Final prices are confirmed by our server when you place your order.</p>
        </aside>
      </div>
    </div>
  );
}
