import Redis from "ioredis";

/**
 * Redis client factory.
 *
 * Creates Redis connections for pub/sub and general operations.
 * In production, connects to GCP Memorystore (provisioned in Sprint 1 infra).
 */

function getRedisUrl(): string {
  return process.env["REDIS_URL"] ?? "redis://localhost:6379";
}

/** Lazily initialized Redis client for general operations (get/set/publish). */
let generalClient: Redis | null = null;

export function getRedis(): Redis {
  if (!generalClient) {
    generalClient = new Redis(getRedisUrl(), {
      maxRetriesPerRequest: 3,
      retryStrategy(times) {
        const delay = Math.min(times * 200, 5000);
        return delay;
      },
      lazyConnect: true,
    });

    generalClient.on("error", (err) => {
      console.error("[Redis] Connection error:", err.message);
    });

    generalClient.on("connect", () => {
      console.log("[Redis] Connected");
    });

    void generalClient.connect();
  }
  return generalClient;
}

/**
 * Create a dedicated Redis client for subscriptions.
 * Subscriber clients cannot be used for other commands while subscribed.
 */
export function createSubscriber(): Redis {
  const subscriber = new Redis(getRedisUrl(), {
    maxRetriesPerRequest: 3,
    retryStrategy(times) {
      const delay = Math.min(times * 200, 5000);
      return delay;
    },
    lazyConnect: true,
  });

  subscriber.on("error", (err) => {
    console.error("[Redis:Sub] Connection error:", err.message);
  });

  void subscriber.connect();
  return subscriber;
}

/** Gracefully close all Redis connections. */
export async function closeRedis(): Promise<void> {
  if (generalClient) {
    await generalClient.quit();
    generalClient = null;
  }
}
