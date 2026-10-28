import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ProductCard } from "./ProductCard";
import type { Product } from "../lib/types";

const cart = { qtyOf: vi.fn(() => 0), add: vi.fn(), setQty: vi.fn() };
vi.mock("../context/CartContext", () => ({ useCart: () => cart }));
vi.mock("../context/WishlistContext", () => ({ useWishlist: () => ({ has: () => false, toggle: () => true }) }));
vi.mock("../context/ToastContext", () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }));

const product = (o: Partial<Product> = {}): Product => ({
  id: "p1", slug: "tonic", sku: "ICX-TON-001", variantGroup: null, name: "Schweppes Indian Tonic Water", brand: "Schweppes", priceStatus: "SAMPLE", priceSourceUrl: null, priceVerifiedAt: null, priceNotes: null,
  description: "", details: null, packSize: "300 ml", priceMinor: 6000, mrpMinor: null, discountPercent: 0, stock: 10, inStock: true, lowStock: false, lowStockAt: 10,
  popularity: 1, isActive: true, isDemo: true, categoryId: "c", images: [{ url: "/img/coming-soon.svg", alt: "Tonic, photo coming soon", isPlaceholder: true }], ...o,
});
let root: HTMLElement;
const renderCard = (p: Product) => { root = render(<MemoryRouter><ProductCard product={p} /></MemoryRouter>).container; };

beforeEach(() => vi.clearAllMocks());

describe("ProductCard", () => {
  it("shows brand, exact pack size, price and stock, and adds to the cart", () => {
    renderCard(product());
    expect(screen.getByText("Schweppes")).toBeInTheDocument();
    expect(screen.getByText(/300 ml/)).toBeInTheDocument();
    expect(screen.getByText(/60/)).toBeInTheDocument();
    expect(screen.getByText("In stock")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Add Schweppes Indian Tonic Water to cart"));
    expect(cart.add).toHaveBeenCalledWith("p1", 1, 10);
  });
  it("labels unverified prices and never shows an MRP or discount for them", () => {
    renderCard(product({ mrpMinor: null, discountPercent: 0 }));
    expect(screen.getByText(/Sample price · unverified/)).toBeInTheDocument();
    expect(screen.queryByText(/% OFF/)).toBeNull();
  });
  it("shows MRP and discount only when the server sends them (verified)", () => {
    renderCard(product({ priceStatus: "VERIFIED", mrpMinor: 8000, discountPercent: 25 }));
    expect(screen.getByText("25% OFF")).toBeInTheDocument();
    expect(screen.queryByText(/Sample price/)).toBeNull();
  });
  it("disables Add when out of stock and shows a stepper when already in the cart", () => {
    renderCard(product({ stock: 0, inStock: false }));
    expect(screen.getAllByText("Out of stock").length).toBeGreaterThan(0);
    expect(screen.queryByLabelText(/to cart/)).toBeNull();
    cart.qtyOf.mockReturnValueOnce(2 as never);
    renderCard(product());
    fireEvent.click(screen.getByLabelText("Increase quantity of Schweppes Indian Tonic Water"));
    expect(cart.setQty).toHaveBeenCalledWith("p1", 3, 10);
  });
  it("falls back to the placeholder if the image fails to load", () => {
    renderCard(product({ images: [{ url: "/broken.jpg", alt: "Tonic", isPlaceholder: false }] }));
    const img = root.querySelector("img")!;
    fireEvent.error(img);
    expect(root.querySelector("img")!.getAttribute("src")).toBe("/img/coming-soon.svg");
    expect(root.querySelector("img")!.getAttribute("alt")).toMatch(/photo unavailable/);
  });
});
