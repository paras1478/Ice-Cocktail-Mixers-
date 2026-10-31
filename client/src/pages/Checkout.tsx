import { useEffect, useRef, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { AlertTriangle, CheckCircle2, Lock, MapPin, XCircle } from "lucide-react";
import { api, apiError } from "../lib/api";
import { payForOrder, PaymentNotCompleted, type OnlineMethod } from "../lib/payOnline";
import type { Address, AppConfig, Delivery, Order } from "../lib/types";
import { formatAddress, formatMoney, formatTime } from "../lib/format";
import { useAuth } from "../context/AuthContext";
import { useCart } from "../context/CartContext";
import { useLocationCtx } from "../context/LocationContext";
import { ErrorState, FieldError, Spinner, useAsync } from "../components/ui";
import { AddressForm, addressPayload, draftFromRecord, emptyAddress, validateAddress, type AddressDraft } from "../components/AddressForm";
import { PaymentMethods, type PayChoice } from "../components/PaymentMethods";
import { OrderSummary } from "../components/OrderSummary";
import { DiscountBox } from "./CartPage";

const STEPS = ["Contact", "Address", "Review & pay"];

/** One key per order attempt: repeating the same attempt (double click, lost response, retry) can never create a second order. */
const newRequestId = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;

const toDraft = (a: Address): AddressDraft => draftFromRecord(a);
const IGNORED: (keyof AddressDraft)[] = ["phone", "stateCode"];
const sameDraft = (a: AddressDraft, b: AddressDraft) => (Object.keys(a) as (keyof AddressDraft)[]).every((k) => IGNORED.includes(k) || a[k] === b[k]);

export default function Checkout() {
  const { user } = useAuth();
  const cart = useCart();
  const loc = useLocationCtx();
  const cfg = useAsync(() => api.get<AppConfig>("/config").then((r) => r.data), []);
  const saved = useAsync(() => api.get<{ addresses: Address[] }>("/addresses").then((r) => r.data.addresses), []);
  const [step, setStep] = useState(0);
  const [contact, setContact] = useState({ name: user?.name ?? "", instructions: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [addr, setAddr] = useState<AddressDraft>(emptyAddress);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [saveAddress, setSaveAddress] = useState(true);
  const [delivery, setDelivery] = useState<Delivery | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [choice, setChoice] = useState<PayChoice>("COD");
  const [checking, setChecking] = useState(false);
  const [placing, setPlacing] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [order, setOrder] = useState<Order | null>(null);
  // Online payment: the order is saved first, then paid. If the payment is cancelled or fails the order stays here so the customer can retry (no second order).
  const [unpaid, setUnpaid] = useState<Order | null>(null);
  const [payBusy, setPayBusy] = useState(false);
  const [payError, setPayError] = useState<{ message: string; kind: "cancelled" | "failed" | "error" } | null>(null);
  const confirmRef = useRef<HTMLInputElement>(null);
  const attempt = useRef<{ id: string; sig: string } | null>(null);
  const inFlight = useRef(false); // blocks a second click / double submit while an order or payment is being processed

  // Start from the default saved address (or the header PIN) once they are known. This runs once and never after the
  // customer has started typing, so a late-arriving list can not overwrite their input.
  const touched = useRef(false);
  const prefilled = useRef(false);
  useEffect(() => {
    if (!saved.data || prefilled.current || touched.current) return;
    prefilled.current = true;
    const d = saved.data.find((a) => a.isDefault) ?? saved.data[0];
    if (d) { setSelectedId(d.id); setAddr({ ...toDraft(d), phone: d.phone ?? user?.phone ?? "" }); }
    else setAddr((a) => ({ ...a, phone: a.phone || (user?.phone ?? ""), pincode: a.pincode || (loc.pincode ?? "") }));
  }, [saved.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const pay = async (o: Order, how?: OnlineMethod) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setPayBusy(true);
    setPayError(null);
    try {
      const paid = await payForOrder(o.id, how); // the server verified the payment before answering
      cart.clear(); // only now, so a cancelled or failed payment never costs the customer their cart
      setOrder(paid);
      setUnpaid(null);
    } catch (ex) {
      if (ex instanceof PaymentNotCompleted) setPayError({ message: ex.message, kind: ex.kind });
      else setPayError({ message: ex instanceof Error && !("response" in ex) ? ex.message : apiError(ex).message, kind: "error" });
    } finally { setPayBusy(false); inFlight.current = false; }
  };

  if (order) return <Success order={order} />;
  if (unpaid) return <PayPanel order={unpaid} busy={payBusy} error={payError} onPay={() => pay(unpaid, onlineHow(choice))} onLater={() => cart.clear()} />;
  if (!cart.items.length) return <Navigate to="/cart" replace />;

  const q = cart.quote;
  const selected = saved.data?.find((a) => a.id === selectedId) ?? null;
  const unchanged = selected ? sameDraft(addr, toDraft(selected)) : false;
  const codOk = cfg.data?.payments.cod ?? true;
  const onlineOk = cfg.data?.payments.online ?? false;
  // An unavailable method is shown with the reason (never silently hidden); the customer is moved to one that works.
  const available = (c: PayChoice) => (c === "COD" ? codOk : onlineOk);
  const selectedChoice: PayChoice = available(choice) ? choice : (["UPI", "CARD", "NETBANKING", "COD"] as PayChoice[]).find(available) ?? choice;
  const payment: "COD" | "ONLINE" = selectedChoice === "COD" ? "COD" : "ONLINE";
  const onlineNote = cfg.error ? "We couldn't check online payment options. Please retry." : cfg.loading ? "Checking availability…" : "Online payment isn't set up for this store yet. Cash on delivery still works.";

  const next = async () => {
    setServerError(null);
    if (step === 0) {
      const e: Record<string, string> = {};
      if (contact.name.trim().length < 2) e.name = "Enter the recipient's name";
      setErrors(e);
      if (Object.keys(e).length) return;
    } else if (step === 1) {
      const e = validateAddress(addr);
      setErrors(e);
      if (Object.keys(e).length) return;
      setChecking(true);
      try {
        // Authoritative serviceability check against our delivery coverage (a valid postal PIN is not necessarily deliverable).
        const { data } = await api.post<Delivery>("/addresses/validate", addressPayload(addr));
        setDelivery(data);
        if (!data.serviceable) { setErrors({ pincode: data.reason === "paused" ? `Delivery to ${data.pincode} is temporarily paused.` : `We don't deliver to ${data.pincode} yet. Try another PIN code.` }); return; }
        await loc.setPincode(addr.pincode).catch(() => undefined); // keep the header location in sync
      } catch (ex) {
        const info = apiError(ex);
        setErrors(Object.keys(info.fields).length ? info.fields : { pincode: info.message });
        return;
      } finally { setChecking(false); }
    }
    setErrors({});
    setStep((s) => s + 1);
  };

  const place = async () => {
    if (inFlight.current) return;
    if (!q || q.issues.length) return setServerError(q ? "Some items in your cart need attention. Please review the order summary." : cart.quoteError ?? "We are still calculating your total. Please try again in a moment.");
    if (!confirmed) {
      // Never fail silently: say what is missing, scroll to it and focus it.
      setServerError("Please tick “I confirm this delivery address is correct” before paying.");
      confirmRef.current?.scrollIntoView?.({ block: "center", behavior: "smooth" });
      confirmRef.current?.focus();
      return;
    }
    setPlacing(true);
    setServerError(null);
    inFlight.current = true;
    try {
      // A coupon is optional. Only one the quote accepted is sent; an invalid, expired or ineligible code is left out, so it can never block the order
      // (the customer sees a notice and pays the full amount). The server validates whatever it receives and calculates the total itself.
      const appliedCode = cart.code && q.discountCode ? cart.code : undefined;
      const payload = {
        items: cart.items, code: appliedCode,
        contactName: contact.name.trim(), contactPhone: addr.phone,
        address: addressPayload(addr),
        addressId: selected && unchanged ? selected.id : undefined,
        saveAddress: !(selected && unchanged) && saveAddress ? true : undefined,
        addressConfirmed: true,
        instructions: contact.instructions.trim() || undefined,
        paymentMethod: payment,
        expectedTotalMinor: q.totals.totalMinor, // the server refuses if prices changed since this total was shown
      };
      // Same content = same key (a retry returns the order already created); changed content = a new key.
      const sig = JSON.stringify(payload);
      if (attempt.current?.sig !== sig) attempt.current = { id: newRequestId(), sig };
      const r = await api.post<{ order: Order }>("/orders", { ...payload, requestId: attempt.current.id });
      if (payment === "ONLINE") {
        // The order is saved first (cart kept until the payment succeeds), then paid. A cancelled or failed payment retries this same order.
        setUnpaid(r.data.order); setPlacing(false); inFlight.current = false;
        await pay(r.data.order, onlineHow(selectedChoice));
        return;
      }
      cart.clear();
      inFlight.current = false;
      setOrder(r.data.order);
    } catch (ex) {
      inFlight.current = false;
      const info = apiError(ex);
      setServerError(info.message);
      cart.refresh(); // pick up changed prices / stock
      if (info.status === 409) setConfirmed(false);
    } finally { setPlacing(false); }
  };

  return (
    <div className="container-x py-8 pb-32 lg:pb-8">
      <h1 className="text-3xl font-extrabold">Checkout</h1>
      <ol className="mt-4 flex gap-2 overflow-x-auto" aria-label="Checkout steps">
        {STEPS.map((s, i) => (
          <li key={s} aria-current={i === step ? "step" : undefined} className={`flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-full px-2 py-1.5 text-center text-[11px] font-bold leading-tight sm:flex-none sm:justify-start sm:gap-2 sm:px-3 sm:text-xs ${i === step ? "bg-action text-on-action" : i < step ? "bg-secondary text-ink" : "bg-tint text-muted"}`}>
            <span>{i + 1}</span>{s}
          </li>
        ))}
      </ol>

      <div className="mt-6 grid gap-8 lg:grid-cols-[1fr_380px]">
        <div className="card p-5 sm:p-6">
          {step === 0 && (
            <div className="space-y-4">
              <h2 className="text-lg font-extrabold">Who is receiving the order?</h2>
              <p className="text-sm text-muted">We'll ask for a contact number with the delivery address.</p>
              <div>
                <label htmlFor="c-name" className="label">Recipient name</label>
                <input id="c-name" className="input" autoComplete="name" value={contact.name} aria-invalid={!!errors.name} onChange={(e) => setContact({ ...contact, name: e.target.value })} />
                <FieldError id="c-name-err" message={errors.name} />
              </div>
              <div>
                <label htmlFor="c-note" className="label">Delivery instructions (optional)</label>
                <textarea id="c-note" className="input" rows={2} maxLength={300} value={contact.instructions} onChange={(e) => setContact({ ...contact, instructions: e.target.value })} />
              </div>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-4">
              <h2 className="text-lg font-extrabold">Delivery address</h2>
              {saved.loading ? <Spinner /> : saved.data && saved.data.length > 0 && (
                <fieldset><legend className="label">Saved addresses</legend>
                  <div className="space-y-2">
                    {saved.data.map((a) => (
                      <label key={a.id} className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 text-sm ${selectedId === a.id ? "border-accent bg-tint/60" : "border-line"}`}>
                        <input type="radio" name="saved" className="mt-1" checked={selectedId === a.id} onChange={() => { setSelectedId(a.id); setAddr(toDraft(a)); setErrors({}); }} />
                        <span><b>{a.label}</b> · {formatAddress(a)}</span>
                      </label>
                    ))}
                    <label className={`flex cursor-pointer items-center gap-3 rounded-xl border p-3 text-sm ${!selectedId ? "border-accent bg-tint/60" : "border-line"}`}>
                      <input type="radio" name="saved" checked={!selectedId} onChange={() => { setSelectedId(null); setAddr({ ...emptyAddress }); setErrors({}); }} /> Use a new address
                    </label>
                  </div>
                </fieldset>
              )}
              <AddressForm value={addr} errors={errors} onChange={(p) => { touched.current = true; setAddr((a) => ({ ...a, ...p })); setConfirmed(false); }} />
              {(!selected || !unchanged) && <label className="flex min-h-9 items-center gap-2 text-sm"><input type="checkbox" checked={saveAddress} onChange={(e) => setSaveAddress(e.target.checked)} /> {selected ? "Save this as a new address" : "Save this address for next time"}</label>}
            </div>
          )}

          {step === 2 && (
            <div className="space-y-5">
              <h2 className="text-lg font-extrabold">Review &amp; pay</h2>
              <div className="rounded-xl bg-band p-4 text-sm">
                <p className="flex items-center justify-between font-bold">Deliver to <button type="button" className="text-xs font-semibold underline" onClick={() => setStep(1)}>Change</button></p>
                <p className="mt-1">{contact.name} · {addr.phone}</p>
                <p className="text-ink-soft">{formatAddress({ ...addr, city: addr.district })}</p>
                <p className="mt-1 flex items-center gap-1 text-xs text-muted"><MapPin className="h-3.5 w-3.5" aria-hidden />{addr.latitude !== null ? `GPS pin included (${addr.latitude}, ${addr.longitude})` : "No GPS pin (manual address)"}</p>
                {delivery?.serviceable && <p className="mt-1 font-semibold">Estimated delivery: about {delivery.etaMinutes} min (an estimate, not a guarantee)</p>}
                {contact.instructions && <p className="mt-1 text-muted">Note: {contact.instructions}</p>}
              </div>
              <label className={`flex items-start gap-2 rounded-xl border p-3 text-sm font-semibold ${!confirmed && serverError ? "border-danger bg-band" : "border-line"}`}><input ref={confirmRef} type="checkbox" className="mt-1" checked={confirmed} aria-invalid={!confirmed && !!serverError} data-testid="confirm-address" onChange={(e) => { setConfirmed(e.target.checked); if (e.target.checked) setServerError(null); }} /> I confirm this delivery address is correct.</label>
              <fieldset>
                <legend className="label">Payment method</legend>
                {cfg.error && <div className="mb-3"><ErrorState message={cfg.error} onRetry={cfg.reload} /></div>}
                <PaymentMethods value={selectedChoice} onChange={setChoice} codOk={codOk} onlineOk={onlineOk} onlineNote={onlineNote} />
                <p className="mt-3 flex items-start gap-2 rounded-xl bg-band p-3 text-xs text-ink-soft" data-testid="pay-note">
                  <Lock className="mt-0.5 h-4 w-4 shrink-0 text-ok" aria-hidden />
                  {payment === "ONLINE"
                    ? <span><b>Secure checkout.</b> You pay {q ? <b>{formatMoney(q.totals.totalMinor)}</b> : "the total"} in Razorpay's secure window. We never see or store your card, UPI or bank details. Your order is confirmed only after the payment succeeds.</span>
                    : <span>You pay {q ? <b>{formatMoney(q.totals.totalMinor)}</b> : "the total"} in cash when your order arrives.</span>}
                </p>
              </fieldset>
              <DiscountBox />
            </div>
          )}

          <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 px-4 py-3 shadow-[0_-6px_20px_rgba(0,0,0,0.14)] backdrop-blur lg:static lg:z-auto lg:mt-6 lg:border-0 lg:bg-transparent lg:p-0 lg:shadow-none" data-testid="checkout-actions">
            {serverError && <p role="alert" className="mx-auto mb-2 max-w-3xl rounded-xl bg-band p-3 text-sm font-semibold text-danger lg:max-w-none" data-testid="checkout-error">{serverError}</p>}
            <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 lg:max-w-none">
              {step > 0 ? <button className="btn-ghost" onClick={() => setStep(step - 1)} disabled={placing}>Back</button> : <Link to="/cart" className="btn-ghost">Back to cart</Link>}
              {q && <p className="text-right text-xs text-muted lg:hidden">Total<br /><b className="text-base text-ink">{formatMoney(q.totals.totalMinor)}</b></p>}
              {step < 2 ? <button className="btn-primary" onClick={next} disabled={checking}>{checking ? "Checking delivery…" : "Continue"}</button>
                : <button className="btn-add-solid px-6 sm:px-8" onClick={place} disabled={placing || !q || q.issues.length > 0}>
                  {placing ? <span className="inline-flex items-center gap-2"><Spinner /> {payment === "ONLINE" ? "Preparing payment…" : "Placing order…"}</span>
                    : <span className="inline-flex items-center gap-2">{payment === "ONLINE" && <Lock className="h-4 w-4" aria-hidden />}{payment === "ONLINE" ? "Pay securely" : "Place order"}{q ? ` · ${formatMoney(q.totals.totalMinor)}` : ""}</span>}
                </button>}
            </div>
          </div>
        </div>

        <OrderSummary quote={q ?? null} payable={step === 2} />
      </div>
    </div>
  );
}

const onlineHow = (c: PayChoice): OnlineMethod | undefined => (c === "UPI" || c === "CARD" || c === "NETBANKING" ? c : undefined);

function Success({ order }: { order: Order }) {
  const paidOnline = order.payment?.method === "ONLINE" && order.payment.status === "PAID";
  return (
    <div className="container-x py-12 sm:py-16">
      <div className="card mx-auto max-w-xl p-6 text-center sm:p-8" role="status" aria-live="polite">
        <CheckCircle2 className="mx-auto h-14 w-14 text-ok" aria-hidden />
        <h1 className="mt-3 text-2xl font-extrabold">{paidOnline ? "Payment successful" : "Order placed"}</h1>
        <p className="mt-1 text-muted">{paidOnline ? `We received ${formatMoney(order.totalMinor)}. Thank you for your order!` : `Please keep ${formatMoney(order.totalMinor)} ready to pay on delivery.`}</p>
        <p className="mx-auto mt-4 inline-block rounded-xl bg-band px-4 py-2 text-sm">Order ID <b data-testid="order-number">#{order.number}</b></p>
        <ul className="mt-5 divide-y divide-line rounded-xl border border-line text-left text-sm">
          {order.items.map((i) => <li key={i.id} className="flex justify-between gap-3 px-4 py-2.5"><span>{i.quantity} × {i.name}</span><span className="font-semibold">{formatMoney(i.unitMinor * i.quantity)}</span></li>)}
          <li className="flex justify-between gap-3 bg-band px-4 py-2.5 font-extrabold"><span>{paidOnline ? "Paid" : "To pay"}</span><span>{formatMoney(order.totalMinor)}</span></li>
        </ul>
        {order.estimatedDeliveryAt && <p className="mt-4 font-semibold">Estimated arrival around {formatTime(order.estimatedDeliveryAt)} <span className="font-normal text-muted">(an estimate, not a guarantee)</span></p>}
        <p className="mt-2 text-sm text-ink-soft">{formatAddress({ house: order.addrHouse, line1: order.addrLine1, landmark: order.addrLandmark, area: order.addrArea, district: order.addrDistrict, city: order.addrCity, state: order.addrState, pincode: order.addrPincode })}</p>
        <div className="mt-6 flex flex-col justify-center gap-3 sm:flex-row"><Link to="/shop" className="btn-add-solid px-8">Continue shopping</Link><Link to="/orders" className="btn-ghost">View my orders</Link></div>
      </div>
    </div>
  );
}

function PayPanel({ order, busy, error, onPay, onLater }: { order: Order; busy: boolean; error: { message: string; kind: "cancelled" | "failed" | "error" } | null; onPay: () => void; onLater: () => void }) {
  const Icon = error?.kind === "failed" ? XCircle : AlertTriangle;
  return (
    <div className="container-x py-12 sm:py-16">
      <div className="card mx-auto max-w-xl p-6 text-center sm:p-8" role="status" aria-live="polite">
        {busy ? <Spinner /> : error ? <Icon className={`mx-auto h-12 w-12 ${error.kind === "failed" ? "text-danger" : "text-warn"}`} aria-hidden /> : <Lock className="mx-auto h-10 w-10 text-accent" aria-hidden />}
        <h1 className="mt-3 text-2xl font-extrabold">{busy ? "Processing your payment…" : error?.kind === "failed" ? "Payment failed" : error?.kind === "cancelled" ? "Payment cancelled" : error ? "We could not start the payment" : "Complete your payment"}</h1>
        {busy && <p className="mt-2 font-semibold">Please do not refresh or close this page.</p>}
        {!busy && error && <p role="alert" className="mx-auto mt-3 max-w-md rounded-xl bg-band p-3 text-sm font-semibold">{error.message}</p>}
        <p className="mt-4 text-sm text-muted">Order <b>#{order.number}</b> · Amount to pay <b className="text-ink">{formatMoney(order.totalMinor)}</b></p>
        <div className="mt-6 flex flex-col justify-center gap-3 sm:flex-row">
          <button className="btn-add-solid px-8" onClick={onPay} disabled={busy}>{busy ? "Processing…" : error ? "Retry payment" : "Pay securely"}</button>
          <Link to="/orders" onClick={onLater} className="btn-ghost">Pay later from My orders</Link>
        </div>
        <p className="mt-4 text-xs text-muted">Your order is saved and your cart is kept. Nothing is charged until the payment succeeds.</p>
      </div>
    </div>
  );
}
