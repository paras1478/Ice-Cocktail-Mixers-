import { useEffect, useRef } from "react";
import type { VoicePhase } from "../lib/voice";

const BARS = 32;

/**
 * Live audio waveform. While listening it shows the microphone, while the assistant speaks it shows its voice, and while it
 * is thinking a soft travelling wave. It draws straight from the analyser each frame (no React state), so it costs almost nothing.
 */
export function VoiceWaveform({ getLevels, phase, muted, active, className = "h-16 w-full max-w-sm sm:h-20" }: { getLevels: () => Uint8Array | null; phase: VoicePhase; muted: boolean; active: boolean; className?: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const live = useRef({ getLevels, phase, muted, active });
  live.current = { getLevels, phase, muted, active };

  useEffect(() => {
    const el = canvas.current;
    const g = el?.getContext("2d");
    if (!el || !g) return;
    let raf = 0;
    const draw = (t: number) => {
      const dpr = window.devicePixelRatio || 1;
      const w = el.clientWidth, h = el.clientHeight;
      if (el.width !== Math.round(w * dpr) || el.height !== Math.round(h * dpr)) { el.width = Math.round(w * dpr); el.height = Math.round(h * dpr); }
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, w, h);
      // Not laid out yet (hidden, zero-sized or a very narrow window): nothing to draw, and no negative bar widths or radii.
      if (!(w >= BARS * 2) || !(h > 0)) { raf = requestAnimationFrame(draw); return; }
      const { getLevels: levels, phase: ph, muted: m, active: on } = live.current;
      const data = on && !(m && ph !== "speaking") ? levels() : null;
      const gap = Math.min(5, (w / BARS) * 0.35);
      const bw = Math.max(1, (w - gap * (BARS - 1)) / BARS);
      g.fillStyle = "#e0a444";
      for (let i = 0; i < BARS; i++) {
        let v: number;
        if (data && data.length > 1 && ph !== "thinking") {
          // low-to-mid frequencies carry speech: spread them across the bars, mirrored around the centre
          const k = Math.floor((Math.abs(i - (BARS - 1) / 2) / ((BARS - 1) / 2)) * Math.min(24, data.length - 1));
          v = Math.min(1, ((data[k] ?? 0) / 255) * 1.25);
        } else if (on && ph === "thinking") v = 0.18 + 0.14 * (1 + Math.sin(t / 220 + i * 0.5));
        else v = 0.06 + 0.02 * (1 + Math.sin(t / 700 + i * 0.4)); // resting
        if (!Number.isFinite(v)) v = 0;
        const bh = Math.min(h, Math.max(4, v * h));
        const r = Math.max(0, Math.min(bw / 2, bh / 2)); // never negative
        g.globalAlpha = 0.45 + 0.55 * v;
        g.beginPath();
        if (typeof g.roundRect === "function") g.roundRect(i * (bw + gap), (h - bh) / 2, bw, bh, r);
        else g.rect(i * (bw + gap), (h - bh) / 2, bw, bh); // browsers without roundRect (older Safari)
        g.fill();
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return <canvas ref={canvas} className={className} aria-hidden />;
}
