import { useState } from "react";
import { ActivityIndicator, Image, Pressable, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { api, errMsg } from "./lib/api";
import { imageUrl } from "./lib/config";
import { money } from "./lib/format";
import { c, cream, ink, script, serif } from "./lib/theme";
import type { Bundle, Product } from "./lib/types";
import { useCart } from "./context/CartContext";

// Getter, so the colour follows the current theme.
const eyebrow = { get color() { return c.text; }, fontSize: 10, letterSpacing: 0.8, textTransform: "uppercase" as const };
const AddBtn = ({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) => (
  <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={onPress} style={{ backgroundColor: c.brand, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 11, opacity: disabled ? 0.5 : 1 }}>
    <Text style={{ color: c.onBrand, fontWeight: "700", fontSize: 13 }}>{label}</Text>
  </Pressable>
);

/* ---------- PIN check (delivery availability from our own service areas) ---------- */
type PinState = { kind: "idle" } | { kind: "loading" } | { kind: "ok"; text: string } | { kind: "no"; text: string };

export function usePinCheck() {
  const [pin, setPin] = useState("");
  const [state, setState] = useState<PinState>({ kind: "idle" });
  async function check() {
    if (!/^\d{6}$/.test(pin)) return setState({ kind: "no", text: "Enter a valid 6-digit PIN code" });
    setState({ kind: "loading" });
    try {
      const { data } = await api.get<{ delivery: { serviceable: boolean; areaName?: string; etaMinutes?: number } }>(`/pincode/${pin}`);
      setState(
        data.delivery.serviceable
          ? { kind: "ok", text: `Delivery available${data.delivery.areaName ? ` in ${data.delivery.areaName}` : ""} · about ${data.delivery.etaMinutes} min` }
          : { kind: "no", text: "Sorry, delivery is not available in this area." },
      );
    } catch (e) {
      setState({ kind: "no", text: errMsg(e) });
    }
  }
  return { pin, setPin: (t: string) => setPin(t.replace(/\D/g, "").slice(0, 6)), state, check };
}

export function PinBox({ tone, pc }: { tone: "hero" | "cta"; pc: ReturnType<typeof usePinCheck> }) {
  const light = tone === "cta";
  return (
    <View>
      <View style={{ flexDirection: "row", alignItems: "center", backgroundColor: light ? "#fffcf7" : c.card, borderRadius: 16, paddingLeft: 14, paddingRight: 6 }}>
        <Ionicons name="location-outline" size={20} color={light ? ink : c.text} />
        <TextInput
          value={pc.pin}
          onChangeText={pc.setPin}
          placeholder="Enter PIN code"
          placeholderTextColor={light ? "#4a3e35" : c.muted}
          keyboardType="number-pad"
          maxLength={6}
          style={{ flex: 1, paddingVertical: 15, paddingLeft: 10, color: light ? ink : c.text, fontSize: 15 }}
        />
        <Pressable accessibilityRole="button" onPress={pc.check} style={{ backgroundColor: ink, borderRadius: 12, paddingHorizontal: 18, paddingVertical: 12 }}>
          {pc.state.kind === "loading" ? <ActivityIndicator color={c.onDark} /> : <Text style={{ color: c.onDark, fontWeight: "700" }}>Check</Text>}
        </Pressable>
      </View>
      <Text style={{ color: pc.state.kind === "ok" ? c.ok : pc.state.kind === "no" ? c.danger : c.muted, fontSize: 11, marginTop: 10 }}>
        {pc.state.kind === "ok" || pc.state.kind === "no" ? pc.state.text : "Delivery availability & timing depend on your PIN and demand."}
      </Text>
    </View>
  );
}

/* ---------- Party bundles ---------- */
const FALLBACK = ["/img/stock/category-party-bundles.jpg", "/img/stock/category-margarita-mixes.jpg", "/img/stock/ice-cubes.jpg", "/img/stock/category-tonic-water.jpg"];

export function BundlesSection({ bundles }: { bundles: Bundle[] }) {
  const cart = useCart();
  if (!bundles.length) return null;
  return (
    <View style={{ paddingTop: 36, paddingHorizontal: 20 }}>
      <Text style={eyebrow}>Less planning. More pouring.</Text>
      <Text style={{ fontFamily: script, color: c.text, fontSize: 32, lineHeight: 38, marginTop: 4, marginBottom: 14 }}>Good company. Great combinations.</Text>
      {bundles.slice(0, 4).map((b, n) => {
        const img = imageUrl(b.imageUrl ?? FALLBACK[n % FALLBACK.length]);
        return (
          <View key={b.id} style={{ flexDirection: "row", backgroundColor: c.card, borderRadius: 16, overflow: "hidden", marginBottom: 12 }}>
            <View style={{ width: "30%", backgroundColor: c.imgWell }}>{img ? <Image source={{ uri: img }} style={{ flex: 1 }} resizeMode="cover" /> : null}</View>
            <View style={{ flex: 1, padding: 14 }}>
              <Text style={{ fontFamily: serif, color: c.text, fontSize: 24, lineHeight: 28 }}>{b.name}</Text>
              <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 8 }}>
                <Text style={{ color: c.text, fontSize: 12, fontWeight: "700" }}>What’s inside</Text>
              </View>
              <View style={{ marginTop: 6 }}>
                {b.items.map((i) => (
                  <Text key={i.productId} style={{ color: c.text, fontSize: 12, lineHeight: 18 }}>
                    {i.quantity} × {i.name}{i.inStock ? "" : " (unavailable)"}
                  </Text>
                ))}
              </View>
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 12 }}>
                <View>
                  <Text style={{ color: c.text, fontSize: 18, fontWeight: "600" }}>{money(b.priceMinor)}</Text>
                  {b.savingsMinor > 0 ? <Text style={{ color: c.ok, fontSize: 11 }}>Save {money(b.savingsMinor)}</Text> : null}
                </View>
                <AddBtn label={b.inStock ? "Add kit +" : "Unavailable"} disabled={!b.inStock} onPress={() => b.items.forEach((i) => cart.setQty(i.productId, cart.qtyOf(i.productId) + i.quantity))} />
              </View>
            </View>
          </View>
        );
      })}
    </View>
  );
}

/* ---------- Keep the good times cold ---------- */
export function IceFeature({ products }: { products: Product[] }) {
  const cart = useCart();
  const ice = products.filter((p) => p.category?.slug === "ice-bags" && p.inStock).slice(0, 2);
  return (
    <View style={{ margin: 20, marginTop: 28, borderRadius: 28, overflow: "hidden", backgroundColor: c.feature }}>
      <Image source={{ uri: imageUrl("/img/stock/ice-bucket.jpg") }} style={{ width: "100%", height: 170 }} resizeMode="cover" />
      <View style={{ padding: 20 }}>
        <Text style={{ ...eyebrow, color: c.onDark, opacity: 0.85 }}>The foundation of every pour</Text>
        <Text style={{ fontFamily: script, color: c.onDark, fontSize: 34, marginTop: 6 }}>Keep the good times cold.</Text>
        <Text style={{ color: c.onDarkMuted, fontSize: 13, lineHeight: 20, marginTop: 12 }}>A quiet night in or a house full of friends. Pick the ice bag that belongs on your guest list.</Text>
        <View style={{ flexDirection: "row", gap: 12, marginTop: 20 }}>
          {ice.map((p) => (
            <View key={p.id} style={{ flex: 1, backgroundColor: cream, borderRadius: 18, padding: 14 }}>
              <Text style={{ color: "#4a3e35", fontSize: 11 }}>{p.brand ?? "Ice"}</Text>
              <Text style={{ color: ink, fontSize: 13, fontWeight: "600", marginTop: 4, minHeight: 34 }}>{p.name} · {p.packSize}</Text>
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 10 }}>
                <Text style={{ color: ink, fontSize: 18, fontWeight: "700" }}>{money(p.priceMinor)}</Text>
                <Pressable accessibilityRole="button" onPress={() => cart.setQty(p.id, cart.qtyOf(p.id) + 1, p.stock)} style={{ backgroundColor: c.brand, borderRadius: 10, paddingHorizontal: 11, paddingVertical: 8 }}>
                  <Text style={{ color: c.onBrand, fontWeight: "700", fontSize: 12 }}>Add +</Text>
                </Pressable>
              </View>
            </View>
          ))}
        </View>
      </View>
    </View>
  );
}

/* ---------- Finish with a flourish ---------- */
const EXTRAS = [
  { slug: "citrus-garnishes", name: "Citrus garnishes", text: "Lime wheels, orange slices & a final flourish." },
  { slug: "bitters", name: "Bitters", text: "Small drops. A whole new dimension." },
  { slug: "party-essentials", name: "Party essentials", text: "The practical little things that make hosting easier." },
];

export function Extras({ onPick }: { onPick: (slug: string) => void }) {
  return (
    <View style={{ paddingHorizontal: 20, paddingTop: 12 }}>
      <Text style={eyebrow}>The little extras</Text>
      <Text style={{ fontFamily: script, color: c.text, fontSize: 32, marginTop: 4, marginBottom: 14 }}>Finish with a flourish.</Text>
      <Image source={{ uri: imageUrl("/img/stock/bitters-glass-bottles.jpg") }} style={{ width: "100%", height: 190, borderRadius: 14 }} resizeMode="cover" />
      <View style={{ marginTop: 14, borderTopWidth: 1, borderTopColor: c.line }}>
        {EXTRAS.map((x) => (
          <Pressable key={x.slug} onPress={() => onPick(x.slug)} style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: c.line }}>
            <View style={{ flex: 1, paddingRight: 12 }}>
              <Text style={{ color: c.text, fontSize: 15, fontWeight: "600" }}>{x.name}</Text>
              <Text style={{ color: c.text, fontSize: 12, marginTop: 4 }}>{x.text}</Text>
            </View>
            <Ionicons name="arrow-up-outline" size={16} color={c.text} style={{ transform: [{ rotate: "45deg" }] }} />
          </Pressable>
        ))}
      </View>
    </View>
  );
}

/* ---------- How it works ---------- */
export function Steps() {
  const rows: [keyof typeof Ionicons.glyphMap, string, string][] = [
    ["location-outline", "01 / Start with your PIN", "Check whether delivery is available at your location."],
    ["bag-handle-outline", "02 / Build your gathering", "Choose your ice, mixers and all the little extras."],
    ["bus-outline", "03 / Check, then check out", "Review availability, delivery timing and charges before ordering."],
  ];
  return (
    <View style={{ backgroundColor: c.strip, marginTop: 32, padding: 20, paddingVertical: 28 }}>
      <Text style={eyebrow}>From your list to your door</Text>
      <Text style={{ fontFamily: script, color: c.text, fontSize: 32, lineHeight: 38, marginTop: 4, marginBottom: 18 }}>A few steps to a well-stocked evening.</Text>
      {rows.map(([icon, title, text]) => (
        <View key={title} style={{ flexDirection: "row", marginBottom: 18 }}>
          <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: "#f8f5ed", alignItems: "center", justifyContent: "center" }}>
            <Ionicons name={icon} size={20} color={ink} />
          </View>
          <View style={{ flex: 1, marginLeft: 14 }}>
            <Text style={{ color: c.text, fontSize: 15, fontWeight: "600" }}>{title}</Text>
            <Text style={{ color: c.text, fontSize: 13, lineHeight: 20, marginTop: 4 }}>{text}</Text>
          </View>
        </View>
      ))}
      <Text style={{ color: c.text, fontSize: 11, lineHeight: 16 }}>No PIN selected yet. Delivery timing depends on location, product availability and demand.</Text>
    </View>
  );
}

/* ---------- FAQ ---------- */
const FAQS: [string, string][] = [
  ["Do you deliver to my area?", "Enter your PIN code to check delivery availability. Service and timing depend on your location and current demand."],
  ["How soon can my order arrive?", "Delivery timing is shown once you enter your PIN code. It is an estimate, not a guarantee."],
  ["Are these alcoholic products?", "No. We stock non-alcoholic essentials: ice, mixers, garnishes and finishing touches."],
  ["How should I store the ice?", "Keep it in the freezer or an insulated cooler until you are ready to pour."],
  ["Can I see what’s in a bundle?", "Yes. Every bundle lists exactly what is inside before you add it to your cart."],
];

export function Faq() {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <View style={{ padding: 20, paddingVertical: 28 }}>
      <Text style={eyebrow}>A few useful details</Text>
      <Text style={{ fontFamily: script, color: c.text, fontSize: 34, marginTop: 4, marginBottom: 16 }}>Before the first pour.</Text>
      <View style={{ borderTopWidth: 1, borderTopColor: c.line }}>
        {FAQS.map(([q, a], i) => {
          const on = open === i;
          return (
            <View key={q} style={{ borderBottomWidth: 1, borderBottomColor: c.line }}>
              <Pressable accessibilityRole="button" accessibilityState={{ expanded: on }} onPress={() => setOpen(on ? null : i)} style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 16 }}>
                <Text style={{ color: c.text, fontSize: 13, fontWeight: "600", flex: 1, paddingRight: 12 }}>{q}</Text>
                <Ionicons name={on ? "remove" : "add"} size={18} color={c.text} />
              </Pressable>
              {on ? <Text style={{ color: c.text, fontSize: 13, lineHeight: 20, paddingBottom: 16 }}>{a}</Text> : null}
            </View>
          );
        })}
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", marginTop: 18 }}>
        <Text style={{ color: c.text, fontSize: 14, fontWeight: "600" }}>Visit help centre </Text>
        <Ionicons name="arrow-up-outline" size={14} color={c.text} style={{ transform: [{ rotate: "45deg" }] }} />
      </View>
    </View>
  );
}

/* ---------- Final CTA ---------- */
export function StockedCta({ pc }: { pc: ReturnType<typeof usePinCheck> }) {
  return (
    <View style={{ backgroundColor: c.cta, padding: 20, paddingVertical: 32 }}>
      <Text style={eyebrow}>Your next gathering starts here</Text>
      <Text style={{ fontFamily: script, color: c.text, fontSize: 32, marginTop: 4 }}>Let’s get your place stocked.</Text>
      <Text style={{ color: c.text, fontSize: 13, marginTop: 8, marginBottom: 18 }}>Start with your PIN. We’ll take it from there.</Text>
      <PinBox tone="cta" pc={pc} />
    </View>
  );
}

/* ---------- Footer ---------- */
export function Footer({ onPick, onAll }: { onPick: (slug: string) => void; onAll: () => void }) {
  const link = (label: string, onPress?: () => void) => (
    <Pressable key={label} onPress={onPress} disabled={!onPress} style={{ marginBottom: 14 }}>
      <Text style={{ color: c.onDarkMuted, fontSize: 13 }}>{label}</Text>
    </Pressable>
  );
  const head = (t: string) => <Text style={{ color: c.onDark, fontSize: 13, fontWeight: "700", marginBottom: 14 }}>{t}</Text>;
  return (
    <View style={{ backgroundColor: c.footer, padding: 20, paddingTop: 28, paddingBottom: 32 }}>
      <Text style={{ fontFamily: script, color: c.onDark, fontSize: 36 }}>Ice &amp; Mixers</Text>
      <Text style={{ color: c.onDark, fontSize: 10, letterSpacing: 1.5 }}>EXPRESS</Text>
      <Text style={{ color: c.onDarkMuted, fontSize: 14, lineHeight: 22, marginTop: 14 }}>Good ice. Great mixers. The little things that bring everyone together.</Text>
      <Text style={{ color: c.onDarkMuted, fontSize: 11, marginTop: 14 }}>A non-alcoholic ice &amp; mixers store.</Text>
      <View style={{ flexDirection: "row", alignItems: "center", marginTop: 14 }}>
        <Ionicons name="logo-instagram" size={22} color={c.onDark} />
        <Text style={{ color: c.onDark, fontSize: 13, marginLeft: 14 }}>Find your next pour ↗</Text>
      </View>
      <View style={{ flexDirection: "row", marginTop: 26 }}>
        <View style={{ flex: 1 }}>
          {head("Shop")}
          {link("Ice Bags", () => onPick("ice-bags"))}
          {link("Tonic Water", () => onPick("tonic-water"))}
          {link("Club Soda", () => onPick("club-soda"))}
          {link("Margarita Mixes", () => onPick("margarita-mixes"))}
          {link("Bitters", () => onPick("bitters"))}
          {link("Citrus Garnishes", () => onPick("citrus-garnishes"))}
        </View>
        <View style={{ flex: 1 }}>
          {head("Gather")}
          {link("Party Bundles")}
          {link("Party Essentials", () => onPick("party-essentials"))}
          {link("Shop all products", onAll)}
          {link("How delivery works")}
        </View>
      </View>
      <View style={{ marginTop: 6 }}>
        {head("Good to know")}
        {link("Help centre & FAQs")}
        {link("Delivery information")}
        {link("Returns & refunds")}
        {link("Contact us")}
      </View>
      <View style={{ borderTopWidth: 1, borderTopColor: "rgba(248,245,237,0.3)", marginTop: 8, paddingTop: 16 }}>
        <Text style={{ color: c.onDarkMuted, fontSize: 11, lineHeight: 17 }}>Design concept · Prices shown are development samples, not verified retail prices. Product photography is representative; packaging may differ.</Text>
        <Text style={{ color: c.onDarkMuted, fontSize: 11, marginTop: 14 }}>© 2026 Ice &amp; Mixers Express   Privacy policy   Terms &amp; conditions   India · INR ₹</Text>
      </View>
    </View>
  );
}
