/**
 * Parses CLIENT_ORIGIN into the list of allowed browser origins.
 * Accepts one origin or a comma-separated list, and tolerates what people actually paste: a trailing slash
 * ("https://app.vercel.app/"), a path, or stray spaces. A browser sends the Origin header WITHOUT a trailing slash,
 * so a value with one would never match and every request would be blocked by CORS.
 */
export function parseOrigins(raw: string): string[] {
  const out: string[] = [];
  for (const part of raw.split(",")) {
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
