import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Linking, Pressable, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { api, errMsg } from "../lib/api";
import { cleanPin, pincodeError } from "../lib/pincode";
import { accuracyNote, currentFix, describeAccuracy, GEO_MESSAGES, GeoError, inIndia, isCoarse, mapLink } from "../lib/geolocate";
import { usePincodeLookup } from "../lib/usePincodeLookup";
import type { AddressType, PostOffice } from "../lib/types";
import { c } from "../lib/theme";
import { Button, Field } from "../components";
import { PinFeedback } from "./DeliveryInfo";
import LocationMap from "./LocationMap";

export interface AddressDraft {
  type: AddressType;
  house: string;
  line1: string;
  landmark: string;
  /** Postal area / post office. */
  area: string;
  district: string;
  state: string;
  /** ISO 3166-2:IN code, shown read-only; only present while it matches the state the lookup detected. */
  stateCode: string;
  /** Contact number for this address (10-digit Indian mobile). */
  phone: string;
  pincode: string;
  latitude: number | null;
  longitude: number | null;
}

export const emptyAddress: AddressDraft = { type: "HOME", house: "", line1: "", landmark: "", area: "", district: "", state: "", stateCode: "", phone: "", pincode: "", latitude: null, longitude: null };

/** Client-side checks mirroring the server rules. Returns field -> message. */
export function validateAddress(a: AddressDraft): Record<string, string> {
  const e: Record<string, string> = {};
  if (!a.house.trim()) e.house = "Enter your house / flat number";
  if (a.line1.trim().length < 3) e.line1 = "Enter the building, street or locality";
  if (a.district.trim().length < 2) e.district = "Enter the district";
  if (a.state.trim().length < 2) e.state = "Enter the state";
  if (!/^[6-9]\d{9}$/.test(a.phone)) e.phone = "Enter a valid 10-digit mobile number";
  const p = pincodeError(a.pincode);
  if (p) e.pincode = p;
  return e;
}

export const addressPayload = (a: AddressDraft) => ({
  type: a.type,
  house: a.house.trim(),
  line1: a.line1.trim(),
  landmark: a.landmark.trim() || null,
  area: a.area.trim() || null,
  district: a.district.trim(),
  city: a.district.trim(),
  state: a.state.trim(),
  pincode: a.pincode,
  latitude: a.latitude,
  longitude: a.longitude,
});

/** Saved-address and order records use `city`; the form edits `district` (they are the same place). */
export const draftFromRecord = (a: { type: AddressType | null; house: string | null; line1: string; landmark: string | null; area?: string | null; district?: string | null; city: string; state: string; stateCode?: string | null; phone?: string | null; pincode: string; latitude: number | null; longitude: number | null }): AddressDraft => ({
  type: a.type ?? "HOME", house: a.house ?? "", line1: a.line1, landmark: a.landmark ?? "", area: a.area ?? "", district: a.district ?? a.city, state: a.state, stateCode: a.stateCode ?? "", phone: a.phone ?? "", pincode: a.pincode, latitude: a.latitude, longitude: a.longitude,
});

interface Detected {
  latitude: number;
  longitude: number;
  accuracy?: number | null;
  outside?: boolean;
  coarse?: boolean;
  address?: { line1: string | null; area: string | null; district: string | null; city: string | null; state: string | null; pincode: string | null };
  note?: string;
}
type SearchHit = NonNullable<Detected["address"]> & { latitude: number; longitude: number; displayName: string | null };

// Getters, so the colours follow the current theme (these objects are created once, at import time).
const box = { get backgroundColor() { return c.tint; }, borderRadius: 14, padding: 12 };
const ghost = { borderWidth: 1, get borderColor() { return c.accent; }, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, flexDirection: "row" as const, alignItems: "center" as const, justifyContent: "center" as const };

function Chip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityState={{ selected: on }} style={{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, marginRight: 8, marginBottom: 8, backgroundColor: on ? c.brand : "transparent", borderWidth: 1, borderColor: on ? c.brand : c.border }}>
      <Text style={{ color: on ? c.onBrand : c.text, fontWeight: "600", fontSize: 13 }}>{label}</Text>
    </Pressable>
  );
}

/** `onChange` receives a patch, never a whole object, so a slow lookup can't overwrite fields typed in the meantime. */
export function AddressForm({ value, errors, onChange }: { value: AddressDraft; errors: Record<string, string>; onChange: (patch: Partial<AddressDraft>) => void }) {
  const lookup = usePincodeLookup(value.pincode);
  const [gps, setGps] = useState<{ busy: boolean; error: string | null; found: Detected | null }>({ busy: false, error: null, found: null });
  const [search, setSearch] = useState<{ q: string; busy: boolean; error: string | null; results: SearchHit[] | null }>({ q: "", busy: false, error: null, results: null });
  const [picking, setPicking] = useState(false); // "Choose on map": a plain map view until the customer taps a spot
  const latest = useRef(value);
  latest.current = value;
  // What we last filled in automatically, so a new PIN may replace those values but never the customer's own edits.
  const auto = useRef<{ area: string; district: string; state: string; stateCode: string }>({ area: "", district: "", state: "", stateCode: "" });
  const result = lookup.status === "done" ? lookup.result : null;
  const postal = result?.postal ?? null;
  const offices: PostOffice[] = postal?.status === "found" ? postal.offices : [];

  useEffect(() => {
    if (postal?.status !== "found") return;
    const cur = latest.current;
    const mine = (field: "area" | "district" | "state" | "stateCode") => cur[field] === "" || cur[field] === auto.current[field];
    const next = { area: offices.length === 1 ? offices[0].name : "", district: postal.district ?? "", state: postal.state ?? "", stateCode: postal.stateCode ?? "" };
    const patch: Partial<AddressDraft> = {};
    for (const f of ["area", "district", "state", "stateCode"] as const) {
      // With several post offices the area is left for the customer to choose.
      if (mine(f) && (f !== "area" || offices.length === 1 || cur.area === auto.current.area)) {
        if (cur[f] !== next[f]) patch[f] = next[f];
        auto.current[f] = next[f];
      }
    }
    if (Object.keys(patch).length) onChange(patch);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [postal]);

  const pickOffice = (name: string) => {
    const o = offices.find((x) => x.name === name);
    if (!o) return onChange({ area: "" });
    auto.current.area = o.name;
    const keepState = !!value.state && value.state !== auto.current.state;
    onChange({ area: o.name, district: value.district && value.district !== auto.current.district ? value.district : o.district, ...(keepState ? {} : { state: o.state, stateCode: o.stateCode ?? "" }) });
  };

  // Only the most recent request may update the screen (a slow reverse lookup must not overwrite a newer pin).
  const seq = useRef(0);
  const reverse = async (latitude: number, longitude: number, accuracy: number | null, id: number) => {
    if (!inIndia(latitude, longitude)) {
      if (id === seq.current) setGps({ busy: false, error: null, found: { latitude, longitude, accuracy, outside: true, note: "This location is outside India, where we deliver, so we can't suggest an address or use this pin. Enter your address manually." } });
      return;
    }
    if (isCoarse(accuracy)) {
      // A city-level guess is not an address: looking it up would just name a landmark near the city centre, so no address is suggested.
      if (id === seq.current) setGps({ busy: false, error: null, found: { latitude, longitude, accuracy, coarse: true, note: "We can't suggest an address from such a rough position. Search your address or PIN code above, or tap the map on your exact delivery spot and the address will be looked up for that spot." } });
      return;
    }
    try {
      const { data } = await api.post("/geo/reverse", { latitude, longitude });
      if (id === seq.current) setGps({ busy: false, error: null, found: { latitude, longitude, accuracy, address: data } });
    } catch (e) {
      if (id === seq.current) setGps({ busy: false, error: null, found: { latitude, longitude, accuracy, note: errMsg(e) } });
    }
  };
  const locate = async () => {
    setPicking(false);
    const id = ++seq.current;
    setGps({ busy: true, error: null, found: null });
    try {
      const fix = await currentFix();
      if (id === seq.current) await reverse(fix.latitude, fix.longitude, fix.accuracy, id);
    } catch (e) {
      if (id === seq.current) setGps({ busy: false, found: null, error: e instanceof GeoError ? e.message : GEO_MESSAGES.unavailable });
    }
  };
  // The pin was moved: the address shown must belong to the NEW coordinates, so look it up again.
  const moveFound = (latitude: number, longitude: number) => {
    const id = ++seq.current;
    setGps((g) => ({ ...g, found: { latitude, longitude, accuracy: null, note: "Looking up the address for the moved pin…" } }));
    void reverse(latitude, longitude, null, id);
  };
  const runSearch = async () => {
    const q = search.q.trim();
    if (q.length < 3) return setSearch((x) => ({ ...x, error: "Type at least 3 characters of the address, area or landmark.", results: null }));
    setSearch((x) => ({ ...x, busy: true, error: null, results: null }));
    try {
      const { data } = await api.post<{ results: SearchHit[] }>("/geo/search", { query: q });
      setSearch((x) => ({ ...x, busy: false, results: data.results, error: data.results.length ? null : "No matching address in India. Try a nearby landmark or area, or tap the map." }));
    } catch (err) {
      setSearch((x) => ({ ...x, busy: false, results: null, error: errMsg(err) }));
    }
  };
  // A search result becomes the selected pin; the customer still confirms it (and can drag it) like a detected location.
  const pickHit = (h: SearchHit) => {
    seq.current++;
    setPicking(false);
    setSearch((x) => ({ ...x, results: null }));
    const { latitude, longitude, displayName, ...address } = h;
    void displayName;
    setGps({ busy: false, error: null, found: { latitude, longitude, accuracy: null, address } });
  };
  // Nothing is filled until the customer confirms what was detected.
  const useDetected = (d: Detected, withAddress: boolean) => {
    const a = d.address;
    const cur = latest.current;
    onChange({
      latitude: d.latitude,
      longitude: d.longitude,
      ...(withAddress && a
        ? {
            // The customer asked to use what was found at the selected pin, so it replaces the older location text (house, landmark and phone are kept).
            line1: [a.line1, a.area].filter(Boolean).join(", ") || cur.line1,
            area: a.area || cur.area,
            district: a.district || a.city || cur.district,
            state: a.state || cur.state,
            pincode: a.pincode || cur.pincode,
          }
        : {}),
    });
    setGps({ busy: false, error: null, found: null });
  };

  const f = gps.found;
  const note = f ? accuracyNote(f.accuracy ?? null) : null;
  const text = (id: keyof AddressDraft, label: string, extra: Record<string, unknown> = {}) => (
    <Field label={label} value={String(value[id] ?? "")} error={errors[id]} onChangeText={(t) => onChange({ [id]: id === "phone" ? t.replace(/\D/g, "").slice(0, 10) : t } as Partial<AddressDraft>)} {...extra} />
  );

  return (
    <View>
      <View style={[box, { marginBottom: 16 }]}>
        <View style={{ gap: 8 }}>
          <Pressable accessibilityRole="button" onPress={locate} disabled={gps.busy} style={[ghost, gps.busy && { opacity: 0.6 }]}>
            {gps.busy ? <ActivityIndicator color={c.accent} /> : <Ionicons name="locate-outline" size={18} color={c.accent} />}
            <Text style={{ color: c.accent, fontWeight: "700", marginLeft: 8 }}>{gps.busy ? "Locating…" : "Use my current location"}</Text>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityState={{ expanded: picking }} onPress={() => { setGps({ busy: false, error: null, found: null }); setPicking(true); }} style={ghost}>
            <Ionicons name="location-outline" size={18} color={c.accent} />
            <Text style={{ color: c.accent, fontWeight: "700", marginLeft: 8 }}>Choose on map</Text>
          </Pressable>
        </View>

        <Text style={{ color: c.muted, fontSize: 13, fontWeight: "600", marginTop: 14, marginBottom: 4 }}>Search delivery address</Text>
        <View style={{ flexDirection: "row", gap: 8 }}>
          <TextInput
            value={search.q}
            onChangeText={(t) => setSearch((x) => ({ ...x, q: t }))}
            onSubmitEditing={runSearch}
            returnKeyType="search"
            placeholder="Area, street or landmark"
            placeholderTextColor={c.muted}
            autoCorrect={false}
            style={{ flex: 1, borderWidth: 1, borderColor: c.border, backgroundColor: c.card, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, color: c.text }}
          />
          <Pressable accessibilityRole="button" onPress={runSearch} disabled={search.busy} style={[ghost, search.busy && { opacity: 0.6 }]}>
            {search.busy ? <ActivityIndicator color={c.accent} /> : <Text style={{ color: c.accent, fontWeight: "700" }}>Search</Text>}
          </Pressable>
        </View>
        {search.error ? <Text style={{ color: c.warn, fontSize: 12, fontWeight: "600", marginTop: 6 }}>{search.error}</Text> : null}
        {search.results && search.results.length > 0 ? (
          <View style={{ marginTop: 8, borderRadius: 10, overflow: "hidden", backgroundColor: c.card }}>
            {search.results.map((h) => (
              <Pressable key={`${h.latitude},${h.longitude}`} onPress={() => pickHit(h)} style={{ flexDirection: "row", padding: 12, borderBottomWidth: 1, borderBottomColor: c.border }}>
                <Ionicons name="location-outline" size={16} color={c.text} style={{ marginTop: 2 }} />
                <Text style={{ color: c.text, fontSize: 13, flex: 1, marginLeft: 8 }}>{h.displayName ?? [h.line1, h.area, h.city, h.state, h.pincode].filter(Boolean).join(", ")}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}

        {picking && !f ? (
          <View style={{ marginTop: 12 }}>
            <LocationMap latitude={null} longitude={null} view={{ latitude: 22.5, longitude: 79, zoom: 4 }} onMove={(la, lo) => { setPicking(false); moveFound(la, lo); }} />
            <Text style={{ color: c.muted, fontSize: 12, marginTop: 6 }}>This is only a plain map view of India, not your location. Zoom in and tap your delivery spot to place the pin.</Text>
            <Pressable onPress={() => setPicking(false)} style={{ marginTop: 6 }}><Text style={{ color: c.text, fontWeight: "600", textDecorationLine: "underline", fontSize: 12 }}>Cancel</Text></Pressable>
          </View>
        ) : null}

        <Text style={{ color: c.muted, fontSize: 12, marginTop: 10 }}>Optional. Your phone asks for permission only when you tap "Use my current location"; we use your position just to fill this address and never track you.</Text>
        {gps.error ? <Text style={{ color: c.warn, fontSize: 12, fontWeight: "600", marginTop: 8 }}>{gps.error}</Text> : null}

        {f ? (
          <View style={{ marginTop: 12, backgroundColor: c.card, borderRadius: 12, padding: 12 }}>
            {f.address ? (
              <Text style={{ color: c.text, fontSize: 14 }}>
                <Text style={{ fontWeight: "700" }}>Detected: </Text>
                {[f.address.line1, f.address.area, f.address.district ?? f.address.city, f.address.state, f.address.pincode].filter(Boolean).join(", ")}
              </Text>
            ) : (
              <Text style={{ color: c.warn, fontSize: 13 }}>{f.note}</Text>
            )}
            {!f.outside ? (
              <View style={{ marginTop: 10 }}>
                {/* A city-level guess is shown as an area only, with no pin: a pin would claim a spot that is really hundreds of km wide. */}
                {f.coarse ? (
                  <LocationMap latitude={null} longitude={null} view={{ latitude: f.latitude, longitude: f.longitude, zoom: 9 }} onMove={moveFound} />
                ) : (
                  <LocationMap latitude={f.latitude} longitude={f.longitude} accuracy={f.accuracy} onMove={moveFound} />
                )}
              </View>
            ) : null}
            <Text style={{ color: c.muted, fontSize: 12, marginTop: 8 }}>
              Latitude {f.latitude}, longitude {f.longitude} · accuracy {describeAccuracy(f.accuracy ?? null)}
              {!f.outside ? (f.coarse ? " · approximate area only, no pin placed" : " · tap the map or drag the pin to adjust it") : ""}
            </Text>
            {note ? <Text style={{ color: c.warn, fontSize: 12, fontWeight: "600", marginTop: 6 }}>{note}</Text> : null}
            <View style={{ marginTop: 10, gap: 8 }}>
              {f.address ? <Button title="Confirm delivery location" onPress={() => useDetected(f, true)} /> : null}
              {!f.outside && !f.coarse ? <Button title="Confirm pin only" kind="ghost" onPress={() => useDetected(f, false)} /> : null}
              <Button title="Dismiss" kind="ghost" onPress={() => setGps({ busy: false, error: null, found: null })} />
            </View>
          </View>
        ) : null}

        {value.latitude !== null && value.longitude !== null ? (
          <View style={{ marginTop: 12 }}>
            <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center" }}>
              <Ionicons name="location" size={14} color={c.text} />
              <Text style={{ color: c.text, fontSize: 12, marginLeft: 6 }}>GPS pin saved with this address · </Text>
              <Pressable onPress={() => void Linking.openURL(mapLink(value.latitude!, value.longitude!))}><Text style={{ color: c.text, fontSize: 12, fontWeight: "700", textDecorationLine: "underline" }}>View on map</Text></Pressable>
              <Text style={{ color: c.text, fontSize: 12 }}> · </Text>
              <Pressable onPress={() => onChange({ latitude: null, longitude: null })}><Text style={{ color: c.text, fontSize: 12, fontWeight: "700", textDecorationLine: "underline" }}>Remove pin</Text></Pressable>
            </View>
            <View style={{ marginTop: 8 }}><LocationMap latitude={value.latitude} longitude={value.longitude} height={160} /></View>
          </View>
        ) : null}
      </View>

      <Field label="PIN code" value={value.pincode} error={errors.pincode} onChangeText={(t) => onChange({ pincode: cleanPin(t) })} keyboardType="number-pad" maxLength={6} placeholder="6 digits" autoComplete="postal-code" />
      <View style={{ marginTop: -4, marginBottom: 14 }}>
        <PinFeedback status={lookup.status} postal={postal} delivery={result?.delivery ?? null} error={lookup.error} onRetry={lookup.retry} />
      </View>

      {offices.length > 1 ? (
        <View style={{ marginBottom: 12 }}>
          <Text style={{ color: c.muted, fontSize: 13, fontWeight: "600", marginBottom: 6 }}>Select your post office / area</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
            {offices.map((o) => <Chip key={o.name} label={`${o.name}${o.block ? ` (${o.block})` : ""}`} on={value.area === o.name} onPress={() => pickOffice(o.name)} />)}
          </View>
          <Text style={{ color: c.muted, fontSize: 12 }}>{offices.length} areas share this PIN code. You can also type your own area below.</Text>
        </View>
      ) : null}

      {text("house", "House / flat no.", { placeholder: "e.g. 12B", autoCapitalize: "characters" })}
      {text("line1", "Street / locality", { autoCapitalize: "sentences" })}
      {text("area", "Area / post office", { placeholder: "Filled from your PIN code", autoCapitalize: "words" })}
      {text("district", "City / district", { autoCapitalize: "words" })}
      <Field label="State" value={value.state} error={errors.state} onChangeText={(t) => onChange({ state: t, stateCode: "" })} autoCapitalize="words" />
      {value.stateCode ? <Text style={{ color: c.muted, fontSize: 12, marginTop: -6, marginBottom: 12 }}>State code: <Text style={{ fontWeight: "700" }}>{value.stateCode}</Text></Text> : null}
      {text("landmark", "Landmark (optional)", { placeholder: "Near…", autoCapitalize: "sentences" })}
      {text("phone", "Mobile number", { keyboardType: "number-pad", maxLength: 10, placeholder: "10-digit mobile" })}
      <Text style={{ color: c.muted, fontSize: 13, fontWeight: "600", marginBottom: 6 }}>Address type</Text>
      <View style={{ flexDirection: "row" }}>
        {(["HOME", "WORK", "OTHER"] as AddressType[]).map((t) => <Chip key={t} label={t[0] + t.slice(1).toLowerCase()} on={value.type === t} onPress={() => onChange({ type: t })} />)}
      </View>
    </View>
  );
}
