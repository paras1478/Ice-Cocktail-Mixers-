import { useEffect, useRef, useState } from "react";
import { api, apiError } from "../lib/api";
import { useAuth } from "../context/AuthContext";

interface GoogleId {
  initialize: (o: { client_id: string; callback: (r: { credential: string }) => void }) => void;
  renderButton: (el: HTMLElement, o: Record<string, unknown>) => void;
}
declare global { interface Window { google?: { accounts: { id: GoogleId } } } }

const SRC = "https://accounts.google.com/gsi/client";
let loading: Promise<void> | null = null;
const loadGsi = () => (loading ??= new Promise<void>((ok, fail) => {
  if (window.google?.accounts) return ok();
  const s = document.createElement("script");
  s.src = SRC; s.async = true; s.onload = () => ok(); s.onerror = () => { loading = null; fail(new Error("Could not load Google sign-in")); };
  document.head.appendChild(s);
}));

/** "Continue with Google". Renders nothing until the backend reports a Google client ID, so it is invisible when sign-in isn't set up. */
export function GoogleButton({ onDone, onError }: { onDone: () => void; onError: (m: string) => void }) {
  const { google } = useAuth();
  const box = useRef<HTMLDivElement>(null);
  const [clientId, setClientId] = useState<string | null>(null);
  const cb = useRef({ onDone, onError, google });
  cb.current = { onDone, onError, google };

  useEffect(() => {
    let live = true;
    api.get<{ google?: { webClientId: string | null } }>("/config").then((r) => live && setClientId(r.data.google?.webClientId ?? null)).catch(() => undefined);
    return () => { live = false; };
  }, []);

  useEffect(() => {
    if (!clientId) return;
    let live = true;
    loadGsi().then(() => {
      if (!live || !box.current || !window.google) return;
      window.google.accounts.id.initialize({
        client_id: clientId,
        callback: (r) => { cb.current.google(r.credential).then(() => cb.current.onDone()).catch((e) => cb.current.onError(apiError(e).message)); },
      });
      window.google.accounts.id.renderButton(box.current, { theme: "outline", size: "large", text: "continue_with", shape: "pill", width: Math.min(360, box.current.clientWidth || 360) });
    }).catch((e) => live && cb.current.onError(e instanceof Error ? e.message : "Could not load Google sign-in"));
    return () => { live = false; };
  }, [clientId]);

  if (!clientId) return null;
  return (
    <>
      <div className="flex items-center gap-3 text-xs text-muted"><span className="h-px flex-1 bg-line" />or<span className="h-px flex-1 bg-line" /></div>
      <div ref={box} className="flex min-h-10 justify-center" />
    </>
  );
}
