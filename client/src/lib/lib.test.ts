import { describe, expect, it } from "vitest";
import { addItem, itemCount, mergeCarts, parseStoredCart, reconcileCarts, removeItem, setQuantity } from "./cart";
import { filtersToApiQuery, filtersToParams, parseFilters } from "./filters";
import { formatAddress, formatMoney, mapLink } from "./format";
import { cleanPin, pincodeError } from "./pincode";
import { apiError } from "./api";

describe("cart quantity updates", () => {
  it("adds, increments and caps at stock and the max quantity", () => {
    let c = addItem([], "a", 1, 5);
    c = addItem(c, "a", 2, 5);
    expect(c).toEqual([{ productId: "a", quantity: 3 }]);
    expect(addItem(c, "a", 10, 5)[0].quantity).toBe(5);
    expect(addItem([], "a", 99)[0].quantity).toBe(50);
    expect(addItem([], "a", 1, 0)).toEqual([]);
  });
  it("sets, removes and counts", () => {
    const c = [{ productId: "a", quantity: 2 }, { productId: "b", quantity: 3 }];
    expect(setQuantity(c, "a", 4)).toEqual([{ productId: "a", quantity: 4 }, { productId: "b", quantity: 3 }]);
    expect(setQuantity(c, "a", 0)).toEqual([{ productId: "b", quantity: 3 }]);
    expect(removeItem(c, "b")).toEqual([{ productId: "a", quantity: 2 }]);
    expect(itemCount(c)).toBe(5);
  });
  it("merges carts summing quantities", () => {
    expect(mergeCarts([{ productId: "a", quantity: 1 }], [{ productId: "a", quantity: 2 }, { productId: "b", quantity: 1 }])).toEqual([{ productId: "a", quantity: 3 }, { productId: "b", quantity: 1 }]);
  });
  it("ignores corrupt persisted carts", () => {
    expect(parseStoredCart("not json")).toEqual([]);
    expect(parseStoredCart('{"a":1}')).toEqual([]);
    expect(parseStoredCart('[{"productId":"a","quantity":-1},{"productId":"b","quantity":2}]')).toEqual([{ productId: "b", quantity: 2 }]);
  });
  it("reconciles server and local carts idempotently (max per product, never a sum)", () => {
    const cart = [{ productId: "a", quantity: 3 }, { productId: "b", quantity: 1 }];
    let c = cart;
    for (let i = 0; i < 5; i++) c = reconcileCarts(cart, c);
    expect(c).toEqual(cart);
    expect(reconcileCarts([{ productId: "a", quantity: 1 }, { productId: "s", quantity: 4 }], [{ productId: "a", quantity: 2 }, { productId: "l", quantity: 1 }])).toEqual([
      { productId: "a", quantity: 2 }, { productId: "s", quantity: 4 }, { productId: "l", quantity: 1 },
    ]);
  });
});

describe("shop filters in the URL", () => {
  it("round-trips filters", () => {
    const qs = "q=tonic&category=tonic-water&min=50&max=200&inStock=1&sort=price_asc&page=2";
    const f = parseFilters(new URLSearchParams(qs));
    expect(f).toMatchObject({ q: "tonic", category: "tonic-water", minPrice: 50, maxPrice: 200, inStock: true, sort: "price_asc", page: 2 });
    expect(filtersToParams(f).toString()).toBe(new URLSearchParams(qs).toString());
  });
  it("falls back to safe defaults for junk input", () => {
    expect(parseFilters(new URLSearchParams("sort=hax&page=-4&min=abc"))).toMatchObject({ sort: "popular", page: 1, minPrice: undefined });
  });
  it("converts rupees to minor units for the API and forces the category on category pages", () => {
    expect(filtersToApiQuery(parseFilters(new URLSearchParams("min=49.5&max=100")), 12)).toMatchObject({ minPrice: 4950, maxPrice: 10000, pageSize: 12 });
    expect(parseFilters(new URLSearchParams("category=x"), "ice-bags").category).toBe("ice-bags");
  });
});

describe("PIN code validation", () => {
  it("accepts only six digits not starting with 0", () => {
    expect(pincodeError("122018")).toBeNull();
    expect(pincodeError("")).toMatch(/Enter/);
    expect(pincodeError("12345")).toMatch(/6 digits/);
    expect(pincodeError("1234567")).toMatch(/6 digits/);
    expect(pincodeError("012345")).toMatch(/start with 0/);
    expect(pincodeError("12a456")).toMatch(/digits/);
  });
  it("cleans input to six digits", () => {
    expect(cleanPin(" 122-018 99")).toBe("122018");
  });
});

describe("formatting", () => {
  it("formats minor units as rupees", () => {
    expect(formatMoney(24900)).toContain("249");
    expect(formatMoney(24950)).toContain("249.5");
  });
  it("formats addresses and map links", () => {
    expect(formatAddress({ house: "12B", line1: "Sector 54", landmark: "Park", city: "Gurgaon", state: "Haryana", pincode: "122018" })).toBe("12B, Sector 54, Near Park, Gurgaon, Haryana 122018");
    expect(mapLink(28.4, 77.1)).toContain("mlat=28.4");
  });
});

describe("apiError", () => {
  it("explains unreachable servers instead of hiding them", () => {
    const e = Object.assign(new Error("Network Error"), { isAxiosError: true, response: undefined, code: "ERR_NETWORK" });
    expect(apiError(e).message).toMatch(/Can't reach the server/);
  });
  it("maps validation details to fields and strips the address prefix", () => {
    const e = Object.assign(new Error("x"), { isAxiosError: true, response: { status: 400, data: { error: "Validation failed", details: { "address.pincode": ["Bad PIN"], name: ["Short"] } } } });
    expect(apiError(e).fields).toEqual({ pincode: "Bad PIN", name: "Short" });
  });
  it("surfaces backend-down proxy errors", () => {
    const e = Object.assign(new Error("x"), { isAxiosError: true, response: { status: 502, data: {} } });
    expect(apiError(e).message).toMatch(/HTTP 502/);
  });
});

describe("API base URL (VITE_API_URL)", () => {
  it("defaults to same-origin /api and adds /api when it is missing", async () => {
    const { resolveApiBase } = await import("./api");
    expect(resolveApiBase(undefined)).toBe("/api");
    expect(resolveApiBase("")).toBe("/api");
    expect(resolveApiBase("   ")).toBe("/api");
    expect(resolveApiBase("https://ice-cocktail-mixers.onrender.com")).toBe("https://ice-cocktail-mixers.onrender.com/api");
    expect(resolveApiBase("https://ice-cocktail-mixers.onrender.com/")).toBe("https://ice-cocktail-mixers.onrender.com/api");
    expect(resolveApiBase("https://ice-cocktail-mixers.onrender.com/api")).toBe("https://ice-cocktail-mixers.onrender.com/api");
    expect(resolveApiBase("https://ice-cocktail-mixers.onrender.com/api/")).toBe("https://ice-cocktail-mixers.onrender.com/api");
    expect(resolveApiBase("/api")).toBe("/api");
  });
});

describe("API error bodies of any shape never become objects (React #31 crash)", () => {
  const ax = (status: number, data: unknown) => Object.assign(new Error("x"), { isAxiosError: true, response: { status, data } });
  it("reads our own { error: string }", () => {
    expect(apiError(ax(409, { error: "Out of stock" })).message).toBe("Out of stock");
  });
  it("reads Vercel's { error: { code, message } } as text (this exact shape crashed the deployed site)", () => {
    const info = apiError(ax(404, { error: { code: "404", message: "The page could not be found" } }));
    expect(typeof info.message).toBe("string");
    expect(info.message).toBe("The page could not be found");
  });
  it("falls back to a status message for HTML, empty, array and odd bodies", () => {
    for (const body of ["<!doctype html><html></html>", "", null, undefined, [], { error: { code: 1 } }, { error: 5 }, 42]) {
      const m = apiError(ax(404, body)).message;
      expect(typeof m).toBe("string");
      expect(m).toBe("Request failed (HTTP 404)");
    }
    expect(apiError(ax(502, { error: { nested: true } })).message).toMatch(/Can't reach the API server \(HTTP 502\)/);
  });
  it("uses the top-level message field when that is what a proxy sends", () => {
    expect(apiError(ax(503, { message: "Service Unavailable" })).message).toBe("Service Unavailable");
  });
});

describe("web page returned instead of API data", () => {
  it("is rejected with an explanation instead of crashing components that expect JSON", async () => {
    const { api } = await import("./api");
    const adapter = async (config: unknown) => ({ data: "<!doctype html><html><body>app</body></html>", status: 200, statusText: "OK", headers: {}, config });
    await expect(api.get("/categories", { adapter: adapter as never })).rejects.toThrow(/returned a web page instead of data/);
    const ok = async (config: unknown) => ({ data: { categories: [] }, status: 200, statusText: "OK", headers: {}, config });
    expect((await api.get("/categories", { adapter: ok as never })).data).toEqual({ categories: [] });
  });
});
