import { serve } from "@hono/node-server";
import { app } from "./app.js";
import { logger } from "./lib/logger.js";
import { getRedis } from "./lib/redis.js";

const port = parseInt(process.env["PORT"] ?? "8080", 10);

const server = serve({ fetch: app.fetch, port }, (info) => {
  logger.info(`Control Plane API listening on port ${info.port}`);
});

// -- Graceful shutdown --------------------------------------------------------
// On SIGTERM/SIGINT, stop accepting new connections, drain in-flight requests,
// close Redis, and exit cleanly. Cloud Run sends SIGTERM before stopping.

let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;

  logger.info(`Received ${signal}, starting graceful shutdown...`);

  // Stop accepting new connections.
  server.close(() => {
    logger.info("HTTP server closed");
  });

  // Close Redis connection.
  try {
    const redis = getRedis();
    await redis.quit();
    logger.info("Redis connection closed");
  } catch {
    // Redis may not be connected; ignore.
  }

  // Allow in-flight requests a grace period (10s).
  const GRACE_PERIOD_MS = 10_000;
  setTimeout(() => {
    logger.warn("Grace period expired, forcing exit");
    process.exit(1);
  }, GRACE_PERIOD_MS).unref();

  logger.info("Graceful shutdown complete");
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
