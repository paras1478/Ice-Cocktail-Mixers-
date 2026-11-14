import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, Captions, Loader2, Maximize2, Mic, MicOff, Minus, PhoneOff, RefreshCw, ShoppingBag, X } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { useCart } from "../context/CartContext";
import { useRealtimeVoice } from "../lib/useRealtimeVoice";
import { VoiceWaveform } from "./VoiceWaveform";

const PHASE_TEXT = { listening: "Listening…", thinking: "Thinking…", speaking: "Speaking…" } as const;

/**
 * The voice assistant as a small floating panel in the bottom-right corner (it never covers the header or category navigation, and it has no backdrop,
 * so the page behind stays fully usable). It can be expanded, minimized to a small pill, or closed. The conversation lives in this component and the
 * component lives in the page layout, so it keeps running while the customer scrolls or moves between pages; only "Close" (or leaving for the admin area) ends it.
 */
export default function VoicePanel({ onClose }: { onClose: () => void }) {
  const { user, loading } = useAuth();
  const cart = useCart();
  const v = useRealtimeVoice({ onCartChanged: () => { void cart.syncFromServer(); } });
  const [minimized, setMinimized] = useState(false);
  const [showTranscript, setShowTranscript] = useState(false);
  const transcriptEnd = useRef<HTMLDivElement>(null);
  const { start, stop } = v;

  // Opening the panel starts the conversation (start() cancels any earlier attempt itself, so React StrictMode's double mount in development is harmless).
  const userId = user?.id;
  useEffect(() => {
    if (loading || !userId) return;
    void start();
  }, [loading, userId, start]);

  const end = () => { stop(); onClose(); };
  useEffect(() => { transcriptEnd.current?.scrollIntoView?.({ block: "end" }); }, [v.lines, showTranscript]);

  const connecting = v.status === "requesting-mic" || v.status === "connecting";
  const live = v.status === "live";
  const failed = v.status === "error" && !!v.error;
  const statusText = v.status === "requesting-mic" ? "Allow the microphone…" : v.status === "connecting" ? "Connecting…" : live ? (v.muted && v.phase === "listening" ? "Microphone is muted" : PHASE_TEXT[v.phase]) : failed ? "Not connected" : "Ready";
  const ring = !live ? "" : v.phase === "speaking" ? "vc-ring-fast" : v.phase === "listening" && !v.muted ? "vc-ring" : "";
  // Escape tucks the panel away (it never closes the conversation by accident).
  const onKeyDown = (e: KeyboardEvent) => { if (e.key === "Escape" && !minimized) setMinimized(true); };

  const icon = (
    <span className={`relative grid h-9 w-9 shrink-0 place-items-center rounded-full ${v.muted ? "bg-white/15 text-[#d9ccb6]" : "bg-[#e0a444] text-[#1c0f08]"}`}>
      {live && ring && <span className={`absolute inset-0 rounded-full border border-[#e0a444]/60 ${ring}`} aria-hidden />}
      {connecting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : failed ? <AlertTriangle className="h-4 w-4" aria-hidden /> : v.muted ? <MicOff className="h-4 w-4" aria-hidden /> : <Mic className="h-4 w-4" aria-hidden />}
    </span>
  );
  const small = "grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white/10 hover:bg-white/20 disabled:opacity-40";
  const where = "fixed right-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-[75] sm:right-5 sm:bottom-5";

  // ---------------------------------------------------------------- minimized: a small pill that keeps the mic controls within reach
  if (minimized)
    return (
      <section role="region" aria-labelledby="vc-title" onKeyDown={onKeyDown} className={`${where} rise flex max-w-[calc(100vw-1.5rem)] items-center gap-1.5 rounded-full bg-[#1c0f08] p-1.5 pr-2 text-[#f8f5ed] shadow-[0_10px_30px_rgba(13,8,5,0.4)] ring-1 ring-white/10`}>
        <span id="vc-title" className="sr-only">Ice and Cocktail AI voice assistant</span>
        <button onClick={() => setMinimized(false)} aria-label={`Expand voice assistant. ${statusText}`} className="flex min-w-0 items-center gap-2 rounded-full pr-1 text-left hover:opacity-90">
          {icon}
          <span className="max-w-[8.5rem] truncate text-xs font-bold" aria-live="polite">{statusText}</span>
        </button>
        <button onClick={v.toggleMute} disabled={!live} aria-pressed={v.muted} aria-label={v.muted ? "Unmute microphone" : "Mute microphone"} className={small}>
          {v.muted ? <MicOff className="h-4 w-4" aria-hidden /> : <Mic className="h-4 w-4" aria-hidden />}
        </button>
        <button onClick={() => setMinimized(false)} aria-label="Expand voice assistant" className={small}><Maximize2 className="h-4 w-4" aria-hidden /></button>
        <button onClick={end} aria-label="Close voice assistant" className={small}><X className="h-4 w-4" aria-hidden /></button>
      </section>
    );

  // ---------------------------------------------------------------- expanded: the small floating panel
  return (
    <section role="region" aria-labelledby="vc-title" onKeyDown={onKeyDown}
      className={`${where} rise flex w-[min(20rem,calc(100vw-1.5rem))] max-h-[min(34rem,calc(100dvh-8rem))] flex-col overflow-hidden rounded-3xl bg-[#1c0f08] text-[#f8f5ed] shadow-[0_18px_50px_rgba(13,8,5,0.5)] ring-1 ring-white/10`}>
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_22%,rgba(229,173,82,0.16),rgba(229,173,82,0)_60%)]" aria-hidden />

      <header className="relative flex items-center gap-2 px-3 pb-1 pt-3">
        <div className="min-w-0 flex-1">
          <h2 id="vc-title" className="font-script text-lg leading-none">Ice <span className="text-[#e0a444]">&amp;</span> Cocktail</h2>
          <p className="mt-0.5 text-[9px] font-extrabold uppercase tracking-[0.18em] text-[#d9ccb6]">AI voice assistant</p>
        </div>
        <button onClick={() => setMinimized(true)} aria-label="Minimize voice assistant" className={small}><Minus className="h-4 w-4" aria-hidden /></button>
        <button onClick={end} aria-label="Close voice assistant" className={small}><X className="h-4 w-4" aria-hidden /></button>
      </header>

      <div className="relative flex min-h-0 flex-1 flex-col items-center gap-3 overflow-y-auto px-3 py-2 text-center">
        {!loading && !user ? (
          <div className="py-3">
            <p className="text-sm font-bold">Log in to talk to our assistant</p>
            <p className="mt-1 text-xs text-[#d9ccb6]">It uses your cart, so we need to know it&apos;s you.</p>
            <Link to="/login" onClick={onClose} className="mt-3 inline-flex min-h-10 items-center rounded-full bg-[#e0a444] px-5 text-sm font-bold text-[#1c0f08]">Log in</Link>
          </div>
        ) : failed && v.error ? (
          <div role="alert" className="py-2">
            <AlertTriangle className="mx-auto h-7 w-7 text-[#e0a444]" aria-hidden />
            <p className="mt-2 text-sm font-bold">{v.error.kind === "mic-denied" ? "Microphone is blocked" : "Voice assistant stopped"}</p>
            <p className="mt-1 text-xs leading-relaxed text-[#d9ccb6]">{v.error.message}</p>
            <div className="mt-3 flex justify-center">
              {v.error.kind === "login"
                ? <Link to="/login" onClick={onClose} className="inline-flex min-h-10 items-center rounded-full bg-[#e0a444] px-5 text-sm font-bold text-[#1c0f08]">Log in</Link>
                : <button onClick={() => void start()} className="inline-flex min-h-10 items-center gap-2 rounded-full bg-[#e0a444] px-5 text-sm font-bold text-[#1c0f08]"><RefreshCw className="h-4 w-4" aria-hidden />{v.error.kind === "mic-denied" || v.error.kind === "mic-missing" ? "Try again" : "Reconnect"}</button>}
            </div>
          </div>
        ) : (
          <>
            <div className="relative grid h-24 w-24 shrink-0 place-items-center">
              <span className={`absolute inset-0 rounded-full border border-[#e0a444]/50 ${ring}`} aria-hidden />
              <span className={`absolute inset-2 rounded-full border border-[#e0a444]/30 ${ring}`} style={{ animationDelay: "0.5s" }} aria-hidden />
              {live && v.phase === "thinking" && <span className="vc-spin absolute inset-0.5 rounded-full border-2 border-transparent border-t-[#e0a444]" aria-hidden />}
              <span className={`relative grid h-16 w-16 place-items-center rounded-full shadow-[0_8px_26px_rgba(13,8,5,0.45)] ${v.muted ? "bg-white/15 text-[#d9ccb6]" : "bg-[#e0a444] text-[#1c0f08]"}`}>
                {connecting ? <Loader2 className="h-7 w-7 animate-spin" aria-hidden /> : v.muted ? <MicOff className="h-7 w-7" aria-hidden /> : <Mic className="h-7 w-7" aria-hidden />}
              </span>
            </div>
            <div aria-live="polite">
              <p className="text-base font-bold">{statusText}</p>
              <p className="mt-0.5 text-xs text-[#d9ccb6]">{live ? "Speak in Hindi, English or Hinglish" : "Just a moment…"}</p>
            </div>
            <VoiceWaveform getLevels={v.getLevels} phase={v.phase} muted={v.muted} active={live} className="h-10 w-full max-w-[15rem]" />
          </>
        )}

        {v.cartNote && (
          <Link to="/cart" className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1.5 text-xs font-semibold hover:bg-white/20">
            <ShoppingBag className="h-3.5 w-3.5 text-[#e0a444]" aria-hidden />{v.cartNote} · View cart ({cart.count})
          </Link>
        )}

        {v.products.length > 0 && (
          <ul className="flex w-full gap-2 overflow-x-auto pb-1 text-left" aria-label="Products mentioned">
            {v.products.map((p) => (
              <li key={p.id} className="w-24 shrink-0 rounded-xl bg-[#f4e6c6] p-1.5 text-[#1c0f08]">
                <Link to={p.slug ? `/product/${p.slug}` : "/shop"} className="block">
                  <span className="grid aspect-square place-items-center overflow-hidden rounded-lg bg-white/70">
                    {p.image ? <img src={p.image} alt="" loading="lazy" className="h-full w-full object-contain" /> : <ShoppingBag className="h-6 w-6 text-[#1c0f08]/40" aria-hidden />}
                  </span>
                  <span className="mt-1 line-clamp-2 block text-[11px] font-bold leading-snug">{p.name}</span>
                  <span className="block text-[11px] font-semibold text-[#7a4e0e]">{p.price}{p.inStock ? "" : " · out of stock"}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}

        {showTranscript && (
          <div className="max-h-28 w-full overflow-y-auto rounded-xl bg-black/25 p-2 text-left text-xs" aria-label="Conversation transcript">
            {v.lines.length === 0 ? <p className="text-[#d9ccb6]">The conversation will appear here.</p> : v.lines.map((l) => (
              <p key={l.id} className="mb-1"><span className={`font-bold ${l.role === "user" ? "text-[#e0a444]" : "text-[#f8f5ed]"}`}>{l.role === "user" ? "You: " : "Assistant: "}</span><span className="text-[#e4dccf]">{l.text}</span></p>
            ))}
            <div ref={transcriptEnd} />
          </div>
        )}
      </div>

      <footer className="relative flex items-center justify-center gap-2 px-3 pb-3 pt-1">
        <button onClick={v.toggleMute} disabled={!live} aria-pressed={v.muted} aria-label={v.muted ? "Unmute microphone" : "Mute microphone"} className={small}>
          {v.muted ? <MicOff className="h-4 w-4" aria-hidden /> : <Mic className="h-4 w-4" aria-hidden />}
        </button>
        <button onClick={end} className="inline-flex min-h-9 items-center gap-2 rounded-full bg-[#b3261e] px-4 text-xs font-bold text-white hover:brightness-110">
          <PhoneOff className="h-4 w-4" aria-hidden />End conversation
        </button>
        <button onClick={() => setShowTranscript((s) => !s)} aria-pressed={showTranscript} aria-label={showTranscript ? "Hide transcript" : "Show transcript"}
          className={`grid h-9 w-9 shrink-0 place-items-center rounded-full hover:bg-white/20 ${showTranscript ? "bg-[#e0a444] text-[#1c0f08]" : "bg-white/10"}`}>
          <Captions className="h-4 w-4" aria-hidden />
        </button>
      </footer>
    </section>
  );
}
