import { useEffect, useRef, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { CheckCircle2, MapPin } from "lucide-react";
import { api, apiError } from "../lib/api";
import type { Address, AppConfig, Delivery, Order } from "../lib/types";
import { formatAddress, formatMoney, formatTime } from "../lib/format";
import { useAuth } from "../context/AuthContext";
import { useCart } from "../context/CartContext";
import { useLocationCtx } from "../context/LocationContext";
import { ErrorState, FieldError, Spinner, useAsync } from "../components/ui";
import { AddressForm, addressPayload, draftFromRecord, emptyAddress, validateAddress, type AddressDraft } from "../components/AddressForm";
import { DiscountBox, OrderTotals } from "./CartPage";

const STEPS = ["Contact", "Address", "Review & pay"];

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
  const [payment, setPayment] = useState<"COD" | "CARD">("COD");
  const [checking, setChecking] = useState(false);
  const [placing, setPlacing] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [order, setOrder] = useState<Order | null>(null);

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

  if (order) return <Success order={order} />;
  if (!cart.items.length) return <Navigate to="/cart" replace />;

  const q = cart.quote;
  const selected = saved.data?.find((a) => a.id === selectedId) ?? null;
  const unchanged = selected ? sameDraft(addr, toDraft(selected)) : false;
  const codOk = cfg.data?.payments.cod ?? true;

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
    if (!q || q.issues.length) return setServerError("Some items in your cart need attention.");
    if (!confirmed) return setServerError("Please confirm that your delivery address is correct.");
    setPlacing(true);
    setServerError(null);
    try {
      const r = await api.post<{ order: Order }>("/orders", {
        items: cart.items, code: cart.code || undefined,
        contactName: contact.name.trim(), contactPhone: addr.phone,
        address: addressPayload(addr),
        addressId: selected && unchanged ? selected.id : undefined,
        saveAddress: !(selected && unchanged) && saveAddress ? true : undefined,
        addressConfirmed: true,
        instructions: contact.instructions.trim() || undefined,
        paymentMethod: payment,
        expectedTotalMinor: q.totals.totalMinor, // the server refuses if prices changed since this total was shown
      });
      cart.clear();
      setOrder(r.data.order);
    } catch (ex) {
      const info = apiError(ex);
      setServerError(info.message);
      cart.refresh(); // pick up changed prices / stock
      if (info.status === 409) setConfirmed(false);
    } finally { setPlacing(false); }
  };

  return (
    <div className="container-x py-8">
      <h1 className="text-3xl font-extrabold">Checkout</h1>
      <ol className="mt-4 flex gap-2 overflow-x-auto" aria-label="Checkout steps">
        {STEPS.map((s, i) => (
          <li key={s} aria-current={i === step ? "step" : undefined} className={`flex shrink-0 items-center gap-2 rounded-full px-3 py-1.5 text-xs font-bold ${i === step ? "bg-action text-on-action" : i < step ? "bg-secondary text-ink" : "bg-tint text-muted"}`}>
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
              <label className="flex items-start gap-2 text-sm font-semibold"><input type="checkbox" className="mt-1" checked={confirmed} onChange={(e) => { setConfirmed(e.target.checked); if (e.target.checked) setServerError(null); }} /> I confirm this delivery address is correct.</label>
              <fieldset>
                <legend className="label">Payment</legend>
                {cfg.error && <ErrorState message={cfg.error} onRetry={cfg.reload} />}
                <div className="space-y-2">
                  <label className={`flex items-start gap-3 rounded-xl border p-3 text-sm ${payment === "COD" ? "border-accent bg-tint/60" : "border-line"} ${codOk ? "" : "opacity-50"}`}>
                    <input type="radio" name="pay" className="mt-1" disabled={!codOk} checked={payment === "COD"} onChange={() => setPayment("COD")} /><span><b>Cash on delivery</b><br /><span className="text-muted">Pay when your order arrives.</span></span>
                  </label>
                  <label className="flex items-start gap-3 rounded-xl border border-line p-3 text-sm opacity-50">
                    <input type="radio" name="pay" className="mt-1" disabled /><span><b>Card / UPI</b><br /><span className="text-muted">Online payment is not available yet.</span></span>
                  </label>
                </div>
              </fieldset>
              <DiscountBox />
            </div>
          )}

          {serverError && <p role="alert" className="mt-4 rounded-xl bg-band p-3 text-sm font-semibold text-danger">{serverError}</p>}
          <div className="mt-6 flex items-center justify-between gap-3">
            {step > 0 ? <button className="btn-ghost" onClick={() => setStep(step - 1)}>Back</button> : <Link to="/cart" className="btn-ghost">Back to cart</Link>}
            {step < 2 ? <button className="btn-primary" onClick={next} disabled={checking}>{checking ? "Checking delivery…" : "Continue"}</button>
              : <button className="btn-add-solid px-8" onClick={place} disabled={placing || !q || q.issues.length > 0}>{placing ? "Placing order…" : `Place order${q ? ` · ${formatMoney(q.totals.totalMinor)}` : ""}`}</button>}
          </div>
        </div>

        <aside className="card h-fit p-5 lg:sticky lg:top-28" aria-label="Order summary">
          <h2 className="mb-4 text-lg font-extrabold">Order summary</h2>
          {q ? <><ul className="mb-4 space-y-1.5 text-sm">{q.lines.map((l) => <li key={l.productId} className="flex justify-between gap-3"><span>{l.quantity} × {l.name}</span><span className="font-semibold">{formatMoney(l.unitMinor * l.quantity)}</span></li>)}</ul><OrderTotals quote={q} />
            {q.issues.map((i) => <p key={i.productId} role="alert" className="mt-2 text-xs font-semibold text-danger">{i.message}</p>)}</> : <Spinner />}
        </aside>
      </div>
    </div>
  );
}

function Success({ order }: { order: Order }) {
  return (
    <div className="container-x py-16">
      <div className="card mx-auto max-w-xl p-8 text-center">
        <CheckCircle2 className="mx-auto h-12 w-12 text-ok" aria-hidden />
        <h1 className="mt-3 text-2xl font-extrabold">Order #{order.number} placed</h1>
        <p className="mt-1 text-muted">Pay {formatMoney(order.totalMinor)} on delivery.</p>
        {order.estimatedDeliveryAt && <p className="mt-2 font-semibold">Estimated arrival around {formatTime(order.estimatedDeliveryAt)} (an estimate, not a guarantee)</p>}
        <p className="mt-2 text-sm text-ink-soft">{formatAddress({ house: order.addrHouse, line1: order.addrLine1, landmark: order.addrLandmark, area: order.addrArea, district: order.addrDistrict, city: order.addrCity, state: order.addrState, pincode: order.addrPincode })}</p>
        <div className="mt-6 flex justify-center gap-3"><Link to="/orders" className="btn-primary">View my orders</Link><Link to="/shop" className="btn-ghost">Keep shopping</Link></div>
      </div>
    </div>
  );
}
