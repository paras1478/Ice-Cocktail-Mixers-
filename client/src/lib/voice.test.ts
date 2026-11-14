import { describe, expect, it } from "vitest";
import { applyTranscriptEvent, describeMicError, phaseForEvent, productsFromToolResult, type VoiceLine } from "./voice";

describe("transcript", () => {
  it("shows what the customer said once it is transcribed, whatever the language", () => {
    const l = applyTranscriptEvent([], { type: "conversation.item.input_audio_transcription.completed", item_id: "u1", transcript: "  Mera mood achha nahi hai  " });
    expect(l).toEqual([{ id: "u1", role: "user", text: "Mera mood achha nahi hai" }]);
    expect(applyTranscriptEvent(l, { type: "conversation.item.input_audio_transcription.completed", item_id: "u2", transcript: "   " })).toBe(l);
  });
  it("builds the assistant's line from streamed deltas and replaces it with the final text (current and older event names)", () => {
    let l: VoiceLine[] = [];
    l = applyTranscriptEvent(l, { type: "response.output_audio_transcript.delta", item_id: "a1", delta: "Hello " });
    l = applyTranscriptEvent(l, { type: "response.output_audio_transcript.delta", item_id: "a1", delta: "there" });
    expect(l).toEqual([{ id: "a1", role: "assistant", text: "Hello there" }]);
    l = applyTranscriptEvent(l, { type: "response.audio_transcript.done", item_id: "a1", transcript: "Hello there!" });
    expect(l).toEqual([{ id: "a1", role: "assistant", text: "Hello there!" }]);
  });
  it("ignores unrelated events and keeps the list bounded", () => {
    const l: VoiceLine[] = [];
    expect(applyTranscriptEvent(l, { type: "session.updated" })).toBe(l);
    let many: VoiceLine[] = [];
    for (let i = 0; i < 60; i++) many = applyTranscriptEvent(many, { type: "conversation.item.input_audio_transcription.completed", item_id: `u${i}`, transcript: "hi" });
    expect(many).toHaveLength(40);
  });
});

describe("phase", () => {
  it("follows listening -> thinking -> speaking -> listening, and an interruption returns to listening", () => {
    expect(phaseForEvent({ type: "input_audio_buffer.speech_started" }, "speaking")).toBe("listening");
    expect(phaseForEvent({ type: "input_audio_buffer.speech_stopped" }, "listening")).toBe("thinking");
    expect(phaseForEvent({ type: "output_audio_buffer.started" }, "thinking")).toBe("speaking");
    expect(phaseForEvent({ type: "output_audio_buffer.stopped" }, "speaking")).toBe("listening");
    expect(phaseForEvent({ type: "response.created" }, "speaking")).toBeNull();
    expect(phaseForEvent({ type: "rate_limits.updated" }, "listening")).toBeNull();
  });
});

describe("product cards", () => {
  it("takes real products from search, details and alternatives results, and nothing else", () => {
    const p = { id: "p1", slug: "lemon", name: "Lemon Soda", price: "₹60", image: "/img/x.webp", inStock: true };
    expect(productsFromToolResult({ ok: true, products: [p, { junk: 1 }] })).toEqual([p]);
    expect(productsFromToolResult({ ok: true, product: p })).toEqual([p]);
    expect(productsFromToolResult({ ok: true, alternatives: [{ ...p, inStock: false }] })[0].inStock).toBe(false);
    expect(productsFromToolResult({ ok: false, error: "x" })).toEqual([]);
    expect(productsFromToolResult(null)).toEqual([]);
  });
});

describe("microphone errors", () => {
  it("explains a denied or missing microphone", () => {
    expect(describeMicError({ name: "NotAllowedError" })).toMatchObject({ kind: "mic-denied" });
    expect(describeMicError({ name: "NotFoundError" })).toMatchObject({ kind: "mic-missing" });
    expect(describeMicError(new Error("boom"))).toMatchObject({ kind: "connection" });
  });
});
