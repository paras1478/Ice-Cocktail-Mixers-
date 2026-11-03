import { Platform } from "react-native";
import Constants from "expo-constants";

/**
 * API base URL. Set EXPO_PUBLIC_API_URL (e.g. https://your-backend.onrender.com) in mobile/.env.
 * Without it, the dev machine running Expo is used (the Metro host IP, which a real phone can reach),
 * falling back to the Android emulator alias / localhost.
 */
function resolveBase(): string {
  const env = (process.env.EXPO_PUBLIC_API_URL ?? "").trim().replace(/\/+$/, "");
  if (env) return /\/api$/.test(env) ? env : `${env}/api`;
  const host = Constants.expoConfig?.hostUri?.split(":")[0];
  if (host) return `http://${host}:4000/api`;
  return Platform.OS === "android" ? "http://10.0.2.2:4000/api" : "http://localhost:4000/api";
}
export const API_BASE = resolveBase();
/** Image URLs from the API are often site-relative ("/img/..."): serve them from the web origin. */
export const ASSET_BASE = (process.env.EXPO_PUBLIC_ASSET_URL ?? "").trim().replace(/\/+$/, "") || API_BASE.replace(/\/api$/, "");
export const imageUrl = (u?: string | null) => (!u ? undefined : /^https?:/i.test(u) ? u : `${ASSET_BASE}${u.startsWith("/") ? "" : "/"}${u}`);
