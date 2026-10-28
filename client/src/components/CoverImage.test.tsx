import { describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import { CoverImage, ProductImage, FALLBACK_IMAGE } from "./ui";

describe("CoverImage (category backgrounds)", () => {
  it("renders the photo with reserved dimensions, lazy loading and a dark overlay for readable text", () => {
    const { container } = render(<div className="relative"><CoverImage src="/img/stock/category-club-soda.jpg" width={640} height={400} /></div>);
    const img = container.querySelector("img")!;
    expect(img).toHaveAttribute("src", "/img/stock/category-club-soda.jpg");
    expect(img).toHaveAttribute("width", "640");
    expect(img).toHaveAttribute("height", "400");
    expect(img).toHaveAttribute("loading", "lazy");
    expect(img.className).toContain("object-cover");
    expect(container.querySelector("span.bg-gradient-to-t")).not.toBeNull(); // overlay
  });
  it("loads eagerly for above-the-fold banners", () => {
    const { container } = render(<div className="relative"><CoverImage src="/x.jpg" eager /></div>);
    expect(container.querySelector("img")).toHaveAttribute("loading", "eager");
  });
  it("renders nothing without a src, and nothing (no retry, no placeholder) after a load error", () => {
    const none = render(<div className="relative"><CoverImage src={null} /></div>);
    expect(none.container.querySelector("img")).toBeNull();
    const onError = vi.fn();
    const { container } = render(<div className="relative"><CoverImage src="/missing.jpg" onError={onError} /></div>);
    fireEvent.error(container.querySelector("img")!);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("span.bg-gradient-to-t")).toBeNull();
  });
});

describe("ProductImage fallback", () => {
  it("swaps to the local fallback once on failure and never loops, even if the fallback itself fails", () => {
    const { container } = render(<ProductImage src="/missing.jpg" alt="Party Ice, 1 kg" />);
    fireEvent.error(container.querySelector("img")!);
    const img = container.querySelector("img")!;
    expect(img).toHaveAttribute("src", FALLBACK_IMAGE);
    expect(img.getAttribute("alt")).toBe("Party Ice, 1 kg (photo unavailable)");
    fireEvent.error(img); // the fallback failing must not change anything further
    fireEvent.error(img);
    expect(container.querySelector("img")).toHaveAttribute("src", FALLBACK_IMAGE);
  });
  it("keeps the real photo and its alt text when it loads", () => {
    const { container } = render(<ProductImage src="/img/stock/ice-cubes.jpg" alt="Clear ice cubes" width={400} height={400} />);
    const img = container.querySelector("img")!;
    expect(img).toHaveAttribute("src", "/img/stock/ice-cubes.jpg");
    expect(img).toHaveAttribute("alt", "Clear ice cubes");
    expect(img).toHaveAttribute("width", "400");
    expect(img).toHaveAttribute("loading", "lazy");
  });
  it("recovers when the product changes to a valid image after a failure", () => {
    const { container, rerender } = render(<ProductImage src="/missing.jpg" alt="x" />);
    fireEvent.error(container.querySelector("img")!);
    rerender(<ProductImage src="/img/stock/crushed-ice.jpg" alt="x" />);
    expect(container.querySelector("img")).toHaveAttribute("src", "/img/stock/crushed-ice.jpg");
  });
});
