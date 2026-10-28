/** Returns a safe (credential-free) problem description when DATABASE_URL must not be used in production, otherwise null. */
export function productionDbUrlProblem(url: string | undefined): string | null {
  if (!url) return "DATABASE_URL is not set. Set it in the hosting environment to your PostgreSQL connection string.";
  if (url !== url.trim() || /^["']|["']$/.test(url) || /^\s*DATABASE_URL\s*=/i.test(url))
    return "DATABASE_URL has surrounding spaces or quotes, or includes the name \"DATABASE_URL=\". In Render paste only the value itself, with no quotes.";
  if (!/^postgres(ql)?:\/\//i.test(url)) return "DATABASE_URL must start with postgresql:// (this app uses PostgreSQL).";
  let host = "";
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return "DATABASE_URL is not a valid URL.";
  }
  if (["localhost", "127.0.0.1", "::1", "[::1]", "0.0.0.0"].includes(host))
    return "DATABASE_URL points to a local database (localhost). In production use your hosted PostgreSQL URL (on Render: the Internal Database URL).";
  return null;
}

/** Safe, credential-free summary of DATABASE_URL for startup logs: presence, scheme, hostname and obvious formatting mistakes only. */
export function describeDbUrl(url: string | undefined) {
  if (!url) return { present: false };
  const scheme = /^([a-z][a-z0-9+.-]*):\/\//i.exec(url.trim().replace(/^["']/, ""))?.[1]?.toLowerCase() ?? null; // scheme only, never the rest
  const valid = /^postgres(ql)?:\/\//i.test(url);
  let host: string | null = null;
  if (valid) {
    try {
      host = new URL(url).hostname.toLowerCase();
    } catch {
      host = null;
    }
  }
  return {
    present: true,
    startsWithPostgres: valid,
    scheme: valid ? undefined : scheme,
    hostname: host,
    hasWhitespaceAroundValue: url !== url.trim(),
    hasWrappingQuotes: /^["']|["']$/.test(url.trim()),
    looksLikeNamePrefix: /^\s*DATABASE_URL\s*=/i.test(url),
  };
}
