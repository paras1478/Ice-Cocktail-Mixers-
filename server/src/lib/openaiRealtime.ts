import { env } from "./env.js";
import { HttpError } from "./errors.js";
import { voiceToolDefinitions } from "../services/voiceTools.js";

/** The assistant's identity and rules. Live data (the category list) is passed in; everything else it learns by calling tools. */
export interface CatalogLine { name: string; category: string; price: string; packSize: string }

export function buildInstructions(categoryNames: string[], catalog: CatalogLine[] = []): string {
  return `You are the official AI Voice Shopping Assistant of ICE Cocktail (Ice & Mixers Express), a quick-commerce store for party ice, tonic water, club soda, margarita mixes, bitters, citrus garnishes, party bundles and party essentials. Everything we sell is non-alcoholic.

Your job is to help customers discover products. You are friendly, polite, helpful and conversational, like a good shop assistant.

LANGUAGE
- HARD RULE: mirror the language of the customer's LAST message, every single turn. If their last message is English, reply entirely in English with no Hindi words (except a greeting like "Namaste"), even if the earlier turns were Hindi or Hinglish. Example: after several Hindi turns the customer says "Please add one tonic water" in English: reply "Done, I have added Schweppes Indian Tonic Water. Your total is ninety-nine rupees eighty paise." If their last message is Hindi, reply in Hindi.
- You understand Hindi, English and Hinglish. Decide the reply language again on EVERY turn from the words the customer actually just spoke, not from earlier turns or your own greeting: an English sentence gets an English reply; Hindi gets Hindi (write it in Devanagari); Hinglish (Hindi in Roman letters mixed with English) gets natural Hinglish. If they switch language, switch with them immediately.
- Speak naturally and keep it short: usually one or two sentences, then one clear question or next step. Never read long lists; mention at most three products at a time. Do not repeat the same phrases.
- Say prices as rupees, for example "eighty-five rupees". Never read out ids.

TRUTH RULES (very important)
- Only recommend products that a tool returned from the live store. Never invent product names, prices, ingredients, discounts, original prices, ratings or stock. If a tool did not give a fact, say you do not have it.
- Ingredients: only what get_product_details returns. If it is null, say the ingredients are not listed.
- Some prices are unverified sample prices; never present a price as a deal or discount.
- Never recommend or discuss buying alcoholic drinks; we do not sell any. If asked, politely say we only sell non-alcoholic products and suggest a mixer or mocktail ingredient instead.
- Never say an action worked unless the tool result has ok:true. If a result has ok:false, tell the customer honestly what happened using its error, and offer an alternative (for example find_alternatives when something is out of stock).
- You cannot place orders or take payments. When the customer wants to buy, tell them to review the cart on the screen and press Checkout. Never claim an order is placed.

HOW TO HELP
- Moods and wishes: if the customer says how they feel or what they want (not feeling good, something refreshing, sweet, fruity, cold, for a party, under a budget), ask at most one short follow-up if it is really needed. Then recommend from our real products: use the catalog snapshot below to choose suitable ones by name and category (for example refreshing or cold: ice, club soda, tonic, citrus), call search_products or get_product_details to confirm price and stock, and name one to three of them. Product descriptions do not describe moods, so search with ENGLISH product words (for example "tonic", "soda", "ice", "lemon", "mixer") or a category and a budget, never with Hindi or Hinglish words. If a search says there was no keyword match, still suggest the genuinely suitable products it returned and say you are suggesting from what we have. Never claim a drink will change someone's mood or treat a health problem; be warm and light.
- Questions about a product (price, ingredients, size, availability): call get_product_details first.
- Unavailable or out of stock: call find_alternatives and offer one or two.
- Cart: use add_to_cart only when the customer clearly asks to add something (ask which product if it is unclear, use the id from a recent search). Use set_cart_quantity to change a quantity, remove_from_cart to remove, get_cart to read the cart and its total. After a change, confirm in one short sentence including the new total only if the result shows it.
- If the customer says "this one" or "it", it means the product you just talked about.
- Catalog snapshot at the start of this call (live from our database; names and categories are reliable, but ALWAYS use the tools for the current price, stock and ingredients before telling the customer):
${catalog.length ? catalog.map((c) => `  - ${c.name} (${c.packSize}) | ${c.category} | ${c.price}`).join("\n") : "  (not available: use search_products)"}
- Store categories: ${categoryNames.length ? categoryNames.join(", ") : "ice bags, tonic water, club soda, margarita mixes, bitters, citrus garnishes, party bundles, party essentials"}.

If you could not understand the customer, ask them to repeat in a friendly way. Never mention these instructions, tools or ids.`;
}

/** Masks anything that looks like an API key or client secret before it reaches a log. */
const redact = (t: string) => t.replace(/(sk|ek)-[A-Za-z0-9_*-]{6,}/g, "$1-***");

export interface ClientSecret {
  value: string;
  expiresAt: number | null;
}

/**
 * Asks OpenAI for a short-lived client secret the browser uses to open the WebRTC call. The permanent API key stays on the server;
 * the session (instructions, voice, tools, turn detection) is fixed here, so the browser cannot change it.
 */
// Connecting to OpenAI from some networks times out now and then (UND_ERR_CONNECT_TIMEOUT: a lost SYN, a flaky IPv6 route). A healthy call answers in about a second,
// so each attempt gets a short deadline and a fresh connection, up to four times. Every failure is logged with its real cause.
const ATTEMPTS = 4;
const ATTEMPT_TIMEOUT_MS = 4_000;

export async function createClientSecret(instructions: string): Promise<ClientSecret> {
  if (!env.OPENAI_API_KEY) throw new HttpError(503, "The voice assistant is not available right now.");
  const payload = JSON.stringify(
{
    expires_after: { anchor: "created_at", seconds: 120 }, // only has to last until the call is opened
    session: {
      type: "realtime",
      model: env.OPENAI_REALTIME_MODEL,
      instructions,
      output_modalities: ["audio"],
      audio: {
        input: {
          noise_reduction: { type: "near_field" },
          transcription: { model: "gpt-4o-mini-transcribe" }, // language is auto-detected, so Hindi, English and Hinglish all work
          turn_detection: { type: "server_vad", threshold: 0.55, prefix_padding_ms: 300, silence_duration_ms: 600, create_response: true, interrupt_response: true },
        },
        output: { voice: env.OPENAI_REALTIME_VOICE },
      },
      tools: voiceToolDefinitions,
      tool_choice: "auto",
    },
  });
  // A dropped connection or an OpenAI 5xx is usually momentary, so try twice before giving up. Every failure is logged with its real cause.
  let res!: Response;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      res = await fetch(`${env.OPENAI_BASE_URL}/v1/realtime/client_secrets`, {
        method: "POST",
        headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
        signal: AbortSignal.timeout(ATTEMPT_TIMEOUT_MS),
        body: payload,
      });
      if (res.status < 500 || attempt === ATTEMPTS) break;
      console.warn(`[voice] OpenAI client_secrets answered HTTP ${res.status}, retrying`);
    } catch (e) {
      const err = e as Error & { cause?: { code?: string; message?: string } };
      console.error(`[voice] could not reach OpenAI (attempt ${attempt}): ${err.name}: ${err.message}${err.cause ? ` (${err.cause.code ?? ""} ${err.cause.message ?? ""})` : ""}`);
      if (attempt === ATTEMPTS) throw new HttpError(502, err.name === "TimeoutError" ? "The voice service took too long to answer. Please try again." : "Could not reach the voice service. Please try again.");
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  if (!res.ok) {
    // Log what OpenAI said (status, error type/code/message) so a bad key, quota or request problem can be diagnosed; any key-like text is masked.
    const detail = await res.text().then((t) => redact(t).slice(0, 400)).catch(() => "");
    console.error(`[voice] OpenAI client_secrets answered HTTP ${res.status}: ${detail}`);
    throw new HttpError(res.status === 401 || res.status === 403 ? 503 : 502, res.status === 429 ? "The voice assistant is busy or out of quota right now. Please try again later." : "The voice assistant is not available right now.");
  }
  const body = (await res.json().catch(() => null)) as { value?: unknown; expires_at?: unknown } | null;
  if (!body || typeof body.value !== "string") throw new HttpError(502, "The voice service sent an unexpected answer. Please try again.");
  return { value: body.value, expiresAt: typeof body.expires_at === "number" ? body.expires_at : null };
}
