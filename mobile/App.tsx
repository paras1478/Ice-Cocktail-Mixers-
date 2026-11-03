import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { useFonts, Satisfy_400Regular } from "@expo-google-fonts/satisfy";
import { InstrumentSerif_400Regular } from "@expo-google-fonts/instrument-serif";
import * as SecureStore from "expo-secure-store";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AuthProvider, useAuth } from "./src/context/AuthContext";
import { PaymentProvider } from "./src/context/PaymentContext";
import { CartProvider } from "./src/context/CartContext";
import { ThemeContext } from "./src/context/ThemeContext";
import Navigation from "./src/navigation";
import { applyTheme, c, currentMode, type Mode } from "./src/lib/theme";

const THEME_KEY = "icx_theme";

function Gate() {
  const { loading } = useAuth();
  const [fontsLoaded] = useFonts({ Satisfy_400Regular, InstrumentSerif_400Regular });
  if (loading || !fontsLoaded)
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: c.bg }}>
        <ActivityIndicator color={c.accent} />
      </View>
    );
  return <Navigation />;
}

export default function App() {
  // The theme state lives here: when it changes, App re-renders, so every provider and screen below repaints with the new palette.
  const [mode, setMode] = useState<Mode>(currentMode());

  useEffect(() => {
    SecureStore.getItemAsync(THEME_KEY)
      .then((v) => {
        if ((v === "light" || v === "dark") && v !== currentMode()) {
          applyTheme(v);
          setMode(v);
        }
      })
      .catch(() => undefined);
  }, []);

  const toggle = useCallback(() => {
    const next: Mode = currentMode() === "dark" ? "light" : "dark";
    applyTheme(next);
    setMode(next);
    SecureStore.setItemAsync(THEME_KEY, next).catch(() => undefined);
  }, []);
  const value = useMemo(() => ({ mode, toggle }), [mode, toggle]);

  return (
    <ThemeContext.Provider value={value}>
      <SafeAreaProvider>
        <AuthProvider>
          <CartProvider>
            <PaymentProvider>
              <Gate />
            </PaymentProvider>
            <StatusBar style={mode === "dark" ? "light" : "dark"} />
          </CartProvider>
        </AuthProvider>
      </SafeAreaProvider>
    </ThemeContext.Provider>
  );
}
