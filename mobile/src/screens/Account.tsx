import { useCallback, useEffect, useState, type ReactNode } from "react";
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import type { BottomTabNavigationProp } from "@react-navigation/bottom-tabs";
import { api, errMsg } from "../lib/api";
import { money } from "../lib/format";
import { c, cream, ink, script } from "../lib/theme";
import { useTheme } from "../context/ThemeContext";
import type { Address, AppConfig, Order } from "../lib/types";
import { useAuth } from "../context/AuthContext";
import { Button, ErrorText, Field } from "../components";
import { AddressForm, addressPayload, draftFromRecord, emptyAddress, validateAddress, type AddressDraft } from "../components/AddressForm";
import GoogleSignIn from "../components/GoogleSignIn";
import type { TabsParam } from "../navigation";

const formatAddress = (a: Address) => [a.house, a.line1, a.landmark, a.area, a.district ?? a.city, a.state, a.pincode].filter(Boolean).join(", ");
const initials = (name: string) => name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("") || "?";

function Card({ title, icon, right, children }: { title: string; icon: keyof typeof Ionicons.glyphMap; right?: ReactNode; children: ReactNode }) {
  return (
    <View style={{ backgroundColor: c.card, borderRadius: 20, padding: 16, marginTop: 14, borderWidth: 1, borderColor: c.border }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          <View style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: c.tint, alignItems: "center", justifyContent: "center" }}>
            <Ionicons name={icon} size={17} color={c.accent} />
          </View>
          <Text style={{ color: c.text, fontSize: 16, fontWeight: "800", marginLeft: 10 }}>{title}</Text>
        </View>
        {right}
      </View>
      {children}
    </View>
  );
}

/* ------------------------------------------------------------------ signed out */
function SignedOut() {
  const { login, register } = useAuth();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      if (mode === "login") await login(email.trim(), password);
      else await register({ name: name.trim(), email: email.trim(), password, phone: phone.trim() || undefined });
      setPassword("");
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  const perks: [keyof typeof Ionicons.glyphMap, string][] = [
    ["flash-outline", "Faster checkout with saved addresses"],
    ["receipt-outline", "Track every order, pay or cancel in a tap"],
    ["refresh-outline", "Clear refund status on online payments"],
  ];

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView style={{ backgroundColor: c.bg }} contentContainerStyle={{ paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
        <View style={{ backgroundColor: c.hero, borderBottomLeftRadius: 32, borderBottomRightRadius: 32, padding: 24, paddingTop: 36 }}>
          <Text style={{ color: c.text, fontSize: 10, letterSpacing: 1, opacity: 0.85 }}>{mode === "login" ? "WELCOME BACK" : "JOIN THE GATHERING"}</Text>
          <Text style={{ fontFamily: script, color: c.text, fontSize: 42, lineHeight: 50, marginTop: 6 }}>{mode === "login" ? "Good to see you again." : "Let’s get you stocked."}</Text>
          <View style={{ marginTop: 16, gap: 10 }}>
            {perks.map(([icon, text]) => (
              <View key={text} style={{ flexDirection: "row", alignItems: "center" }}>
                <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: cream, alignItems: "center", justifyContent: "center" }}>
                  <Ionicons name={icon} size={15} color={ink} />
                </View>
                <Text style={{ color: c.text, fontSize: 13, marginLeft: 10, flex: 1 }}>{text}</Text>
              </View>
            ))}
          </View>
        </View>

        <View style={{ marginHorizontal: 16, marginTop: -18, backgroundColor: c.card, borderRadius: 24, padding: 18, borderWidth: 1, borderColor: c.border }}>
          <View style={{ flexDirection: "row", backgroundColor: c.tint, borderRadius: 14, padding: 4, marginBottom: 16 }}>
            {(["login", "register"] as const).map((m) => (
              <Pressable key={m} onPress={() => { setMode(m); setError(null); }} style={{ flex: 1, alignItems: "center", paddingVertical: 10, borderRadius: 11, backgroundColor: mode === m ? c.brand : "transparent" }}>
                <Text style={{ color: mode === m ? c.onBrand : c.text, fontWeight: "800" }}>{m === "login" ? "Log in" : "Sign up"}</Text>
              </Pressable>
            ))}
          </View>
          {mode === "register" ? <Field label="Name" value={name} onChangeText={setName} autoCapitalize="words" autoComplete="name" /> : null}
          <Field label="Email" value={email} onChangeText={setEmail} keyboardType="email-address" autoComplete="email" />
          {mode === "register" ? <Field label="Mobile (optional)" value={phone} onChangeText={(t) => setPhone(t.replace(/\D/g, ""))} keyboardType="number-pad" maxLength={10} /> : null}
          <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry autoComplete={mode === "login" ? "current-password" : "new-password"} />
          {mode === "register" ? <Text style={{ color: c.muted, fontSize: 12, marginTop: -4, marginBottom: 8 }}>Use at least 8 characters.</Text> : null}
          <ErrorText>{error}</ErrorText>
          <Button title={mode === "login" ? "Log in" : "Create account"} onPress={submit} loading={busy} disabled={!email || !password || (mode === "register" && !name)} />
          <GoogleSignIn onError={setError} />
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", marginTop: 14 }}>
            <Ionicons name="lock-closed-outline" size={13} color={c.muted} />
            <Text style={{ color: c.muted, fontSize: 12, marginLeft: 6 }}>Your details are used only to deliver your orders.</Text>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

/* ------------------------------------------------------------------ signed in */
function Profile() {
  const { user, setUser } = useAuth();
  const [name, setName] = useState(user?.name ?? "");
  const [phone, setPhone] = useState(user?.phone ?? "");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const dirty = name.trim() !== (user?.name ?? "") || (phone || "") !== (user?.phone ?? "");

  const save = async () => {
    setBusy(true);
    setSaved(false);
    try {
      const { data } = await api.patch("/auth/me", { name: name.trim(), phone: phone || null });
      setUser(data.user);
      setErrors({});
      setSaved(true);
    } catch (e) {
      setErrors({ name: errMsg(e) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card title="Profile" icon="person-outline">
      <Field label="Name" value={name} error={errors.name} onChangeText={(t) => { setName(t); setSaved(false); }} autoCapitalize="words" />
      <Field label="Email" value={user?.email ?? ""} editable={false} />
      <Field label="Mobile" value={phone} error={errors.phone} onChangeText={(t) => { setPhone(t.replace(/\D/g, "").slice(0, 10)); setSaved(false); }} keyboardType="number-pad" maxLength={10} />
      {saved ? <Text style={{ color: c.ok, fontWeight: "600", marginBottom: 8 }}>Profile updated.</Text> : null}
      <Button title="Save changes" onPress={save} loading={busy} disabled={!dirty || name.trim().length < 2} />
    </Card>
  );
}

function Password() {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.patch("/auth/me", { currentPassword: current, newPassword: next });
      setCurrent("");
      setNext("");
      setOpen(false);
      setDone(true);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card title="Security" icon="shield-checkmark-outline" right={!open ? <Pressable onPress={() => { setOpen(true); setDone(false); }}><Text style={{ color: c.accent, fontWeight: "700" }}>Change password</Text></Pressable> : undefined}>
      {open ? (
        <View>
          <Field label="Current password" value={current} onChangeText={setCurrent} secureTextEntry autoComplete="current-password" />
          <Field label="New password" value={next} onChangeText={setNext} secureTextEntry autoComplete="new-password" />
          <Text style={{ color: c.muted, fontSize: 12, marginTop: -4, marginBottom: 8 }}>Use at least 8 characters.</Text>
          <ErrorText>{error}</ErrorText>
          <View style={{ flexDirection: "row", gap: 10 }}>
            <Button title="Cancel" kind="ghost" onPress={() => { setOpen(false); setError(null); }} style={{ flex: 1 }} />
            <Button title="Update" onPress={save} loading={busy} disabled={!current || next.length < 8} style={{ flex: 1 }} />
          </View>
        </View>
      ) : (
        <Text style={{ color: done ? c.ok : c.muted, fontSize: 13 }}>{done ? "Password updated." : "Your password is stored securely and never shown. Change it any time."}</Text>
      )}
    </Card>
  );
}

function Addresses({ onCount }: { onCount: (n: number) => void }) {
  const [list, setList] = useState<Address[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string | null; draft: AddressDraft } | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const a = (await api.get<{ addresses: Address[] }>("/addresses")).data.addresses;
      setList(a);
      onCount(a.length);
      setError(null);
    } catch (e) {
      setError(errMsg(e));
    }
  }, [onCount]);
  useEffect(() => { void load(); }, [load]);

  const save = async () => {
    if (!editing) return;
    const e = validateAddress(editing.draft);
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    try {
      const d = editing.draft;
      const body = { ...addressPayload(d), phone: d.phone, label: d.type === "WORK" ? "Work" : d.type === "OTHER" ? "Other" : "Home", confirmed: true };
      if (editing.id) await api.put(`/addresses/${editing.id}`, body);
      else await api.post("/addresses", body);
      setEditing(null);
      await load();
    } catch (ex) {
      setErrors({ pincode: errMsg(ex) });
    } finally {
      setBusy(false);
    }
  };
  const del = (a: Address) =>
    Alert.alert("Delete this address?", "Past orders keep their own address.", [
      { text: "Keep", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => api.delete(`/addresses/${a.id}`).then(load).catch((e) => Alert.alert("Could not delete", errMsg(e))) },
    ]);

  return (
    <Card
      title="Saved addresses"
      icon="location-outline"
      right={!editing ? <Pressable onPress={() => { setEditing({ id: null, draft: { ...emptyAddress } }); setErrors({}); }}><Text style={{ color: c.accent, fontWeight: "700" }}>+ Add</Text></Pressable> : undefined}
    >
      {editing ? (
        <View>
          <AddressForm value={editing.draft} errors={errors} onChange={(p) => setEditing((e) => (e ? { ...e, draft: { ...e.draft, ...p } } : e))} />
          <View style={{ flexDirection: "row", gap: 10, marginTop: 8 }}>
            <Button title="Cancel" kind="ghost" onPress={() => setEditing(null)} style={{ flex: 1 }} />
            <Button title="Save address" onPress={save} loading={busy} style={{ flex: 1 }} />
          </View>
        </View>
      ) : error ? (
        <View><ErrorText>{error}</ErrorText><Button title="Retry" kind="ghost" onPress={load} /></View>
      ) : !list ? (
        <ActivityIndicator color={c.accent} />
      ) : list.length === 0 ? (
        <Text style={{ color: c.muted, fontSize: 13 }}>No saved addresses yet. Add one to check out faster.</Text>
      ) : (
        <View style={{ gap: 10 }}>
          {list.map((a) => (
            <View key={a.id} style={{ backgroundColor: c.tint, borderRadius: 14, padding: 12 }}>
              <View style={{ flexDirection: "row", alignItems: "center" }}>
                <Ionicons name={a.type === "WORK" ? "briefcase-outline" : a.type === "OTHER" ? "pin-outline" : "home-outline"} size={16} color={c.text} />
                <Text style={{ color: c.text, fontWeight: "800", marginLeft: 8 }}>{a.label}</Text>
                {a.isDefault ? <Text style={{ color: c.onBrand, backgroundColor: c.brand, fontSize: 10, fontWeight: "800", borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2, marginLeft: 8, overflow: "hidden" }}>DEFAULT</Text> : null}
                {a.latitude !== null ? <Ionicons name="navigate-circle-outline" size={16} color={c.ok} style={{ marginLeft: "auto" }} /> : null}
              </View>
              <Text style={{ color: c.muted, fontSize: 13, marginTop: 6, lineHeight: 19 }}>{formatAddress(a)}</Text>
              {a.phone ? <Text style={{ color: c.muted, fontSize: 12, marginTop: 4 }}>Contact: {a.phone}</Text> : null}
              <View style={{ flexDirection: "row", gap: 18, marginTop: 10 }}>
                <Pressable onPress={() => { setEditing({ id: a.id, draft: draftFromRecord(a) }); setErrors({}); }}><Text style={{ color: c.text, fontWeight: "700", fontSize: 13 }}>Edit</Text></Pressable>
                <Pressable onPress={() => del(a)}><Text style={{ color: c.danger, fontWeight: "700", fontSize: 13 }}>Delete</Text></Pressable>
              </View>
            </View>
          ))}
        </View>
      )}
    </Card>
  );
}

function Appearance() {
  const { mode, toggle } = useTheme();
  return (
    <Card title="Appearance" icon={mode === "dark" ? "moon-outline" : "sunny-outline"}>
      <View style={{ flexDirection: "row", backgroundColor: c.tint, borderRadius: 14, padding: 4 }}>
        {(["dark", "light"] as const).map((m) => (
          <Pressable key={m} accessibilityRole="button" accessibilityState={{ selected: mode === m }} onPress={() => mode !== m && toggle()} style={{ flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", paddingVertical: 10, borderRadius: 11, backgroundColor: mode === m ? c.brand : "transparent" }}>
            <Ionicons name={m === "dark" ? "moon-outline" : "sunny-outline"} size={16} color={mode === m ? c.onBrand : c.text} />
            <Text style={{ color: mode === m ? c.onBrand : c.text, fontWeight: "800", marginLeft: 8 }}>{m === "dark" ? "Dark" : "Light"}</Text>
          </Pressable>
        ))}
      </View>
    </Card>
  );
}

function About() {
  const [cfg, setCfg] = useState<AppConfig | null>(null);
  useEffect(() => { api.get<AppConfig>("/config").then((r) => setCfg(r.data)).catch(() => undefined); }, []);
  const rows: [keyof typeof Ionicons.glyphMap, string, string][] = [
    ["bicycle-outline", "Delivery", cfg ? `${cfg.deliveryFeeMinor ? `${money(cfg.deliveryFeeMinor)} per order` : "Free"}${cfg.freeDeliveryThresholdMinor ? `, free above ${money(cfg.freeDeliveryThresholdMinor)}` : ""}. Timing is an estimate for your PIN, not a guarantee.` : "Timing is an estimate for your PIN, not a guarantee."],
    ["card-outline", "Payment", cfg ? [cfg.payments.online ? "UPI, cards and net banking (secure Razorpay checkout)" : null, cfg.payments.cod ? "Cash on delivery" : null].filter(Boolean).join(" · ") || "Not available right now" : "Loading…"],
    ["leaf-outline", "What we sell", "Non-alcoholic ice, mixers, garnishes and party essentials."],
  ];
  return (
    <Card title="Good to know" icon="information-circle-outline">
      <View style={{ gap: 14 }}>
        {rows.map(([icon, title, text]) => (
          <View key={title} style={{ flexDirection: "row" }}>
            <Ionicons name={icon} size={18} color={c.accent} style={{ marginTop: 1 }} />
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={{ color: c.text, fontWeight: "700", fontSize: 14 }}>{title}</Text>
              <Text style={{ color: c.muted, fontSize: 13, lineHeight: 19, marginTop: 2 }}>{text}</Text>
            </View>
          </View>
        ))}
      </View>
    </Card>
  );
}

function SignedIn() {
  const { user, logout } = useAuth();
  const navigation = useNavigation<BottomTabNavigationProp<TabsParam>>();
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [addrCount, setAddrCount] = useState<number | null>(null);
  useFocusEffect(useCallback(() => { api.get<{ orders: Order[] }>("/orders").then((r) => setOrders(r.data.orders)).catch(() => undefined); }, []));
  if (!user) return null;

  const live = (orders ?? []).filter((o) => o.status !== "CANCELLED");
  const spent = live.filter((o) => o.payment?.method === "COD" ? o.status === "DELIVERED" : o.payment?.status === "PAID").reduce((s, o) => s + o.totalMinor, 0);
  const stats: [string, string][] = [
    ["Orders", orders ? String(orders.length) : "–"],
    ["Total spent", orders ? money(spent) : "–"],
    ["Addresses", addrCount === null ? "–" : String(addrCount)],
  ];
  const confirmLogout = () => Alert.alert("Log out?", "You can log back in any time.", [{ text: "Stay", style: "cancel" }, { text: "Log out", style: "destructive", onPress: () => void logout() }]);

  return (
    <ScrollView style={{ backgroundColor: c.bg }} contentContainerStyle={{ paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
      <View style={{ backgroundColor: c.hero, borderBottomLeftRadius: 32, borderBottomRightRadius: 32, paddingHorizontal: 20, paddingTop: 32, paddingBottom: 44 }}>
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          <View style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: cream, alignItems: "center", justifyContent: "center", borderWidth: 3, borderColor: c.accent }}>
            <Text style={{ fontFamily: script, color: ink, fontSize: 30 }}>{initials(user.name)}</Text>
          </View>
          <View style={{ flex: 1, marginLeft: 16 }}>
            <Text style={{ color: c.text, fontSize: 10, letterSpacing: 1, opacity: 0.85 }}>{user.role === "ADMIN" ? "ADMIN" : "ICE & MIXERS MEMBER"}</Text>
            <Text style={{ fontFamily: script, color: c.text, fontSize: 30, lineHeight: 36 }} numberOfLines={1}>{user.name}</Text>
            <Text style={{ color: c.muted, fontSize: 13 }} numberOfLines={1}>{user.email}</Text>
            {user.phone ? <Text style={{ color: c.muted, fontSize: 13 }}>+91 {user.phone}</Text> : null}
          </View>
        </View>
      </View>

      <View style={{ marginHorizontal: 16, marginTop: -26, flexDirection: "row", backgroundColor: c.card, borderRadius: 20, borderWidth: 1, borderColor: c.border, paddingVertical: 14 }}>
        {stats.map(([label, value], i) => (
          <View key={label} style={{ flex: 1, alignItems: "center", borderLeftWidth: i ? 1 : 0, borderLeftColor: c.border }}>
            <Text style={{ color: c.text, fontSize: 18, fontWeight: "800" }}>{value}</Text>
            <Text style={{ color: c.muted, fontSize: 11, marginTop: 2 }}>{label}</Text>
          </View>
        ))}
      </View>

      <View style={{ paddingHorizontal: 16 }}>
        <Pressable onPress={() => navigation.navigate("Orders")} style={{ flexDirection: "row", alignItems: "center", backgroundColor: c.brand, borderRadius: 18, padding: 14, marginTop: 14 }}>
          <Ionicons name="receipt-outline" size={22} color={c.onBrand} />
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Text style={{ color: c.onBrand, fontWeight: "800", fontSize: 15 }}>My orders</Text>
            <Text style={{ color: c.onBrand, fontSize: 12, opacity: 0.8 }}>Track, pay, cancel and check refunds</Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={c.onBrand} />
        </Pressable>

        <Profile />
        <Addresses onCount={setAddrCount} />
        <Password />
        <Appearance />
        <About />

        <Pressable onPress={confirmLogout} style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: c.danger, borderRadius: 14, paddingVertical: 14, marginTop: 20 }}>
          <Ionicons name="log-out-outline" size={18} color={c.danger} />
          <Text style={{ color: c.danger, fontWeight: "800", marginLeft: 8 }}>Log out</Text>
        </Pressable>
        <Text style={{ color: c.muted, fontSize: 11, textAlign: "center", marginTop: 14 }}>Ice &amp; Mixers Express · Delivery times are estimates, not guarantees.</Text>
      </View>
    </ScrollView>
  );
}

export default function Account() {
  const { user } = useAuth();
  return user ? <SignedIn /> : <SignedOut />;
}
