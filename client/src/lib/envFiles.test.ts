import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { resolveApiBase } from "./api";

// Guards the environment setup: production builds must call the deployed backend, local development must stay on the local proxy,
// and nothing secret may live in a VITE_ variable (those are bundled into the browser).
const root = path.resolve(__dirname, "../..");
const read = (f: string) => (fs.existsSync(path.join(root, f)) ? fs.readFileSync(path.join(root, f), "utf8") : "");
const value = (text: string, key: string) => text.split(/\r?\n/).filter((l) => !l.trim().startsWith("#")).map((l) => l.match(new RegExp(`^${key}=(.*)$`))?.[1]?.trim()).find((v) => v !== undefined);

describe("frontend environment files", () => {
  it("production builds use the deployed Render backend (with /api added automatically)", () => {
    const url = value(read(".env.production"), "VITE_API_URL");
    expect(url).toBe("https://ice-cocktail-mixers.onrender.com");
    expect(resolveApiBase(url)).toBe("https://ice-cocktail-mixers.onrender.com/api");
  });
  it("local development files use the Vite proxy (empty) or a localhost backend, never the production host", () => {
    for (const f of [".env", ".env.development", ".env.local", ".env.development.local"]) {
      const v = value(read(f), "VITE_API_URL");
      const local = v === undefined || v === "" || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/api)?\/?$/.test(v);
      expect(local, `${f} must not point local development at a remote backend (got "${v}")`).toBe(true);
    }
    expect(resolveApiBase("")).toBe("/api");
    expect(resolveApiBase("http://localhost:4000")).toBe("http://localhost:4000/api");
  });
  it("no VITE_ variable looks like a secret", () => {
    for (const f of [".env", ".env.example", ".env.production"]) {
      for (const line of read(f).split(/\r?\n/)) {
        if (line.trim().startsWith("#") || !line.includes("=")) continue;
        const [k, v] = [line.split("=")[0], line.slice(line.indexOf("=") + 1)];
        expect(k.startsWith("VITE_"), `${f}: ${k}`).toBe(true);
        expect(/secret|password|token|private|key|postgres(ql)?:\/\//i.test(k + v), `${f}: ${k}`).toBe(false);
      }
    }
  });
});
