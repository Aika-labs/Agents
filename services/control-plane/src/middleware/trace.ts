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
  const route = c.req.routePath ?? path;
  const status = c.res.status;

  const labels = { method, route, status: String(status) };

  httpRequestsTotal.inc(labels);
  httpRequestDuration.observe({ method, route }, durationSec);

  if (status >= 400) {
    httpErrorsTotal.inc({ method, route, status: String(status) });
  }

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
