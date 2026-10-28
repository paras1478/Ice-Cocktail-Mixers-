import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { Layout } from "./Layout";

const categories = ["Ice Bags", "Tonic Water", "Club Soda", "Margarita Mixes", "Bitters", "Citrus Garnishes", "Party Bundles", "Party Essentials"].map((name, i) => ({
  id: String(i), slug: name.toLowerCase().replace(/ /g, "-"), name, description: "", imageUrl: null, sortOrder: i, icon: null, isActive: true, productCount: 1,
}));

vi.mock("../lib/api", () => ({ api: { get: vi.fn(async () => ({ data: { categories } })) }, apiError: (e: Error) => ({ message: e.message, fields: {} }) }));
vi.mock("../context/AuthContext", () => ({ useAuth: () => ({ user: null, logout: vi.fn() }) }));
vi.mock("../context/CartContext", () => ({ useCart: () => ({ count: 2 }) }));
vi.mock("../context/ThemeContext", () => ({ useTheme: () => ({ theme: "light", toggle: vi.fn() }) }));
vi.mock("../context/LocationContext", () => ({
  useLocationCtx: () => ({ pincode: "122018", delivery: { serviceable: true, pincode: "122018", areaName: "Sector 54", etaMinutes: 14 }, postal: null, status: "serviceable", error: null, modalOpen: false, openModal: vi.fn(), closeModal: vi.fn(), setPincode: vi.fn(), retry: vi.fn() }),
}));

const at = (path: string) => render(<MemoryRouter initialEntries={[path]}><Routes><Route element={<Layout />}><Route path="*" element={<p>page</p>} /></Route></Routes></MemoryRouter>);

describe("Layout", () => {
  it("shows the delivery banner with an honest estimate, and only the approved category pills", async () => {
    at("/");
    expect(screen.getByTestId("delivery-banner")).toHaveTextContent(/about 14 min/);
    expect(screen.getByTestId("delivery-banner")).toHaveTextContent(/not a guarantee/);
    await waitFor(() => expect(screen.getByRole("link", { name: "Ice Bags" })).toBeInTheDocument());
    const nav = screen.getByRole("navigation", { name: "Product categories" });
    expect(nav.querySelectorAll("a")).toHaveLength(8);
    expect(nav.textContent).not.toMatch(/beer|whisky|vodka|rum|gin|wine|champagne|malt/i);
  });
  it("never shows the customer delivery banner, category pills or cart inside admin routes", () => {
    at("/admin");
    expect(screen.queryByTestId("delivery-banner")).toBeNull();
    expect(screen.queryByRole("navigation", { name: "Product categories" })).toBeNull();
    expect(screen.queryByTestId("cart-count")).toBeNull();
    expect(screen.getByText("Admin")).toBeInTheDocument();
  });
  it("shows the cart count outside admin", () => {
    at("/cart");
    expect(screen.getByTestId("cart-count")).toHaveTextContent("2");
  });
});
