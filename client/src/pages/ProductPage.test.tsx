import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import ProductPage from "./ProductPage";
import { BundleGrid } from "./Bundles";

const product = { id: "p1", slug: "tonic", sku: "ICX-TON-001", variantGroup: null, name: "Schweppes Indian Tonic Water", brand: "Schweppes", priceStatus: "VERIFIED", priceSourceUrl: null, priceVerifiedAt: null, priceNotes: null, description: "Crisp tonic", details: null, packSize: "300 ml", priceMinor: 6000, mrpMinor: null, discountPercent: 0, stock: 10, inStock: true, lowStock: false, lowStockAt: 10, popularity: 1, isActive: true, isDemo: false, categoryId: "c", category: { id: "c", slug: "tonic-water", name: "Tonic Water" }, images: [] };
const cart = vi.hoisted(() => ({ qtyOf: () => 0, add: vi.fn(), count: 0, quote: null as null | { totals: { subtotalMinor: number } }, addMany: vi.fn() }));

vi.mock("../lib/api", () => ({
  api: { get: vi.fn(async (u: string) => (u === "/config" ? { data: { deliveryFeeMinor: 2900, freeDeliveryThresholdMinor: 49900 } } : { data: { product, related: [], packs: [product] } })) },
  apiError: (e: Error) => ({ message: e.message, fields: {} }),
}));
vi.mock("../context/CartContext", () => ({ useCart: () => cart }));
vi.mock("../context/WishlistContext", () => ({ useWishlist: () => ({ has: () => false, toggle: () => true }) }));
vi.mock("../context/ToastContext", () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }));
vi.mock("../context/LocationContext", () => ({ useLocationCtx: () => ({ delivery: null, openModal: vi.fn() }) }));

const show = () => render(<MemoryRouter initialEntries={["/product/tonic"]}><Routes><Route path="/product/:slug" element={<ProductPage />} /></Routes></MemoryRouter>);
beforeEach(() => { cart.add.mockClear(); cart.count = 0; cart.quote = null; });

describe("product page on mobile", () => {
  it("has a fixed purchase bar that adds the product using the existing cart, and reserves room so it covers nothing", async () => {
    show();
    const bar = await screen.findByTestId("mobile-buy-bar");
    expect(bar).toHaveTextContent("₹60");
    expect(document.body.classList.contains("has-buy-bar")).toBe(true);
    fireEvent.click(bar.querySelector("button")!);
    expect(cart.add).toHaveBeenCalledWith("p1", 1, 10);
  });
  it("shows the cart count and subtotal from the cart's own quote", async () => {
    cart.count = 3; cart.quote = { totals: { subtotalMinor: 18000 } };
    show();
    const bar = await screen.findByTestId("mobile-buy-bar");
    expect(bar).toHaveTextContent("3 items in cart");
    expect(bar).toHaveTextContent("Subtotal ₹180");
  });
  it("shows the configured delivery fee near the price, and keeps product details collapsible", async () => {
    show();
    await waitFor(() => expect(screen.getByText(/Delivery ₹29, free above ₹499/)).toBeInTheDocument());
    expect(document.querySelector("details")).not.toBeNull();
  });
});

describe("party bundles", () => {
  it("keeps the contents collapsed under What's included", () => {
    const bundle = { id: "b1", slug: "k", name: "Party Kit", description: "d", imageUrl: null, isActive: true, priceMinor: 50000, regularMinor: 55000, savingsMinor: 5000, inStock: true, items: [{ productId: "p1", name: "Ice", packSize: "1 kg", quantity: 2, unitMinor: 6000, inStock: true }] };
    render(<BundleGrid bundles={[bundle]} />);
    const d = document.querySelector("details")!;
    expect(d.open).toBe(false);
    expect(d.querySelector("summary")).toHaveTextContent("What's included (1 item)");
  });
});
