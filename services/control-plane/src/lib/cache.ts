/**
 * Redis-backed cache layer.
 *
 * Provides:
 *   - Namespaced key management for multi-tenant isolation.
 *   - get/set/invalidate with configurable TTL.
 *   - Cache-aside pattern helper (fetch from cache, fallback to loader).
 *   - Bulk invalidation by prefix (e.g., invalidate all agent-related keys).
 *   - JSON serialization/deserialization.
 */

import { getRedis } from "./redis.js";
import { logger } from "./logger.js";

// =============================================================================
// Configuration
// =============================================================================

/** Default TTL in seconds (5 minutes). */
const DEFAULT_TTL_SECONDS = 300;

/** Global key prefix for all cache entries. */
const KEY_PREFIX = "cache:";

// =============================================================================
// Key management
// =============================================================================

/**
 * Build a namespaced cache key.
 *
 * Format: cache:{namespace}:{key}
 * Example: cache:agent:abc-123
 */
export function cacheKey(namespace: string, key: string): string {
  return `${KEY_PREFIX}${namespace}:${key}`;
}

/**
 * Build a cache key scoped to a specific user/owner.
 *
 * Format: cache:{namespace}:{ownerId}:{key}
 * Example: cache:agents-list:user-456:page-1
 */
export function ownerCacheKey(namespace: string, ownerId: string, key: string): string {
  return `${KEY_PREFIX}${namespace}:${ownerId}:${key}`;
}

// =============================================================================
// Core operations
// =============================================================================

/**
 * Get a cached value by key.
 *
 * Returns null if the key doesn't exist or has expired.
 */
export async function cacheGet<T>(key: string): Promise<T | null> {
  try {
    const redis = getRedis();
    const raw = await redis.get(key);
    if (raw === null) return null;
    return JSON.parse(raw) as T;
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown cache error";
    logger.warn("Cache get failed", { key, error: msg });
    return null;
  }
}

/**
 * Set a cached value with optional TTL.
 *
 * @param key - Full cache key (use cacheKey() or ownerCacheKey() to build).
 * @param value - Value to cache (will be JSON-serialized).
 * @param ttlSeconds - Time-to-live in seconds (default: 300).
 */
export async function cacheSet<T>(
  key: string,
  value: T,
  ttlSeconds: number = DEFAULT_TTL_SECONDS,
): Promise<void> {
  try {
    const redis = getRedis();
    const serialized = JSON.stringify(value);
    await redis.set(key, serialized, "EX", ttlSeconds);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown cache error";
    logger.warn("Cache set failed", { key, error: msg });
  }
}

/**
 * Invalidate (delete) a specific cache key.
 */
export async function cacheInvalidate(key: string): Promise<void> {
  try {
    const redis = getRedis();
    await redis.del(key);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown cache error";
    logger.warn("Cache invalidate failed", { key, error: msg });
  }
}

/**
 * Invalidate all cache keys matching a prefix.
 *
 * Uses SCAN to avoid blocking Redis on large keyspaces.
 * Example: cacheInvalidatePrefix("cache:agent:abc-123") removes all
 * keys starting with that prefix.
 */
export async function cacheInvalidatePrefix(prefix: string): Promise<number> {
  try {
    const redis = getRedis();
    let cursor = "0";
    let deleted = 0;

    do {
      const [nextCursor, keys] = await redis.scan(
        cursor,
        "MATCH",
        `${prefix}*`,
        "COUNT",
        100,
      );
      cursor = nextCursor;

      if (keys.length > 0) {
        await redis.del(...keys);
        deleted += keys.length;
      }
    } while (cursor !== "0");

    return deleted;
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown cache error";
    logger.warn("Cache prefix invalidation failed", { prefix, error: msg });
    return 0;
  }
}

// =============================================================================
// Cache-aside pattern
// =============================================================================

/**
 * Cache-aside helper: try cache first, fall back to loader on miss.
 *
 * On cache miss, calls the loader function, caches the result, and returns it.
 * On cache hit, returns the cached value without calling the loader.
 *
 * @param key - Full cache key.
 * @param loader - Async function that fetches the data on cache miss.
 * @param ttlSeconds - TTL for the cached value.
 */
export async function cacheAside<T>(
  key: string,
  loader: () => Promise<T>,
  ttlSeconds: number = DEFAULT_TTL_SECONDS,
): Promise<T> {
  // Try cache first.
  const cached = await cacheGet<T>(key);
  if (cached !== null) {
    return cached;
  }

  // Cache miss -- load from source.
  const value = await loader();

  // Cache the result (fire-and-forget).
  void cacheSet(key, value, ttlSeconds);

  return value;
}

// =============================================================================
// Convenience helpers for common patterns
// =============================================================================

/**
 * Invalidate all cache entries for a specific agent.
 *
 * Call this after any mutation to agent data (update, delete, etc.).
 */
export async function invalidateAgentCache(agentId: string): Promise<void> {
  await cacheInvalidatePrefix(cacheKey("agent", agentId));
}

/**
 * Invalidate all cache entries for a specific owner's list queries.
 *
 * Call this after mutations that affect list results (create, delete).
 */
export async function invalidateOwnerListCache(
  ownerId: string,
  namespace: string = "list",
): Promise<void> {
  await cacheInvalidatePrefix(ownerCacheKey(namespace, ownerId, ""));
}

/**
 * Get cache stats (approximate key count and memory usage).
 */
export async function getCacheStats(): Promise<{
  keyCount: number;
  memoryUsed: string;
}> {
  try {
    const redis = getRedis();
    const info = await redis.info("memory");
    const dbSize = await redis.dbsize();

    // Parse used_memory_human from INFO output.
    const memMatch = info.match(/used_memory_human:(\S+)/);
    const memoryUsed = memMatch ? memMatch[1] : "unknown";

    return { keyCount: dbSize, memoryUsed };
  } catch {
    return { keyCount: 0, memoryUsed: "unknown" };
  }
}
