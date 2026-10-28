import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { ZodType } from "zod";
import { HttpError } from "./errors.js";

export const ah =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    fn(req, res, next).catch(next);
  };

export function parse<T>(schema: ZodType<T>, data: unknown): T {
  const r = schema.safeParse(data);
  if (!r.success) {
    // Keyed by field path ("address.pincode") so forms can show errors next to the right field.
    const details: Record<string, string[]> = {};
    for (const i of r.error.issues) (details[i.path.join(".") || "_"] ??= []).push(i.message);
    throw new HttpError(400, "Validation failed", details);
  }
  return r.data;
}
