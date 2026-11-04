import path from "node:path";
import { SessionStore } from "./session-store.js";
import { loadConfig } from "./config.js";
import { createDatabase } from "./db.js";
import { createApp } from "./app.js";
try {
  const config = loadConfig(),
    pool = createDatabase(config.database);
  const sessions = await new SessionStore({
    file: path.resolve(config.stateDir, "sessions.json"),
    secret: config.secret,
  }).load();
  const app = createApp({ pool, config, sessions });
  const server = app.listen(config.port, config.host, () =>
    console.log(`Cashpay Admin écoute sur ${config.host}:${config.port}`),
  );
  function close() {
    server.close(() => pool.end().then(() => process.exit(0)));
    setTimeout(() => process.exit(1), 10000).unref();
  }
  process.once("SIGTERM", close);
  process.once("SIGINT", close);
} catch (error) {
  console.error("[startup]", error.message);
  process.exitCode = 1;
}
