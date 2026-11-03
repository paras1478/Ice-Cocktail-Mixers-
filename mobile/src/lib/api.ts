import axios from "axios";
import * as SecureStore from "expo-secure-store";
import { API_BASE } from "./config";

const TOKEN_KEY = "icx_token";
let token: string | null = null;

export async function loadToken() {
  try { token = await SecureStore.getItemAsync(TOKEN_KEY); } catch { token = null; }
  return token;
}
export async function saveToken(t: string | null) {
  token = t;
  try { if (t) await SecureStore.setItemAsync(TOKEN_KEY, t); else await SecureStore.deleteItemAsync(TOKEN_KEY); } catch { /* storage unavailable */ }
}

export const api = axios.create({ baseURL: API_BASE, timeout: 45000 });
api.interceptors.request.use((cfg) => {
  if (token) cfg.headers.set("Authorization", `Bearer ${token}`);
  return cfg;
});

/** Turns any thrown value into a message a customer can read. */
export function errMsg(e: unknown): string {
  if (axios.isAxiosError(e)) {
    if (!e.response) return e.code === "ECONNABORTED" ? "The server took too long to respond. Please try again." : `Can't reach the server (${API_BASE}). Check your connection.`;
    const d = e.response.data as { error?: unknown; details?: Record<string, string[]> } | undefined;
    const first = d?.details && Object.values(d.details).find((v) => Array.isArray(v) && v[0])?.[0];
    if (typeof d?.error === "string") return first ? `${d.error}: ${first}` : d.error;
    return `Request failed (HTTP ${e.response.status})`;
  }
  return e instanceof Error ? e.message : "Something went wrong";
}
