import { Lock } from "lucide-react";
import type { Quote } from "../lib/types";
import { formatMoney } from "../lib/format";
import { ProductImage, Spinner } from "./ui";
import { OrderTotals } from "../pages/CartPage";

/** Checkout order summary. Every figure comes from the server quote, which is also the amount that is charged. */
export function OrderSummary({ quote, payable }: { quote: Quote | null; payable?: boolean }) {
  return (
    <aside className="card h-fit p-5 lg:sticky lg:top-28" aria-label="Order summary">
      <h2 className="mb-4 text-lg font-extrabold">Order summary</h2>
      {!quote ? <Spinner /> : (
        <>
          <ul className="mb-4 divide-y divide-line" data-testid="summary-lines">
            {quote.lines.map((l) => (
              <li key={l.productId} className="flex items-center gap-3 py-3 first:pt-0">
                <ProductImage src={l.image} alt={l.name} width={56} height={56} className="h-14 w-14 shrink-0 rounded-xl border border-line object-cover" />
                <span className="min-w-0 flex-1 text-sm">
                  <span className="block font-semibold leading-snug">{l.name}</span>
                  <span className="text-xs text-muted">{l.packSize} · Qty {l.quantity}</span>
                </span>
                <span className="text-sm font-bold">{formatMoney(l.unitMinor * l.quantity)}</span>
              </li>
            ))}
          </ul>
          <OrderTotals quote={quote} />
          {quote.discountCode && quote.totals.discountMinor > 0 && <p className="mt-2 text-xs font-semibold text-ok">You saved {formatMoney(quote.totals.discountMinor)} with {quote.discountCode}.</p>}
          {payable && (
            <p className="mt-4 flex items-center gap-2 rounded-xl bg-band p-3 text-xs text-ink-soft"><Lock className="h-4 w-4 shrink-0 text-ok" aria-hidden /><span>Secure checkout. You pay exactly <b>{formatMoney(quote.totals.totalMinor)}</b>, the total shown here.</span></p>
          )}
          {quote.issues.map((i) => <p key={i.productId} role="alert" className="mt-2 text-xs font-semibold text-danger">{i.message}</p>)}
        </>
      )}
    </aside>
  );
}
