import { useEffect, useRef, useState } from "react";
import { api, apiError } from "../lib/api";
import { useAuth } from "../context/AuthContext";

interface TokenClient { requestAccessToken: (o?: { prompt?: string }) => void }
interface TokenResponse { access_token?: string; error?: string }
declare global {
  interface Window {
    google?: { accounts: { oauth2: { initTokenClient: (o: { client_id: string; scope: string; callback: (r: TokenResponse) => void; error_callback?: (e: { type?: string }) => void }) => TokenClient } } };
  }
}

const SRC = "https://accounts.google.com/gsi/client";
let loading: Promise<void> | null = null;
const loadGsi = () => (loading ??= new Promise<void>((ok, fail) => {
  if (window.google?.accounts) return ok();
  const s = document.createElement("script");
  s.src = SRC; s.async = true; s.onload = () => ok(); s.onerror = () => { loading = null; fail(new Error("Could not load Google sign-in")); };
  document.head.appendChild(s);
}));

const GLogo = () => (
  <svg viewBox="0 0 48 48" className="h-5 w-5" aria-hidden>
    <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z" />
    <path fill="#4285F4" d="M46.5 24.6c0-1.6-.1-3.1-.4-4.6H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4.1 7.1-10.1 7.1-17.4z" />
    <path fill="#FBBC05" d="M10.5 28.7a14.5 14.5 0 0 1 0-9.4l-7.9-6.1a24 24 0 0 0 0 21.6l7.9-6.1z" />
    <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.5-5.8c-2.1 1.4-4.9 2.3-8.4 2.3-6.3 0-11.6-4.1-13.5-9.8l-7.9 6.1C6.5 42.6 14.6 48 24 48z" />
  </svg>
);

/** "Continue with Google": our own button that opens Google's account popup, so no signed-in Google account is shown on the page. Renders nothing until the backend reports a Google client ID. */
export function GoogleButton({ onDone, onError }: { onDone: () => void; onError: (m: string) => void }) {
  const { google } = useAuth();
  const [clientId, setClientId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const tc = useRef<TokenClient | null>(null);
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
      if (!live || !window.google) return;
      tc.current = window.google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: "openid email profile",
        callback: (r) => {
          if (!r.access_token) { setBusy(false); if (r.error !== "access_denied") cb.current.onError("Google sign-in failed. Please try again."); return; }
          cb.current.google({ accessToken: r.access_token }).then(() => cb.current.onDone()).catch((e) => cb.current.onError(apiError(e).message)).finally(() => setBusy(false));
        },
        error_callback: () => setBusy(false), // popup closed or blocked
      });
      setReady(true);
    }).catch((e) => live && cb.current.onError(e instanceof Error ? e.message : "Could not load Google sign-in"));
    return () => { live = false; };
  }, [clientId]);

  if (!clientId) return null;
  return (
    <>
      <div className="flex items-center gap-3 text-xs text-muted"><span className="h-px flex-1 bg-line" />or continue with<span className="h-px flex-1 bg-line" /></div>
      <button type="button" disabled={!ready || busy} onClick={() => { setBusy(true); tc.current?.requestAccessToken({ prompt: "select_account" }); }}
        className="flex min-h-12 w-full items-center justify-center gap-3 rounded-full border border-line bg-white px-5 text-[15px] font-semibold text-neutral-800 shadow-sm transition hover:bg-neutral-50 hover:shadow active:scale-[0.99] disabled:opacity-60">
        <GLogo />{busy ? "Connecting…" : "Continue with Google"}
      </button>
    </>
  );
}
