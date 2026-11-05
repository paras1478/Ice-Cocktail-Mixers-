import express from "express";
import fs from "node:fs";
import path from "node:path";
import helmet from "helmet";
import cors from "cors";
import { isOriginAllowed } from "./lib/origins.js";
import cookieParser from "cookie-parser";
import rateLimit from "express-rate-limit";
import { allowSamplePrices, clientOriginPatterns, clientOrigins, env, trustProxy } from "./lib/env.js";
import { publicProductWhere } from "./lib/publish.js";
import { paymentRouter, razorpayWebhook } from "./routes/payments.js";
import { prisma } from "./lib/db.js";
import { classifyDbError } from "./lib/dbHealth.js";
import { authRouter } from "./routes/auth.js";
import { addressRouter } from "./routes/addresses.js";
import { productRouter, categoryRouter, searchRouter } from "./routes/catalog.js";
import { cartRouter } from "./routes/cart.js";
import { orderRouter } from "./routes/orders.js";
import { publicRouter, adminRouter } from "./routes/misc.js";
import { errorHandler, notFound } from "./middleware/error.js";

const warnedOrigins = new Set<string>();

export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  // same-origin-allow-popups (not helmet's default same-origin): keeps the opener link to Google's sign-in popup so it can report "closed" without COOP console warnings.
  app.use(helmet({ crossOriginOpenerPolicy: { policy: "same-origin-allow-popups" } }));
  // Product photos live in the web client (client/public/img). Serving them here lets the mobile app load "/img/..." from the API host (when the folder is deployed alongside).
  const imgDir = path.resolve(process.cwd(), "../client/public/img");
  if (fs.existsSync(imgDir)) app.use("/img", express.static(imgDir, { maxAge: "7d", index: false }));
  if (trustProxy) app.set("trust proxy", 1); // so per-IP rate limits see the real client IP behind Render/nginx
  app.use(
    cors({
      // Requests without an Origin header (same-site, curl, health checks) are allowed; browsers must come from a listed origin.
      origin: (origin, cb) => {
        const ok = !origin || isOriginAllowed(origin, clientOrigins, clientOriginPatterns);
        if (!ok && !warnedOrigins.has(origin)) {
          warnedOrigins.add(origin); // once per origin; origins are public values, not secrets
          console.warn(`[cors] blocked origin ${origin}. Allowed: ${clientOrigins.join(", ")}. Add it to CLIENT_ORIGIN (comma-separated), or match it with CLIENT_ORIGIN_PATTERNS.`);
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
      res.json({ ok: true, db: true, categories, products, visibleProducts, bundles, samplePricesVisible: allowSamplePrices });
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
