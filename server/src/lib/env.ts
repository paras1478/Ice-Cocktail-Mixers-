import "dotenv/config";
import { z } from "zod";
import { allowedOrigins, parseOrigins } from "./origins.js";
import { productionDbUrlProblem } from "./dbUrl.js";

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  // Optional. When set, user credentials (email + password hash) are stored in MongoDB Atlas instead of PostgreSQL (orders, carts and
  // addresses stay in PostgreSQL). Keep this value in the backend environment only: never in a VITE_ variable and never in source code.
  MONGODB_URI: z.string().regex(/^mongodb(\+srv)?:\/\//, "MONGODB_URI must start with mongodb:// or mongodb+srv://").optional(),
  MONGODB_DB: z.string().min(1).default("icemixers"),
  JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 characters"),
  // Browser origin(s) allowed by CORS: one value or a comma-separated list, e.g. "https://app.vercel.app,https://staging.vercel.app".
  CLIENT_ORIGIN: z.string().min(1).default("http://localhost:5173"),
  // "lax" when the site and API share a domain (or the API is reached through a /api rewrite). "none" when the frontend and the API are on
  // different sites (e.g. vercel.app + onrender.com) so the login cookie is sent with cross-site requests; "none" is HTTPS-only.
  COOKIE_SAMESITE: z.enum(["lax", "strict", "none"]).default("lax"),
  // Behind a reverse proxy / PaaS (Render, Fly, nginx) the real client IP and HTTPS come from X-Forwarded-* headers. Defaults to on in production.
  TRUST_PROXY: z.enum(["true", "false"]).optional(),
  PORT: z.coerce.number().default(4000),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  STRIPE_SECRET_KEY: z.string().optional(),
  TAX_RATE_BPS: z.coerce.number().int().min(0).default(1800),
  DELIVERY_FEE_MINOR: z.coerce.number().int().min(0).default(2900),
  FREE_DELIVERY_THRESHOLD_MINOR: z.coerce.number().int().min(0).default(39900),
  // Sample (unverified) prices are visible/purchasable only when allowed. Default: allowed in dev, blocked in production.
  ALLOW_SAMPLE_PRICES: z.enum(["true", "false"]).optional(),
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(10).optional(),
  ENABLE_COD: z.enum(["true", "false"]).default("true"),
  PINCODE_API_URL: z.string().url().default("https://api.postalpincode.in/pincode"),
  REVERSE_GEOCODE_URL: z.string().url().default("https://nominatim.openstreetmap.org/reverse"),
  GEOCODER_USER_AGENT: z.string().default("IceCocktailMixersExpress/1.0"),
  SEED_ADMIN_EMAIL: z.string().email().default("admin@example.com"),
  SEED_ADMIN_PASSWORD: z.string().min(8).default("ChangeMe123!"),
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
    console.error("Invalid environment configuration:", problem);
    process.exit(1);
  }
}
export const clientOrigins = (() => {
  try {
    return allowedOrigins(parseOrigins(env.CLIENT_ORIGIN), env.NODE_ENV);
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  }
})();
export const trustProxy = env.TRUST_PROXY ? env.TRUST_PROXY === "true" : env.NODE_ENV === "production" || process.env.RENDER === "true"; // Render sets RENDER=true
export const allowSamplePrices = env.ALLOW_SAMPLE_PRICES ? env.ALLOW_SAMPLE_PRICES === "true" : env.NODE_ENV !== "production";
