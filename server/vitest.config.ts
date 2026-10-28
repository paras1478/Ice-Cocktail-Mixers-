import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    env: {
      NODE_ENV: "test",
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/icemixers_ci?schema=public",
      JWT_SECRET: "test-secret-0123456789abcdef0123456789abcdef",
      ENABLE_COD: "true",
      CLIENT_ORIGIN: "http://localhost:5173", // pinned so tests never depend on a developer's local .env
    },
    fileParallelism: false,
    testTimeout: 20000,
  },
});
