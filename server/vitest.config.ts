import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    env: {
      NODE_ENV: "test",
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/icemixers_ci?schema=public",
      JWT_SECRET: "test-secret-0123456789abcdef0123456789abcdef",
      ENABLE_COD: "true",
      // Fake credentials for the payment tests (the Razorpay API is mocked); never real keys
      RAZORPAY_KEY_ID: "rzp_test_unitkey",
      RAZORPAY_KEY_SECRET: "unit_test_secret_value",
      RAZORPAY_WEBHOOK_SECRET: "unit_webhook_secret",
      OPENAI_API_KEY: "sk-test-not-a-real-key", // the OpenAI API is mocked in tests; a developer's real key from .env is never used
      CLIENT_ORIGIN: "http://localhost:5173", // pinned so tests never depend on a developer's local .env
    },
    fileParallelism: false,
    testTimeout: 20000,
  },
});
