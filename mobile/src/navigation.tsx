import { useRef } from "react";
import { Pressable, Text } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { DarkTheme, DefaultTheme, NavigationContainer, type NavigationState, type NavigatorScreenParams } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { c, currentMode } from "./lib/theme";
import { useTheme } from "./context/ThemeContext";
import { useAuth } from "./context/AuthContext";
import { useCart } from "./context/CartContext";
import { Center, Button } from "./components";
import Shop from "./screens/Shop";
import ProductScreen from "./screens/Product";
import CartScreen from "./screens/Cart";
import Checkout from "./screens/Checkout";
import Orders from "./screens/Orders";
import Account from "./screens/Account";

export type TabsParam = { Shop: undefined; Cart: undefined; Orders: undefined; Account: undefined };
export type RootStack = { Tabs: NavigatorScreenParams<TabsParam> | undefined; Product: { id: string }; Checkout: undefined };

const Stack = createNativeStackNavigator<RootStack>();
const Tab = createBottomTabNavigator<TabsParam>();

/** Active tab: filled icon, strong colour and a soft highlight behind the whole item (see tabBarActiveBackgroundColor), in both themes. */
const icon = (name: keyof typeof Ionicons.glyphMap, active: keyof typeof Ionicons.glyphMap) => ({ color, size, focused }: { color: string; size: number; focused: boolean }) => (
  <Ionicons name={focused ? active : name} size={size} color={color} />
);
const navTheme = () => {
  const base = currentMode() === "dark" ? DarkTheme : DefaultTheme;
  return { ...base, colors: { ...base.colors, background: c.bg, card: c.bg, text: c.text, border: c.border, primary: c.brand } };
};

function Tabs() {
  const { count } = useCart();
  return (
    <Tab.Navigator screenOptions={({ navigation }) => ({
      // Back arrow on Cart / Orders / Account: returns to the shop (Shop has no header).
      headerLeft: () => (
        <Pressable accessibilityRole="button" accessibilityLabel="Back to shop" onPress={() => navigation.navigate("Shop")} hitSlop={12} style={{ marginLeft: 14 }}>
          <Ionicons name="arrow-back" size={24} color={c.text} />
        </Pressable>
      ), tabBarActiveTintColor: currentMode() === "dark" ? c.brand : "#7a4e0e", tabBarInactiveTintColor: c.muted, tabBarActiveBackgroundColor: c.tint, tabBarItemStyle: { borderRadius: 14, marginHorizontal: 6, marginVertical: 5 }, tabBarLabelStyle: { fontWeight: "700", fontSize: 11 }, tabBarStyle: { backgroundColor: c.card, borderTopColor: c.border }, headerStyle: { backgroundColor: c.bg }, headerTintColor: c.text })}>
      <Tab.Screen name="Shop" component={Shop} options={{ headerShown: false, tabBarLabel: "Shop", tabBarIcon: icon("home-outline", "home") }} />
      <Tab.Screen name="Cart" component={CartScreen} options={{ tabBarIcon: icon("bag-outline", "bag"), tabBarBadge: count > 0 ? count : undefined }} />
      <Tab.Screen name="Orders" component={Orders} options={{ tabBarIcon: icon("receipt-outline", "receipt") }} />
      <Tab.Screen name="Account" component={Account} options={{ tabBarIcon: icon("person-outline", "person") }} />
    </Tab.Navigator>
  );
}

/** Checkout needs an account: orders are tied to a user. */
function CheckoutGate(props: any) {
  const { user } = useAuth();
  if (!user)
    return (
      <Center>
        <Text style={{ fontWeight: "700", fontSize: 17, color: c.text, marginBottom: 12 }}>Log in to place your order</Text>
        <Button title="Go to login" onPress={() => props.navigation.reset({ index: 0, routes: [{ name: "Tabs", params: { screen: "Account" } }] })} />
      </Center>
    );
  return <Checkout {...props} />;
}

/**
 * Opening a tab with navigate("Tabs", { screen: "Cart" }) leaves { screen: "Cart" } on the Tabs route. If that state is restored after a theme switch,
 * React Navigation replays it and jumps to that tab again, so the one-shot params are dropped before the state is saved.
 */
const withoutTabsParams = (state: NavigationState): NavigationState => ({
  ...state,
  routes: state.routes.map((r) => (r.name === "Tabs" ? { ...r, params: undefined } : r)),
});

export default function Navigation() {
  const { mode } = useTheme();
  // Remounted on a theme switch so headers / tab bar repaint; the saved state keeps the customer on the same screen.
  const saved = useRef<NavigationState | undefined>(undefined);
  return (
    <NavigationContainer key={mode} theme={navTheme()} initialState={saved.current} onStateChange={(s) => { saved.current = s && withoutTabsParams(s); }}>
      <Stack.Navigator screenOptions={{ headerStyle: { backgroundColor: c.bg }, headerTintColor: c.text }}>
        <Stack.Screen name="Tabs" component={Tabs} options={{ headerShown: false }} />
        <Stack.Screen name="Product" component={ProductScreen} options={{ title: "Product" }} />
        <Stack.Screen name="Checkout" component={CheckoutGate} options={{ title: "Checkout" }} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
