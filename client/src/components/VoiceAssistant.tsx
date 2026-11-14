import { lazy, Suspense, useState } from "react";
import { Mic } from "lucide-react";
import { useAppConfig } from "../lib/useAppConfig";

// The WebRTC code and the floating panel only load when somebody opens the assistant.
const VoicePanel = lazy(() => import("./VoicePanel"));

/** Floating "talk to our AI" button; opening it shows the small floating panel (it lives in the page layout, so a conversation survives scrolling and page changes). Rendered only when the server has the voice assistant configured (GET /api/config -> voice.enabled). */
export function VoiceAssistant() {
  const cfg = useAppConfig();
  const [open, setOpen] = useState(false);
  if (!cfg?.voice?.enabled) return null;
  return (
    <>
      {!open && (
        <button onClick={() => setOpen(true)} data-testid="voice-fab" aria-label="Talk to our AI voice assistant"
          className="fixed bottom-[max(1.25rem,env(safe-area-inset-bottom))] right-4 z-[60] inline-flex min-h-14 items-center gap-2.5 rounded-full bg-[#e0a444] px-5 text-sm font-extrabold text-[#1c0f08] shadow-[0_10px_30px_rgba(13,8,5,0.35)] transition hover:brightness-105 active:scale-95 sm:right-6">
          <span className="relative grid h-8 w-8 place-items-center rounded-full bg-[#1c0f08] text-[#e0a444]">
            <span className="vc-ring absolute inset-0 rounded-full border border-[#1c0f08]/50" aria-hidden />
            <Mic className="h-4 w-4" aria-hidden />
          </span>
          <span className="hidden sm:inline">Ask AI</span>
        </button>
      )}
      {open && <Suspense fallback={null}><VoicePanel onClose={() => setOpen(false)} /></Suspense>}
    </>
  );
}
