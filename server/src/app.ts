import express from "express";
import helmet from "helmet";
import cors from "cors";
import cookieParser from "cookie-parser";
import rateLimit from "express-rate-limit";
import { env } from "./lib/env.js";
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
  app.use(cors({ origin: env.CLIENT_ORIGIN, credentials: true }));
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
