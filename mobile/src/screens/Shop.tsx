import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Image, Pressable, RefreshControl, Text, TextInput, View } from "react-native";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { api, errMsg } from "../lib/api";
import { imageUrl } from "../lib/config";
import { c, script } from "../lib/theme";
import { useTheme } from "../context/ThemeContext";
import type { Bundle, Category, Product } from "../lib/types";
import { useCart } from "../context/CartContext";
import { Button, ErrorText, ProductCard } from "../components";
import { BundlesSection, Extras, Faq, Footer, IceFeature, PinBox, StockedCta, Steps, usePinCheck } from "../sections";
import type { RootStack } from "../navigation";

const CAT_ICON: Record<string, keyof typeof MaterialCommunityIcons.glyphMap> = {
  "ice-bags": "cube-outline",
  "tonic-water": "cup-water",
  "club-soda": "bottle-soda-outline",
  "margarita-mixes": "glass-cocktail",
  bitters: "eyedropper",
  "citrus-garnishes": "fruit-citrus",
  "party-bundles": "package-variant-closed",
  "party-essentials": "silverware-fork-knife",
};

/** Same groups as the website's "Best sellers" filter: each is a set of the store's own category slugs. */
const FILTERS: { label: string; slugs?: string[] }[] = [
  { label: "Best sellers" },
  { label: "Ice & chill", slugs: ["ice-bags"] },
  { label: "Mixers", slugs: ["tonic-water", "club-soda", "margarita-mixes"] },
  { label: "Finishing touches", slugs: ["bitters", "citrus-garnishes", "party-essentials"] },
];

export default function Shop() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStack>>();
  const cart = useCart();
  const insets = useSafeAreaInsets();
  const { mode, toggle } = useTheme();
  const list = useRef<FlatList<Product>>(null);
  const [cats, setCats] = useState<Category[]>([]);
  const [bundles, setBundles] = useState<Bundle[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [filter, setFilter] = useState(0);
  const [category, setCategory] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hero = usePinCheck();
  const cta = usePinCheck();

  useEffect(() => {
    api.get<{ categories: Category[] }>("/categories").then((r) => setCats(r.data.categories)).catch(() => undefined);
    api.get<{ bundles: Bundle[] }>("/bundles").then((r) => setBundles(r.data.bundles)).catch(() => undefined);
  }, []);
  useEffect(() => {
    const t = setTimeout(() => setQuery(q.trim()), 350);
    return () => clearTimeout(t);
  }, [q]);

  const load = useCallback(async () => {
    try {
      const r = await api.get<{ products: Product[] }>("/products", { params: { sort: "popular", pageSize: 50, ...(query ? { q: query } : {}) } });
      setProducts(r.data.products);
      setError(null);
    } catch (e) {
      setError(errMsg(e));
    }
  }, [query]);
  useEffect(() => {
    setLoading(true);
    load().finally(() => setLoading(false));
  }, [load]);

  const shown = useMemo(() => {
    const slugs = category ? [category] : FILTERS[filter].slugs;
    const all = slugs ? products.filter((p) => p.category && slugs.includes(p.category.slug)) : products;
    return showAll || query || category ? all : all.slice(0, 8);
  }, [products, filter, category, showAll, query]);

  // Where the product section starts (measured, so the scroll lands on it on every screen size).
  const innerY = useRef(0);
  const editY = useRef(0);
  const scrollToProducts = () => list.current?.scrollToOffset({ offset: Math.max(0, innerY.current + editY.current - 8), animated: true });

  const pickCategory = (slug: string | null) => {
    setCategory(slug);
    setFilter(0);
    scrollToProducts();
  };
  const shopAll = () => {
    scrollToProducts();
    setCategory(null);
    setFilter(0);
    setShowAll(true);
  };
  const heading = category ? (cats.find((x) => x.slug === category)?.name ?? "Stock the good stuff.") : "Stock the good stuff.";

  const header = (
    <View>
      <View style={{ backgroundColor: c.topbar, paddingVertical: 9 }}>
        <Text style={{ color: c.onDark, textAlign: "center", fontSize: 11, letterSpacing: 0.5 }}>GOOD ICE. GREAT MIXERS. BETTER GATHERINGS.</Text>
      </View>

      <View style={{ paddingHorizontal: 20, paddingTop: 16 }} onLayout={(e) => { innerY.current = e.nativeEvent.layout.y; }}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <View>
            <Text style={{ fontFamily: script, color: c.text, fontSize: 34 }}>Ice &amp; Mixers</Text>
            <Text style={{ color: c.text, fontSize: 9, letterSpacing: 1.5, fontStyle: "italic", marginTop: -4 }}>EXPRESS</Text>
          </View>
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            <Pressable accessibilityRole="button" accessibilityLabel={mode === "dark" ? "Switch to light mode" : "Switch to dark mode"} onPress={toggle} hitSlop={10} style={{ marginRight: 18 }}>
              <Ionicons name={mode === "dark" ? "sunny-outline" : "moon-outline"} size={24} color={c.text} />
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="Open cart" onPress={() => navigation.navigate("Tabs", { screen: "Cart" })} style={{ flexDirection: "row", alignItems: "center" }}>
              <Ionicons name="bag-outline" size={24} color={c.text} />
              <Text style={{ color: c.text, fontWeight: "700", marginLeft: 10 }}>{cart.count}</Text>
            </Pressable>
          </View>
        </View>

        <View style={{ flexDirection: "row", alignItems: "center", backgroundColor: c.card, borderRadius: 16, borderWidth: 1, borderColor: c.border, paddingHorizontal: 14, marginTop: 20 }}>
          <Ionicons name="search-outline" size={20} color={c.text} />
          <TextInput
            value={q}
            onChangeText={setQ}
            placeholder="Search ice, mixers, garnishes & more"
            placeholderTextColor={c.muted}
            returnKeyType="search"
            style={{ flex: 1, paddingVertical: 14, paddingLeft: 10, fontSize: 14, color: c.text }}
          />
        </View>

        {/* hero */}
        <View style={{ backgroundColor: c.hero, borderRadius: 28, overflow: "hidden", marginTop: 22 }}>
          <View style={{ padding: 20, paddingBottom: 22 }}>
            <Text style={{ color: c.text, fontSize: 10, letterSpacing: 0.8 }}>THE HOST’S ESSENTIALS, DELIVERED</Text>
            <Text style={{ fontFamily: script, color: c.text, fontSize: 40, lineHeight: 46, marginTop: 10 }}>A good evening starts with ice.</Text>
            <Text style={{ color: c.muted, fontSize: 13, marginTop: 14, marginBottom: 18 }}>Ice, mixers &amp; the finishing touches for your kind of gathering.</Text>
            <PinBox tone="hero" pc={hero} />
            <Pressable accessibilityRole="button" onPress={shopAll} style={{ alignSelf: "flex-start", backgroundColor: c.brand, borderRadius: 14, paddingHorizontal: 20, paddingVertical: 15, marginTop: 14, flexDirection: "row", alignItems: "center" }}>
              <Text style={{ color: c.onBrand, fontWeight: "700", fontSize: 15 }}>Shop the essentials  </Text>
              <Ionicons name="arrow-forward" size={16} color={c.onBrand} />
            </Pressable>
          </View>
          <Image source={{ uri: imageUrl("/img/hero-ice.jpg") }} style={{ width: "100%", height: 140 }} resizeMode="cover" />
        </View>

        {/* cart strip */}
        <Pressable onPress={shopAll} style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: c.hero, borderRadius: 18, padding: 16, marginTop: 16 }}>
          <View>
            <Text style={{ color: c.text, fontWeight: "700", fontSize: 14 }}>Shop all essentials ↗</Text>
            <Text style={{ color: c.muted, fontSize: 11, marginTop: 4 }}>Enter PIN to check availability</Text>
          </View>
          <Pressable accessibilityRole="button" onPress={() => navigation.navigate("Tabs", { screen: "Cart" })} style={{ backgroundColor: c.brand, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 11, flexDirection: "row", alignItems: "center" }}>
            <Ionicons name="bag-outline" size={16} color={c.onBrand} />
            <Text style={{ color: c.onBrand, fontWeight: "700", marginLeft: 6 }}>Cart · {cart.count}</Text>
          </Pressable>
        </Pressable>

        {/* menu */}
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", marginTop: 32 }}>
          <Text style={{ color: c.text, fontSize: 18, fontWeight: "600" }}>What’s on the menu?</Text>
          <Text style={{ color: c.text, fontSize: 12, letterSpacing: 0.4 }}>{cats.length} WAYS TO STOCK UP</Text>
        </View>
        <View style={{ flexDirection: "row", flexWrap: "wrap", marginTop: 18 }}>
          {cats.map((cat) => {
            const on = category === cat.slug;
            return (
              <Pressable key={cat.id} onPress={() => pickCategory(on ? null : cat.slug)} style={{ width: "25%", alignItems: "center", marginBottom: 18 }}>
                <View style={{ width: 64, height: 64, borderRadius: 18, backgroundColor: c.tile, alignItems: "center", justifyContent: "center", borderWidth: on ? 2 : 0, borderColor: c.accent }}>
                  <MaterialCommunityIcons name={CAT_ICON[cat.slug] ?? "tag-outline"} size={30} color={on ? c.brand : c.text} />
                </View>
                <Text style={{ color: c.text, fontSize: 12, textAlign: "center", marginTop: 8 }} numberOfLines={2}>{cat.name}</Text>
              </Pressable>
            );
          })}
        </View>

        {/* best sellers */}
        <View onLayout={(e) => { editY.current = e.nativeEvent.layout.y; }} />
        <Text style={{ color: c.text, fontSize: 10, letterSpacing: 0.8, marginTop: 14 }}>THE EVERY-GATHERING EDIT</Text>
        <View style={{ flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between" }}>
          <Text style={{ fontFamily: script, color: c.text, fontSize: 34, flex: 1 }}>{heading}</Text>
          <Pressable onPress={shopAll} style={{ paddingBottom: 8 }}>
            <Text style={{ color: c.text, fontWeight: "600" }}>Shop all ↗</Text>
          </Pressable>
        </View>
        <View style={{ flexDirection: "row", flexWrap: "wrap", marginTop: 12, marginBottom: 10 }}>
          {FILTERS.map((f, i) => {
            const on = !category && filter === i;
            return (
              <Pressable key={f.label} accessibilityState={{ selected: on }} onPress={() => { setCategory(null); setFilter(i); setShowAll(false); }} style={{ paddingHorizontal: 14, paddingVertical: 7, borderRadius: 999, marginRight: 8, marginBottom: 8, backgroundColor: on ? c.chipBg : "transparent", borderWidth: 1, borderColor: on ? c.chipBg : c.border }}>
                <Text style={{ color: on ? c.chipText : c.text, fontSize: 12, fontWeight: "600" }}>{f.label}</Text>
              </Pressable>
            );
          })}
        </View>
        {error ? (
          <View style={{ alignItems: "center", marginVertical: 12 }}>
            <ErrorText>{error}</ErrorText>
            <Button title="Retry" onPress={() => { setLoading(true); load().finally(() => setLoading(false)); }} />
          </View>
        ) : null}
      </View>
    </View>
  );

  const footer = (
    <View>
      <BundlesSection bundles={bundles} />
      <IceFeature products={products} />
      <Extras onPick={(slug) => pickCategory(slug)} />
      <Steps />
      <Faq />
      <StockedCta pc={cta} />
      <Footer onPick={(slug) => pickCategory(slug)} onAll={shopAll} />
    </View>
  );

  // Header and footer stay mounted while products reload, so typing in search never loses focus.
  return (
    <View style={{ flex: 1, backgroundColor: c.topbar, paddingTop: insets.top }}>
      <FlatList
        ref={list}
        style={{ backgroundColor: c.bg }}
        numColumns={2}
        data={shown}
        keyExtractor={(p) => p.id}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={header}
        ListFooterComponent={footer}
        columnWrapperStyle={{ paddingHorizontal: 15 }}
        refreshControl={<RefreshControl tintColor={c.brand} refreshing={refreshing} onRefresh={() => { setRefreshing(true); load().finally(() => setRefreshing(false)); }} />}
        ListEmptyComponent={loading ? <ActivityIndicator color={c.accent} style={{ marginTop: 24 }} /> : error ? undefined : <Text style={{ textAlign: "center", color: c.muted, marginTop: 24 }}>Nothing in this group right now.</Text>}
        renderItem={({ item }) => <ProductCard p={item} qty={cart.qtyOf(item.id)} onQty={(n) => cart.setQty(item.id, n, item.stock)} onOpen={() => navigation.navigate("Product", { id: item.id })} />}
      />
    </View>
  );
}
