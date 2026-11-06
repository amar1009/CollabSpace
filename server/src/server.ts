import { createServer } from "node:http";
import { config } from "./config/index.js";
import { db } from "./models/db.js";
import { logger } from "./utils/logger.js";
import { createApp } from "./app.js";
import { CollaborationHub } from "./websocket/hub.js";
const server = createServer(createApp());
const hub = new CollaborationHub(server);
await db.$connect();
server.listen(config.PORT, "0.0.0.0", () =>
  logger.info(
    { port: config.PORT },
    "CollabSpace API and collaboration server ready",
  ),
);
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  const deadline = setTimeout(() => process.exit(1), 15000).unref();
  server.close();
  try {
    await hub.close();
    await db.$disconnect();
    clearTimeout(deadline);
    process.exit(0);
  } catch {
    logger.error("Graceful shutdown failed");
    process.exit(1);
  }
}
process.on("SIGINT", () => void stop());
process.on("SIGTERM", () => void stop());
