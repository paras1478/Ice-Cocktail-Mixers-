import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { PriceFilter, parseRupees, validatePriceRange } from "./PriceFilter";
import { loadSavedFilters, saveFilters } from "../lib/savedFilters";

describe("price validation", () => {
  it("accepts blank (no limit), whole rupees and up to two decimals", () => {
    expect(parseRupees("")).toEqual({});
    expect(parseRupees("  ")).toEqual({});
    expect(parseRupees("150")).toEqual({ value: 150 });
    expect(parseRupees("99.5")).toEqual({ value: 99.5 });
    expect(parseRupees("99.50")).toEqual({ value: 99.5 });
    expect(parseRupees("0")).toEqual({ value: 0 });
  });
  it("rejects negatives, text, many decimals and stray symbols", () => {
    for (const bad of ["-5", "abc", "1.234", "1..2", "₹50", "5e3", ".5"]) expect(parseRupees(bad).error, bad).toMatch(/valid amount/);
  });
  it("rejects a minimum above the maximum but allows equal values", () => {
    expect(validatePriceRange("200", "100").errors.range).toMatch(/can't be higher/);
    expect(validatePriceRange("100", "100").errors).toEqual({});
    expect(validatePriceRange("100", "").errors).toEqual({});
    expect(validatePriceRange("", "").errors).toEqual({});
  });
});

const bounds = { minMinor: 6000, maxMinor: 59900 };
const setup = (props: Partial<Parameters<typeof PriceFilter>[0]> = {}) => {
  const onApply = vi.fn(); const onReset = vi.fn(); const onClearAll = vi.fn();
  render(<PriceFilter bounds={bounds} onApply={onApply} onReset={onReset} onClearAll={onClearAll} anyFilterActive {...props} />);
  return { onApply, onReset, onClearAll };
};
const type = (label: string, v: string) => fireEvent.change(screen.getByLabelText(label), { target: { value: v } });

describe("PriceFilter", () => {
  it("shows the heading, separate Min and Max inputs, the real catalogue range and the buttons", () => {
    setup();
    expect(screen.getByText("Price (₹)")).toBeInTheDocument();
    expect(screen.getByLabelText("Min")).toBeInTheDocument();
    expect(screen.getByLabelText("Max")).toBeInTheDocument();
    expect(screen.getByText(/₹60 – ₹599/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Apply price filter" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reset price filter" })).toBeInTheDocument();
  });
  it("applies valid decimal values (in rupees)", () => {
    const { onApply } = setup();
    type("Min", "49.5"); type("Max", "250");
    fireEvent.click(screen.getByRole("button", { name: "Apply price filter" }));
    expect(onApply).toHaveBeenCalledWith(49.5, 250);
  });
  it("applies a single bound, and none at all", () => {
    const { onApply } = setup();
    type("Max", "100");
    fireEvent.click(screen.getByRole("button", { name: "Apply price filter" }));
    expect(onApply).toHaveBeenLastCalledWith(undefined, 100);
    type("Max", "");
    fireEvent.click(screen.getByRole("button", { name: "Apply price filter" }));
    expect(onApply).toHaveBeenLastCalledWith(undefined, undefined);
  });
  it("blocks min > max with a clear message and does not apply", () => {
    const { onApply } = setup();
    type("Min", "300"); type("Max", "100");
    expect(screen.getByRole("alert")).toHaveTextContent(/Minimum price can't be higher than the maximum/);
    fireEvent.click(screen.getByRole("button", { name: "Apply price filter" }));
    expect(onApply).not.toHaveBeenCalled();
  });
  it("drops non-numeric characters as the customer types", () => {
    setup();
    type("Min", "₹1a2,5-0");
    expect((screen.getByLabelText("Min") as HTMLInputElement).value).toBe("1250");
  });
  it("Reset clears only the price filter, and Clear all filters clears everything", () => {
    const { onReset, onClearAll } = setup({ min: 50, max: 200 });
    expect((screen.getByLabelText("Min") as HTMLInputElement).value).toBe("50");
    fireEvent.click(screen.getByRole("button", { name: "Reset price filter" }));
    expect(onReset).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Clear all filters" }));
    expect(onClearAll).toHaveBeenCalledTimes(1);
  });
  it("the slider reflects and edits the range using real price bounds", () => {
    const { onApply } = setup();
    const lo = screen.getByLabelText("Minimum price") as HTMLInputElement;
    const hi = screen.getByLabelText("Maximum price") as HTMLInputElement;
    expect([lo.min, lo.max, hi.min, hi.max]).toEqual(["60", "599", "60", "599"]);
    fireEvent.change(lo, { target: { value: "100" } });
    fireEvent.change(hi, { target: { value: "400" } });
    expect((screen.getByLabelText("Min") as HTMLInputElement).value).toBe("100");
    expect((screen.getByLabelText("Max") as HTMLInputElement).value).toBe("400");
    fireEvent.click(screen.getByRole("button", { name: "Apply price filter" }));
    expect(onApply).toHaveBeenCalledWith(100, 400);
  });
  it("hides the slider when there is no price spread to choose from", () => {
    setup({ bounds: { minMinor: 6000, maxMinor: 6000 } });
    expect(screen.queryByLabelText("Minimum price")).toBeNull();
    setup({ bounds: null });
    expect(screen.queryAllByLabelText("Maximum price")).toHaveLength(0);
  });
});

describe("remembered filters", () => {
  beforeEach(() => sessionStorage.clear());
  it("round-trips price, stock and sort, and forgets when cleared", () => {
    expect(loadSavedFilters()).toBeNull();
    saveFilters({ minPrice: 50, maxPrice: 200, inStock: true, sort: "price_asc" });
    expect(loadSavedFilters()).toEqual({ minPrice: 50, maxPrice: 200, inStock: true, sort: "price_asc" });
    saveFilters(null);
    expect(loadSavedFilters()).toBeNull();
    saveFilters({ inStock: false, sort: "popular" }); // nothing worth remembering
    expect(loadSavedFilters()).toBeNull();
  });
  it("ignores corrupt storage", () => {
    sessionStorage.setItem("icx_filters", "{not json");
    expect(loadSavedFilters()).toBeNull();
    sessionStorage.setItem("icx_filters", JSON.stringify({ minPrice: -3, maxPrice: "x", sort: "hax", inStock: "yes" }));
    expect(loadSavedFilters()).toBeNull();
  });
});
