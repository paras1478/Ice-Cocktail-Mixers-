import axios, { AxiosError } from "axios";

/**
 * Resolves the API base URL from VITE_API_URL (set at BUILD time; it is public, never put secrets in it).
 *  - unset / empty  -> "/api" (same-origin: the Vite dev proxy locally, or a host rewrite such as vercel.json in production)
 *  - "https://host"  -> "https://host/api"  (the backend serves everything under /api, so it is added when missing)
 *  - "https://host/" -> "https://host/api"
 *  - "https://host/api" is used as is
 */
export function resolveApiBase(raw: string | undefined): string {
  const v = (raw ?? "").trim().replace(/\/+$/, "");
  if (!v) return "/api";
  return /\/api$/.test(v) ? v : `${v}/api`;
}

export const API_BASE = resolveApiBase(import.meta.env.VITE_API_URL);

// 45 s: a free Render instance can take 30-60 s to wake up on the first request after idling.
export const api = axios.create({ baseURL: API_BASE, withCredentials: true, timeout: 45000 });

/** The API only ever answers JSON. An HTML page means the request hit a web server instead of the API (wrong VITE_API_URL, or no rewrite). */
api.interceptors.response.use((res) => {
  if (typeof res.data === "string" && /^\s*<(!doctype|html)/i.test(res.data))
    throw new Error(`The API returned a web page instead of data. Check that VITE_API_URL points to the backend (currently "${API_BASE}").`);
  return res;
});

export interface ApiErrorInfo {
  message: string;
  status?: number;
  /** Field-level messages keyed by field path, e.g. "address.pincode". */
  fields: Record<string, string>;
}

/**
 * Pulls a readable message out of an error response body. The backend sends { error: string }, but proxies and hosts
 * (e.g. Vercel: { error: { code, message } }) send other shapes; anything that is not text is never returned as-is,
 * because rendering an object in React would crash the page.
 */
export function messageFromBody(data: unknown): string | undefined {
  if (!data || typeof data !== "object") return undefined;
  const body = data as { error?: unknown; message?: unknown };
  if (typeof body.error === "string" && body.error) return body.error;
  if (body.error && typeof body.error === "object" && typeof (body.error as { message?: unknown }).message === "string") return (body.error as { message: string }).message;
  if (typeof body.message === "string" && body.message) return body.message;
  return undefined;
}

/** Turns any thrown value into a message a customer can read. Real API errors are never replaced by a fake success. */
export function apiError(e: unknown): ApiErrorInfo {
  if (axios.isAxiosError(e)) {
    const err = e as AxiosError<{ error?: unknown; details?: unknown }>;
    const status = err.response?.status;
    const fields: Record<string, string> = {};
    const d = err.response?.data?.details;
    if (d && typeof d === "object" && !Array.isArray(d))
      for (const [k, v] of Object.entries(d as Record<string, unknown>)) if (Array.isArray(v) && typeof v[0] === "string") fields[k.replace(/^address\./, "")] = v[0];
    if (!err.response)
      return { message: err.code === "ECONNABORTED" ? "The server took too long to respond (it may be waking up). Please try again." : "Can't reach the server. Check your connection and try again.", fields };
    const text = messageFromBody(err.response.data);
    if (status === 502 || status === 503 || status === 504) return { message: text ?? `Can't reach the API server (HTTP ${status}). Make sure the backend is running.`, status, fields };
    return { message: text ?? `Request failed (HTTP ${status})`, status, fields };
  }
  return { message: e instanceof Error ? e.message : "Something went wrong", fields: {} };
}
