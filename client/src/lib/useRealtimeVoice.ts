import { useCallback, useEffect, useRef, useState } from "react";
import { api, apiError } from "./api";
import { openSocketLink, openWebRtcLink, TransportError, type Link } from "./realtimeTransports";
import {
  GREETING_INSTRUCTIONS, applyTranscriptEvent, describeMicError, phaseForEvent, productsFromToolResult,
  type RealtimeEvent, type VoiceError, type VoiceLine, type VoicePhase, type VoiceProduct,
} from "./voice";

export type VoiceStatus = "idle" | "requesting-mic" | "connecting" | "live" | "error";
export type VoiceMode = "webrtc" | "websocket";

interface Options {
  /** Called after the assistant changed the customer's cart on the server, so the browser cart can refresh. */
  onCartChanged: () => void;
}

/** How long WebRTC gets to open (ICE + DTLS + data channel) before we switch to the WebSocket transport. A healthy connection opens in 1-2 s. */
const WEBRTC_OPEN_MS = 6_000;
/**
 * Right after a failed ICE attempt the first new connection to OpenAI often stalls for ~10 s on such networks (measured: the next one opens in 1-2 s).
 * So the WebSocket gets short, repeated attempts instead of one long wait; the last one is patient for genuinely slow mobile networks.
 */
const SOCKET_ATTEMPT_MS = [4_000, 4_000, 10_000];
const DISCONNECT_GRACE_MS = 8_000;
/** A healthy WebRTC connection opens in 1-2 s. If it is still not open after this long, a second client secret is requested in the background so a fallback is instant. */
const SPARE_SESSION_MS = 3_000;
const PREF_KEY = "voice-transport";
/** How long a failed WebRTC attempt is remembered, so the next conversation on the same (blocked) network connects at once. After that WebRTC is tried again. */
const PREF_TTL_MS = 6 * 60 * 60 * 1000;

const readPref = (): VoiceMode | null => {
  try {
    const at = Number(localStorage.getItem(PREF_KEY));
    return at && Date.now() - at < PREF_TTL_MS ? "websocket" : null;
  } catch { return null; }
};
const writePref = () => { try { localStorage.setItem(PREF_KEY, String(Date.now())); } catch { /* storage unavailable */ } };

interface Session { clientSecret: string; expiresAt?: number | null; callsUrl: string; realtimeUrl: string }

/**
 * One voice conversation with the OpenAI Realtime API.
 * The browser never sees the permanent API key: it asks OUR server for a short-lived client secret and relays the model's tool calls back to
 * OUR server (which runs them as the logged-in customer). It tries WebRTC first; if the audio path does not open (a network or VPN that blocks
 * UDP) it switches by itself to the WebSocket transport (HTTPS port 443), which works wherever the website works.
 */
export function useRealtimeVoice({ onCartChanged }: Options) {
  const [status, setStatusState] = useState<VoiceStatus>("idle");
  const statusRef = useRef<VoiceStatus>("idle");
  const setStatus = (s: VoiceStatus) => { statusRef.current = s; setStatusState(s); };
  const [phase, setPhase] = useState<VoicePhase>("listening");
  const [muted, setMuted] = useState(false);
  const [lines, setLines] = useState<VoiceLine[]>([]);
  const [products, setProducts] = useState<VoiceProduct[]>([]);
  const [error, setError] = useState<VoiceError | null>(null);
  const [cartNote, setCartNote] = useState<string | null>(null);
  const [mode, setMode] = useState<VoiceMode | null>(null);

  const gen = useRef(0); // bumped on every start/stop, so a late async step of an old attempt can tell it was cancelled
  const link = useRef<Link | null>(null);
  const mic = useRef<MediaStream | null>(null);
  const freq = useRef<Uint8Array<ArrayBuffer>>(new Uint8Array(new ArrayBuffer(64)));
  const phaseRef = useRef<VoicePhase>("listening");
  const pending = useRef<Promise<{ callId: string; output: unknown }>[]>([]);
  const seenCalls = useRef(new Set<string>());
  const cartChanged = useRef(onCartChanged);
  cartChanged.current = onCartChanged;

  const setPhaseBoth = (p: VoicePhase) => { phaseRef.current = p; setPhase(p); };

  /** Releases everything: the open connection (peer connection or socket), its audio, and the microphone. Safe to call any number of times. */
  const cleanup = useCallback(() => {
    try { link.current?.close(); } catch { /* already closed */ }
    link.current = null;
    mic.current?.getTracks().forEach((t) => t.stop());
    mic.current = null;
    pending.current = []; seenCalls.current.clear();
  }, []);

  const fail = useCallback((e: VoiceError) => { gen.current++; cleanup(); setError(e); setStatus("error"); }, [cleanup]);

  const send = (msg: unknown) => link.current?.send(msg);

  /** Runs a model tool call on our server. A failure is returned to the model as { ok:false, error } so it can tell the customer the truth. */
  const runTool = useCallback(async (name: string, rawArgs: string, myGen: number) => {
    let args: unknown = {};
    try { args = rawArgs ? JSON.parse(rawArgs) : {}; } catch { return { ok: false, error: "The request was not understood." }; }
    try {
      const r = await api.post<{ result: Record<string, unknown>; cartChanged: boolean }>("/voice/tool", { name, arguments: args });
      if (gen.current !== myGen) return r.data.result;
      const shown = productsFromToolResult(r.data.result);
      if (shown.length) setProducts(shown);
      if (r.data.cartChanged) {
        setCartNote("Your cart was updated");
        cartChanged.current();
      }
      return r.data.result;
    } catch (e) {
      const info = apiError(e);
      if (info.status === 401 && gen.current === myGen) fail({ kind: "login", message: "Your session ended. Please log in again to keep talking." });
      return { ok: false, error: info.message };
    }
  }, [fail]);

  const onEvent = useCallback((ev: RealtimeEvent, myGen: number) => {
    if (gen.current !== myGen) return;
    setLines((l) => applyTranscriptEvent(l, ev));
    const next = phaseForEvent(ev, phaseRef.current);
    if (next) setPhaseBoth(next);

    if (ev.type === "response.output_item.done" && ev.item?.type === "function_call" && ev.item.call_id && ev.item.name) {
      const { call_id: callId, name, arguments: a } = ev.item;
      if (seenCalls.current.has(callId)) return;
      seenCalls.current.add(callId);
      setPhaseBoth("thinking");
      pending.current.push(runTool(name, a ?? "", myGen).then((output) => ({ callId, output })));
    }
    // All tool calls of one response are answered together, then the model is asked once to speak the outcome.
    if (ev.type === "response.done" && pending.current.length) {
      const batch = pending.current;
      pending.current = [];
      void Promise.all(batch).then((done) => {
        if (gen.current !== myGen) return;
        for (const d of done) send({ type: "conversation.item.create", item: { type: "function_call_output", call_id: d.callId, output: JSON.stringify(d.output) } });
        send({ type: "response.create" });
      });
    }
    if (ev.type === "error") {
      const code = ev.error?.code ?? "";
      console.warn("[voice] realtime error:", code || ev.error?.message);
      if (/expired|session/i.test(code)) fail({ kind: "expired", message: "The voice session expired. Tap to start a new one." });
    }
  }, [fail, runTool]);

  const start = useCallback(async () => {
    const myGen = ++gen.current;
    cleanup(); // a Reconnect first releases the previous connection and microphone, so there is never more than one
    setError(null); setLines([]); setProducts([]); setCartNote(null); setMuted(false); setMode(null); setPhaseBoth("listening");
    const stale = () => gen.current !== myGen;

    if (!navigator.mediaDevices?.getUserMedia)
      return fail({ kind: "unsupported", message: "This browser does not support voice chat. Try the latest Chrome, Edge, Safari or Firefox." });
    if (navigator.onLine === false) return fail({ kind: "offline", message: "You are offline. Check your internet connection and try again." });

    setStatus("requesting-mic");
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    } catch (e) {
      return stale() ? undefined : fail(describeMicError(e));
    }
    if (stale()) { stream.getTracks().forEach((t) => t.stop()); return; }
    mic.current = stream;
    setStatus("connecting");

    // A fresh client secret for every connection attempt (they are short-lived).
    const fetchSession = async (): Promise<Session> => {
      try {
        return (await api.post<Session>("/voice/session")).data;
      } catch (e) {
        const st = apiError(e).status;
        if (st !== 502 && st !== 504 && st !== undefined) throw e; // a refusal (login, not configured, rate limit) is final; a gateway or network hiccup is retried once
        console.warn("[voice] session request failed, retrying once:", st ?? "network error");
        await new Promise((r) => setTimeout(r, 500));
        return (await api.post<Session>("/voice/session")).data;
      }
    };
    const open = (kind: VoiceMode, s: Session) => {
      const common = {
        stream,
        register: (l: Link) => { link.current = l; }, // registered at once, so cleanup() can close a connection that is still opening
        onEvent: (ev: RealtimeEvent) => onEvent(ev, myGen),
        onLost: (why: string) => { if (!stale()) fail({ kind: "connection", message: `${why} Tap to reconnect.` }); },
      };
      return kind === "webrtc"
        ? openWebRtcLink({ ...common, callsUrl: s.callsUrl, secret: s.clientSecret, openTimeoutMs: WEBRTC_OPEN_MS, graceMs: DISCONNECT_GRACE_MS })
        : openSocketLink({ ...common, url: s.realtimeUrl, secret: s.clientSecret, openTimeoutMs: SOCKET_ATTEMPT_MS[0] });
    };
    const openSocketWithRetry = async (s: Session): Promise<Link> => {
      for (let i = 0; ; i++) {
        try {
          return await openSocketLink({
            stream, register: (l) => { link.current = l; }, onEvent: (ev) => onEvent(ev, myGen),
            onLost: (why) => { if (!stale()) fail({ kind: "connection", message: `${why} Tap to reconnect.` }); },
            url: s.realtimeUrl, secret: s.clientSecret, openTimeoutMs: SOCKET_ATTEMPT_MS[i],
          });
        } catch (e) {
          const retry = e instanceof TransportError && (e.reason === "timeout" || e.reason === "socket") && i < SOCKET_ATTEMPT_MS.length - 1 && !stale();
          console.warn(`[voice] WebSocket attempt ${i + 1} failed${retry ? ", retrying" : ""}:`, (e as Error).message);
          if (!retry) throw e;
        }
      }
    };

    let opened: Link;
    let used: VoiceMode = "webrtc";
    try {
      let session = await fetchSession();
      if (stale()) return;
      if (readPref() === "websocket" || typeof RTCPeerConnection === "undefined") {
        used = "websocket";
        opened = await openSocketWithRetry(session);
      } else {
        // (A client secret that was used for a WebRTC call cannot be reused for the WebSocket, hence a separate spare one.)
        const spare: { p: Promise<Session | null> | null } = { p: null };
        const spareTimer = setTimeout(() => { spare.p = fetchSession().catch(() => null); }, SPARE_SESSION_MS);
        try {
          opened = await open("webrtc", session);
          clearTimeout(spareTimer);
        } catch (e) {
          clearTimeout(spareTimer);
          if (stale()) return;
          const blocked = e instanceof TransportError && (e.reason === "timeout" || e.reason === "ice-failed" || e.reason === "unsupported");
          if (!blocked) throw e;
          // WebRTC could not open its audio path (UDP blocked by the network, a VPN or a firewall): switch to the WebSocket transport on the same microphone.
          console.warn("[voice] switching to the WebSocket transport:", e.message);
          writePref();
          link.current = null;
          session = (spare.p ? await spare.p : null) ?? (await fetchSession());
          console.debug("[voice] session ready for the WebSocket transport");
          if (stale()) return;
          used = "websocket";
          opened = await openSocketWithRetry(session);
        }
      }
    } catch (e) {
      if (stale()) return;
      if (e instanceof TransportError) {
        const expired = e.status === 401 || e.status === 403;
        return fail(expired
          ? { kind: "expired", message: "The voice session expired before it started. Tap to try again." }
          : e.reason === "timeout" || e.reason === "ice-failed" || e.reason === "socket"
            ? { kind: "network", message: "Could not open an audio connection, over WebRTC or over a secure WebSocket. Check your internet connection or turn off any VPN or firewall that blocks voice, then reconnect." }
            : { kind: "connection", message: "Could not connect to the voice service. Check your internet and try again." });
      }
      const info = apiError(e);
      return fail(info.status === 401
        ? { kind: "login", message: "Please log in to talk to the assistant." }
        : { kind: info.status === 503 ? "unavailable" : "connection", message: info.message });
    }
    if (stale()) { opened.close(); return; }
    link.current = opened;
    setMode(used);
    console.debug(`[voice] live over ${used}`);
    setStatus("live");
    send({ type: "response.create", response: { instructions: GREETING_INSTRUCTIONS } });
  }, [cleanup, fail, onEvent]);

  const stop = useCallback(() => { gen.current++; cleanup(); setStatus("idle"); setError(null); }, [cleanup]);

  const toggleMute = useCallback(() => {
    const track = mic.current?.getAudioTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    setMuted(!track.enabled);
  }, []);

  /** Current frequency bins for the waveform: the assistant's voice while it speaks, otherwise the microphone (silent when muted). */
  const getLevels = useCallback((): Uint8Array<ArrayBuffer> | null => {
    const a = (phaseRef.current === "speaking" && link.current?.remoteAnalyser()) || link.current?.micAnalyser() || null;
    if (!a) return null;
    if (freq.current.length !== a.frequencyBinCount) freq.current = new Uint8Array(new ArrayBuffer(a.frequencyBinCount));
    a.getByteFrequencyData(freq.current);
    return freq.current;
  }, []);

  // Going offline during a call ends it cleanly instead of leaving a frozen screen.
  useEffect(() => {
    const off = () => { if (link.current) fail({ kind: "offline", message: "You went offline. Reconnect to the internet and try again." }); };
    window.addEventListener("offline", off);
    return () => window.removeEventListener("offline", off);
  }, [fail]);

  // Never leave the microphone on after the screen is gone.
  useEffect(() => () => { gen.current++; cleanup(); }, [cleanup]);

  return { status, phase, muted, lines, products, error, cartNote, mode, start, stop, toggleMute, getLevels };
}
