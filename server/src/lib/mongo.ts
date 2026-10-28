import mongoose, { Schema, type Connection, type Model } from "mongoose";
import { env } from "./env.js";
import { AccountStoreUnavailable, DuplicateAccountError, type Account, type CredentialStore } from "../services/accounts.js";

/** Removes credentials from anything that could contain a connection string, so it is safe to log. */
export function sanitize(text: unknown): string {
  return String(text instanceof Error ? text.message : text).replace(/(mongodb(?:\+srv)?:\/\/)[^@\s/]*@/gi, "$1<credentials>@").slice(0, 300);
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const userSchema = new Schema(
  {
    // The same id as the user's profile row in PostgreSQL (orders, carts and addresses reference it there).
    _id: { type: String, required: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 254, match: EMAIL_RE },
    name: { type: String, required: true, trim: true, maxlength: 80 },
    phone: { type: String, default: null },
    // bcrypt hash only. Plain passwords, OTPs and tokens are never stored.
    passwordHash: { type: String, required: true },
  },
  { timestamps: true, collection: "users", versionKey: false },
);

type UserDoc = { _id: string; email: string; name: string; phone: string | null; passwordHash: string };
const toAccount = (d: UserDoc): Account => ({ id: d._id, email: d.email, name: d.name, phone: d.phone ?? null, passwordHash: d.passwordHash });

/** Classifies a Mongo failure into a fixed, secret-free reason (used by /api/health/db and logs). */
export function mongoReason(e: unknown): { reason: "BAD_URI" | "AUTH_FAILED" | "UNREACHABLE" | "OTHER"; hint: string } {
  const err = e as { name?: string; code?: number | string; message?: string };
  const msg = String(err?.message ?? "");
  if (err?.name === "MongoParseError" || /Invalid scheme|Invalid connection string|must be a valid/i.test(msg))
    return { reason: "BAD_URI", hint: "MONGODB_URI is not a valid MongoDB connection string (it must start with mongodb:// or mongodb+srv://)." };
  if (err?.code === 18 || err?.code === 13 || /Authentication failed|bad auth|not authorized/i.test(msg))
    return { reason: "AUTH_FAILED", hint: "Atlas rejected the username or password in MONGODB_URI, or the user cannot access this database. Check Database Access in Atlas." };
  if (err?.name === "MongoServerSelectionError" || err?.name === "MongoNetworkError" || /ENOTFOUND|ECONNREFUSED|timed out|querySrv|Server selection/i.test(msg))
    return { reason: "UNREACHABLE", hint: "Atlas cannot be reached from this server. Check Network Access in Atlas (allow Render's outbound IPs, or 0.0.0.0/0) and the cluster host in MONGODB_URI." };
  return { reason: "OTHER", hint: "MongoDB error: see the server logs (credentials are never logged)." };
}

/** User credentials in MongoDB Atlas (database MONGODB_DB, collection "users"). The connection is opened lazily and reused. */
export class MongoCredentialStore implements CredentialStore {
  readonly kind = "mongodb";
  private conn: Connection | null = null;
  private model: Model<UserDoc> | null = null;
  private ready: Promise<Model<UserDoc>> | null = null;

  constructor(private readonly uri: string, private readonly dbName: string) {}

  private open(): Promise<Model<UserDoc>> {
    this.ready ??= (async () => {
      const conn = mongoose.createConnection(this.uri, { dbName: this.dbName, serverSelectionTimeoutMS: 8000, maxPoolSize: 5 });
      conn.on("error", (e) => console.error("[mongodb] connection error:", sanitize(e)));
      try {
        await conn.asPromise();
        const model = conn.model<UserDoc>("User", userSchema);
        await model.init(); // builds the unique email index
        this.conn = conn;
        this.model = model;
        return model;
      } catch (e) {
        await conn.close().catch(() => undefined);
        this.ready = null; // allow a later retry
        throw e;
      }
    })();
    return this.ready;
  }

  /** Runs a store operation, turning connection problems into a safe 503 and logging a credential-free diagnostic. */
  private async run<T>(fn: (m: Model<UserDoc>) => Promise<T>): Promise<T> {
    try {
      return await fn(await this.open());
    } catch (e) {
      if (e instanceof DuplicateAccountError) throw e;
      if ((e as { code?: number }).code === 11000) throw new DuplicateAccountError();
      console.error("[mongodb] operation failed:", mongoReason(e).reason, "-", sanitize(e));
      throw new AccountStoreUnavailable();
    }
  }

  async connect() {
    await this.open();
  }
  async ping(): Promise<void> {
    await this.open();
    await this.conn!.db!.admin().command({ ping: 1 });
  }
  async close() {
    await this.conn?.close();
    this.conn = this.model = this.ready = null;
  }

  findByEmail(email: string) {
    return this.run(async (m) => {
      const d = await m.findOne({ email: email.trim().toLowerCase() }).lean<UserDoc>();
      return d ? toAccount(d) : null;
    });
  }
  findById(id: string) {
    return this.run(async (m) => {
      const d = await m.findById(id).lean<UserDoc>();
      return d ? toAccount(d) : null;
    });
  }
  insert(a: Account) {
    return this.run(async (m) => {
      await m.create({ _id: a.id, email: a.email, name: a.name, phone: a.phone, passwordHash: a.passwordHash });
    });
  }
  update(id: string, patch: Partial<Pick<Account, "name" | "phone" | "passwordHash">>) {
    return this.run(async (m) => {
      await m.updateOne({ _id: id }, { $set: patch });
    });
  }
  remove(id: string) {
    return this.run(async (m) => {
      await m.deleteOne({ _id: id });
    });
  }
}

/** Builds the store from the environment, or null when MONGODB_URI is not set (PostgreSQL-only accounts, as before). */
export function createMongoStoreFromEnv(): MongoCredentialStore | null {
  // Tests never touch a real cluster, even when a developer's local .env contains MONGODB_URI.
  return env.MONGODB_URI && env.NODE_ENV !== "test" ? new MongoCredentialStore(env.MONGODB_URI, env.MONGODB_DB) : null;
}
