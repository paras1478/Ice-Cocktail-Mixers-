import "dotenv/config";
import { z } from "zod";
import { allowedOrigins, parseOriginPatterns, parseOrigins } from "./origins.js";
import { describeDbUrl, productionDbUrlProblem } from "./dbUrl.js";

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 characters"),
  // Browser origin(s) allowed by CORS: one value or a comma-separated list, e.g. "https://app.vercel.app,https://staging.vercel.app".
  CLIENT_ORIGIN: z.string().min(1).default("http://localhost:5173"),
  // Extra origins matched by pattern, for Vercel preview deployments whose URL changes every deploy, e.g.
  // "https://ice-cocktail-*-pankaj-kumars-projects-d26ce2ff.vercel.app". One "*" in the first host label only; https only.
  CLIENT_ORIGIN_PATTERNS: z.string().optional(),
  // "lax" when the site and API share a domain (or the API is reached through a /api rewrite). "none" when the frontend and the API are on
  // different sites (e.g. vercel.app + onrender.com) so the login cookie is sent with cross-site requests; "none" is HTTPS-only.
  COOKIE_SAMESITE: z.enum(["lax", "strict", "none"]).default("lax"),
  // Behind a reverse proxy / PaaS (Render, Fly, nginx) the real client IP and HTTPS come from X-Forwarded-* headers. Defaults to on in production.
  TRUST_PROXY: z.enum(["true", "false"]).optional(),
  PORT: z.coerce.number().default(4000),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  STRIPE_SECRET_KEY: z.string().optional(),
  // Razorpay online payments (UPI / cards). Backend only: the secret never reaches the frontend or the logs.
  RAZORPAY_KEY_ID: z.string().trim().min(1).optional(),
  RAZORPAY_KEY_SECRET: z.string().trim().min(1).optional(),
  RAZORPAY_WEBHOOK_SECRET: z.string().trim().min(1).optional(), // set the same value in Razorpay Dashboard > Webhooks
  RAZORPAY_ALLOW_LIVE: z.enum(["true", "false"]).default("false"), // live keys (rzp_live_) are refused unless this is "true"
  TAX_RATE_BPS: z.coerce.number().int().min(0).default(1800),
  DELIVERY_FEE_MINOR: z.coerce.number().int().min(0).default(2900),
  FREE_DELIVERY_THRESHOLD_MINOR: z.coerce.number().int().min(0).default(39900),
  // Sample (unverified) prices are visible/purchasable only when allowed. Default: allowed in dev, blocked in production.
  ALLOW_SAMPLE_PRICES: z.enum(["true", "false"]).optional(),
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(10).optional(),
  ENABLE_COD: z.enum(["true", "false"]).default("true"),
  PINCODE_API_URL: z.string().url().default("https://api.postalpincode.in/pincode"),
  // Geoapify geocoding (server-side): reverse geocoding (pin -> address) and delivery address / PIN search.
  GEOAPIFY_API_KEY: z.string().trim().min(1).optional(),
  // Google sign-in. OAuth client IDs are public. GOOGLE_CLIENT_ID is the Web client (the website); the Android / iOS ones are for the mobile app.
  // Leave them all unset to hide the "Continue with Google" buttons.
  GOOGLE_CLIENT_ID: z.string().trim().min(1).optional(),
  GOOGLE_ANDROID_CLIENT_ID: z.string().trim().min(1).optional(),
  GOOGLE_IOS_CLIENT_ID: z.string().trim().min(1).optional(),
  GEOAPIFY_URL: z.string().url().default("https://api.geoapify.com"),
  // AI voice shopping assistant (OpenAI Realtime over WebRTC). Backend only: the permanent key never reaches the browser, which gets a short-lived client secret.
  // Leave OPENAI_API_KEY unset to hide the voice assistant.
  OPENAI_API_KEY: z.string().trim().min(1).optional(),
  OPENAI_REALTIME_MODEL: z.string().trim().min(1).default("gpt-realtime"),
  OPENAI_REALTIME_VOICE: z.string().trim().min(1).default("marin"),
  OPENAI_BASE_URL: z.string().url().default("https://api.openai.com"),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error("Invalid environment configuration:", parsed.error.flatten().fieldErrors);
  process.exit(1);
}
export const env = parsed.data;
if (env.NODE_ENV === "production") {
  // Never fall back to (or start with) a local database in production; the message contains no credentials.
  const problem = productionDbUrlProblem(process.env.DATABASE_URL);
  if (problem) {
    console.error("Invalid environment configuration:", problem, JSON.stringify(describeDbUrl(process.env.DATABASE_URL)));
    process.exit(1);
  }
  console.log("[db] DATABASE_URL", JSON.stringify(describeDbUrl(process.env.DATABASE_URL)));
  // Not fatal (checkout still works with a typed address), but without it address search and pin -> address silently stop working.
  if (!env.GEOAPIFY_API_KEY) console.warn("[geo] GEOAPIFY_API_KEY is not set: address search and reverse geocoding are disabled. Set it in Render > Environment.");
}
export const clientOrigins = (() => {
  try {
    return allowedOrigins(parseOrigins(env.CLIENT_ORIGIN), env.NODE_ENV);
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  }
})();
export const clientOriginPatterns = (() => {
  try {
    return parseOriginPatterns(env.CLIENT_ORIGIN_PATTERNS);
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  }
})();
export const trustProxy = env.TRUST_PROXY ? env.TRUST_PROXY === "true" : env.NODE_ENV === "production" || process.env.RENDER === "true"; // Render sets RENDER=true
export const allowSamplePrices = env.ALLOW_SAMPLE_PRICES ? env.ALLOW_SAMPLE_PRICES === "true" : env.NODE_ENV !== "production";
