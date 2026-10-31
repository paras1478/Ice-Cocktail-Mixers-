import express from "express";
import helmet from "helmet";
import cors from "cors";
import cookieParser from "cookie-parser";
import rateLimit from "express-rate-limit";
import { allowSamplePrices, clientOrigins, env, trustProxy } from "./lib/env.js";
import { publicProductWhere } from "./lib/publish.js";
import { paymentRouter, razorpayWebhook } from "./routes/payments.js";
import { prisma } from "./lib/db.js";
import { classifyDbError } from "./lib/dbHealth.js";
import { createMongoStoreFromEnv, mongoReason, sanitize } from "./lib/mongo.js";
import { credentialStore, setCredentialStore } from "./services/accounts.js";
import { authRouter } from "./routes/auth.js";
import { addressRouter } from "./routes/addresses.js";
import { productRouter, categoryRouter, searchRouter } from "./routes/catalog.js";
import { cartRouter } from "./routes/cart.js";
import { orderRouter } from "./routes/orders.js";
import { publicRouter, adminRouter } from "./routes/misc.js";
import { errorHandler, notFound } from "./middleware/error.js";

const warnedOrigins = new Set<string>();

export function createApp() {
  // Optional MongoDB Atlas credential store (MONGODB_URI). Connection problems are logged without credentials and never crash the server.
  if (!credentialStore()) {
    const mongo = createMongoStoreFromEnv();
    if (mongo) {
      setCredentialStore(mongo);
      mongo.connect().then(
        () => console.log("[mongodb] connected: user accounts are stored in MongoDB Atlas"),
        (e) => console.error("[mongodb] could not connect:", mongoReason(e).reason, "-", sanitize(e)),
      );
    }
  }
  const app = express();
  app.disable("x-powered-by");
  app.use(helmet());
  if (trustProxy) app.set("trust proxy", 1); // so per-IP rate limits see the real client IP behind Render/nginx
  app.use(
    cors({
      // Requests without an Origin header (same-site, curl, health checks) are allowed; browsers must come from a listed origin.
      origin: (origin, cb) => {
        const ok = !origin || clientOrigins.includes(origin);
        if (!ok && !warnedOrigins.has(origin)) {
          warnedOrigins.add(origin); // once per origin; origins are public values, not secrets
          console.warn(`[cors] blocked origin ${origin}. Allowed: ${clientOrigins.join(", ")}. Add it to CLIENT_ORIGIN (comma-separated) to allow it.`);
        }
        cb(null, ok);
      },
      credentials: true,
    }),
  );
  // The webhook signature covers the exact raw bytes, so it must be parsed before express.json() touches the body.
  app.post(["/api/payments/razorpay/webhook", "/api/webhooks/razorpay"], express.raw({ type: "*/*", limit: "100kb" }), razorpayWebhook);
  app.use(express.json({ limit: "100kb" }));
  app.use(cookieParser());
  if (env.NODE_ENV !== "test") {
    app.use(
      "/api",
      rateLimit({
        windowMs: 60_000,
        limit: env.RATE_LIMIT_PER_MINUTE ?? (env.NODE_ENV === "production" ? 300 : 3000), // dev hot-reload and double fetching burst past production traffic
        standardHeaders: true,
        legacyHeaders: false,
        message: { error: "Too many requests. Please wait a moment and try again." },
      }),
    );
  }

  app.get("/api/health", (_req, res) => res.json({ ok: true }));
  // Readiness check that includes the database. Reports only an error CODE (never connection strings or secrets) so a failing deploy can be diagnosed from outside.
  app.get("/api/health/db", async (_req, res) => {
    try {
      const categories = await prisma.category.count();
      const [products, visibleProducts, bundles] = await Promise.all([prisma.product.count(), prisma.product.count({ where: publicProductWhere() }), prisma.bundle.count()]);
      // Accounts: only reports whether MongoDB answers (never the URI, host or credentials).
      const mongoStore = credentialStore();
      let mongo: { configured: boolean; ok?: boolean; reason?: string; hint?: string } = { configured: false };
      if (mongoStore && "ping" in mongoStore) {
        try {
          await (mongoStore as { ping(): Promise<void> }).ping();
          mongo = { configured: true, ok: true };
        } catch (e) {
          mongo = { configured: true, ok: false, ...mongoReason(e) };
        }
      }
      res.status(mongo.configured && !mongo.ok ? 503 : 200).json({ ok: !mongo.configured || !!mongo.ok, db: true, categories, products, visibleProducts, bundles, samplePricesVisible: allowSamplePrices, mongo });
    } catch (e) {
      res.status(503).json({ ok: false, db: false, ...classifyDbError(e) });
    }
  });
  app.use("/api/auth", authRouter);
  app.use("/api/addresses", addressRouter);
  app.use("/api/products", productRouter);
  app.use("/api/categories", categoryRouter);
  app.use("/api/search", searchRouter);
  app.use("/api/cart", cartRouter);
  app.use("/api/orders", orderRouter);
  app.use("/api/payments", paymentRouter);
  app.use("/api/admin", adminRouter);
  app.use("/api", publicRouter);

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
