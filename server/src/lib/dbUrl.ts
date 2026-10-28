/** Returns a safe (credential-free) problem description when DATABASE_URL must not be used in production, otherwise null. */
export function productionDbUrlProblem(url: string | undefined): string | null {
  if (!url) return "DATABASE_URL is not set. Set it in the hosting environment to your PostgreSQL connection string.";
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
