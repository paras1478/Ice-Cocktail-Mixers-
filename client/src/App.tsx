import { lazy, Suspense } from "react";
import { useState } from "react";
import { Route, Routes, useLocation } from "react-router-dom";
import { Layout } from "./components/Layout";
import { Spinner } from "./components/ui";
import Home from "./pages/Home";
import Welcome from "./pages/Welcome";
import Shop from "./pages/Shop";
import ProductPage from "./pages/ProductPage";
import CartPage from "./pages/CartPage";
import { LoginPage, RegisterPage, RequireAuth } from "./pages/AuthPages";
import { NotFound, Policy } from "./pages/Misc";

// Account, checkout and admin are only needed after login, so they load on demand.
const Checkout = lazy(() => import("./pages/Checkout"));
const Orders = lazy(() => import("./pages/Orders"));
const Account = lazy(() => import("./pages/Account"));
const Admin = lazy(() => import("./pages/Admin"));
const lazyPage = (el: React.ReactNode) => <Suspense fallback={<div className="py-24"><Spinner /></div>}>{el}</Suspense>;

const WELCOME_KEY = "welcome-seen";
const welcomeSeen = () => { try { return sessionStorage.getItem(WELCOME_KEY) === "1"; } catch { return true; } }; // storage blocked: skip the splash rather than trap the visitor

/** Shows the welcome screen once per browser session, only when the visitor lands on "/" (deep links to /shop, /cart ... skip it). */
function WelcomeGate({ children }: { children: React.ReactNode }) {
  const { pathname } = useLocation();
  const [seen, setSeen] = useState(welcomeSeen);
  if (seen || pathname !== "/") return <>{children}</>;
  return <Welcome onStart={() => { try { sessionStorage.setItem(WELCOME_KEY, "1"); } catch { /* ignore */ } setSeen(true); }} />;
}

export default function App() {
  return (
    <WelcomeGate>
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Home />} />
        <Route path="shop" element={<Shop />} />
        <Route path="category/:slug" element={<Shop />} />
        <Route path="product/:slug" element={<ProductPage />} />
        <Route path="cart" element={<CartPage />} />
        <Route path="login" element={<LoginPage />} />
        <Route path="register" element={<RegisterPage />} />
        <Route path="policy/:slug" element={<Policy />} />
        <Route path="checkout" element={<RequireAuth>{lazyPage(<Checkout />)}</RequireAuth>} />
        <Route path="orders" element={<RequireAuth>{lazyPage(<Orders />)}</RequireAuth>} />
        <Route path="account" element={<RequireAuth>{lazyPage(<Account />)}</RequireAuth>} />
        <Route path="admin" element={<RequireAuth admin>{lazyPage(<Admin />)}</RequireAuth>} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
    </WelcomeGate>
  );
}
