import { useCallback, useState } from "react";
import { ActivityIndicator, Alert, FlatList, Modal, Pressable, RefreshControl, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import type { BottomTabScreenProps } from "@react-navigation/bottom-tabs";
import { api, errMsg } from "../lib/api";
import { money } from "../lib/format";
import { c } from "../lib/theme";
import type { Order } from "../lib/types";
import { useAuth } from "../context/AuthContext";
import { useCart } from "../context/CartContext";
import { usePayment } from "../context/PaymentContext";
import { Button, Center, ErrorText, Thumb } from "../components";
import type { TabsParam } from "../navigation";

const LABEL: Record<string, string> = { PLACED: "Placed", CONFIRMED: "Confirmed", PREPARING: "Preparing", OUT_FOR_DELIVERY: "Out for delivery", DELIVERED: "Delivered", CANCELLED: "Cancelled" };

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
    case "REQUESTED": return { title: "Refund initiated", body: "We are sending your refund request to the payment provider. You don't need to do anything.", tone: "muted" };
    case "PROCESSING": return { title: "Refund processing", body: "The payment provider has accepted your refund and is processing it. Banks usually take about 5–7 business days to show it.", tone: "muted" };
    case "COMPLETED": return { title: "Refund completed", body: `The payment provider confirmed your refund${p.refundedAt ? ` on ${new Date(p.refundedAt).toLocaleString()}` : ""}. It goes back to your original payment method.`, tone: "ok" };
    case "FAILED": return { title: "Refund needs attention", body: "The payment provider could not complete this refund. Our team has been notified and will contact you; you can also reach out to us.", tone: "danger" };
    default: return null;
  }
}

const toneColor = (t: "ok" | "danger" | "muted") => (t === "ok" ? c.ok : t === "danger" ? c.danger : c.muted);
// Customers can cancel while the order is Placed or Confirmed.
const canCancel = (o: Order) => o.status === "PLACED" || o.status === "CONFIRMED";

export default function Orders({ navigation }: BottomTabScreenProps<TabsParam, "Orders">) {
  const { user } = useAuth();
  const { payForOrder } = usePayment();
  const cart = useCart();
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [working, setWorking] = useState<string | null>(null); // `${orderId}:pay` | `${orderId}:refund`
  const [target, setTarget] = useState<Order | null>(null); // the order the cancel sheet is open for
  const [cancelBusy, setCancelBusy] = useState(false);
  const [cancelledNow, setCancelledNow] = useState<Order | null>(null); // set right after a successful cancel: the sheet then shows the result
  const [cancelError, setCancelError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setOrders((await api.get<{ orders: Order[] }>("/orders")).data.orders);
      setError(null);
    } catch (e) {
      setError(errMsg(e));
    }
  }, []);
  useFocusEffect(useCallback(() => { if (user) load(); }, [user, load]));

  if (!user)
    return (
      <Center>
        <Text style={{ color: c.text, fontWeight: "700", fontSize: 17, marginBottom: 12 }}>Log in to see your orders</Text>
        <Button title="Log in" onPress={() => navigation.navigate("Account")} />
      </Center>
    );
  if (!orders && !error) return <Center><ActivityIndicator color={c.accent} /></Center>;

  const patch = (o: Order) => setOrders((cur) => (cur ? cur.map((x) => (x.id === o.id ? { ...x, ...o } : x)) : cur));

  const payNow = async (o: Order) => {
    setWorking(`${o.id}:pay`);
    try {
      patch(await payForOrder(o.id));
      Alert.alert("Payment received", "Your order is paid.");
      void load();
    } catch (e) {
      Alert.alert("Payment not completed", e instanceof Error ? e.message : errMsg(e));
    } finally {
      setWorking(null);
    }
  };
  const checkRefund = async (o: Order) => {
    setWorking(`${o.id}:refund`);
    try {
      patch((await api.post<{ order: Order }>(`/orders/${o.id}/refund/refresh`)).data.order);
    } catch (e) {
      Alert.alert("Could not check", errMsg(e));
    } finally {
      setWorking(null);
    }
  };
  const confirmCancel = async (reason: string) => {
    if (!target) return;
    setCancelBusy(true);
    setCancelError(null);
    try {
      const r = await api.post<{ order: Order }>(`/orders/${target.id}/cancel`, reason ? { reason } : {});
      patch(r.data.order);
      setCancelledNow(r.data.order);
      void load();
    } catch (e) {
      setCancelError(errMsg(e));
    } finally {
      setCancelBusy(false);
    }
  };
  const cancel = (o: Order) => {
    setCancelError(null);
    setCancelledNow(null);
    setTarget(o);
  };
  const closeSheet = () => {
    if (cancelBusy) return;
    setTarget(null);
    setCancelledNow(null);
  };
  const reorder = (o: Order) => {
    o.items.forEach((i) => cart.setQty(i.productId, cart.qtyOf(i.productId) + i.quantity));
    navigation.navigate("Cart");
  };

  return (
    <>
    <FlatList
      style={{ backgroundColor: c.bg }}
      data={orders ?? []}
      keyExtractor={(o) => o.id}
      contentContainerStyle={{ padding: 16 }}
      refreshControl={<RefreshControl tintColor={c.brand} refreshing={refreshing} onRefresh={() => { setRefreshing(true); load().finally(() => setRefreshing(false)); }} />}
      ListHeaderComponent={<ErrorText>{error}</ErrorText>}
      ListEmptyComponent={error ? undefined : <Text style={{ textAlign: "center", color: c.muted, marginTop: 40 }}>No orders yet.</Text>}
      renderItem={({ item: o }) => {
        const pay = paymentLabel(o);
        const refund = refundInfo(o.payment);
        const cancelled = o.status === "CANCELLED";
        const unpaidOnline = o.payment?.method === "ONLINE" && o.payment.status !== "PAID" && o.payment.status !== "REFUNDED" && !cancelled;
        return (
          <View style={{ backgroundColor: c.card, borderRadius: 14, padding: 14, marginBottom: 12, borderWidth: 1, borderColor: c.border }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
              <Text style={{ fontWeight: "700", color: c.text }}>{new Date(o.createdAt).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}</Text>
              <Text style={{ fontWeight: "600", color: cancelled ? c.danger : o.status === "DELIVERED" ? c.ok : c.brand }}>{LABEL[o.status] ?? o.status}</Text>
            </View>
            <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 8 }}>
              <Text style={{ color: c.muted, fontSize: 12 }}>{new Date(o.createdAt).toLocaleString()}</Text>
              <Text style={{ color: toneColor(pay.tone), fontSize: 12, fontWeight: "700" }}>{pay.text}</Text>
            </View>

            {cancelled ? (
              <View style={{ flexDirection: "row", backgroundColor: c.tint, borderRadius: 14, padding: 12, marginBottom: 10, borderLeftWidth: 4, borderLeftColor: c.danger }}>
                <Ionicons name="close-circle" size={22} color={c.danger} />
                <View style={{ flex: 1, marginLeft: 10 }}>
                  <Text style={{ color: c.danger, fontWeight: "800", fontSize: 15 }}>Order cancelled</Text>
                  <Text style={{ color: c.muted, fontSize: 12, marginTop: 2 }}>
                    {new Date(o.cancelledAt ?? o.updatedAt).toLocaleString()}{o.cancelledBy === "ADMIN" ? " · cancelled by our team" : ""}
                  </Text>
                  {o.cancelReason ? (
                    <Text style={{ alignSelf: "flex-start", color: c.text, fontSize: 11, fontWeight: "600", borderWidth: 1, borderColor: c.border, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3, marginTop: 8, overflow: "hidden" }}>{o.cancelReason}</Text>
                  ) : null}
                </View>
              </View>
            ) : null}

            {refund ? (
              <View style={{ flexDirection: "row", backgroundColor: c.tint, borderRadius: 14, padding: 12, marginBottom: 10, borderLeftWidth: 4, borderLeftColor: refund.tone === "ok" ? c.ok : refund.tone === "danger" ? c.danger : c.accent }}>
                <Ionicons name={refund.tone === "ok" ? "checkmark-circle" : refund.tone === "danger" ? "alert-circle" : "time-outline"} size={22} color={refund.tone === "ok" ? c.ok : refund.tone === "danger" ? c.danger : c.accent} />
                <View style={{ flex: 1, marginLeft: 10 }}>
                  <Text style={{ color: c.text, fontWeight: "800" }}>{refund.title}</Text>
                  <Text style={{ color: c.muted, fontSize: 12, lineHeight: 18, marginTop: 2 }}>{refund.body}</Text>
                  {o.payment?.refundStatus === "PROCESSING" || o.payment?.refundStatus === "REQUESTED" ? (
                    <Button title={working === `${o.id}:refund` ? "Checking…" : "Check refund status"} kind="ghost" onPress={() => checkRefund(o)} disabled={working === `${o.id}:refund`} style={{ marginTop: 10, paddingVertical: 8 }} />
                  ) : null}
                </View>
              </View>
            ) : null}

            {o.items.map((i) => (
              <View key={i.id} style={{ flexDirection: "row", alignItems: "center", marginVertical: 3, opacity: cancelled ? 0.6 : 1 }}>
                <Thumb uri={i.image} size={36} />
                <Text style={{ flex: 1, marginLeft: 10, color: c.text }} numberOfLines={1}>{i.name}</Text>
                <Text style={{ color: c.muted }}>×{i.quantity}</Text>
              </View>
            ))}
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginTop: 8 }}>
              <Text style={{ color: c.muted, flex: 1, paddingRight: 10 }}>{o.payment?.method === "ONLINE" ? "Online (UPI / card / net banking)" : "Cash on delivery"}{o.payment?.paidAt ? ` · paid ${new Date(o.payment.paidAt).toLocaleDateString()}` : ""}</Text>
              <Text style={{ fontWeight: "800", color: c.text }}>{money(o.totalMinor)}</Text>
            </View>
            {o.payment?.status === "FAILED" && o.payment.failureReason ? <Text style={{ color: c.warn, fontSize: 12, marginTop: 4 }}>{o.payment.failureReason}</Text> : null}

            {unpaidOnline ? (
              <Button title={working === `${o.id}:pay` ? "Opening payment…" : `Pay ${money(o.totalMinor)} now`} onPress={() => payNow(o)} loading={working === `${o.id}:pay`} disabled={working !== null} style={{ marginTop: 10 }} />
            ) : null}
            {cancelled ? <Button title="Order again" onPress={() => reorder(o)} style={{ marginTop: 12 }} /> : null}
            {canCancel(o) ? <Button title="Cancel order" kind="ghost" onPress={() => cancel(o)} disabled={working !== null} style={{ marginTop: 10 }} /> : null}
          </View>
        );
      }}
    />
    <CancelSheet order={target} done={cancelledNow} busy={cancelBusy} error={cancelError} onConfirm={confirmCancel} onClose={closeSheet} />
    </>
  );
}

const REASONS = ["Ordered by mistake", "Found a better price elsewhere", "Delivery will take too long", "Changed my mind", "Other"];

/** Bottom sheet shown before an order is cancelled: says what happens to the money, and lets the customer pick an optional reason. */
function CancelSheet({ order, done, busy, error, onConfirm, onClose }: { order: Order | null; done: Order | null; busy: boolean; error: string | null; onConfirm: (reason: string) => void; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const [reason, setReason] = useState("");
  const paidOnline = order?.payment?.method === "ONLINE" && order.payment.status === "PAID";
  const unpaidOnline = order?.payment?.method === "ONLINE" && !paidOnline;
  const note = paidOnline
    ? `You paid ${money(order!.totalMinor)} online. When you cancel, we ask Razorpay for a full refund to your original payment method. The refund is only complete once the payment provider confirms it, and banks usually take about 5–7 business days.`
    : unpaidOnline
      ? "No payment was taken for this order, so there is nothing to refund."
      : "This is a cash on delivery order, so no payment has been taken.";
  return (
    <Modal visible={!!order} transparent animationType="slide" onRequestClose={onClose} onShow={() => setReason("")}>
      <Pressable style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" }} onPress={onClose}>
        <Pressable onPress={() => undefined} style={{ backgroundColor: c.card, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 20, paddingBottom: insets.bottom + 20, borderTopWidth: 1, borderColor: c.border }}>
          <View style={{ alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: c.border, marginBottom: 16 }} />
          {done ? <CancelledResult order={done} onDone={onClose} /> : null}
          {done ? null : (
          <>
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: c.tint, alignItems: "center", justifyContent: "center" }}>
              <Ionicons name="close-circle-outline" size={26} color={c.danger} />
            </View>
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={{ color: c.text, fontSize: 19, fontWeight: "800" }}>Cancel this order?</Text>
              <Text style={{ color: c.muted, fontSize: 13 }}>{order ? `${order.items.length} item${order.items.length === 1 ? "" : "s"} · ${money(order.totalMinor)}` : ""}</Text>
            </View>
          </View>

          <View style={{ flexDirection: "row", backgroundColor: c.tint, borderRadius: 14, padding: 12, marginTop: 16 }}>
            <Ionicons name={paidOnline ? "card-outline" : "information-circle-outline"} size={18} color={c.accent} style={{ marginTop: 1 }} />
            <Text style={{ color: c.text, fontSize: 13, lineHeight: 19, marginLeft: 10, flex: 1 }}>{note}</Text>
          </View>

          <Text style={{ color: c.muted, fontSize: 13, fontWeight: "700", marginTop: 16, marginBottom: 8 }}>Reason (optional)</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
            {REASONS.map((r) => {
              const on = reason === r;
              return (
                <Pressable key={r} accessibilityState={{ selected: on }} disabled={busy} onPress={() => setReason(on ? "" : r)} style={{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, marginRight: 8, marginBottom: 8, borderWidth: 1, borderColor: on ? c.chipBg : c.border, backgroundColor: on ? c.chipBg : "transparent" }}>
                  <Text style={{ color: on ? c.chipText : c.text, fontSize: 12, fontWeight: "600" }}>{r}</Text>
                </Pressable>
              );
            })}
          </View>

          {error ? <Text style={{ color: c.danger, fontWeight: "600", backgroundColor: c.tint, borderRadius: 12, padding: 12, marginTop: 4 }}>{error}</Text> : null}

          <View style={{ flexDirection: "row", gap: 10, marginTop: 14 }}>
            <Button title="Keep order" kind="ghost" onPress={onClose} disabled={busy} style={{ flex: 1 }} />
            <Pressable accessibilityRole="button" disabled={busy} onPress={() => onConfirm(reason)} style={{ flex: 1, backgroundColor: "#b3261e", borderRadius: 10, paddingVertical: 13, alignItems: "center", justifyContent: "center", opacity: busy ? 0.7 : 1 }}>
              {busy ? <ActivityIndicator color="#fff" /> : <Text style={{ color: "#fff", fontWeight: "800", fontSize: 15 }}>{error ? "Try again" : "Yes, cancel order"}</Text>}
            </Pressable>
          </View>
          </>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/** Shown in the sheet right after a successful cancel: confirms it and says plainly what happens to the money. */
function CancelledResult({ order, onDone }: { order: Order; onDone: () => void }) {
  const refund = refundInfo(order.payment);
  const wasPaid = order.payment?.method === "ONLINE" && !!order.payment.refundStatus;
  return (
    <View style={{ alignItems: "center" }}>
      <View style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: c.tint, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: c.ok }}>
        <Ionicons name="checkmark" size={38} color={c.ok} />
      </View>
      <Text style={{ color: c.text, fontSize: 22, fontWeight: "800", marginTop: 14 }}>Order cancelled</Text>
      <Text style={{ color: c.muted, textAlign: "center", marginTop: 4 }}>
        {wasPaid ? "We have started your refund." : "Nothing was charged for this order."}
      </Text>
      {refund ? (
        <View style={{ width: "100%", flexDirection: "row", backgroundColor: c.tint, borderRadius: 14, padding: 12, marginTop: 16 }}>
          <Ionicons name="card-outline" size={20} color={c.accent} />
          <View style={{ flex: 1, marginLeft: 10 }}>
            <Text style={{ color: c.text, fontWeight: "800" }}>{refund.title}</Text>
            <Text style={{ color: c.muted, fontSize: 12, lineHeight: 18, marginTop: 2 }}>{refund.body}</Text>
          </View>
        </View>
      ) : null}
      <Button title="Done" onPress={onDone} style={{ alignSelf: "stretch", marginTop: 18 }} />
    </View>
  );
}
