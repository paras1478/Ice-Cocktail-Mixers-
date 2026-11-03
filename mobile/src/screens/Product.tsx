import { useEffect, useState } from "react";
import { ActivityIndicator, Image, Linking, Pressable, ScrollView, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { api, errMsg } from "../lib/api";
import { imageUrl } from "../lib/config";
import { money } from "../lib/format";
import { c } from "../lib/theme";
import type { AppConfig, Product } from "../lib/types";
import { useCart } from "../context/CartContext";
import { Center, ErrorText, ProductCard } from "../components";
import { PinBox, usePinCheck } from "../sections";
import type { RootStack } from "../navigation";

interface Detail {
  product: Product;
  related: Product[];
  packs: Product[];
}

const when = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

function QtyStepper({ value, max, onChange }: { value: number; max: number; onChange: (n: number) => void }) {
  const btn = { width: 40, height: 44, alignItems: "center" as const, justifyContent: "center" as const };
  return (
    <View style={{ flexDirection: "row", alignItems: "center", borderWidth: 1, borderColor: c.border, backgroundColor: c.card, borderRadius: 14 }}>
      <Pressable accessibilityLabel="Decrease quantity" onPress={() => onChange(value - 1)} disabled={value <= 1} style={[btn, value <= 1 && { opacity: 0.4 }]}>
        <Ionicons name="remove" size={20} color={c.text} />
      </Pressable>
      <Text style={{ minWidth: 28, textAlign: "center", fontWeight: "800", color: c.text, fontSize: 16 }}>{value}</Text>
      <Pressable accessibilityLabel="Increase quantity" onPress={() => onChange(value + 1)} disabled={value >= max} style={[btn, value >= max && { opacity: 0.4 }]}>
        <Ionicons name="add" size={20} color={c.text} />
      </Pressable>
    </View>
  );
}

export default function ProductScreen({ route, navigation }: NativeStackScreenProps<RootStack, "Product">) {
  const cart = useCart();
  const insets = useSafeAreaInsets();
  const pin = usePinCheck();
  const [data, setData] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cfg, setCfg] = useState<AppConfig | null>(null);
  const [qty, setQty] = useState(1);
  const [imgIdx, setImgIdx] = useState(0);
  const [specOpen, setSpecOpen] = useState(true);

  useEffect(() => {
    let live = true;
    setData(null);
    setError(null);
    api
      .get<Detail>(`/products/${route.params.id}`)
      .then((r) => {
        if (!live) return;
        setData(r.data);
        setQty(1);
        setImgIdx(0);
      })
      .catch((e) => live && setError(errMsg(e)));
    return () => {
      live = false;
    };
  }, [route.params.id]);
  useEffect(() => {
    api.get<AppConfig>("/config").then((r) => setCfg(r.data)).catch(() => undefined);
  }, []);

  if (error) return <Center><ErrorText>{error}</ErrorText></Center>;
  if (!data) return <Center><ActivityIndicator color={c.accent} /></Center>;

  const p = data.product;
  const inCart = cart.qtyOf(p.id);
  const max = Math.max(0, p.stock - inCart);
  const img = p.images[imgIdx] ?? p.images[0];
  const uri = imageUrl(img?.url);
  const realPhoto = !!img && !img.isPlaceholder;
  const feeText = cfg ? `${cfg.deliveryFeeMinor ? `Delivery ${money(cfg.deliveryFeeMinor)}` : "Free delivery"}${cfg.freeDeliveryThresholdMinor && cfg.deliveryFeeMinor ? `, free above ${money(cfg.freeDeliveryThresholdMinor)}` : ""}` : "Delivery fee";
  const stockText = !p.inStock ? "Out of stock" : p.lowStock ? `Only ${p.stock} left` : "In stock";
  const stockColor = !p.inStock ? c.danger : p.lowStock ? c.warn : c.ok;
  const addLabel = !p.inStock ? "Out of stock" : max === 0 ? "Max quantity in cart" : "Add to cart";
  const addToCart = () => {
    cart.setQty(p.id, inCart + qty, p.stock);
    setQty(1);
  };

  const specs = ([
    ["Brand", p.brand ?? "Unbranded"],
    ["Category", p.category?.name],
    ["Pack size", p.packSize],
    ["SKU", p.sku],
    ["Availability", stockText],
    ["Price", p.priceStatus === "VERIFIED" ? "Verified" : "Development sample (unverified)"],
  ] as [string, string | null | undefined][]).filter(([, v]) => v);

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <ScrollView contentContainerStyle={{ paddingBottom: 110 }} keyboardShouldPersistTaps="handled">
        {/* gallery */}
        <View style={{ backgroundColor: c.imgWell, height: 320 }}>
          {uri ? <Image source={{ uri }} style={{ width: "100%", height: "100%" }} resizeMode={realPhoto ? "contain" : "cover"} /> : null}
        </View>
        {p.images.length > 1 ? (
          <View style={{ flexDirection: "row", gap: 8, paddingHorizontal: 16, marginTop: 12 }}>
            {p.images.map((im, i) => (
              <Pressable key={im.url} accessibilityLabel={`Show image ${i + 1}`} onPress={() => setImgIdx(i)} style={{ width: 62, height: 62, borderRadius: 12, overflow: "hidden", borderWidth: 2, borderColor: i === imgIdx ? c.brand : "transparent", backgroundColor: c.imgWell }}>
                <Image source={{ uri: imageUrl(im.url) }} style={{ width: "100%", height: "100%" }} resizeMode="cover" />
              </Pressable>
            ))}
          </View>
        ) : null}

        <View style={{ padding: 16 }}>
          <Text style={{ color: c.muted, fontSize: 13, fontWeight: "600" }}>
            {p.brand ? <Text style={{ color: c.text, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.5 }}>{p.brand}</Text> : null}
            {p.brand && p.category ? " · " : ""}
            {p.category?.name}
          </Text>
          <Text style={{ color: c.text, fontSize: 26, fontWeight: "800", marginTop: 4 }}>{p.name}</Text>
          <Text style={{ color: c.muted, marginTop: 2 }}>{p.packSize}</Text>

          {data.packs.length > 1 ? (
            <View style={{ marginTop: 16 }}>
              <Text style={{ color: c.text, fontWeight: "800", marginBottom: 8 }}>Pack size</Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                {data.packs.map((k) => {
                  const on = k.id === p.id;
                  return (
                    <Pressable key={k.id} accessibilityState={{ selected: on }} onPress={() => !on && navigation.setParams({ id: k.slug })} style={{ borderWidth: 1, borderColor: on ? c.accent : c.border, backgroundColor: on ? c.tint : "transparent", borderRadius: 12, paddingHorizontal: 14, paddingVertical: 8, opacity: k.inStock ? 1 : 0.6 }}>
                      <Text style={{ color: c.text, fontWeight: on ? "800" : "600" }}>{k.packSize}</Text>
                      <Text style={{ color: c.muted, fontSize: 12 }}>{money(k.priceMinor)}{k.inStock ? "" : " · out of stock"}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ) : null}

          {/* price */}
          <View style={{ flexDirection: "row", alignItems: "baseline", flexWrap: "wrap", gap: 10, marginTop: 18 }}>
            <Text style={{ color: c.accent, fontSize: 32, fontWeight: "800" }}>{money(p.priceMinor)}</Text>
            {p.mrpMinor && p.mrpMinor > p.priceMinor ? (
              <>
                <Text style={{ color: c.muted, fontSize: 17, textDecorationLine: "line-through" }}>{money(p.mrpMinor)}</Text>
                <Text style={{ color: c.onBrand, backgroundColor: c.brand, fontSize: 12, fontWeight: "800", borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3, overflow: "hidden" }}>{p.discountPercent}% off MRP</Text>
              </>
            ) : null}
          </View>
          <Text style={{ color: c.muted, fontSize: 12, marginTop: 4 }}>{feeText} · taxes are calculated at checkout.</Text>
          {p.priceStatus === "VERIFIED" && p.priceVerifiedAt ? (
            <Text style={{ color: c.muted, fontSize: 12, marginTop: 4 }}>
              Price checked {when(p.priceVerifiedAt)}
              {p.priceSourceUrl ? <Text style={{ textDecorationLine: "underline" }} onPress={() => void Linking.openURL(p.priceSourceUrl!)}> · source</Text> : null}
            </Text>
          ) : (
            <Text style={{ color: c.warn, backgroundColor: c.tint, borderRadius: 12, padding: 12, fontSize: 12, fontWeight: "600", marginTop: 8, overflow: "hidden" }}>
              Development sample price: not yet verified against a retailer or the pack.
            </Text>
          )}
          <Text style={{ color: stockColor, fontWeight: "800", marginTop: 14 }}>{stockText}</Text>

          {/* add to cart */}
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12, marginTop: 16 }}>
            {p.inStock && max > 0 ? <QtyStepper value={qty} max={max} onChange={(n) => setQty(Math.max(1, Math.min(n, max)))} /> : null}
            <Pressable accessibilityRole="button" disabled={!p.inStock || max === 0} onPress={addToCart} style={{ flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", backgroundColor: c.brand, borderRadius: 14, paddingVertical: 14, opacity: !p.inStock || max === 0 ? 0.5 : 1 }}>
              <Ionicons name="bag-add-outline" size={18} color={c.onBrand} />
              <Text style={{ color: c.onBrand, fontWeight: "800", fontSize: 15, marginLeft: 8 }}>{addLabel}</Text>
            </Pressable>
          </View>
          {inCart > 0 ? (
            <Text style={{ color: c.muted, marginTop: 8 }}>
              {inCart} in your cart ·{" "}
              <Text style={{ color: c.text, fontWeight: "700", textDecorationLine: "underline" }} onPress={() => navigation.navigate("Tabs", { screen: "Cart" })}>View cart</Text>
            </Text>
          ) : null}

          {/* delivery */}
          <View style={{ backgroundColor: c.card, borderRadius: 18, borderWidth: 1, borderColor: c.border, padding: 14, marginTop: 20 }}>
            <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 10 }}>
              <Ionicons name="time-outline" size={20} color={c.text} />
              <Text style={{ color: c.text, fontWeight: "800", marginLeft: 10 }}>Check delivery time for your area</Text>
            </View>
            <PinBox tone="hero" pc={pin} />
            <Text style={{ color: c.muted, fontSize: 11, marginTop: 6 }}>An estimate only; it can vary with demand.</Text>
          </View>

          {/* about */}
          <Text style={{ color: c.text, fontSize: 18, fontWeight: "800", marginTop: 26 }}>About this product</Text>
          <Text style={{ color: c.text, opacity: 0.9, lineHeight: 22, marginTop: 8 }}>{p.description || "No description available."}</Text>
          {p.details ? (
            <>
              <Text style={{ color: c.muted, fontSize: 12, fontWeight: "800", letterSpacing: 0.6, textTransform: "uppercase", marginTop: 18 }}>Ingredients &amp; details</Text>
              <Text style={{ color: c.text, opacity: 0.9, lineHeight: 22, marginTop: 4 }}>{p.details}</Text>
            </>
          ) : null}

          {/* spec table */}
          <Pressable accessibilityRole="button" accessibilityState={{ expanded: specOpen }} onPress={() => setSpecOpen((v) => !v)} style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 26, minHeight: 44 }}>
            <Text style={{ color: c.text, fontSize: 18, fontWeight: "800" }}>Product details</Text>
            <Ionicons name={specOpen ? "chevron-up" : "chevron-down"} size={20} color={c.text} />
          </Pressable>
          {specOpen ? (
            <View style={{ borderWidth: 1, borderColor: c.border, borderRadius: 14, overflow: "hidden", marginTop: 6 }}>
              {specs.map(([k, v], i) => (
                <View key={k} style={{ flexDirection: "row", backgroundColor: c.card, paddingHorizontal: 14, paddingVertical: 11, borderTopWidth: i ? 1 : 0, borderTopColor: c.border }}>
                  <Text style={{ color: c.muted, width: 110 }}>{k}</Text>
                  <Text style={{ color: c.text, fontWeight: "700", flex: 1 }}>{v}</Text>
                </View>
              ))}
            </View>
          ) : null}
          {!p.details ? <Text style={{ color: c.muted, fontSize: 12, marginTop: 8 }}>Ingredients and nutrition are shown only when taken from the product’s own label. They have not been verified for this item yet.</Text> : null}
          {p.images[0]?.isPlaceholder ? (
            <Text style={{ color: c.muted, fontSize: 12, backgroundColor: c.tint, borderRadius: 12, padding: 12, marginTop: 20, overflow: "hidden", lineHeight: 18 }}>
              {p.images[0].url.includes("coming-soon") ? "Product photo coming soon." : "Representative photo, not necessarily the exact product."} Pack details may differ.
              {p.images[0].attribution ? ` Photo: ${p.images[0].attribution}${p.images[0].license ? ` · ${p.images[0].license}` : ""}` : ""}
            </Text>
          ) : null}
        </View>

        {/* related */}
        {data.related.length > 0 ? (
          <View style={{ paddingHorizontal: 11, marginTop: 8 }}>
            <Text style={{ color: c.text, fontSize: 22, fontWeight: "800", marginBottom: 10, marginLeft: 5 }}>You may also like</Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
              {data.related.map((r) => (
                <ProductCard key={r.id} p={r} qty={cart.qtyOf(r.id)} onQty={(n) => cart.setQty(r.id, n, r.stock)} onOpen={() => navigation.push("Product", { id: r.slug })} />
              ))}
            </View>
          </View>
        ) : null}
      </ScrollView>

      {/* buy bar */}
      <View style={{ position: "absolute", left: 0, right: 0, bottom: 0, flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: c.card, borderTopWidth: 1, borderTopColor: c.border, paddingHorizontal: 16, paddingTop: 10, paddingBottom: insets.bottom + 10 }}>
        <Pressable accessibilityRole="button" onPress={() => navigation.navigate("Tabs", { screen: "Cart" })} style={{ flex: 1 }}>
          {cart.count > 0 ? (
            <>
              <Text style={{ color: c.text, fontWeight: "800", fontSize: 13 }}>{cart.count} item{cart.count === 1 ? "" : "s"} in cart</Text>
              <Text style={{ color: c.muted, fontSize: 12 }}>{cart.quote ? `Subtotal ${money(cart.quote.totals.subtotalMinor)}` : "View cart"}</Text>
            </>
          ) : (
            <>
              <Text style={{ color: c.accent, fontWeight: "800", fontSize: 17 }}>{money(p.priceMinor)}</Text>
              <Text style={{ color: c.muted, fontSize: 12 }}>{p.packSize}</Text>
            </>
          )}
        </Pressable>
        <Pressable accessibilityRole="button" disabled={!p.inStock || max === 0} onPress={addToCart} style={{ backgroundColor: c.brand, borderRadius: 14, paddingHorizontal: 26, paddingVertical: 13, opacity: !p.inStock || max === 0 ? 0.5 : 1 }}>
          <Text style={{ color: c.onBrand, fontWeight: "800" }}>{!p.inStock ? "Out of stock" : max === 0 ? "Max in cart" : "Add"}</Text>
        </Pressable>
      </View>
    </View>
  );
}
