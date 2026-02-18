import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";
import type { AppEnv } from "../types/env.js";

/**
 * In-memory sliding window rate limiter.
 *
 * Tracks request timestamps per key (IP or user ID) and enforces a maximum
 * number of requests within a rolling time window.
 *
 * Production note: Replace with Redis-backed implementation (ZRANGEBYSCORE)
 * for multi-instance deployments on Cloud Run.
 */

interface RateLimitConfig {
  /** Maximum requests allowed within the window. */
  maxRequests: number;
  /** Window duration in milliseconds. */
  windowMs: number;
  /** Key extractor: returns the rate-limit key for a request. */
  keyFn: (c: Context<AppEnv>) => string;
  /** Optional prefix for the Retry-After header message. */
  label?: string;
}

interface WindowEntry {
  timestamps: number[];
}

const stores = new Map<string, Map<string, WindowEntry>>();

/** Periodic cleanup interval (5 minutes). */
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

function getStore(storeId: string): Map<string, WindowEntry> {
  let store = stores.get(storeId);
  if (!store) {
    store = new Map();
    stores.set(storeId, store);

    // Schedule periodic cleanup to prevent memory leaks.
    const interval = setInterval(() => {
      const now = Date.now();
      for (const [key, entry] of store!) {
        // Remove entries with no recent timestamps.
        if (
          entry.timestamps.length === 0 ||
          entry.timestamps[entry.timestamps.length - 1]! < now - CLEANUP_INTERVAL_MS
        ) {
          store!.delete(key);
        }
      }
    }, CLEANUP_INTERVAL_MS);

    // Allow the process to exit without waiting for the interval.
    interval.unref();
  }
  return store;
}

function slidingWindowCheck(
  store: Map<string, WindowEntry>,
  key: string,
  maxRequests: number,
  windowMs: number,
): { allowed: boolean; remaining: number; resetMs: number } {
  const now = Date.now();
  const windowStart = now - windowMs;

  let entry = store.get(key);
  if (!entry) {
    entry = { timestamps: [] };
    store.set(key, entry);
  }

  // Prune timestamps outside the window.
  entry.timestamps = entry.timestamps.filter((t) => t > windowStart);

  if (entry.timestamps.length >= maxRequests) {
    // Rate limited. Calculate when the oldest request in the window expires.
    const oldestInWindow = entry.timestamps[0]!;
    const resetMs = oldestInWindow + windowMs - now;
    return {
      allowed: false,
      remaining: 0,
      resetMs: Math.max(resetMs, 0),
    };
  }

  entry.timestamps.push(now);
  return {
    allowed: true,
    remaining: maxRequests - entry.timestamps.length,
    resetMs: windowMs,
  };
}

/**
 * Create a rate-limiting middleware with the given configuration.
 *
 * Sets standard rate-limit headers on every response:
 * - X-RateLimit-Limit
 * - X-RateLimit-Remaining
 * - Retry-After (only on 429)
 */
export function rateLimiter(config: RateLimitConfig) {
  const storeId = config.label ?? "default";

  return async (c: Context<AppEnv>, next: Next): Promise<void> => {
    const store = getStore(storeId);
    const key = config.keyFn(c);

    const { allowed, remaining, resetMs } = slidingWindowCheck(
      store,
      key,
      config.maxRequests,
      config.windowMs,
    );

    // Always set rate-limit headers.
    c.header("X-RateLimit-Limit", String(config.maxRequests));
    c.header("X-RateLimit-Remaining", String(remaining));

    if (!allowed) {
      const retryAfterSec = Math.ceil(resetMs / 1000);
      c.header("Retry-After", String(retryAfterSec));
      throw new HTTPException(429, {
        message: `Rate limit exceeded. Try again in ${retryAfterSec}s.`,
      });
    }

    await next();
  };
}

// -- Pre-configured limiters --------------------------------------------------

/**
 * Extract client IP from X-Forwarded-For (Cloud Run sets this) or fall back
 * to a generic key.
 */
function getClientIp(c: Context<AppEnv>): string {
  return (
    c.req.header("X-Forwarded-For")?.split(",")[0]?.trim() ?? "unknown"
  );
}

/**
 * IP-based rate limiter: 100 requests per minute.
 * Applied globally to all routes.
 */
export const ipRateLimiter = rateLimiter({
  maxRequests: 100,
  windowMs: 60 * 1000,
  keyFn: (c) => `ip:${getClientIp(c)}`,
  label: "ip",
});

/**
 * User-based rate limiter: 200 requests per minute.
 * Applied after auth middleware (uses authenticated user ID).
 */
export const userRateLimiter = rateLimiter({
  maxRequests: 200,
  windowMs: 60 * 1000,
  keyFn: (c) => {
    try {
      const user = c.get("user");
      return `user:${user.id}`;
    } catch {
      // Fallback to IP if no user in context.
      return `ip:${getClientIp(c)}`;
    }
  },
  label: "user",
});

/**
 * Strict rate limiter for sensitive operations (kill switch, model swap).
 * 10 requests per minute per user.
 */
export const strictRateLimiter = rateLimiter({
  maxRequests: 10,
  windowMs: 60 * 1000,
  keyFn: (c) => {
    try {
      const user = c.get("user");
      return `strict:${user.id}`;
    } catch {
      return `strict:${getClientIp(c)}`;
    }
  },
  label: "strict",
});
