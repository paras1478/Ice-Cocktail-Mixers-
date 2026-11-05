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

/**
 * Parses CLIENT_ORIGIN_PATTERNS: origins whose FIRST host label contains one "*", e.g. "https://ice-cocktail-*-team-abc123.vercel.app"
 * (Vercel preview URLs change on every deploy). Strict on purpose: https only; the "*" stays inside the first label (it can never match
 * a dot, a port or another domain); the text AFTER the "*" in that label (your team/project suffix) must be at least 6 characters, so a
 * bare prefix like "https://ice-*.vercel.app" or "https://*.vercel.app" (every Vercel project) is rejected.
 */
export function parseOriginPatterns(raw: string | undefined): RegExp[] {
  const out: RegExp[] = [];
  const escape = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  for (const part of (raw ?? "").split(/[\s,]+/)) {
    const v = part.trim().replace(/\/+$/, "").toLowerCase();
    if (!v) continue;
    const m = /^https:\/\/([a-z0-9-]*)\*([a-z0-9-]{6,})((?:\.[a-z0-9-]+){2,})$/.exec(v);
    if (!m) throw new Error(`CLIENT_ORIGIN_PATTERNS contains an unsafe or invalid pattern: "${part.trim()}"`);
    out.push(new RegExp(`^https://${escape(m[1])}[a-z0-9-]*${escape(m[2])}${escape(m[3])}$`));
  }
  return out;
}

/** True when the browser's Origin header is allowed: an exact configured origin, or a match of a (strict) pattern. */
export function isOriginAllowed(origin: string, exact: string[], patterns: RegExp[]): boolean {
  return exact.includes(origin) || patterns.some((re) => re.test(origin));
}
