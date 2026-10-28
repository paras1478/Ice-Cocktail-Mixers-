import "dotenv/config";
import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 characters"),
  CLIENT_ORIGIN: z.string().url().default("http://localhost:5173"),
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
export const allowSamplePrices = env.ALLOW_SAMPLE_PRICES ? env.ALLOW_SAMPLE_PRICES === "true" : env.NODE_ENV !== "production";
