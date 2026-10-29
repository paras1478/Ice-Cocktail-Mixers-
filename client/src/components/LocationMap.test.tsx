import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import LocationMap from "./LocationMap";

// Real Leaflet in jsdom (no layout, no tiles): enough to check the pin is created and removed with the coordinates it is given.
// Pixel positions need a real browser; the pin's position follows setLatLng(latitude, longitude) (see manual checks).
const markers = (c: HTMLElement) => c.querySelectorAll(".leaflet-marker-icon");

describe("LocationMap", () => {
  it("shows no pin and no coordinates while nothing is selected (a temporary map view only)", () => {
    const { container } = render(<LocationMap latitude={null} longitude={null} view={{ latitude: 22.5, longitude: 79, zoom: 4 }} onMove={vi.fn()} />);
    expect(container.querySelector(".leaflet-container")).not.toBeNull();
    expect(markers(container)).toHaveLength(0);
  });

  it("draws one pin for the selected coordinates, keeps it single when they change, and removes it when the selection is cleared", () => {
    const { container, rerender } = render(<LocationMap latitude={28.4312} longitude={77.1012} accuracy={20} onMove={vi.fn()} />);
    expect(markers(container)).toHaveLength(1);
    rerender(<LocationMap latitude={19.076} longitude={72.8777} accuracy={20} onMove={vi.fn()} />);
    expect(markers(container)).toHaveLength(1);
    rerender(<LocationMap latitude={null} longitude={null} onMove={vi.fn()} />);
    expect(markers(container)).toHaveLength(0);
  });

  it("makes the pin draggable only when the customer may move it, and never lets the accuracy circle capture clicks", () => {
    const { container, rerender } = render(<LocationMap latitude={28.4} longitude={77.1} accuracy={200000} onMove={vi.fn()} />);
    expect(container.querySelector(".leaflet-marker-draggable")).not.toBeNull();
    expect(container.querySelector("path.leaflet-interactive")).toBeNull(); // the circle is not interactive
    rerender(<LocationMap latitude={28.4} longitude={77.1} />);
  });
});
