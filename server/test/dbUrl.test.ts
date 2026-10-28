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
