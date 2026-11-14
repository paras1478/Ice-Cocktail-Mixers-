import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

const post = vi.fn();
vi.mock("./api", () => ({ api: { post: (...a: unknown[]) => post(...a) }, apiError: (e: { status?: number; message?: string }) => ({ message: e.message ?? "failed", status: e.status, fields: {} }) }));
const sdpPost = vi.fn();
vi.mock("axios", () => ({ default: { post: (...a: unknown[]) => sdpPost(...a), isAxiosError: (e: unknown) => !!(e as { isAxios?: boolean })?.isAxios } }));

import { useRealtimeVoice } from "./useRealtimeVoice";

class FakeChannel {
  readyState = "open";
  sent: Record<string, unknown>[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((m: { data: string }) => void) | null = null;
  send(s: string) { this.sent.push(JSON.parse(s)); }
  close() { this.readyState = "closed"; }
  emit(ev: unknown) { this.onmessage?.({ data: JSON.stringify(ev) }); }
}
let channel: FakeChannel;
let peer: FakePeer;
class FakePeer {
  connectionState = "new";
  onconnectionstatechange: (() => void) | null = null;
  ontrack: unknown = null;
  closed = false;
  constructor() { peer = this; }
  addTrack() {}
  createDataChannel() { channel = new FakeChannel(); return channel as unknown as RTCDataChannel; }
  async createOffer() { return { type: "offer", sdp: "v=0 offer" }; }
  async setLocalDescription() {}
  async setRemoteDescription() { queueMicrotask(() => channel.onopen?.()); }
  close() { this.closed = true; }
}

let track: { enabled: boolean; stop: ReturnType<typeof vi.fn> };
const session = { data: { clientSecret: "ek_test", callsUrl: "https://api.openai.com/v1/realtime/calls", realtimeUrl: "wss://api.openai.com/v1/realtime?model=gpt-realtime" } };

let sockets: FakeSocket[] = [];
class FakeSocket {
  static OPEN = 1;
  readyState = 0;
  sent: Record<string, unknown>[] = [];
  closed = false;
  onopen: (() => void) | null = null; onerror: (() => void) | null = null; onclose: ((e: { code: number; reason: string }) => void) | null = null; onmessage: ((m: { data: string }) => void) | null = null;
  static failToOpen = false;
  constructor(public url: string, public protocols: string[]) {
    sockets.push(this);
    queueMicrotask(() => { if (FakeSocket.failToOpen) { this.onerror?.(); this.onclose?.({ code: 1006, reason: "" }); } else { this.readyState = 1; this.onopen?.(); } });
  }
  send(s: string) { this.sent.push(JSON.parse(s)); }
  close() { this.closed = true; this.readyState = 3; }
  emit(ev: unknown) { this.onmessage?.({ data: JSON.stringify(ev) }); }
}

beforeEach(() => {
  post.mockReset(); sdpPost.mockReset();
  sdpPost.mockResolvedValue({ data: "v=0 answer" });
  track = { enabled: true, stop: vi.fn() };
  const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia: vi.fn(async () => stream) } });
  vi.stubGlobal("RTCPeerConnection", FakePeer);
  vi.stubGlobal("Audio", class { autoplay = false; srcObject: unknown = null; pause() {} });
  vi.stubGlobal("AudioContext", class {
    state = "running"; sampleRate = 24000; destination = {}; currentTime = 0;
    createAnalyser() { return { fftSize: 0, smoothingTimeConstant: 0, frequencyBinCount: 64, getByteFrequencyData() {}, connect() {} }; }
    createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
    createGain() { return { gain: { value: 1 }, connect() {} }; }
    createScriptProcessor() { return { connect() {}, onaudioprocess: null }; }
    resume() { return Promise.resolve(); }
    close() { return Promise.resolve(); }
  });
  vi.stubGlobal("WebSocket", FakeSocket);
  sockets = []; FakeSocket.failToOpen = false;
  try { localStorage.clear(); } catch { /* ignore */ }
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

/** With fake timers waitFor() cannot poll, so let the pending promises and timers run a little at a time until the wanted status shows. */
async function settle(h: { result: { current: { status: string } } }, want: string) {
  for (let i = 0; i < 40 && h.result.current.status !== want; i++) await act(async () => { await vi.advanceTimersByTimeAsync(100); });
}

async function started(onCartChanged = vi.fn()) {
  post.mockImplementation(async (url: string) => { if (url === "/voice/session") return session; throw new Error(`unexpected ${url}`); });
  const h = renderHook(() => useRealtimeVoice({ onCartChanged }));
  await act(async () => { await h.result.current.start(); });
  await waitFor(() => expect(h.result.current.status).toBe("live"));
  return { h, onCartChanged };
}

describe("useRealtimeVoice", () => {
  it("asks our server for a client secret, opens the call with it (never our cookie) and has the assistant greet first", async () => {
    const { h } = await started();
    expect(post).toHaveBeenCalledWith("/voice/session");
    const [url, sdp, opts] = sdpPost.mock.calls[0];
    expect(url).toBe("https://api.openai.com/v1/realtime/calls");
    expect(sdp).toBe("v=0 offer");
    expect(opts.headers.Authorization).toBe("Bearer ek_test");
    expect(opts.withCredentials).toBe(false);
    expect(channel.sent[0]).toMatchObject({ type: "response.create" });
    expect(h.result.current.phase).toBe("listening");
  });

  it("tracks listening, thinking and speaking, shows the transcript, and handles an interruption", async () => {
    const { h } = await started();
    act(() => channel.emit({ type: "input_audio_buffer.speech_started" }));
    expect(h.result.current.phase).toBe("listening");
    act(() => channel.emit({ type: "input_audio_buffer.speech_stopped" }));
    expect(h.result.current.phase).toBe("thinking");
    act(() => channel.emit({ type: "conversation.item.input_audio_transcription.completed", item_id: "u1", transcript: "Mujhe kuch fruity chahiye" }));
    act(() => channel.emit({ type: "output_audio_buffer.started" }));
    expect(h.result.current.phase).toBe("speaking");
    act(() => channel.emit({ type: "input_audio_buffer.speech_started" })); // customer interrupts
    expect(h.result.current.phase).toBe("listening");
    expect(h.result.current.lines).toEqual([{ id: "u1", role: "user", text: "Mujhe kuch fruity chahiye" }]);
  });

  it("relays a tool call to our server, refreshes the cart after a cart change, and returns the REAL result to the model", async () => {
    const onCartChanged = vi.fn();
    const { h } = await started(onCartChanged);
    post.mockImplementation(async (url: string, body: { name: string }) => {
      expect(url).toBe("/voice/tool");
      return { data: { result: { ok: true, added: { name: "Lemon Soda", quantity: 2 } }, cartChanged: body.name === "add_to_cart" } };
    });
    act(() => channel.emit({ type: "response.output_item.done", item: { type: "function_call", call_id: "c1", name: "add_to_cart", arguments: JSON.stringify({ product_id: "p1", quantity: 2 }) } }));
    act(() => channel.emit({ type: "response.output_item.done", item: { type: "function_call", call_id: "c1", name: "add_to_cart", arguments: "{}" } })); // a repeated event must not run it twice
    channel.sent.length = 0;
    await act(async () => { channel.emit({ type: "response.done" }); });
    await waitFor(() => expect(channel.sent).toHaveLength(2));
    expect(post).toHaveBeenCalledWith("/voice/tool", { name: "add_to_cart", arguments: { product_id: "p1", quantity: 2 } });
    expect(post.mock.calls.filter((c) => c[0] === "/voice/tool")).toHaveLength(1);
    expect(channel.sent[0]).toMatchObject({ type: "conversation.item.create", item: { type: "function_call_output", call_id: "c1" } });
    expect(JSON.parse((channel.sent[0].item as { output: string }).output)).toMatchObject({ ok: true, added: { quantity: 2 } });
    expect(channel.sent[1]).toEqual({ type: "response.create" });
    expect(onCartChanged).toHaveBeenCalledTimes(1);
    expect(h.result.current.cartNote).toBeTruthy();
  });

  it("tells the model the truth when a tool fails, and never claims a cart change", async () => {
    const onCartChanged = vi.fn();
    await started(onCartChanged);
    post.mockRejectedValue({ status: 409, message: "Only 2 left in stock" });
    act(() => channel.emit({ type: "response.output_item.done", item: { type: "function_call", call_id: "c2", name: "add_to_cart", arguments: "{\"product_id\":\"p\"}" } }));
    channel.sent.length = 0;
    await act(async () => { channel.emit({ type: "response.done" }); });
    await waitFor(() => expect(channel.sent).toHaveLength(2));
    expect(JSON.parse((channel.sent[0].item as { output: string }).output)).toEqual({ ok: false, error: "Only 2 left in stock" });
    expect(onCartChanged).not.toHaveBeenCalled();
  });

  it("mutes and unmutes the microphone track, and releases everything when it ends", async () => {
    const { h } = await started();
    act(() => h.result.current.toggleMute());
    expect(track.enabled).toBe(false);
    expect(h.result.current.muted).toBe(true);
    act(() => h.result.current.toggleMute());
    expect(track.enabled).toBe(true);
    act(() => h.result.current.stop());
    expect(track.stop).toHaveBeenCalled();
    expect(peer.closed).toBe(true);
    expect(channel.readyState).toBe("closed");
    expect(h.result.current.status).toBe("idle");
  });

  it("releases the microphone when the screen is closed without pressing End", async () => {
    const { h } = await started();
    h.unmount();
    expect(track.stop).toHaveBeenCalled();
    expect(peer.closed).toBe(true);
  });

  it("explains a denied microphone and never asks the server for a session", async () => {
    (navigator.mediaDevices.getUserMedia as ReturnType<typeof vi.fn>).mockRejectedValue(Object.assign(new Error("denied"), { name: "NotAllowedError" }));
    const h = renderHook(() => useRealtimeVoice({ onCartChanged: vi.fn() }));
    await act(async () => { await h.result.current.start(); });
    expect(h.result.current.status).toBe("error");
    expect(h.result.current.error?.kind).toBe("mic-denied");
    expect(post).not.toHaveBeenCalled();
  });

  it("asks the customer to log in when the session is refused with 401, and frees the microphone", async () => {
    post.mockRejectedValue({ status: 401, message: "Please log in" });
    const h = renderHook(() => useRealtimeVoice({ onCartChanged: vi.fn() }));
    await act(async () => { await h.result.current.start(); });
    expect(h.result.current.error?.kind).toBe("login");
    expect(track.stop).toHaveBeenCalled();
  });

  it("recovers from an expired session: a refused call shows an error and Reconnect gets a fresh secret", async () => {
    post.mockResolvedValue(session);
    sdpPost.mockRejectedValueOnce({ isAxios: true, response: { status: 401 } });
    const h = renderHook(() => useRealtimeVoice({ onCartChanged: vi.fn() }));
    await act(async () => { await h.result.current.start(); });
    expect(h.result.current.error?.kind).toBe("expired");
    post.mockClear();
    await act(async () => { await h.result.current.start(); });
    await waitFor(() => expect(h.result.current.status).toBe("live"));
    expect(post).toHaveBeenCalledWith("/voice/session");
    expect(h.result.current.error).toBeNull();
  });

  it("stops cleanly when the connection is lost or the device goes offline", async () => {
    const { h } = await started();
    act(() => { peer.connectionState = "failed"; peer.onconnectionstatechange?.(); });
    expect(h.result.current.status).toBe("error");
    expect(h.result.current.error?.kind).toBe("connection");
    expect(track.stop).toHaveBeenCalled();
    await act(async () => { await h.result.current.start(); });
    await waitFor(() => expect(h.result.current.status).toBe("live"));
    act(() => { window.dispatchEvent(new Event("offline")); });
    expect(h.result.current.error?.kind).toBe("offline");
  });

  describe("when WebRTC cannot open (UDP blocked by the network, a VPN or a firewall)", () => {
    class StuckPeer extends FakePeer {
      iceConnectionState = "checking";
      async setRemoteDescription() { /* the answer is accepted, but ICE never completes: the data channel never opens */ }
    }
    const stuck = () => vi.stubGlobal("RTCPeerConnection", StuckPeer);

    it("switches by itself to the WebSocket transport (with a spare secret requested in the background), goes live, and relays tool calls over it", async () => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      try {
        stuck();
        post.mockImplementation(async (url: string) => {
          if (url === "/voice/session") return session;
          return { data: { result: { ok: true }, cartChanged: false } };
        });
        const h = renderHook(() => useRealtimeVoice({ onCartChanged: vi.fn() }));
        // start() now resolves only once a connection is open, so under fake timers it must not be awaited before the timers advance
        await act(async () => { void h.result.current.start(); await vi.advanceTimersByTimeAsync(0); });
        expect(h.result.current.status).toBe("connecting");
        expect(sockets).toHaveLength(0); // WebRTC is tried first
        await act(async () => { await vi.advanceTimersByTimeAsync(6_500); });
        await settle(h, "live");
        expect(h.result.current.status).toBe("live");
        expect(h.result.current.mode).toBe("websocket");
        expect(post.mock.calls.filter((c) => c[0] === "/voice/session")).toHaveLength(2); // the spare secret: one that was used for WebRTC is not reused for the socket
        expect(peer.closed).toBe(true); // the stuck peer connection was released
        expect(sockets).toHaveLength(1);
        expect(sockets[0].url).toBe("wss://api.openai.com/v1/realtime?model=gpt-realtime");
        expect(sockets[0].protocols).toEqual(["realtime", "openai-insecure-api-key.ek_test"]);
        expect(sockets[0].sent[0]).toMatchObject({ type: "response.create" }); // the greeting
        expect(Number(localStorage.getItem("voice-transport"))).toBeGreaterThan(0); // remembered for a few hours
        // a tool call arrives over the socket and its REAL result goes back over the socket
        act(() => sockets[0].emit({ type: "response.output_item.done", item: { type: "function_call", call_id: "w1", name: "get_cart", arguments: "{}" } }));
        sockets[0].sent.length = 0;
        await act(async () => { sockets[0].emit({ type: "response.done" }); });
        for (let i = 0; i < 40 && sockets[0].sent.length < 2; i++) await act(async () => { await vi.advanceTimersByTimeAsync(50); });
        expect(sockets[0].sent).toHaveLength(2);
        expect(sockets[0].sent[0]).toMatchObject({ type: "conversation.item.create", item: { type: "function_call_output", call_id: "w1" } });
        expect(sockets[0].sent[1]).toEqual({ type: "response.create" });
      } finally { vi.useRealTimers(); }
    });

    it("remembers the choice for the rest of the tab, so the next conversation skips the failing WebRTC attempt", async () => {
      localStorage.setItem("voice-transport", String(Date.now()));
      post.mockResolvedValue(session);
      const h = renderHook(() => useRealtimeVoice({ onCartChanged: vi.fn() }));
      await act(async () => { await h.result.current.start(); });
      await waitFor(() => expect(h.result.current.status).toBe("live"));
      expect(h.result.current.mode).toBe("websocket");
      expect(post.mock.calls.filter((c) => c[0] === "/voice/session")).toHaveLength(1);
      expect(sdpPost).not.toHaveBeenCalled(); // no WebRTC offer at all
    });

    it("explains a blocked network only when BOTH transports fail, and frees the microphone", async () => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      try {
        stuck();
        FakeSocket.failToOpen = true;
        post.mockResolvedValue(session);
        const h = renderHook(() => useRealtimeVoice({ onCartChanged: vi.fn() }));
        await act(async () => { void h.result.current.start(); await vi.advanceTimersByTimeAsync(0); });
        await act(async () => { await vi.advanceTimersByTimeAsync(6_500); });
        await settle(h, "error");
        expect(h.result.current.status).toBe("error");
        expect(h.result.current.error?.kind).toBe("network");
        expect(h.result.current.error?.message).toMatch(/WebRTC|WebSocket/);
        expect(track.stop).toHaveBeenCalled();
      } finally { vi.useRealTimers(); }
    });
  });

  it("Reconnect releases the previous connection and microphone first, so only one connection exists at a time", async () => {
    const { h } = await started();
    const firstPeer = peer, firstTrack = track;
    firstTrack.stop.mockClear();
    await act(async () => { await h.result.current.start(); });
    await waitFor(() => expect(h.result.current.status).toBe("live"));
    expect(firstPeer.closed).toBe(true);
    expect(firstTrack.stop).toHaveBeenCalled();
    expect(peer).not.toBe(firstPeer);
    expect(h.result.current.mode).toBe("webrtc");
  });

  it("is honest on a browser without microphone support", async () => {
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: undefined });
    const h = renderHook(() => useRealtimeVoice({ onCartChanged: vi.fn() }));
    await act(async () => { await h.result.current.start(); });
    expect(h.result.current.error?.kind).toBe("unsupported");
  });
});

describe("useRealtimeVoice session retry", () => {
  it("retries the session request once after a 502, but never after a refusal", async () => {
    post.mockReset();
    post.mockRejectedValueOnce({ status: 502, message: "Could not reach the voice service" }).mockResolvedValueOnce(session);
    const h = renderHook(() => useRealtimeVoice({ onCartChanged: vi.fn() }));
    await act(async () => { await h.result.current.start(); });
    await waitFor(() => expect(h.result.current.status).toBe("live"), { timeout: 3000 });
    expect(post.mock.calls.filter((c) => c[0] === "/voice/session")).toHaveLength(2);

    post.mockReset();
    post.mockRejectedValue({ status: 429, message: "Too many voice sessions" });
    await act(async () => { await h.result.current.start(); });
    expect(post.mock.calls.filter((c) => c[0] === "/voice/session")).toHaveLength(1);
    expect(h.result.current.error?.message).toMatch(/Too many/);
  });
});
