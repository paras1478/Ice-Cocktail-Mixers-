import { useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, TextInput, View, type TextInputProps, type ViewStyle } from "react-native";
import type { ReactNode } from "react";
import { c, script, themeVersion } from "./lib/theme";
import { imageUrl } from "./lib/config";
import { money } from "./lib/format";
import type { Product } from "./lib/types";

export function Button({ title, onPress, disabled, loading, kind = "primary", style }: { title: string; onPress: () => void; disabled?: boolean; loading?: boolean; kind?: "primary" | "ghost"; style?: ViewStyle }) {
  const off = disabled || loading;
  return (
    <Pressable accessibilityRole="button" onPress={onPress} disabled={off} style={[s.btn, kind === "ghost" && s.ghost, off && { opacity: 0.5 }, style]}>
      {loading ? <ActivityIndicator color={kind === "ghost" ? c.accent : c.onBrand} /> : <Text style={[s.btnText, kind === "ghost" && { color: c.accent }]}>{title}</Text>}
    </Pressable>
  );
}

export function Field({ label, error, secureTextEntry, ...p }: TextInputProps & { label: string; error?: string }) {
  const [hidden, setHidden] = useState(true);
  const isPassword = !!secureTextEntry;
  return (
    <View style={{ marginBottom: 12 }}>
      <Text style={s.label}>{label}</Text>
      <View>
        <TextInput
          placeholderTextColor={c.muted}
          autoCapitalize="none"
          {...p}
          secureTextEntry={isPassword && hidden}
          style={[s.input, isPassword && { paddingRight: 46 }, error ? { borderColor: c.danger } : null]}
        />
        {isPassword ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={hidden ? "Show password" : "Hide password"}
            onPress={() => setHidden((h) => !h)}
            hitSlop={10}
            style={{ position: "absolute", right: 12, top: 0, bottom: 0, justifyContent: "center" }}
          >
            <Ionicons name={hidden ? "eye-outline" : "eye-off-outline"} size={22} color={c.muted} />
          </Pressable>
        ) : null}
      </View>
      {error ? <Text style={s.err}>{error}</Text> : null}
    </View>
  );
}

export const ErrorText = ({ children }: { children?: string | null }) => (children ? <Text style={[s.err, { marginVertical: 8 }]}>{children}</Text> : null);
export const Center = ({ children }: { children: ReactNode }) => <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24 }}>{children}</View>;

export function Thumb({ uri, size = 72 }: { uri?: string | null; size?: number }) {
  const u = imageUrl(uri);
  return u ? (
    <Image source={{ uri: u }} style={{ width: size, height: size, borderRadius: 10, backgroundColor: c.imgWell }} resizeMode="cover" />
  ) : (
    <View style={{ width: size, height: size, borderRadius: 10, backgroundColor: c.imgWell }} />
  );
}

export function Qty({ qty, stock, onChange }: { qty: number; stock?: number; onChange: (n: number) => void }) {
  if (qty === 0) return <Button title="Add" onPress={() => onChange(1)} style={{ paddingVertical: 8, paddingHorizontal: 18 }} />;
  const atMax = stock !== undefined && qty >= stock;
  return (
    <View style={s.qty}>
      <Pressable accessibilityLabel="Decrease" onPress={() => onChange(qty - 1)} style={s.qtyBtn}>
        <Text style={s.qtyTxt}>−</Text>
      </Pressable>
      <Text style={{ minWidth: 24, textAlign: "center", fontWeight: "600", color: c.text }}>{qty}</Text>
      <Pressable accessibilityLabel="Increase" onPress={() => onChange(qty + 1)} disabled={atMax} style={[s.qtyBtn, atMax && { opacity: 0.4 }]}>
        <Text style={s.qtyTxt}>+</Text>
      </Pressable>
    </View>
  );
}

export function ProductCard({ p, qty, onQty, onOpen }: { p: Product; qty: number; onQty: (n: number) => void; onOpen: () => void }) {
  const u = imageUrl(p.images[0]?.url);
  return (
    <View style={s.gridCell}>
      <Pressable onPress={onOpen} style={s.gridCard}>
        <View style={{ aspectRatio: 1.5, backgroundColor: c.imgWell }}>
          {u ? <Image source={{ uri: u }} style={{ width: "100%", height: "100%" }} resizeMode="cover" /> : null}
        </View>
        <View style={{ padding: 8 }}>
          <Text style={s.cardName} numberOfLines={2}>{p.name}</Text>
          <Text style={s.muted}>{p.packSize}</Text>
          {p.priceStatus === "SAMPLE" ? <Text style={{ fontSize: 10, color: c.muted }}>Sample price</Text> : null}
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 4 }}>
            <Text style={[s.price, { fontSize: 13 }]}>{money(p.priceMinor)}</Text>
            {p.inStock ? (
              qty === 0 ? (
                <Pressable accessibilityRole="button" onPress={() => onQty(1)} style={s.addBtn}><Text style={s.addTxt}>Add +</Text></Pressable>
              ) : (
                <Qty qty={qty} stock={p.stock} onChange={onQty} />
              )
            ) : (
              <Text style={{ color: c.danger, fontWeight: "600", fontSize: 12 }}>Sold out</Text>
            )}
          </View>
        </View>
      </Pressable>
    </View>
  );
}

const buildStyles = () => StyleSheet.create({
  btn: { backgroundColor: c.brand, borderRadius: 10, paddingVertical: 13, paddingHorizontal: 20, alignItems: "center", justifyContent: "center" },
  ghost: { backgroundColor: "transparent", borderWidth: 1, borderColor: c.accent },
  btnText: { color: c.onBrand, fontWeight: "700", fontSize: 15 },
  label: { fontSize: 13, color: c.muted, marginBottom: 4, fontWeight: "600" },
  input: { borderWidth: 1, borderColor: c.border, backgroundColor: c.card, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, color: c.text },
  err: { color: c.danger, fontSize: 13, marginTop: 4 },
  card: { flexDirection: "row", backgroundColor: c.card, borderRadius: 14, padding: 12, marginHorizontal: 16, marginBottom: 10, borderWidth: 1, borderColor: c.border },
  title: { fontSize: 15, fontWeight: "600", color: c.text },
  muted: { fontSize: 13, color: c.muted, marginTop: 2 },
  price: { fontSize: 16, fontWeight: "700", color: c.text },
  qty: { flexDirection: "row", alignItems: "center", borderWidth: 1, borderColor: c.accent, borderRadius: 10 },
  qtyBtn: { paddingHorizontal: 12, paddingVertical: 6 },
  qtyTxt: { fontSize: 18, color: c.accent, fontWeight: "700" },
  gridCell: { width: "50%", padding: 4 },
  gridCard: { backgroundColor: c.card, borderRadius: 14, overflow: "hidden" },
  cardName: { fontSize: 12, fontWeight: "600", color: c.text, minHeight: 30 },
  addBtn: { backgroundColor: c.brand, borderRadius: 9, paddingHorizontal: 9, paddingVertical: 5 },
  addTxt: { color: c.onBrand, fontWeight: "700", fontSize: 11 },
  script: { fontFamily: script, color: c.text },
  h1: { fontSize: 22, fontWeight: "800", color: c.text },
  row: { flexDirection: "row", justifyContent: "space-between", marginVertical: 3 },
});

// Styles read colours from `c`, so they are rebuilt once after every theme switch.
let cached: ReturnType<typeof buildStyles> | undefined;
let cachedVersion = -1;
export const s = new Proxy({} as ReturnType<typeof buildStyles>, {
  get: (_t, key: string) => {
    if (!cached || cachedVersion !== themeVersion()) {
      cached = buildStyles();
      cachedVersion = themeVersion();
    }
    return (cached as Record<string, unknown>)[key];
  },
});
