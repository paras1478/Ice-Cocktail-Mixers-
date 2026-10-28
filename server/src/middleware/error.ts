import type { NextFunction, Request, Response } from "express";
import { HttpError } from "../lib/errors.js";
import { env } from "../lib/env.js";

export function notFound(_req: Request, res: Response) {
  res.status(404).json({ error: "Not found" });
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, ...(err.details ? { details: err.details } : {}) });
  const e = err as { type?: string; status?: number };
  if (e?.type === "entity.parse.failed") return res.status(400).json({ error: "Invalid JSON body" });
  if (e?.type === "entity.too.large") return res.status(413).json({ error: "Request body too large" });
  if (env.NODE_ENV !== "test") console.error(err);
  res.status(500).json({ error: "Something went wrong. Please try again." });
}
