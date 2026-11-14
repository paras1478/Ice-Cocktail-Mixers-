import { Router } from "express";
import rateLimit from "express-rate-limit";
import { prisma } from "../lib/db.js";
import { env } from "../lib/env.js";
import { HttpError } from "../lib/errors.js";
import { ah, parse } from "../lib/http.js";
import { buildInstructions, createClientSecret } from "../lib/openaiRealtime.js";
import { APPROVED_CATEGORIES } from "../lib/catalog.js";
import { publicProductWhere } from "../lib/publish.js";
import { requireAuth } from "../middleware/auth.js";
import { CART_CHANGING_TOOLS, runVoiceTool, voiceToolCall } from "../services/voiceTools.js";

export const voiceRouter = Router();
voiceRouter.use(requireAuth); // only logged-in customers can start a call or use the tools

const sessionLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: env.NODE_ENV === "test" ? 1000 : 40, // a connection attempt can need two secrets (WebRTC, then the WebSocket fallback)
  message: { error: "Too many voice sessions. Please wait a few minutes and try again." },
});
const toolLimiter = rateLimit({
  windowMs: 60_000,
  limit: env.NODE_ENV === "test" ? 10_000 : 90,
  message: { error: "Too many requests. Please wait a moment." },
});

voiceRouter.get("/status", (_req, res) => res.json({ enabled: Boolean(env.OPENAI_API_KEY) }));

/** Creates the short-lived credentials the browser needs for the WebRTC call. The OpenAI key itself never leaves the server. */
voiceRouter.post(
  "/session",
  sessionLimiter,
  ah(async (_req, res) => {
    if (!env.OPENAI_API_KEY) throw new HttpError(503, "The voice assistant is not set up on this server.");
    const cats = await prisma.category.findMany({ where: { isActive: true, slug: { in: [...APPROVED_CATEGORIES] } }, orderBy: { sortOrder: "asc" }, select: { name: true } });
    // A compact live snapshot of what is on sale right now, so the assistant can recommend by name; the tools stay the authority for price and stock.
    const products = await prisma.product.findMany({
      where: { ...publicProductWhere(), stock: { gt: 0 } },
      orderBy: [{ popularity: "desc" }, { name: "asc" }],
      take: 40,
      select: { name: true, packSize: true, priceMinor: true, category: { select: { name: true } } },
    });
    const catalog = products.map((p) => ({ name: p.name, category: p.category.name, packSize: p.packSize, price: `₹${p.priceMinor % 100 === 0 ? p.priceMinor / 100 : (p.priceMinor / 100).toFixed(2)}` }));
    const secret = await createClientSecret(buildInstructions(cats.map((c) => c.name), catalog));
    res.setHeader("Cache-Control", "no-store");
    res.json({
      clientSecret: secret.value,
      expiresAt: secret.expiresAt,
      model: env.OPENAI_REALTIME_MODEL,
      callsUrl: `${env.OPENAI_BASE_URL}/v1/realtime/calls`, // WebRTC
      realtimeUrl: `${env.OPENAI_BASE_URL.replace(/^http/, "ws")}/v1/realtime?model=${encodeURIComponent(env.OPENAI_REALTIME_MODEL)}`, // WebSocket fallback (TCP 443)
    });
  }),
);

/**
 * Runs one assistant tool call as the logged-in customer. The browser relays the model's call here; the arguments are validated, the user
 * is always the authenticated one (never taken from the body), and the real result goes back to the model.
 */
voiceRouter.post(
  "/tool",
  toolLimiter,
  ah(async (req, res) => {
    const call = parse(voiceToolCall, { name: req.body?.name, arguments: req.body?.arguments ?? {} });
    const result = await runVoiceTool(req.user!.id, call);
    res.setHeader("Cache-Control", "no-store");
    res.json({ result, cartChanged: CART_CHANGING_TOOLS.has(call.name) && result.ok === true });
  }),
);
