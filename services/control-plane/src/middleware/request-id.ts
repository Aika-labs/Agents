import type { Context, Next } from "hono";
import type { AppEnv } from "../types/env.js";

/**
 * Request ID middleware.
 *
 * Assigns a unique ID to every request. If the client sends an
 * X-Request-Id header (e.g. from an API gateway or load balancer),
 * that value is reused; otherwise a new crypto-random UUID is generated.
 *
 * The ID is:
 * - Stored in Hono context as `requestId` (available via c.get("requestId"))
 * - Echoed back in the X-Request-Id response header
 * - Used by the audit logger for request correlation
 */
export async function requestIdMiddleware(
  c: Context<AppEnv>,
  next: Next,
): Promise<void> {
  const incoming = c.req.header("X-Request-Id");
  const id = incoming && incoming.length <= 128 ? incoming : crypto.randomUUID();

  c.set("requestId", id);
  c.header("X-Request-Id", id);

  await next();
}
