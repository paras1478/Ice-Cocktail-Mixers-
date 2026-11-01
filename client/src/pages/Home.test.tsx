import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import Home from "./Home";

const setPincode = vi.hoisted(() => vi.fn(async () => ({})));
type Reply = { data: unknown } | Error;
const replies: Record<string, Reply> = {};
const get = vi.fn(async (url: string) => {
  const r = replies[url];
  if (r instanceof Error) throw r;
  if (!r) throw new Error("unexpected request " + url);
  return r;
});

vi.mock("../lib/api", () => ({ api: { get: (u: string) => get(u) }, apiError: (e: Error) => ({ message: e.message, fields: {} }) }));
// A logged-out visitor: no user, and the protected endpoints answer 401. The public homepage must not depend on either.
vi.mock("../context/AuthContext", () => ({ useAuth: () => ({ user: null, loading: false }) }));
vi.mock("../context/CartContext", () => ({ useCart: () => ({ qtyOf: () => 0, add: vi.fn(), setQty: vi.fn(), addMany: vi.fn(), count: 0 }) }));
vi.mock("../context/WishlistContext", () => ({ useWishlist: () => ({ has: () => false, toggle: () => true }) }));
vi.mock("../context/ToastContext", () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }));
vi.mock("../context/LocationContext", () => ({ useLocationCtx: () => ({ pincode: "122018", delivery: null, postal: null, status: "idle", error: null, modalOpen: false, openModal: vi.fn(), closeModal: vi.fn(), setPincode, retry: vi.fn() }) }));

const unauthorized = Object.assign(new Error("Please log in"), { response: { status: 401 } });
const product = { id: "p1", slug: "tonic", sku: "ICX-TON-001", variantGroup: null, name: "Schweppes Indian Tonic Water", brand: "Schweppes", priceStatus: "VERIFIED", priceSourceUrl: null, priceVerifiedAt: null, priceNotes: null, description: "", details: null, packSize: "300 ml", priceMinor: 6000, mrpMinor: null, discountPercent: 0, stock: 10, inStock: true, lowStock: false, lowStockAt: 10, popularity: 1, isActive: true, isDemo: false, categoryId: "c", images: [] };
const bundle = { id: "b1", slug: "party-kit", name: "Party Kit", description: "Everything for 10", imageUrl: null, isActive: true, priceMinor: 50000, regularMinor: 55000, savingsMinor: 5000, inStock: true, items: [] };
const category = { id: "c", slug: "tonic-water", name: "Tonic Water", description: "", imageUrl: null, sortOrder: 0, icon: null, isActive: true, productCount: 1 };

const show = () => render(<MemoryRouter><Home /></MemoryRouter>);

beforeEach(() => {
  get.mockClear();
  for (const k of Object.keys(replies)) delete replies[k];
  replies["/auth/me"] = unauthorized;
  replies["/cart"] = unauthorized;
});

describe("homepage hero: delivery", () => {
  beforeEach(() => {
    setPincode.mockClear();
    replies["/categories"] = { data: { categories: [category] } };
    replies["/products"] = { data: { products: [product], total: 1, page: 1, pageSize: 8, totalPages: 1 } };
    replies["/bundles"] = { data: { bundles: [] } };
    replies["/config"] = { data: { currency: "INR", deliveryFeeMinor: 2900, freeDeliveryThresholdMinor: 49900, taxRateBps: 1800, payments: { cod: true, card: false } } };
  });
  it("has the concise headline, a PIN field that reuses the real lookup, and the configured delivery fee", async () => {
    show();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("A good evening starts with ice.");
    fireEvent.change(screen.getByLabelText("PIN code"), { target: { value: "12201" } });
    fireEvent.click(screen.getByRole("button", { name: "Check availability" }));
    expect(screen.getByRole("status", { name: "" })).toBeTruthy();
    expect(setPincode).not.toHaveBeenCalled(); // an incomplete PIN is rejected before any request
    fireEvent.change(screen.getByLabelText("PIN code"), { target: { value: "122018" } });
    fireEvent.click(screen.getByRole("button", { name: "Check availability" }));
    await waitFor(() => expect(setPincode).toHaveBeenCalledWith("122018"));
    await waitFor(() => expect(screen.getByText(/Delivery ₹29, free above ₹499/)).toBeInTheDocument());
  });
  it("shows best sellers right after the categories and before party bundles", async () => {
    show();
    await waitFor(() => expect(screen.getByText("Schweppes Indian Tonic Water")).toBeInTheDocument());
    const order = ["Shop by category", "Best sellers", "Party bundles"].map((t) => screen.getByRole("region", { name: t }));
    expect(order[0].compareDocumentPosition(order[1]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(order[1].compareDocumentPosition(order[2]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe("homepage for a logged-out visitor", () => {
  it("renders the real catalogue returned by the public endpoints and never calls the protected ones", async () => {
    replies["/categories"] = { data: { categories: [category] } };
    replies["/products"] = { data: { products: [product], total: 1, page: 1, pageSize: 8, totalPages: 1 } };
    replies["/bundles"] = { data: { bundles: [bundle] } };
    show();
    await waitFor(() => expect(screen.getByText("Schweppes Indian Tonic Water")).toBeInTheDocument());
    expect(screen.getByText("Party Kit")).toBeInTheDocument();
    expect(screen.queryByText(/No products are listed yet/)).toBeNull();
    const called = get.mock.calls.map((c) => c[0]);
    expect(called).not.toContain("/auth/me");
    expect(called).not.toContain("/cart");
  });

  it("shows the honest empty message only when the API really returns no products", async () => {
    replies["/categories"] = { data: { categories: [] } };
    replies["/products"] = { data: { products: [], total: 0, page: 1, pageSize: 8, totalPages: 1 } };
    replies["/bundles"] = { data: { bundles: [] } };
    show();
    await waitFor(() => expect(screen.getByText(/No products are listed yet/)).toBeInTheDocument());
    expect(screen.getByText(/No bundles right now/)).toBeInTheDocument();
  });

  it("shows an error (not the empty message) when the products request fails", async () => {
    replies["/categories"] = { data: { categories: [category] } };
    replies["/products"] = new Error("Request failed with status code 500");
    replies["/bundles"] = { data: { bundles: [bundle] } };
    show();
    await waitFor(() => expect(screen.getByText(/Best sellers couldn't be loaded/)).toBeInTheDocument());
    expect(screen.queryByText(/No products are listed yet/)).toBeNull();
    expect(screen.getByText("Party Kit")).toBeInTheDocument(); // the rest of the page still renders
  });
});
