import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { Linking, Modal, Pressable, Text, View } from "react-native";
import { WebView, type WebViewMessageEvent } from "react-native-webview";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api } from "../lib/api";
import { checkoutHtml, PaymentNotCompleted, type CheckoutMessage, type CheckoutSuccess, type GatewayOrder, type OnlineMethod } from "../lib/payOnline";
import { c } from "../lib/theme";
import type { Order } from "../lib/types";

interface PaymentApi {
  /**
   * Pays an already-placed online order: asks the server for the gateway order (amount decided server-side), opens Razorpay,
   * then sends the result to the server, which verifies the signature and the real payment status before marking the order paid.
   * Resolves with the paid order. Rejects with PaymentNotCompleted (window closed / payment failed) or the API error.
   */
  payForOrder: (orderId: string, choice?: OnlineMethod) => Promise<Order>;
}
const Ctx = createContext<PaymentApi | null>(null);

interface Session {
  gateway: GatewayOrder;
  method?: OnlineMethod;
  resolve: (r: CheckoutSuccess) => void;
  reject: (e: Error) => void;
}

/** UPI apps and other app links: hand them to the phone (PhonePe, Google Pay ...) instead of loading them in the WebView. */
const isWeb = (url: string) => /^(https?:|about:|data:|blob:)/i.test(url);

export function PaymentProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const settled = useRef(false);
  const insets = useSafeAreaInsets();

  const payForOrder = useCallback(async (orderId: string, choice?: OnlineMethod) => {
    const { data: gateway } = await api.post<GatewayOrder>("/payments/razorpay/order", { orderId });
    settled.current = false;
    const result = await new Promise<CheckoutSuccess>((resolve, reject) => setSession({ gateway, method: choice, resolve, reject }));
    const { data } = await api.post<{ order: Order }>("/payments/razorpay/verify", { orderId, ...result });
    return data.order;
  }, []);

  const finish = (fn: (s: Session) => void) => {
    if (!session || settled.current) return;
    settled.current = true;
    const s = session;
    setSession(null);
    fn(s);
  };
  // A failed attempt does not close the window (the customer can retry inside it). If they then close it, report the failure, not a plain cancel.
  const cancel = (failure?: string) =>
    finish((s) =>
      s.reject(
        failure
          ? new PaymentNotCompleted(`Payment failed: ${failure}. Your order is saved and nothing was charged: you can try again.`, "failed")
          : new PaymentNotCompleted("Payment was cancelled. Your order is saved and nothing was charged: you can pay again.", "cancelled"),
      ),
    );

  const onMessage = (e: WebViewMessageEvent) => {
    let m: CheckoutMessage;
    try {
      m = JSON.parse(e.nativeEvent.data);
    } catch {
      return;
    }
    if (m.type === "success") finish((s) => s.resolve(m.data));
    else if (m.type === "dismiss") cancel(m.failure);
    else if (m.type === "failed") finish((s) => s.reject(new PaymentNotCompleted(m.message ? `Payment failed: ${m.message}` : "Payment failed. You can try again.", "failed")));
    else if (m.type === "loaderror") finish((s) => s.reject(new Error("The payment window could not be loaded. Check your connection and try again.")));
  };

  const value = useMemo(() => ({ payForOrder }), [payForOrder]);
  return (
    <Ctx.Provider value={value}>
      {children}
      <Modal visible={!!session} animationType="slide" onRequestClose={() => cancel()}>
        <View style={{ flex: 1, backgroundColor: c.bg, paddingTop: insets.top }}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 12 }}>
            <View style={{ flexDirection: "row", alignItems: "center" }}>
              <Ionicons name="lock-closed" size={16} color={c.ok} />
              <Text style={{ color: c.text, fontWeight: "700", marginLeft: 8 }}>Secure payment{session?.gateway.testMode ? " (test mode)" : ""}</Text>
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel="Close payment" onPress={() => cancel()} hitSlop={12}>
              <Ionicons name="close" size={24} color={c.text} />
            </Pressable>
          </View>
          {session ? (
            <WebView
              key={session.gateway.razorpayOrderId}
              style={{ flex: 1, backgroundColor: c.bg }}
              originWhitelist={["*"]}
              source={{ html: checkoutHtml(session.gateway, session.method), baseUrl: "https://checkout.razorpay.com/" }}
              javaScriptEnabled
              domStorageEnabled
              setSupportMultipleWindows={false}
              onMessage={onMessage}
              onShouldStartLoadWithRequest={(req) => {
                if (isWeb(req.url)) return true;
                void Linking.openURL(req.url).catch(() => undefined); // upi:// , phonepe:// , intent:// ...
                return false;
              }}
            />
          ) : null}
          <Text style={{ color: c.muted, fontSize: 11, textAlign: "center", padding: 10, paddingBottom: insets.bottom + 10 }}>
            We never see or store your card, UPI or bank details.
          </Text>
        </View>
      </Modal>
    </Ctx.Provider>
  );
}

export function usePayment() {
  const x = useContext(Ctx);
  if (!x) throw new Error("usePayment outside PaymentProvider");
  return x;
}
