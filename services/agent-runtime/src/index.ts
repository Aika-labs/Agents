import { serve } from "@hono/node-server";
import { app, startCommandSubscriber } from "./app.js";
import { closeRedis } from "./redis/client.js";

const port = parseInt(process.env["PORT"] ?? "8081", 10);

// Start the HTTP server.
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`Agent Runtime API listening on port ${info.port}`);
});

// Start the Redis command subscriber (listens for control-plane commands).
const subscriber = startCommandSubscriber();

// Graceful shutdown.
const shutdown = async () => {
  console.log("[Runtime] Shutting down...");
  await subscriber.unsubscribe();
  await closeRedis();
  process.exit(0);
};

process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());
