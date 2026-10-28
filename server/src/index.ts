import { createApp } from "./app.js";
import { env } from "./lib/env.js";

const server = createApp().listen(env.PORT, () => console.log(`API listening on http://localhost:${env.PORT}`));

// A clear message instead of a stack trace when the port is taken (usually a second copy of the API is already running).
server.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EADDRINUSE") {
    console.error(`\nPort ${env.PORT} is already in use: another copy of the API is probably running.\nStop it (or set a different PORT in server/.env) and start again.\n`);
    process.exit(1);
  }
  throw err;
});
