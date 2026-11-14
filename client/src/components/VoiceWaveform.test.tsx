import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { VoiceWaveform } from "./VoiceWaveform";

// Regression: "RangeError: Failed to execute 'roundRect' ... Radius value -2.42188 is negative" when the canvas had no width yet.
function drawAt(width: number, height: number, phase: "listening" | "thinking" | "speaking" = "listening", levels: Uint8Array | null = null) {
  const radii: number[] = [];
  const widths: number[] = [];
  const ctx = {
    setTransform() {}, clearRect() {}, beginPath() {}, fill() {}, fillStyle: "", globalAlpha: 1,
    roundRect(_x: number, _y: number, w: number, _h: number, r: number) {
      if (r < 0) throw new RangeError(`Failed to execute 'roundRect' on 'CanvasRenderingContext2D': Radius value ${r} is negative.`);
      radii.push(r); widths.push(w);
    },
    rect(_x: number, _y: number, w: number) { widths.push(w); },
  };
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(width);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(height);
  const frames: FrameRequestCallback[] = [];
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => { frames.push(cb); return frames.length; });
  vi.stubGlobal("cancelAnimationFrame", () => undefined);
  const u = render(<VoiceWaveform getLevels={() => levels} phase={phase} muted={false} active />);
  for (let i = 0; i < 3; i++) frames.splice(0).forEach((cb) => cb(1000 + i * 16)); // run a few animation frames; any thrown error fails the test
  u.unmount();
  return { radii, widths };
}

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("VoiceWaveform", () => {
  it("never passes a negative radius or width, whatever the canvas size (not laid out yet, tiny, normal, huge)", () => {
    for (const w of [0, 1, 40, 63, 64, 120, 320, 384, 5000]) {
      const { radii, widths } = drawAt(w, 80);
      expect(radii.every((r) => r >= 0 && Number.isFinite(r)), `radii at width ${w}`).toBe(true);
      expect(widths.every((x) => x > 0), `widths at width ${w}`).toBe(true);
    }
  });
  it("draws nothing while the canvas has no size, and tolerates zero height", () => {
    expect(drawAt(0, 80).widths).toHaveLength(0);
    expect(drawAt(300, 0).widths).toHaveLength(0);
  });
  it("draws for every phase, including real audio levels with odd values", () => {
    const levels = new Uint8Array(64).map((_, i) => (i * 7) % 256);
    for (const phase of ["listening", "thinking", "speaking"] as const) expect(drawAt(360, 80, phase, levels).widths.length).toBeGreaterThan(0);
    expect(drawAt(360, 80, "listening", new Uint8Array(0)).widths.length).toBeGreaterThan(0); // empty analyser data
  });
});
