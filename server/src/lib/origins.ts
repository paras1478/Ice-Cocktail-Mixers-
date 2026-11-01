/** The standard Vite dev-server and preview origins. Allowed automatically in development only, so a local frontend can always reach a local API. */
export const DEV_ORIGINS = ["http://localhost:5173", "http://127.0.0.1:5173", "http://localhost:4173", "http://127.0.0.1:4173"];

/** CLIENT_ORIGIN plus, in development only, the local Vite origins. Production allows exactly what CLIENT_ORIGIN lists. */
export function allowedOrigins(configured: string[], nodeEnv: string): string[] {
  return nodeEnv === "development" ? [...new Set([...configured, ...DEV_ORIGINS])] : configured;
}

/**
 * Parses CLIENT_ORIGIN into the list of allowed browser origins.
 * Accepts one origin or a list separated by commas, spaces or newlines, and tolerates what people actually paste: a trailing slash
 * ("https://app.vercel.app/"), a path, or stray spaces. A browser sends the Origin header WITHOUT a trailing slash,
 * so a value with one would never match and every request would be blocked by CORS.
 */
export function parseOrigins(raw: string): string[] {
  const out: string[] = [];
  for (const part of raw.split(/[\s,]+/)) { // commas, spaces and newlines all separate origins
    const v = part.trim();
    if (!v) continue;
    let origin: string;
    try {
      origin = new URL(v).origin;
    } catch {
      throw new Error(`CLIENT_ORIGIN contains an invalid URL: "${v}"`);
    }
    if (!out.includes(origin)) out.push(origin);
  }
  return out;
}
