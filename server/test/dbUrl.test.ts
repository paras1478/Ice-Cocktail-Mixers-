import { describe, expect, it } from "vitest";
import { productionDbUrlProblem } from "../src/lib/dbUrl.js";

describe("production DATABASE_URL guard", () => {
  it("rejects missing, non-PostgreSQL and local URLs without echoing credentials", () => {
    for (const bad of [undefined, "", "mongodb+srv://u:secretpw@c.mongodb.net/", "postgresql://u:secretpw@localhost:5432/x", "postgres://u:secretpw@127.0.0.1:5432/x", "postgresql://u:secretpw@[::1]:5432/x"]) {
      const msg = productionDbUrlProblem(bad);
      expect(msg, String(bad)).toBeTruthy();
      expect(msg).not.toContain("secretpw");
    }
  });
  it("accepts a hosted PostgreSQL URL", () => {
    expect(productionDbUrlProblem("postgresql://u:p@dpg-abc123-a/icemixers")).toBeNull();
    expect(productionDbUrlProblem("postgresql://u:p@dpg-abc123-a.oregon-postgres.render.com/icemixers?sslmode=require")).toBeNull();
  });
});

import { describeDbUrl } from "../src/lib/dbUrl.js";
describe("DATABASE_URL diagnostic", () => {
  it("reports only presence, scheme, hostname and format mistakes, never credentials or query", () => {
    const ok = JSON.stringify(describeDbUrl("postgresql://user:secretpw@dpg-abc-a.oregon-postgres.render.com/db?sslmode=require&x=secretq"));
    expect(ok).toContain("dpg-abc-a.oregon-postgres.render.com");
    expect(ok).not.toMatch(/secretpw|secretq|user/);
    const bad = JSON.stringify(describeDbUrl('"postgresql://user:secretpw@host/db"'));
    expect(bad).toContain('"hasWrappingQuotes":true');
    expect(JSON.stringify(describeDbUrl("mongodb+srv://u:secretpw@c.mongodb.net/"))).not.toContain("secretpw");
    expect(describeDbUrl(undefined)).toEqual({ present: false });
    expect(productionDbUrlProblem('"postgresql://u:p@dpg-x/db"')).toMatch(/quotes/);
    expect(productionDbUrlProblem(" postgresql://u:p@dpg-x/db")).toMatch(/spaces/);
  });
});
