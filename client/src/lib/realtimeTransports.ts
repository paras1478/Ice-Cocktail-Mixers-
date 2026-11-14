import axios from "axios";
import type { RealtimeEvent } from "./voice";

/**
 * Two ways to talk to the OpenAI Realtime API, both driven with the same short-lived client secret from OUR server and both speaking the same events:
 *  - WebRTC (preferred): low latency, but it needs UDP (or ICE-TCP) to OpenAI's media servers, which some networks, VPNs and firewalls block.
 *  - WebSocket (fallback): audio as PCM over HTTPS port 443, which works wherever the website itself works. Slightly higher latency.
 * OpenAI's WebRTC endpoint answers as an ICE-lite server and has no TURN relay we could configure, so a blocked network can only be handled by
 * falling back to the WebSocket transport, never by adding TURN servers of our own.
 */
export interface Link {
  kind: "webrtc" | "websocket";
  send: (msg: unknown) => void;
  close: () => void;
  micAnalyser: () => AnalyserNode | null;
  remoteAnalyser: () => AnalyserNode | null;
}

export class TransportError extends Error {
  constructor(public reason: "timeout" | "ice-failed" | "http" | "socket" | "unsupported", message: string, public status?: number) {
    super(message);
  }
}

interface Handlers {
  /** Called as soon as the link object exists (before it has opened), so the caller can close it even if the attempt is cancelled midway. */
  register: (link: Link) => void;
  onEvent: (ev: RealtimeEvent) => void;
  /** The link was lost AFTER it opened (network drop, server closed it). */
  onLost: (why: string) => void;
}

const AudioCtor = (): typeof AudioContext => window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;

function analyserFor(ac: AudioContext, node: AudioNode): AnalyserNode {
  const a = ac.createAnalyser();
  a.fftSize = 128;
  a.smoothingTimeConstant = 0.75;
  node.connect(a);
  return a;
}

// ---------------------------------------------------------------- WebRTC

const EARLY_CHECK_MS = 3_500;

export async function openWebRtcLink(opts: { callsUrl: string; secret: string; stream: MediaStream; openTimeoutMs: number; graceMs: number } & Handlers): Promise<Link> {
  if (typeof RTCPeerConnection === "undefined") throw new TransportError("unsupported", "WebRTC is not available in this browser");
  const peer = new RTCPeerConnection();
  const ac = new (AudioCtor())();
  const el = new Audio();
  el.autoplay = true;
  let remote: AnalyserNode | null = null;
  const mic = analyserFor(ac, ac.createMediaStreamSource(opts.stream));
  let open = false, closed = false;
  let grace: ReturnType<typeof setTimeout> | undefined;
  let opened: ReturnType<typeof setTimeout> | undefined;
  let early: ReturnType<typeof setTimeout> | undefined;

  const link: Link = {
    kind: "webrtc",
    send: (m) => { if (channel.readyState === "open") channel.send(JSON.stringify(m)); },
    close: () => {
      closed = true;
      clearTimeout(grace); clearTimeout(opened); clearTimeout(early);
      try { channel.close(); } catch { /* already closed */ }
      try { peer.close(); } catch { /* already closed */ }
      el.pause(); el.srcObject = null;
      ac.close().catch(() => undefined);
    },
    micAnalyser: () => mic,
    remoteAnalyser: () => remote,
  };

  opts.register(link);
  peer.ontrack = (e) => {
    el.srcObject = e.streams[0];
    try { remote = analyserFor(ac, ac.createMediaStreamSource(e.streams[0])); } catch { /* the meter is cosmetic */ }
  };
  // The microphone track is added BEFORE the offer is created, so the offer contains a sendrecv audio line.
  opts.stream.getTracks().forEach((t) => peer.addTrack(t, opts.stream));
  const channel = peer.createDataChannel("oai-events");

  return new Promise<Link>((resolve, reject) => {
    const give = (e: TransportError) => { if (!closed) { link.close(); reject(e); } };
    opened = setTimeout(() => {
      if (open || closed) return;
      console.warn(`[voice] WebRTC did not open within ${opts.openTimeoutMs} ms (ICE: ${peer.iceConnectionState}, gathering: ${peer.iceGatheringState}, connection: ${peer.connectionState})`);
      give(new TransportError("timeout", "WebRTC audio connection did not open"));
    }, opts.openTimeoutMs);

    // A reachable server answers ICE checks within a second or two. If checks were sent and NOT ONE answer came back, the audio path is blocked
    // (UDP/ICE-TCP filtered): give up now instead of waiting out the full timeout.
    early = setTimeout(async () => {
      if (open || closed || typeof peer.getStats !== "function") return;
      let sent = 0, answered = 0;
      try { (await peer.getStats()).forEach((r) => { if (r.type === "candidate-pair") { sent += r.requestsSent ?? 0; answered += r.responsesReceived ?? 0; } }); } catch { return; }
      console.debug(`[voice] ICE checks after ${EARLY_CHECK_MS} ms: ${sent} sent, ${answered} answered`);
      if (!open && !closed && sent > 0 && answered === 0) give(new TransportError("ice-failed", "ICE checks get no answer"));
    }, EARLY_CHECK_MS);

    peer.onicegatheringstatechange = () => console.debug("[voice] ICE gathering:", peer.iceGatheringState);
    peer.onicecandidateerror = (e) => { const x = e as RTCPeerConnectionIceErrorEvent; console.debug("[voice] ICE candidate error:", x.errorCode, x.errorText, x.url); };
    peer.oniceconnectionstatechange = () => console.debug("[voice] ICE:", peer.iceConnectionState);
    peer.onconnectionstatechange = () => {
      if (closed) return;
      const s = peer.connectionState;
      console.debug("[voice] connection:", s);
      if (s === "connected") clearTimeout(grace);
      else if (s === "disconnected") {
        clearTimeout(grace);
        grace = setTimeout(() => { if (!closed) { open ? opts.onLost("The connection was lost.") : give(new TransportError("ice-failed", "ICE disconnected")); } }, opts.graceMs);
      } else if (s === "failed" || s === "closed") {
        if (open) { link.close(); opts.onLost("The connection was lost."); } else give(new TransportError("ice-failed", `ICE ${s}`));
      }
    };
    // "Connected" only once the data channel is really open: that happens after ICE, DTLS and SCTP have all completed.
    channel.onopen = () => {
      if (closed) return;
      open = true;
      clearTimeout(opened);
      console.debug("[voice] data channel open (WebRTC connected)");
      resolve(link);
    };
    channel.onmessage = (m) => { try { opts.onEvent(JSON.parse(m.data as string) as RealtimeEvent); } catch { /* ignore a malformed event */ } };

    (async () => {
      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      console.debug("[voice] SDP offer created and set; asking OpenAI for the answer");
      const answer = await axios.post<string>(opts.callsUrl, offer.sdp, {
        headers: { Authorization: `Bearer ${opts.secret}`, "Content-Type": "application/sdp" },
        responseType: "text",
        timeout: 15_000,
        withCredentials: false, // this call goes to OpenAI, never with our login cookie
      });
      if (closed) return;
      await peer.setRemoteDescription({ type: "answer", sdp: answer.data });
      console.debug("[voice] SDP answer applied; waiting for ICE");
    })().catch((e) => {
      const status = axios.isAxiosError(e) ? e.response?.status : undefined;
      console.warn("[voice] WebRTC signalling failed:", status ?? (e as Error).message);
      give(new TransportError("http", "Could not exchange the WebRTC offer", status));
    });
  });
}

// ---------------------------------------------------------------- WebSocket (PCM16 @ 24 kHz)

const RATE = 24_000;
const WORKLET = `class PcmCapture extends AudioWorkletProcessor { process(inputs) { const c = inputs[0] && inputs[0][0]; if (c) this.port.postMessage(c.slice(0)); return true; } } registerProcessor("pcm-capture", PcmCapture);`;

const toBase64 = (bytes: Uint8Array) => { let s = ""; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s); };
const fromBase64 = (b64: string) => { const s = atob(b64); const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; };

/** Linear resampling to 24 kHz, only used when the browser would not give us a 24 kHz audio context. */
export function resampleTo24k(input: Float32Array, fromRate: number): Float32Array {
  if (fromRate === RATE) return input;
  const n = Math.floor((input.length * RATE) / fromRate);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const pos = (i * fromRate) / RATE, i0 = Math.floor(pos), i1 = Math.min(i0 + 1, input.length - 1), f = pos - i0;
    out[i] = input[i0] * (1 - f) + input[i1] * f;
  }
  return out;
}
export const floatToPcm16 = (f: Float32Array) => { const o = new Int16Array(f.length); for (let i = 0; i < f.length; i++) o[i] = Math.max(-1, Math.min(1, f[i])) * 0x7fff; return o; };
export const pcm16ToFloat = (p: Int16Array) => { const o = new Float32Array(p.length); for (let i = 0; i < p.length; i++) o[i] = p[i] / 0x8000; return o; };

export async function openSocketLink(opts: { url: string; secret: string; stream: MediaStream; openTimeoutMs: number } & Handlers): Promise<Link> {
  if (typeof WebSocket === "undefined") throw new TransportError("unsupported", "WebSocket is not available in this browser");
  let ac: AudioContext;
  try { ac = new (AudioCtor())({ sampleRate: RATE }); } catch { ac = new (AudioCtor())(); }
  console.debug(`[voice] WebSocket mode: audio context ${ac.sampleRate} Hz, state ${ac.state}`);
  if (ac.state === "suspended") await ac.resume().catch(() => undefined);

  const src = ac.createMediaStreamSource(opts.stream);
  const mic = analyserFor(ac, src);
  const out = ac.createGain();
  const remote = analyserFor(ac, out);
  out.connect(ac.destination);

  let closed = false, open = false;
  let nextTime = 0;
  const playing = new Set<AudioBufferSourceNode>();
  let audioStarted = false, responseDone = false, dropAudio = false; // dropAudio: late audio of a response the customer just interrupted
  let ws: WebSocket;

  const emit = (type: string) => opts.onEvent({ type });
  const stopPlayback = () => { dropAudio = true; for (const s of playing) { s.onended = null; try { s.stop(); } catch { /* already stopped */ } } playing.clear(); nextTime = 0; if (audioStarted) { audioStarted = false; emit("output_audio_buffer.cleared"); } };

  const play = (b64: string) => {
    const f = pcm16ToFloat(new Int16Array(fromBase64(b64).buffer));
    if (!f.length || dropAudio) return;
    const buf = ac.createBuffer(1, f.length, RATE);
    buf.copyToChannel(f as Float32Array<ArrayBuffer>, 0);
    const s = ac.createBufferSource();
    s.buffer = buf;
    s.connect(out);
    const at = Math.max(ac.currentTime + 0.02, nextTime);
    s.start(at);
    nextTime = at + buf.duration;
    playing.add(s);
    if (!audioStarted) { audioStarted = true; responseDone = false; console.debug("[voice] assistant audio started"); emit("output_audio_buffer.started"); }
    s.onended = () => {
      playing.delete(s);
      if (!playing.size && responseDone && audioStarted) { audioStarted = false; emit("output_audio_buffer.stopped"); }
    };
  };

  const link: Link = {
    kind: "websocket",
    send: (m) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m)); },
    close: () => {
      closed = true;
      stopPlayback();
      try { ws.close(); } catch { /* already closed */ }
      try { src.disconnect(); } catch { /* already disconnected */ }
      ac.close().catch(() => undefined);
    },
    micAnalyser: () => mic,
    remoteAnalyser: () => remote,
  };

  opts.register(link);

  // Microphone -> 24 kHz PCM16 chunks of about 100 ms.
  let pcm: Float32Array[] = [], pcmLen = 0;
  const onSamples = (chunk: Float32Array) => {
    if (!open || closed) return;
    pcm.push(resampleTo24k(chunk, ac.sampleRate)); pcmLen += pcm[pcm.length - 1].length;
    if (pcmLen < 2400) return;
    const all = new Float32Array(pcmLen); let o = 0; for (const p of pcm) { all.set(p, o); o += p.length; }
    pcm = []; pcmLen = 0;
    link.send({ type: "input_audio_buffer.append", audio: toBase64(new Uint8Array(floatToPcm16(all).buffer)) });
  };
  if (ac.audioWorklet) {
    const url = URL.createObjectURL(new Blob([WORKLET], { type: "application/javascript" }));
    try { await ac.audioWorklet.addModule(url); } finally { URL.revokeObjectURL(url); }
    console.debug("[voice] WebSocket mode: microphone worklet ready, connecting");
    const node = new AudioWorkletNode(ac, "pcm-capture");
    node.port.onmessage = (e) => onSamples(e.data as Float32Array);
    const mute = ac.createGain(); mute.gain.value = 0; // keeps the worklet pulled without echoing the microphone back
    src.connect(node); node.connect(mute); mute.connect(ac.destination);
  } else {
    const sp = ac.createScriptProcessor(4096, 1, 1);
    sp.onaudioprocess = (e) => onSamples(new Float32Array(e.inputBuffer.getChannelData(0)));
    const mute = ac.createGain(); mute.gain.value = 0;
    src.connect(sp); sp.connect(mute); mute.connect(ac.destination);
  }

  return new Promise<Link>((resolve, reject) => {
    const give = (e: TransportError) => { if (!closed) { link.close(); reject(e); } };
    // The ephemeral key travels in the WebSocket sub-protocol (browsers cannot set headers on a WebSocket).
    ws = new WebSocket(opts.url, ["realtime", `openai-insecure-api-key.${opts.secret}`]);
    const t = setTimeout(() => { if (!open) give(new TransportError("timeout", "WebSocket did not open")); }, opts.openTimeoutMs);
    ws.onopen = () => { if (closed) return; open = true; clearTimeout(t); console.debug("[voice] WebSocket open (compatibility mode)"); resolve(link); };
    ws.onerror = () => { if (!open) { clearTimeout(t); give(new TransportError("socket", "WebSocket error")); } };
    ws.onclose = (e) => {
      clearTimeout(t);
      if (closed) return;
      console.warn("[voice] WebSocket closed:", e.code, e.reason);
      if (!open) give(new TransportError("socket", `WebSocket closed (${e.code})`, e.code));
      else { link.close(); opts.onLost(e.reason || "The connection was closed."); }
    };
    ws.onmessage = (m) => {
      let ev: RealtimeEvent & { delta?: string };
      try { ev = JSON.parse(m.data as string); } catch { return; }
      if ((ev.type === "response.output_audio.delta" || ev.type === "response.audio.delta") && ev.delta) { play(ev.delta); return; }
      if (ev.type === "response.created") dropAudio = false;
      if (ev.type === "input_audio_buffer.speech_started") stopPlayback(); // the customer interrupts: stop talking at once
      if (ev.type === "response.done") { responseDone = true; if (!playing.size && audioStarted) { audioStarted = false; emit("output_audio_buffer.stopped"); } }
      opts.onEvent(ev);
    };
  });
}
