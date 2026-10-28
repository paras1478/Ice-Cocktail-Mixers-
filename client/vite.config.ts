/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// The dev server and `vite preview` proxy /api to the backend (override with API_PROXY_TARGET).
// In production serve the built client and the API behind one domain (see README).
const target = process.env.API_PROXY_TARGET ?? "http://localhost:4000";

const proxy = {
  "/api": {
    target,
    changeOrigin: true,
    // Backend not running: answer with a clear JSON error (the app shows it) instead of a stack trace per request.
    configure: (p: { on: (ev: "error", cb: (err: Error, req: unknown, res: unknown) => void) => void }) => {
      p.on("error", (_err, _req, res) => {
        const r = res as { writeHead?: (s: number, h: Record<string, string>) => void; end: (b: string) => void; headersSent?: boolean };
        if (r.writeHead && !r.headersSent) {
          r.writeHead(502, { "Content-Type": "application/json" });
          r.end(JSON.stringify({ error: "Can't reach the API server. Start the backend (npm run dev) and try again." }));
        }
      });
    },
  },
};

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 5173, proxy },
  preview: { port: 4173, proxy },
  test: { environment: "jsdom", globals: true, setupFiles: ["./src/setupTests.ts"], css: false },
});
