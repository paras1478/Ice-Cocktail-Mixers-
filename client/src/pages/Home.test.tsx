import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import Home from "./Home";

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
vi.mock("../context/LocationContext", () => ({ useLocationCtx: () => ({ pincode: "122018", delivery: null, postal: null, status: "idle", error: null, modalOpen: false, openModal: vi.fn(), closeModal: vi.fn(), setPincode: vi.fn(), retry: vi.fn() }) }));

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
