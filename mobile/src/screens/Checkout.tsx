import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { api, errMsg } from "../lib/api";
import { money } from "../lib/format";
import { PaymentNotCompleted, type OnlineMethod } from "../lib/payOnline";
import { c } from "../lib/theme";
import type { AppConfig, Delivery, Order } from "../lib/types";
import { useAuth } from "../context/AuthContext";
import { useCart } from "../context/CartContext";
import { usePayment } from "../context/PaymentContext";
import { Button, ErrorText, Field } from "../components";
import { AddressForm, addressPayload, emptyAddress, validateAddress, type AddressDraft } from "../components/AddressForm";
import { PaymentMethods, type PayChoice } from "../components/PaymentMethods";
import type { RootStack } from "../navigation";

const STEPS = ["Contact", "Address", "Review & pay"];
const onlineHow = (p: PayChoice): OnlineMethod | undefined => (p === "UPI" || p === "CARD" || p === "NETBANKING" ? p : undefined);
const newRequestId = () => `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}${Math.random().toString(36).slice(2, 10)}`;
const formatAddress = (a: AddressDraft) => [a.house, a.line1, a.landmark, a.area, a.district, a.state, a.pincode].filter(Boolean).join(", ");

type PayError = { message: string; kind: "cancelled" | "failed" | "error" };

export default function Checkout({ navigation }: NativeStackScreenProps<RootStack, "Checkout">) {
  const { user } = useAuth();
  const cart = useCart();
  const { payForOrder } = usePayment();
  const [step, setStep] = useState(0);
  const [name, setName] = useState(user?.name ?? "");
  const [instructions, setInstructions] = useState("");
  const [addr, setAddr] = useState<AddressDraft>({ ...emptyAddress, phone: user?.phone ?? "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [delivery, setDelivery] = useState<Delivery | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [cfg, setCfg] = useState<{ loading: boolean; error: boolean; data: AppConfig | null }>({ loading: true, error: false, data: null });
  const [choice, setChoice] = useState<PayChoice>("COD");
  const [checking, setChecking] = useState(false);
  const [placing, setPlacing] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [done, setDone] = useState<Order | null>(null);
  // Online payment: the order is saved first, then paid. If the payment is cancelled or fails the order stays here so the customer can retry (no second order).
  const [unpaid, setUnpaid] = useState<Order | null>(null);
  const [payBusy, setPayBusy] = useState(false);
  const [payError, setPayError] = useState<PayError | null>(null);
  const attempt = useRef<{ id: string; sig: string } | null>(null);
  const inFlight = useRef(false); // blocks a second tap / double submit while an order or payment is being processed

  const loadCfg = () => {
    setCfg({ loading: true, error: false, data: null });
    api.get<AppConfig>("/config").then((r) => setCfg({ loading: false, error: false, data: r.data })).catch(() => setCfg({ loading: false, error: true, data: null }));
  };
  useEffect(loadCfg, []);

  const patch = (p: Partial<AddressDraft>) => {
    setAddr((cur) => ({ ...cur, ...p }));
    setErrors((e) => {
      const n = { ...e };
      for (const k of Object.keys(p)) delete n[k];
      return n;
    });
  };

  const pay = async (o: Order, how?: OnlineMethod) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setPayBusy(true);
    setPayError(null);
    try {
      const paid = await payForOrder(o.id, how); // the server verified the payment before answering
      cart.clear(); // only now, so a cancelled or failed payment never costs the customer their cart
      setDone(paid);
      setUnpaid(null);
    } catch (ex) {
      if (ex instanceof PaymentNotCompleted) setPayError({ message: ex.message, kind: ex.kind });
      else setPayError({ message: errMsg(ex), kind: "error" });
    } finally {
      setPayBusy(false);
      inFlight.current = false;
    }
  };

  const goOrders = () => navigation.reset({ index: 0, routes: [{ name: "Tabs", params: { screen: "Orders" } }] });
  const goShop = () => navigation.reset({ index: 0, routes: [{ name: "Tabs", params: { screen: "Shop" } }] });

  if (done) return <Success order={done} onShop={goShop} onOrders={goOrders} />;
  if (unpaid) return <PayPanel order={unpaid} busy={payBusy} error={payError} onPay={() => pay(unpaid, onlineHow(choice))} onLater={() => { cart.clear(); goOrders(); }} />;

  const q = cart.quote;
  const codOk = cfg.data?.payments.cod ?? true;
  const onlineOk = cfg.data?.payments.online ?? false;
  // An unavailable method is shown with the reason (never silently hidden); the customer is moved to one that works.
  const available = (p: PayChoice) => (p === "COD" ? codOk : onlineOk);
  const selectedChoice: PayChoice = available(choice) ? choice : (["UPI", "CARD", "NETBANKING", "COD"] as PayChoice[]).find(available) ?? choice;
  const payment: "COD" | "ONLINE" = selectedChoice === "COD" ? "COD" : "ONLINE";
  const onlineNote = cfg.error ? "We couldn't check online payment options. Please retry." : cfg.loading ? "Checking availability…" : "Online payment isn't set up for this store yet. Cash on delivery still works.";

  const next = async () => {
    setServerError(null);
    if (step === 0) {
      const e: Record<string, string> = {};
      if (name.trim().length < 2) e.name = "Enter the recipient's name";
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
        if (!data.serviceable) {
          setErrors({ pincode: data.reason === "paused" ? `Delivery to ${data.pincode} is temporarily paused.` : `We don't deliver to ${data.pincode} yet. Try another PIN code.` });
          return;
        }
      } catch (ex) {
        setErrors({ pincode: errMsg(ex) });
        return;
      } finally {
        setChecking(false);
      }
    }
    setErrors({});
    setStep((s) => s + 1);
  };

  const place = async () => {
    if (!q || inFlight.current) return;
    if (!confirmed) return setServerError("Please confirm your delivery address");
    inFlight.current = true;
    setPlacing(true);
    setServerError(null);
    try {
      // A coupon is optional. Only one the quote accepted is sent; the server validates it and calculates the total itself.
      const appliedCode = cart.code && q.discountCode ? cart.code : undefined;
      const body = {
        items: cart.items,
        code: appliedCode,
        contactName: name.trim(),
        contactPhone: addr.phone,
        address: addressPayload(addr),
        saveAddress: true,
        addressConfirmed: true,
        instructions: instructions.trim() || undefined,
        paymentMethod: payment,
        expectedTotalMinor: q.totals.totalMinor, // the server refuses if prices changed since this total was shown
      };
      // Same content = same key (a retry returns the order already created); changed content = a new key.
      const sig = JSON.stringify(body);
      if (attempt.current?.sig !== sig) attempt.current = { id: newRequestId(), sig };
      const r = await api.post<{ order: Order }>("/orders", { ...body, requestId: attempt.current.id });
      if (payment === "ONLINE") {
        // The order is saved first (cart kept until the payment succeeds), then paid. A cancelled or failed payment retries this same order.
        setUnpaid(r.data.order);
        setPlacing(false);
        inFlight.current = false;
        await pay(r.data.order, onlineHow(selectedChoice));
        return;
      }
      cart.clear();
      inFlight.current = false;
      setDone(r.data.order);
    } catch (ex) {
      inFlight.current = false;
      setServerError(errMsg(ex));
      setConfirmed(false);
    } finally {
      setPlacing(false);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView style={{ backgroundColor: c.bg }} contentContainerStyle={{ padding: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
        <View style={{ flexDirection: "row", gap: 8, marginBottom: 18 }}>
          {STEPS.map((s, i) => (
            <View key={s} style={{ flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", borderRadius: 999, paddingVertical: 8, paddingHorizontal: 6, backgroundColor: i === step ? c.brand : i < step ? c.border : c.tint }}>
              <Text style={{ color: i === step ? c.onBrand : i < step ? c.text : c.muted, fontWeight: "800", fontSize: 11 }} numberOfLines={1}>{i + 1} {s}</Text>
            </View>
          ))}
        </View>

        {step === 0 ? (
          <View>
            <Text style={h2}>Who is receiving the order?</Text>
            <Text style={{ color: c.muted, fontSize: 13, marginBottom: 14 }}>We'll ask for a contact number with the delivery address.</Text>
            <Field label="Recipient name" value={name} error={errors.name} onChangeText={setName} autoCapitalize="words" autoComplete="name" />
            <Field label="Delivery instructions (optional)" value={instructions} onChangeText={setInstructions} autoCapitalize="sentences" maxLength={300} multiline />
          </View>
        ) : null}

        {step === 1 ? (
          <View>
            <Text style={h2}>Where should we deliver?</Text>
            <AddressForm value={addr} errors={errors} onChange={patch} />
          </View>
        ) : null}

        {step === 2 ? (
          <View>
            <Text style={h2}>Review &amp; pay</Text>
            <View style={{ backgroundColor: c.tint, borderRadius: 14, padding: 14 }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                <Text style={{ color: c.text, fontWeight: "800" }}>Deliver to</Text>
                <Pressable onPress={() => setStep(1)}><Text style={{ color: c.text, fontSize: 12, fontWeight: "600", textDecorationLine: "underline" }}>Change</Text></Pressable>
              </View>
              <Text style={{ color: c.text, marginTop: 6 }}>{name} · {addr.phone}</Text>
              <Text style={{ color: c.muted, marginTop: 2 }}>{formatAddress(addr)}</Text>
              <Text style={{ color: c.muted, fontSize: 12, marginTop: 6 }}>{addr.latitude !== null ? `GPS pin included (${addr.latitude}, ${addr.longitude})` : "No GPS pin (manual address)"}</Text>
              {delivery?.serviceable ? <Text style={{ color: c.text, fontWeight: "600", marginTop: 6 }}>Estimated delivery: about {delivery.etaMinutes} min (an estimate, not a guarantee)</Text> : null}
              {instructions ? <Text style={{ color: c.muted, marginTop: 6 }}>Note: {instructions}</Text> : null}
            </View>

            <Pressable
              accessibilityRole="checkbox"
              accessibilityState={{ checked: confirmed }}
              onPress={() => { setConfirmed((v) => !v); setServerError(null); }}
              style={{ flexDirection: "row", alignItems: "flex-start", borderWidth: 1, borderColor: !confirmed && serverError ? c.danger : c.border, borderRadius: 14, padding: 12, marginTop: 14 }}
            >
              <Ionicons name={confirmed ? "checkbox" : "square-outline"} size={22} color={confirmed ? c.brand : c.muted} />
              <Text style={{ color: c.text, fontWeight: "600", marginLeft: 10, flex: 1 }}>I confirm this delivery address is correct.</Text>
            </Pressable>

            <Text style={[h2, { marginTop: 20 }]}>Payment method</Text>
            {cfg.error ? (
              <View style={{ marginBottom: 10 }}>
                <ErrorText>We couldn't load payment options.</ErrorText>
                <Button title="Retry" kind="ghost" onPress={loadCfg} />
              </View>
            ) : null}
            <PaymentMethods value={selectedChoice} onChange={setChoice} codOk={codOk} onlineOk={onlineOk} onlineNote={onlineNote} />
            <View style={{ flexDirection: "row", backgroundColor: c.tint, borderRadius: 14, padding: 12, marginTop: 12 }}>
              <Ionicons name="lock-closed" size={16} color={c.ok} style={{ marginTop: 2 }} />
              <Text style={{ color: c.text, fontSize: 12, lineHeight: 18, marginLeft: 8, flex: 1 }}>
                {payment === "ONLINE"
                  ? `Secure checkout. You pay ${q ? money(q.totals.totalMinor) : "the total"} in Razorpay's secure window. We never see or store your card, UPI or bank details. Your order is confirmed only after the payment succeeds.`
                  : `You pay ${q ? money(q.totals.totalMinor) : "the total"} in cash when your order arrives.`}
              </Text>
            </View>

            {q ? (
              <View style={{ backgroundColor: c.card, borderRadius: 14, padding: 14, marginTop: 14, borderWidth: 1, borderColor: c.border }}>
                <Line label="Subtotal" value={money(q.totals.subtotalMinor)} />
                {q.totals.discountMinor > 0 ? <Line label="Discount" value={`− ${money(q.totals.discountMinor)}`} /> : null}
                <Line label="Delivery" value={q.totals.deliveryMinor ? money(q.totals.deliveryMinor) : "Free"} />
                <Line label="Tax" value={money(q.totals.taxMinor)} />
                <Line label="Total" value={money(q.totals.totalMinor)} bold />
              </View>
            ) : null}
            {q?.issues.map((i) => <ErrorText key={i.productId + i.message}>{i.message}</ErrorText>)}
          </View>
        ) : null}

        {serverError ? <Text style={{ color: c.danger, fontWeight: "600", backgroundColor: c.tint, borderRadius: 12, padding: 12, marginTop: 14 }}>{serverError}</Text> : null}

        <View style={{ flexDirection: "row", gap: 10, marginTop: 18 }}>
          <Button title="Back" kind="ghost" onPress={() => (step > 0 ? setStep(step - 1) : navigation.goBack())} disabled={placing} style={{ flex: 1 }} />
          {step < 2 ? (
            <Button title="Continue" onPress={next} loading={checking} style={{ flex: 2 }} />
          ) : (
            <Button
              title={`${payment === "ONLINE" ? "Pay securely" : "Place order"}${q ? ` · ${money(q.totals.totalMinor)}` : ""}`}
              onPress={place}
              loading={placing}
              disabled={!q || q.issues.length > 0 || cfg.loading}
              style={{ flex: 2 }}
            />
          )}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const h2 = { fontSize: 18, fontWeight: "800", color: c.text, marginBottom: 12 } as const;

function Line({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  const st = { color: c.text, fontWeight: bold ? ("800" as const) : ("400" as const), fontSize: bold ? 17 : 14 };
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", marginVertical: 3 }}>
      <Text style={st}>{label}</Text>
      <Text style={st}>{value}</Text>
    </View>
  );
}

function Success({ order, onShop, onOrders }: { order: Order; onShop: () => void; onOrders: () => void }) {
  const paidOnline = order.payment?.method === "ONLINE" && order.payment.status === "PAID";
  return (
    <ScrollView style={{ backgroundColor: c.bg }} contentContainerStyle={{ padding: 20, alignItems: "center" }}>
      <View style={{ width: "100%", backgroundColor: c.card, borderRadius: 24, padding: 22, alignItems: "center", borderWidth: 1, borderColor: c.border, marginTop: 20 }}>
        <Ionicons name="checkmark-circle" size={60} color={c.ok} />
        <Text style={{ color: c.text, fontSize: 22, fontWeight: "800", marginTop: 10 }}>{paidOnline ? "Payment successful" : "Order placed"}</Text>
        <Text style={{ color: c.muted, textAlign: "center", marginTop: 4 }}>
          {paidOnline ? `We received ${money(order.totalMinor)}. Thank you for your order!` : `Please keep ${money(order.totalMinor)} ready to pay on delivery.`}
        </Text>
        <View style={{ width: "100%", marginTop: 16, borderWidth: 1, borderColor: c.border, borderRadius: 12 }}>
          {order.items.map((i) => (
            <View key={i.id} style={{ flexDirection: "row", justifyContent: "space-between", padding: 12, borderBottomWidth: 1, borderBottomColor: c.border }}>
              <Text style={{ color: c.text, flex: 1 }}>{i.quantity} × {i.name}</Text>
              <Text style={{ color: c.text, fontWeight: "600" }}>{money(i.unitMinor * i.quantity)}</Text>
            </View>
          ))}
          <View style={{ flexDirection: "row", justifyContent: "space-between", padding: 12, backgroundColor: c.tint }}>
            <Text style={{ color: c.text, fontWeight: "800" }}>{paidOnline ? "Paid" : "To pay"}</Text>
            <Text style={{ color: c.text, fontWeight: "800" }}>{money(order.totalMinor)}</Text>
          </View>
        </View>
        {order.estimatedDeliveryAt ? (
          <Text style={{ color: c.text, fontWeight: "600", marginTop: 14, textAlign: "center" }}>
            Estimated arrival around {new Date(order.estimatedDeliveryAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} <Text style={{ color: c.muted, fontWeight: "400" }}>(an estimate, not a guarantee)</Text>
          </Text>
        ) : null}
        <Text style={{ color: c.muted, marginTop: 8, textAlign: "center" }}>
          {[order.addrHouse, order.addrLine1, order.addrLandmark, order.addrArea, order.addrDistrict ?? order.addrCity, order.addrState, order.addrPincode].filter(Boolean).join(", ")}
        </Text>
        <View style={{ width: "100%", gap: 10, marginTop: 20 }}>
          <Button title="Continue shopping" onPress={onShop} />
          <Button title="View my orders" kind="ghost" onPress={onOrders} />
        </View>
      </View>
    </ScrollView>
  );
}

function PayPanel({ order, busy, error, onPay, onLater }: { order: Order; busy: boolean; error: PayError | null; onPay: () => void; onLater: () => void }) {
  const title = busy ? "Processing your payment…" : error?.kind === "failed" ? "Payment failed" : error?.kind === "cancelled" ? "Payment cancelled" : error ? "We could not start the payment" : "Complete your payment";
  return (
    <ScrollView style={{ backgroundColor: c.bg }} contentContainerStyle={{ padding: 20 }}>
      <View style={{ backgroundColor: c.card, borderRadius: 24, padding: 22, alignItems: "center", borderWidth: 1, borderColor: c.border, marginTop: 20 }}>
        {busy ? <ActivityIndicator color={c.accent} size="large" /> : <Ionicons name={error ? (error.kind === "failed" ? "close-circle" : "alert-circle") : "lock-closed"} size={48} color={error ? (error.kind === "failed" ? c.danger : c.warn) : c.brand} />}
        <Text style={{ color: c.text, fontSize: 22, fontWeight: "800", marginTop: 12, textAlign: "center" }}>{title}</Text>
        {busy ? <Text style={{ color: c.text, fontWeight: "600", marginTop: 8, textAlign: "center" }}>Please do not close the app.</Text> : null}
        {!busy && error ? <Text style={{ color: c.text, fontWeight: "600", backgroundColor: c.tint, borderRadius: 12, padding: 12, marginTop: 12, textAlign: "center" }}>{error.message}</Text> : null}
        <Text style={{ color: c.muted, marginTop: 14 }}>Amount to pay <Text style={{ fontWeight: "800", color: c.text }}>{money(order.totalMinor)}</Text></Text>
        <View style={{ width: "100%", gap: 10, marginTop: 20 }}>
          <Button title={busy ? "Processing…" : error ? "Retry payment" : "Pay securely"} onPress={onPay} disabled={busy} />
          <Button title="Pay later from My orders" kind="ghost" onPress={onLater} disabled={busy} />
        </View>
        <Text style={{ color: c.muted, fontSize: 12, marginTop: 14, textAlign: "center" }}>Your order is saved and your cart is kept. Nothing is charged until the payment succeeds.</Text>
      </View>
    </ScrollView>
  );
}
