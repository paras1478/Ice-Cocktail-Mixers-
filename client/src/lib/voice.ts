// Pure helpers for the voice assistant (no React, no browser APIs) so they can be unit-tested.

export type VoicePhase = "listening" | "thinking" | "speaking";
export interface VoiceLine { id: string; role: "user" | "assistant"; text: string }
export interface VoiceProduct { id: string; slug?: string; name: string; price: string; image: string | null; inStock: boolean }

/** A server event from the Realtime data channel. Only the fields we read are typed. */
export interface RealtimeEvent {
  type: string;
  item_id?: string;
  response_id?: string;
  delta?: string;
  transcript?: string;
  item?: { id?: string; type?: string; name?: string; call_id?: string; arguments?: string };
  response?: { status?: string; status_details?: { error?: { message?: string } } };
  error?: { code?: string; message?: string };
}

const ASSISTANT_TRANSCRIPT_DELTA = new Set(["response.output_audio_transcript.delta", "response.audio_transcript.delta"]);
const ASSISTANT_TRANSCRIPT_DONE = new Set(["response.output_audio_transcript.done", "response.audio_transcript.done"]);

/** Keeps the optional on-screen transcript up to date from the model's events. Returns the same array when the event changes nothing. */
export function applyTranscriptEvent(lines: VoiceLine[], ev: RealtimeEvent): VoiceLine[] {
  const keep = (l: VoiceLine[]) => l.slice(-40);
  if (ev.type === "conversation.item.input_audio_transcription.completed" && ev.item_id && ev.transcript?.trim()) {
    const text = ev.transcript.trim();
    return keep([...lines.filter((l) => l.id !== ev.item_id), { id: ev.item_id, role: "user", text }]);
  }
  if (ASSISTANT_TRANSCRIPT_DELTA.has(ev.type) && ev.item_id && ev.delta) {
    const have = lines.find((l) => l.id === ev.item_id);
    return have ? lines.map((l) => (l.id === ev.item_id ? { ...l, text: l.text + ev.delta } : l)) : keep([...lines, { id: ev.item_id, role: "assistant", text: ev.delta }]);
  }
  if (ASSISTANT_TRANSCRIPT_DONE.has(ev.type) && ev.item_id && ev.transcript) {
    const have = lines.find((l) => l.id === ev.item_id);
    return have ? lines.map((l) => (l.id === ev.item_id ? { ...l, text: ev.transcript! } : l)) : keep([...lines, { id: ev.item_id, role: "assistant", text: ev.transcript }]);
  }
  return lines;
}

/** What the assistant is doing, from an event; null when the event does not change it. */
export function phaseForEvent(ev: RealtimeEvent, current: VoicePhase): VoicePhase | null {
  switch (ev.type) {
    case "input_audio_buffer.speech_started": return "listening"; // also an interruption while the assistant was speaking
    case "input_audio_buffer.speech_stopped": return "thinking";
    case "response.created": return current === "speaking" ? null : "thinking";
    case "output_audio_buffer.started": return "speaking";
    case "output_audio_buffer.stopped":
    case "output_audio_buffer.cleared": return "listening";
    default: return null;
  }
}

/** Products worth showing as cards, taken from a tool result (search results, one product's details, alternatives). */
export function productsFromToolResult(result: unknown): VoiceProduct[] {
  const r = result as { products?: unknown[]; alternatives?: unknown[]; product?: unknown } | null;
  const list = [...(r?.products ?? []), ...(r?.alternatives ?? []), ...(r?.product ? [r.product] : [])];
  const out: VoiceProduct[] = [];
  for (const p of list as { id?: unknown; slug?: unknown; name?: unknown; price?: unknown; image?: unknown; inStock?: unknown }[]) {
    if (typeof p?.id === "string" && typeof p.name === "string" && typeof p.price === "string")
      out.push({ id: p.id, slug: typeof p.slug === "string" ? p.slug : undefined, name: p.name, price: p.price, image: typeof p.image === "string" ? p.image : null, inStock: p.inStock !== false });
  }
  return out.slice(0, 4);
}

export type VoiceErrorKind = "mic-denied" | "mic-missing" | "unsupported" | "login" | "offline" | "expired" | "connection" | "network" | "unavailable";
export interface VoiceError { kind: VoiceErrorKind; message: string }

export function describeMicError(e: unknown): VoiceError {
  const name = (e as { name?: string } | null)?.name;
  if (name === "NotAllowedError" || name === "SecurityError" || name === "PermissionDeniedError")
    return { kind: "mic-denied", message: "Microphone access is blocked. Allow the microphone for this site in your browser's address bar, then try again." };
  if (name === "NotFoundError" || name === "OverconstrainedError" || name === "DevicesNotFoundError")
    return { kind: "mic-missing", message: "No microphone was found. Connect one and try again." };
  if (name === "NotReadableError") return { kind: "mic-missing", message: "Your microphone is being used by another app. Close it and try again." };
  return { kind: "connection", message: "Could not start the microphone. Please try again." };
}

/** The first greeting, asked for by the app (the model replies in speech). Language-neutral so Hindi, English and Hinglish customers all feel at home. */
export const GREETING_INSTRUCTIONS =
  "Greet the customer warmly in one short sentence that starts with \"Namaste\" and is otherwise simple English, say you can help them find drinks, mixers and ice, and ask what they feel like having. Do not list products yet.";
