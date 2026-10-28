import express from "express";
import helmet from "helmet";
import cors from "cors";
import cookieParser from "cookie-parser";
import rateLimit from "express-rate-limit";
import { clientOrigins, env, trustProxy } from "./lib/env.js";
import { prisma } from "./lib/db.js";
import { authRouter } from "./routes/auth.js";
import { addressRouter } from "./routes/addresses.js";
import { productRouter, categoryRouter, searchRouter } from "./routes/catalog.js";
import { cartRouter } from "./routes/cart.js";
import { orderRouter } from "./routes/orders.js";
import { publicRouter, adminRouter } from "./routes/misc.js";
import { errorHandler, notFound } from "./middleware/error.js";

export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.use(helmet());
  if (trustProxy) app.set("trust proxy", 1); // so per-IP rate limits see the real client IP behind Render/nginx
  app.use(
    cors({
      // Requests without an Origin header (same-site, curl, health checks) are allowed; browsers must come from a listed origin.
      origin: (origin, cb) => cb(null, !origin || clientOrigins.includes(origin)),
      credentials: true,
    }),
  );
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
      res.json({ ok: true, db: true, categories });
    } catch (e) {
      const code = (e as { code?: string }).code ?? (e as Error).name;
      const hint =
        code === "P2021" || code === "P2022" ? "The database is reachable but its tables are missing or outdated: run `npx prisma migrate deploy` against it."
        : code === "PrismaClientInitializationError" || /^P100\d$/.test(code) ? "The database cannot be reached or rejected the login: check DATABASE_URL."
        : "Database query failed: see the server logs.";
      res.status(503).json({ ok: false, db: false, code, hint });
    }
  });
  app.use("/api/auth", authRouter);
  app.use("/api/addresses", addressRouter);
  app.use("/api/products", productRouter);
  app.use("/api/categories", categoryRouter);
  app.use("/api/search", searchRouter);
  app.use("/api/cart", cartRouter);
  app.use("/api/orders", orderRouter);
  app.use("/api/admin", adminRouter);
  app.use("/api", publicRouter);

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
