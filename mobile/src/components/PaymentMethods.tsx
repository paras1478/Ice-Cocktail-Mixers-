import { Pressable, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { c } from "../lib/theme";

/** What the customer picked. UPI / card / net banking all pay through Razorpay (the order's payment method is ONLINE). */
export type PayChoice = "UPI" | "CARD" | "NETBANKING" | "COD";

const OPTIONS: { id: PayChoice; title: string; body: string; icon: keyof typeof Ionicons.glyphMap; online: boolean }[] = [
  { id: "UPI", title: "UPI", body: "Google Pay, PhonePe, Paytm and other UPI apps", icon: "phone-portrait-outline", online: true },
  { id: "CARD", title: "Debit / credit card", body: "Visa, Mastercard, RuPay and more", icon: "card-outline", online: true },
  { id: "NETBANKING", title: "Net banking", body: "Pay from your bank account", icon: "business-outline", online: true },
  { id: "COD", title: "Cash on delivery", body: "Pay in cash when your order arrives", icon: "cash-outline", online: false },
];

/** Radio-card group. Unavailable methods stay visible with the reason, so a missing configuration is understandable and COD keeps working. */
export function PaymentMethods({ value, onChange, codOk, onlineOk, onlineNote, disabled }: { value: PayChoice; onChange: (v: PayChoice) => void; codOk: boolean; onlineOk: boolean; onlineNote?: string; disabled?: boolean }) {
  return (
    <View accessibilityRole="radiogroup" style={{ gap: 10 }}>
      {OPTIONS.map(({ id, title, body, icon, online }) => {
        const available = online ? onlineOk : codOk;
        const selected = value === id;
        const off = !available || disabled;
        return (
          <Pressable
            key={id}
            accessibilityRole="radio"
            accessibilityState={{ checked: selected, disabled: off }}
            disabled={off}
            onPress={() => onChange(id)}
            style={{ flexDirection: "row", alignItems: "flex-start", backgroundColor: selected ? c.tint : c.card, borderWidth: 1, borderColor: selected ? c.brand : c.border, borderRadius: 16, padding: 14, opacity: available ? 1 : 0.6 }}
          >
            <View style={{ width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: selected ? c.brand : c.tint }}>
              <Ionicons name={icon} size={20} color={selected ? c.onBrand : c.text} />
            </View>
            <View style={{ flex: 1, marginHorizontal: 12 }}>
              <Text style={{ color: c.text, fontWeight: "800", fontSize: 14 }}>{title}</Text>
              <Text style={{ color: c.muted, fontSize: 12, marginTop: 2 }}>{available ? body : online ? (onlineNote ?? "Not available right now") : "Not available for this store right now"}</Text>
            </View>
            {selected ? (
              <View style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: c.brand, alignItems: "center", justifyContent: "center" }}>
                <Ionicons name="checkmark" size={14} color={c.onBrand} />
              </View>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}
