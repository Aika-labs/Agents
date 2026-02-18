import { Hono } from "hono";
import { logger } from "hono/logger";
import { cors } from "hono/cors";
import { errorHandler } from "./middleware/error-handler.js";
import { authMiddleware } from "./middleware/auth.js";
import { apiKeyMiddleware } from "./middleware/api-key.js";
import { requestIdMiddleware } from "./middleware/request-id.js";
import { securityHeaders } from "./middleware/security-headers.js";
import { ipRateLimiter, userRateLimiter } from "./middleware/rate-limit.js";
import { agentRoutes } from "./routes/agents.js";
import { sessionRoutes } from "./routes/sessions.js";
import { featureFlagRoutes } from "./routes/feature-flags.js";
import { auditRoutes } from "./routes/audit.js";
import { healthRoutes } from "./routes/health.js";
import type { AppEnv } from "./types/env.js";

const app = new Hono<AppEnv>();

// -- Global middleware (runs on every request) --------------------------------

app.use("*", requestIdMiddleware);
app.use("*", logger());
app.use(
  "*",
  cors({
    origin: process.env["CORS_ORIGIN"]?.split(",") ?? "*",
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization", "X-Request-Id", "X-API-Key"],
    exposeHeaders: ["X-Request-Id", "X-RateLimit-Limit", "X-RateLimit-Remaining", "Retry-After"],
    maxAge: 86400,
  }),
);
app.use("*", securityHeaders);
app.use("*", ipRateLimiter);
app.onError(errorHandler);

// -- Public routes (no auth required) -----------------------------------------

app.route("/health", healthRoutes);

// -- Protected routes (API key OR JWT auth required) --------------------------
// API key middleware runs first: if X-API-Key is present and valid, it sets
// the user in context and the JWT middleware becomes a no-op.

app.use("/agents/*", apiKeyMiddleware);
app.use("/agents", apiKeyMiddleware);
app.use("/sessions/*", apiKeyMiddleware);
app.use("/sessions", apiKeyMiddleware);
app.use("/feature-flags/*", apiKeyMiddleware);
app.use("/feature-flags", apiKeyMiddleware);
app.use("/audit-logs/*", apiKeyMiddleware);
app.use("/audit-logs", apiKeyMiddleware);

app.use("/agents/*", authMiddleware);
app.use("/agents", authMiddleware);
app.use("/sessions/*", authMiddleware);
app.use("/sessions", authMiddleware);
app.use("/feature-flags/*", authMiddleware);
app.use("/feature-flags", authMiddleware);
app.use("/audit-logs/*", authMiddleware);
app.use("/audit-logs", authMiddleware);

// Per-user rate limit on authenticated routes.
app.use("/agents/*", userRateLimiter);
app.use("/agents", userRateLimiter);
app.use("/sessions/*", userRateLimiter);
app.use("/sessions", userRateLimiter);
app.use("/feature-flags/*", userRateLimiter);
app.use("/feature-flags", userRateLimiter);
app.use("/audit-logs/*", userRateLimiter);
app.use("/audit-logs", userRateLimiter);

// Mount route groups.
app.route("/agents", agentRoutes);
app.route("/sessions", sessionRoutes);
app.route("/feature-flags", featureFlagRoutes);
app.route("/audit-logs", auditRoutes);

export { app };
