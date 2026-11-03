import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { c } from "../lib/theme";
import type { Delivery, PostalResult } from "../lib/types";
import type { LookupStatus } from "../lib/usePincodeLookup";

/** Whether we deliver. This comes from our own coverage table, never from the postal lookup. */
export function DeliveryResult({ delivery }: { delivery: Delivery | null }) {
  if (!delivery) return null;
  const ok = delivery.serviceable;
  return (
    <View style={{ backgroundColor: c.tint, borderRadius: 12, padding: 12 }}>
      <Text style={{ color: ok ? c.ok : c.danger, fontWeight: "600", fontSize: 13 }}>
        {ok
          ? `Delivery available to ${delivery.areaName} (${delivery.pincode}), usually in about ${delivery.etaMinutes} min. This is an estimate, not a guarantee.${delivery.isSample ? " (Sample coverage data.)" : ""}`
          : delivery.reason === "paused"
            ? `Delivery to ${delivery.pincode} is temporarily paused.`
            : "Sorry, delivery is not available in this area."}
      </Text>
    </View>
  );
}

/** Postal area / district / state for a PIN, plus a clear message when the lookup could not be completed. */
export function PostalSuggestions({ postal }: { postal: PostalResult | null }) {
  if (!postal) return null;
  const warn = postal.status !== "found";
  const text =
    postal.status === "found"
      ? `Area and state detected: ${postal.offices.slice(0, 3).map((o) => o.name).join(", ")}${postal.offices.length > 3 ? "…" : ""} · ${postal.district}, ${postal.state}`
      : postal.status === "not_found"
        ? "The postal service has no record of this PIN code. Check it, or enter the area, district and state manually."
        : postal.message;
  return <Text style={{ color: warn ? c.warn : c.muted, fontSize: 12 }}>{text}</Text>;
}

/** The one place the PIN states are worded: invalid / looking / detected / available / not available / unable to verify. */
export function PinFeedback({ status, postal, delivery, error, onRetry }: { status: LookupStatus; postal: PostalResult | null; delivery: Delivery | null; error: string | null; onRetry: () => void }) {
  if (status === "idle") return <Text style={{ color: c.muted, fontSize: 12 }}>Enter a valid 6-digit PIN code.</Text>;
  if (status === "looking")
    return (
      <View style={{ flexDirection: "row", alignItems: "center" }}>
        <ActivityIndicator size="small" color={c.muted} />
        <Text style={{ color: c.muted, fontSize: 12, marginLeft: 8 }}>Looking up location…</Text>
      </View>
    );
  if (status === "error")
    return (
      <View style={{ backgroundColor: c.tint, borderRadius: 12, padding: 12 }}>
        <Text style={{ color: c.warn, fontWeight: "600", fontSize: 13 }}>Unable to verify delivery. Please try again.</Text>
        {error ? <Text style={{ color: c.muted, fontSize: 12, marginTop: 4 }}>{error}</Text> : null}
        <Pressable accessibilityRole="button" onPress={onRetry} style={{ alignSelf: "flex-start", marginTop: 8, borderWidth: 1, borderColor: c.accent, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 6 }}>
          <Text style={{ color: c.accent, fontWeight: "700" }}>Retry</Text>
        </Pressable>
      </View>
    );
  return (
    <View style={{ gap: 8 }}>
      <PostalSuggestions postal={postal} />
      <DeliveryResult delivery={delivery} />
    </View>
  );
}
