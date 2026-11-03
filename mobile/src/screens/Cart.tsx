import { useEffect, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { BottomTabScreenProps } from "@react-navigation/bottom-tabs";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { api } from "../lib/api";
import { c, cream, script } from "../lib/theme";
import { money } from "../lib/format";
import type { AppConfig } from "../lib/types";
import { useCart } from "../context/CartContext";
import { Button, ErrorText, Field, Qty, Thumb } from "../components";
import type { RootStack, TabsParam } from "../navigation";

export default function CartScreen({ navigation }: BottomTabScreenProps<TabsParam, "Cart">) {
  const cart = useCart();
  const [codeInput, setCodeInput] = useState(cart.code);
  const [freeFrom, setFreeFrom] = useState<number | null>(null);
  const q = cart.quote;

  useEffect(() => {
    api.get<AppConfig>("/config").then((r) => setFreeFrom(r.data.freeDeliveryThresholdMinor || null)).catch(() => undefined);
  }, []);

  if (!cart.items.length)
    return (
      <View style={{ flex: 1, backgroundColor: c.bg, alignItems: "center", justifyContent: "center", padding: 32 }}>
        <View style={{ width: 96, height: 96, borderRadius: 48, backgroundColor: c.card, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: c.border }}>
          <Ionicons name="bag-outline" size={42} color={c.accent} />
        </View>
        <Text style={{ fontFamily: script, color: c.text, fontSize: 34, marginTop: 20 }}>Your cart is empty</Text>
        <Text style={{ color: c.muted, textAlign: "center", marginTop: 6, marginBottom: 22 }}>Add some ice, mixers and the finishing touches to get started.</Text>
        <Button title="Shop now" onPress={() => navigation.navigate("Shop")} style={{ paddingHorizontal: 36 }} />
      </View>
    );

  const blocked = !q || q.issues.length > 0 || cart.quoteLoading;
  const toFree = q && freeFrom && q.totals.deliveryMinor > 0 ? Math.max(0, freeFrom - q.totals.subtotalMinor) : 0;
  const progress = q && freeFrom ? Math.min(1, q.totals.subtotalMinor / freeFrom) : 0;

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <FlatList
        data={q?.lines ?? []}
        keyExtractor={(l) => l.productId}
        contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
        ListHeaderComponent={
          <View style={{ marginBottom: 12 }}>
            <Text style={{ fontFamily: script, color: c.text, fontSize: 32 }}>Your cart</Text>
            <Text style={{ color: c.muted, fontSize: 13 }}>{cart.count} item{cart.count === 1 ? "" : "s"}</Text>
            {toFree > 0 ? (
              <View style={{ backgroundColor: c.hero, borderRadius: 14, padding: 12, marginTop: 12 }}>
                <Text style={{ color: c.text, fontSize: 13, fontWeight: "600" }}>Add {money(toFree)} more for free delivery</Text>
                <View style={{ height: 6, borderRadius: 3, backgroundColor: "rgba(0,0,0,0.35)", marginTop: 8, overflow: "hidden" }}>
                  <View style={{ width: `${Math.round(progress * 100)}%`, height: 6, backgroundColor: cream }} />
                </View>
              </View>
            ) : q && freeFrom && q.totals.deliveryMinor === 0 ? (
              <View style={{ flexDirection: "row", alignItems: "center", backgroundColor: c.hero, borderRadius: 14, padding: 12, marginTop: 12 }}>
                <Ionicons name="checkmark-circle" size={18} color={c.ok} />
                <Text style={{ color: c.text, fontSize: 13, fontWeight: "600", marginLeft: 8 }}>You’ve unlocked free delivery</Text>
              </View>
            ) : null}
          </View>
        }
        ListEmptyComponent={cart.quoteLoading ? <ActivityIndicator color={c.accent} style={{ marginTop: 24 }} /> : undefined}
        renderItem={({ item }) => (
          <View style={{ flexDirection: "row", alignItems: "center", backgroundColor: c.card, borderRadius: 16, padding: 12, marginBottom: 10, borderWidth: 1, borderColor: c.border }}>
            <Thumb uri={item.image} size={68} />
            <View style={{ flex: 1, marginHorizontal: 12 }}>
              <Text style={{ fontWeight: "700", color: c.text }} numberOfLines={2}>{item.name}</Text>
              <Text style={{ color: c.muted, fontSize: 12, marginTop: 2 }}>{item.packSize} · {money(item.unitMinor)} each</Text>
              <Text style={{ color: c.text, fontWeight: "800", fontSize: 15, marginTop: 6 }}>{money(item.unitMinor * item.quantity)}</Text>
            </View>
            <View style={{ alignItems: "flex-end", gap: 10 }}>
              <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${item.name}`} onPress={() => cart.setQty(item.productId, 0)} hitSlop={10}>
                <Ionicons name="trash-outline" size={18} color={c.muted} />
              </Pressable>
              <Qty qty={item.quantity} stock={item.stock} onChange={(n) => cart.setQty(item.productId, n, item.stock)} />
            </View>
          </View>
        )}
        ListFooterComponent={
          <View style={{ marginTop: 8 }}>
            {q?.issues.map((i) => <ErrorText key={i.productId + i.message}>{i.message}</ErrorText>)}
            <ErrorText>{cart.quoteError}</ErrorText>
            <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 8 }}>
              <View style={{ flex: 1 }}><Field label="Discount code" value={codeInput} onChangeText={(t) => setCodeInput(t.toUpperCase())} autoCapitalize="characters" /></View>
              <Button title="Apply" kind="ghost" onPress={() => cart.setCode(codeInput.trim())} style={{ marginBottom: 12 }} />
            </View>
            {q?.discountMessage ? <Text style={{ color: c.muted, marginBottom: 8 }}>{q.discountMessage}</Text> : null}
            {q ? (
              <View style={{ backgroundColor: c.card, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: c.border }}>
                <Row label="Subtotal" value={money(q.totals.subtotalMinor)} />
                {q.totals.discountMinor > 0 ? <Row label="Discount" value={`− ${money(q.totals.discountMinor)}`} ok /> : null}
                <Row label="Delivery" value={q.totals.deliveryMinor ? money(q.totals.deliveryMinor) : "Free"} />
                <Row label="Tax" value={money(q.totals.taxMinor)} />
                <View style={{ height: 1, backgroundColor: c.border, marginVertical: 8 }} />
                <Row label="Total" value={money(q.totals.totalMinor)} bold />
              </View>
            ) : null}
            <Button
              title={q ? `Checkout · ${money(q.totals.totalMinor)}` : "Checkout"}
              onPress={() => navigation.getParent<NativeStackNavigationProp<RootStack>>()?.navigate("Checkout")}
              disabled={blocked}
              loading={cart.quoteLoading && !!q}
              style={{ marginTop: 16 }}
            />
            <Pressable onPress={() => navigation.navigate("Shop")} style={{ alignItems: "center", paddingVertical: 14 }}>
              <Text style={{ color: c.text, fontWeight: "600", textDecorationLine: "underline" }}>Continue shopping</Text>
            </Pressable>
          </View>
        }
      />
    </View>
  );
}

function Row({ label, value, bold, ok }: { label: string; value: string; bold?: boolean; ok?: boolean }) {
  const st = { color: ok ? c.ok : c.text, fontWeight: bold ? ("800" as const) : ("400" as const), fontSize: bold ? 18 : 14 };
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", marginVertical: 3 }}>
      <Text style={st}>{label}</Text>
      <Text style={st}>{value}</Text>
    </View>
  );
}
