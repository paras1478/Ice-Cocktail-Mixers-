import { afterEach, describe, expect, it, vi } from "vitest";
import { accuracyNote, currentFix, describeAccuracy, GeoError, inIndia, isCoarse } from "./geolocate";

type Ok = (p: unknown) => void;
type Err = (e: { code: number }) => void;
const setGeo = (impl: (ok: Ok, err: Err, o: PositionOptions) => void) => {
  const fn = vi.fn(impl);
  Object.defineProperty(navigator, "geolocation", { configurable: true, value: { getCurrentPosition: fn } });
  return fn;
};
const pos = (latitude: number, longitude: number, accuracy = 20) => ({ coords: { latitude, longitude, accuracy } });
afterEach(() => { Object.defineProperty(window, "isSecureContext", { configurable: true, value: true }); });

describe("currentFix", () => {
  it("returns the device coordinates as latitude / longitude (not swapped) with the accuracy, asking for a fresh high-accuracy reading first", async () => {
    const fn = setGeo((ok) => ok(pos(28.4312345678, 77.1012345678, 12.6)));
    expect(await currentFix()).toEqual({ latitude: 28.431235, longitude: 77.101235, accuracy: 13 });
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn.mock.calls[0][2]).toMatchObject({ enableHighAccuracy: true, maximumAge: 0 });
  });

  it("falls back to network positioning when high accuracy times out or is unavailable (typical on laptops)", async () => {
    for (const code of [3, 2]) {
      const fn = setGeo((ok, err, o) => (o.enableHighAccuracy ? err({ code }) : ok(pos(19.076, 72.8777, 2500))));
      const fix = await currentFix();
      expect(fix).toEqual({ latitude: 19.076, longitude: 72.8777, accuracy: 2500 });
      expect(fn).toHaveBeenCalledTimes(2);
      expect(fn.mock.calls[1][2]).toMatchObject({ enableHighAccuracy: false });
    }
  });

  it("keeps listening after a rough first fix and returns the best (most accurate) reading", async () => {
    vi.useFakeTimers();
    try {
      let watcher: Ok = () => {};
      const clearWatch = vi.fn();
      Object.defineProperty(navigator, "geolocation", { configurable: true, value: {
        getCurrentPosition: (ok: Ok) => ok(pos(25.609, 85.1343, 200000)),
        watchPosition: vi.fn((ok: Ok) => { watcher = ok; return 7; }), clearWatch,
      } });
      const p = currentFix(10_000);
      await vi.advanceTimersByTimeAsync(1000);
      watcher(pos(25.5941, 85.1376, 4000)); // better, but not good enough to stop
      watcher(pos(25.6, 85.14, 9000)); // worse readings are ignored
      await vi.advanceTimersByTimeAsync(1000);
      watcher(pos(25.5946, 85.1372, 35)); // good: stops listening at once
      expect(await p).toEqual({ latitude: 25.5946, longitude: 85.1372, accuracy: 35 });
      expect(clearWatch).toHaveBeenCalledWith(7);
    } finally { vi.useRealTimers(); }
  });

  it("returns the rough fix as it is when nothing better arrives, and skips refining when the first fix is already good", async () => {
    vi.useFakeTimers();
    try {
      const watch = vi.fn(() => 3);
      Object.defineProperty(navigator, "geolocation", { configurable: true, value: { getCurrentPosition: (ok: Ok) => ok(pos(25.609, 85.1343, 200000)), watchPosition: watch, clearWatch: vi.fn() } });
      const p = currentFix(5000);
      await vi.advanceTimersByTimeAsync(5000);
      expect(await p).toEqual({ latitude: 25.609, longitude: 85.1343, accuracy: 200000 }); // never presented as precise
      watch.mockClear();
      Object.defineProperty(navigator, "geolocation", { configurable: true, value: { getCurrentPosition: (ok: Ok) => ok(pos(28.43, 77.1, 12)), watchPosition: watch, clearWatch: vi.fn() } });
      expect((await currentFix(5000)).accuracy).toBe(12);
      expect(watch).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });

  it("does not retry after a permission denial, and reports the specific reason otherwise", async () => {
    const denied = setGeo((_ok, err) => err({ code: 1 }));
    await expect(currentFix()).rejects.toMatchObject({ reason: "denied" });
    expect(denied).toHaveBeenCalledTimes(1);
    setGeo((_ok, err) => err({ code: 3 }));
    await expect(currentFix()).rejects.toMatchObject({ reason: "timeout" });
    setGeo((_ok, err) => err({ code: 2 }));
    await expect(currentFix()).rejects.toMatchObject({ reason: "unavailable" });
  });

  it("explains unsupported browsers and insecure (non-https) pages, and never accepts impossible coordinates", async () => {
    Object.defineProperty(navigator, "geolocation", { configurable: true, value: undefined });
    await expect(currentFix()).rejects.toMatchObject({ reason: "unsupported" });
    setGeo((ok) => ok(pos(28, 77)));
    Object.defineProperty(window, "isSecureContext", { configurable: true, value: false });
    const e = await currentFix().catch((x) => x);
    expect(e).toBeInstanceOf(GeoError);
    expect(e.message).toMatch(/https/);
    Object.defineProperty(window, "isSecureContext", { configurable: true, value: true });
    setGeo((ok) => ok(pos(NaN, 77)));
    await expect(currentFix()).rejects.toMatchObject({ reason: "unavailable" });
    setGeo((ok) => ok(pos(120, 77)));
    await expect(currentFix()).rejects.toMatchObject({ reason: "unavailable" });
  });
});

describe("helpers", () => {
  it("warns when the fix is too coarse to place a pin on a house", () => {
    expect(accuracyNote(null)).toBeNull();
    expect(accuracyNote(20)).toBeNull();
    expect(accuracyNote(400)).toMatch(/400 m/);
    expect(accuracyNote(4200)).toMatch(/4\.2 km/);
  });
  it("knows India's bounds (latitude first, then longitude)", () => {
    expect(inIndia(28.4, 77.1)).toBe(true);
    expect(inIndia(77.1, 28.4)).toBe(false); // swapped coordinates are rejected
    expect(inIndia(51.5, -0.12)).toBe(false);
  });
});

describe("approximate (network / IP based) positions", () => {
  it("reports the accuracy exactly as the browser gave it and never calls a rough fix GPS-level", () => {
    expect(describeAccuracy(12)).toBe("±12 m");
    expect(describeAccuracy(3200)).toBe("±3.2 km");
    expect(describeAccuracy(200_000)).toBe("±200 km");
    expect(describeAccuracy(null)).toBe("unknown");
    expect(isCoarse(200_000)).toBe(true);
    expect(isCoarse(900)).toBe(false);
    const note = accuracyNote(200_000)!;
    expect(note).toMatch(/Very approximate/);
    expect(note).toMatch(/not GPS/);
    expect(note).toMatch(/tap the map/i);
  });

  it("always asks for a fresh reading (maximumAge 0), also in the network fallback, and keeps the browser's own accuracy value", async () => {
    const fn = setGeo((ok, err, o) => (o.enableHighAccuracy ? err({ code: 2 }) : ok(pos(25.6, 85.1, 200_000))));
    const fix = await currentFix();
    expect(fix).toEqual({ latitude: 25.6, longitude: 85.1, accuracy: 200_000 });
    for (const call of fn.mock.calls) expect(call[2]).toMatchObject({ maximumAge: 0 });
    expect(fn.mock.calls[0][2]).toMatchObject({ enableHighAccuracy: true });
  });
});
