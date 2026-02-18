import Redis from "ioredis";

/**
 * Redis client for the Control Plane API.
 *
 * Used for:
 *   - Short-term session memory (key-value with TTL)
 *   - Pub/sub for real-time agent events
 *   - Rate limiter backing store (future)
 *
 * Connection is configured via REDIS_URL environment variable.
 * Falls back to localhost:6379 for local development.
 */

/** Lazily initialized singleton. */
let client: Redis | null = null;

export function getRedis(): Redis {
  if (!client) {
    const url = process.env["REDIS_URL"] ?? "redis://localhost:6379";

    client = new Redis(url, {
      maxRetriesPerRequest: 3,
      retryStrategy(times: number): number | null {
        if (times > 10) return null; // Stop retrying after 10 attempts.
        return Math.min(times * 200, 5000); // Exponential backoff, max 5s.
      },
      lazyConnect: false,
    });

    client.on("error", (err) => {
      console.error("[Redis] Connection error:", err.message);
    });

    client.on("connect", () => {
      console.log("[Redis] Connected");
    });
  }

  return client;
}

/**
 * Gracefully close the Redis connection (for shutdown hooks).
 */
export async function closeRedis(): Promise<void> {
  if (client) {
    await client.quit();
    client = null;
  }
}
