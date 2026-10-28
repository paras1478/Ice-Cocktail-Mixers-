import axios, { AxiosError } from "axios";

// Same-origin /api in production; the Vite dev server proxies it. Set VITE_API_URL only when the API lives elsewhere.
export const api = axios.create({ baseURL: import.meta.env.VITE_API_URL ?? "/api", withCredentials: true, timeout: 20000 });

export interface ApiErrorInfo {
  message: string;
  status?: number;
  /** Field-level messages keyed by field path, e.g. "address.pincode". */
  fields: Record<string, string>;
}

/** Turns any thrown value into a message a customer can read. Real API errors are never replaced by a fake success. */
export function apiError(e: unknown): ApiErrorInfo {
  if (axios.isAxiosError(e)) {
    const err = e as AxiosError<{ error?: string; details?: unknown }>;
    const status = err.response?.status;
    const fields: Record<string, string> = {};
    const d = err.response?.data?.details;
    if (d && typeof d === "object" && !Array.isArray(d))
      for (const [k, v] of Object.entries(d as Record<string, unknown>)) if (Array.isArray(v) && typeof v[0] === "string") fields[k.replace(/^address\./, "")] = v[0];
    if (!err.response) return { message: err.code === "ECONNABORTED" ? "The server took too long to respond. Please try again." : "Can't reach the server. Check your connection and try again.", fields };
    if (status === 502 || status === 503 || status === 504)
      return { message: err.response.data?.error ?? "Can't reach the API server (HTTP " + status + "). Make sure the backend is running.", status, fields };
    return { message: err.response.data?.error ?? `Request failed (HTTP ${status})`, status, fields };
  }
  return { message: e instanceof Error ? e.message : "Something went wrong", fields: {} };
}
