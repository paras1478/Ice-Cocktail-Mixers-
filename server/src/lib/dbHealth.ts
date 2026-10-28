export interface DbDiagnosis {
  /** Prisma error code or error class name. */
  code: string;
  /** Stable machine-readable cause. */
  reason: "NOT_POSTGRES_URL" | "UNREACHABLE" | "AUTH_FAILED" | "DATABASE_MISSING" | "SSL_REQUIRED" | "TABLES_MISSING" | "UNKNOWN";
  /** What to do. Fixed text only: never contains the connection string, host or credentials. */
  hint: string;
}

/**
 * Classifies a failed database call so a broken deployment can be diagnosed from outside (GET /api/health/db).
 * Only the error CODE/CLASS and a fixed hint are returned; Prisma's raw message (which can contain hosts) is never exposed.
 */
export function classifyDbError(err: unknown): DbDiagnosis {
  const e = err as { code?: string; name?: string; message?: string };
  const code = e?.code ?? e?.name ?? "Error";
  const msg = String(e?.message ?? "");
  if (code === "P2021" || code === "P2022")
    return { code, reason: "TABLES_MISSING", hint: "The database is reachable but its tables are missing or outdated: run `npx prisma migrate deploy` against it (the Render build command should do this)." };
  if (/Error validating datasource|URL must start with the protocol/i.test(msg))
    return { code, reason: "NOT_POSTGRES_URL", hint: "DATABASE_URL is not a PostgreSQL URL. It must start with postgresql:// (or postgres://). A MongoDB mongodb:// / mongodb+srv:// URL cannot be used: this app uses PostgreSQL." };
  if (/Authentication failed|password authentication failed|credentials .* are not valid/i.test(msg))
    return { code, reason: "AUTH_FAILED", hint: "The database rejected the username or password in DATABASE_URL. Copy the connection string again from the database dashboard." };
  if (/Database `.*` does not exist|database ".*" does not exist/i.test(msg))
    return { code, reason: "DATABASE_MISSING", hint: "The server is reachable but the database name in DATABASE_URL does not exist. Check the name at the end of the URL." };
  if (/SSL|TLS|certificate/i.test(msg))
    return { code, reason: "SSL_REQUIRED", hint: "The database requires an encrypted connection: add ?sslmode=require to DATABASE_URL (the Render *Internal* URL does not need it)." };
  if (/Can't reach database server|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|timed out|P1001|P1002/i.test(msg) || code === "P1001" || code === "P1002")
    return { code, reason: "UNREACHABLE", hint: "The database server cannot be reached from this service. On Render use the Internal Database URL of a PostgreSQL instance in the same region; for an external database allow Render's outbound IPs." };
  return { code, reason: "UNKNOWN", hint: "Database query failed: see the server logs (Render → Logs) for the underlying error." };
}
