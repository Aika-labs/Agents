import type { Context, Next } from "hono";
import { createChildLogger } from "../lib/logger.js";
import {
  httpRequestsTotal,
  httpRequestDuration,
  httpErrorsTotal,
} from "../lib/metrics.js";
import type { AppEnv } from "../types/env.js";

/**
 * Request tracing middleware.
 *
 * Records per-request metrics and emits a structured log line on completion.
 * Must run after requestIdMiddleware (needs requestId in context).
 *
 * For each request it captures:
 *   - Duration (ms and seconds)
 *   - HTTP method, path, matched route
 *   - Response status code
 *   - Authenticated user ID (if available)
 *   - Request ID for correlation
 *
 * Emits:
 *   - `http_requests_total` counter (method, route, status)
 *   - `http_request_duration_seconds` histogram (method, route)
 *   - `http_errors_total` counter for 4xx/5xx responses
 *   - Structured JSON log line (INFO for 2xx/3xx, WARNING for 4xx, ERROR for 5xx)
 */
export async function traceMiddleware(
  c: Context<AppEnv>,
  next: Next,
): Promise<void> {
  const start = performance.now();

  await next();

  const durationMs = performance.now() - start;
  const durationSec = durationMs / 1000;

  const method = c.req.method;
  const path = c.req.path;
  // Use the matched route pattern if available, otherwise the raw path.
  const route = c.req.routePath ?? path;
  const status = c.res.status;

  // Metric labels.
  const labels = { method, route, status: String(status) };

  // Record metrics.
  httpRequestsTotal.inc(labels);
  httpRequestDuration.observe({ method, route }, durationSec);

  if (status >= 400) {
    httpErrorsTotal.inc({ method, route, status: String(status) });
  }

  // Build structured log context.
  let requestId: string | undefined;
  let userId: string | undefined;
  try {
    requestId = c.get("requestId");
  } catch {
    // requestId middleware not mounted on this route.
  }
  try {
    const user = c.get("user");
    userId = user?.id;
  } catch {
    // No authenticated user (public route).
  }

  const log = createChildLogger({
    requestId,
    userId,
    httpRequest: {
      requestMethod: method,
      requestUrl: path,
      status,
      latency: `${durationSec.toFixed(4)}s`,
      remoteIp:
        c.req.header("X-Forwarded-For")?.split(",")[0]?.trim() ?? undefined,
      userAgent: c.req.header("User-Agent") ?? undefined,
    },
  });

  if (status >= 500) {
    log.error(`${method} ${path} ${status} ${durationMs.toFixed(1)}ms`);
  } else if (status >= 400) {
    log.warn(`${method} ${path} ${status} ${durationMs.toFixed(1)}ms`);
  } else {
    log.info(`${method} ${path} ${status} ${durationMs.toFixed(1)}ms`);
  }
}
