import { Hono } from "hono";
import { cors } from "hono/cors";
import { errorHandler } from "./middleware/error-handler.js";
import { authMiddleware } from "./middleware/auth.js";
import { apiKeyMiddleware } from "./middleware/api-key.js";
import { requestIdMiddleware } from "./middleware/request-id.js";
import { traceMiddleware } from "./middleware/trace.js";
import { securityHeaders } from "./middleware/security-headers.js";
import { ipRateLimiter, userRateLimiter } from "./middleware/rate-limit.js";
import { agentRoutes } from "./routes/agents.js";
import { sessionRoutes } from "./routes/sessions.js";
import { featureFlagRoutes } from "./routes/feature-flags.js";
import { auditRoutes } from "./routes/audit.js";
import { memoryRoutes } from "./routes/memory.js";
import { permissionRoutes } from "./routes/permissions.js";
import { approvalRoutes, hitlPolicyRoutes } from "./routes/hitl.js";
import { evalSuiteRoutes, evalCaseRoutes, evalRunRoutes } from "./routes/evals.js";
import {
  connectorRoutes,
  pipelineRoutes,
  pipelineStepRoutes,
  pipelineRunRoutes,
} from "./routes/pipelines.js";
import {
  templateRoutes,
  templateVersionRoutes,
  deploymentRoutes,
} from "./routes/templates.js";
import { agentAnalyticsRoutes, ownerAnalyticsRoutes } from "./routes/analytics.js";
import { healthRoutes } from "./routes/health.js";
import type { AppEnv } from "./types/env.js";

const app = new Hono<AppEnv>();

// -- Global middleware (runs on every request) --------------------------------

app.use("*", requestIdMiddleware);
app.use("*", traceMiddleware);
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
app.use("/templates/*", apiKeyMiddleware);
app.use("/templates", apiKeyMiddleware);
app.use("/analytics/*", apiKeyMiddleware);
app.use("/analytics", apiKeyMiddleware);

app.use("/agents/*", authMiddleware);
app.use("/agents", authMiddleware);
app.use("/sessions/*", authMiddleware);
app.use("/sessions", authMiddleware);
app.use("/feature-flags/*", authMiddleware);
app.use("/feature-flags", authMiddleware);
app.use("/audit-logs/*", authMiddleware);
app.use("/audit-logs", authMiddleware);
app.use("/templates/*", authMiddleware);
app.use("/templates", authMiddleware);
app.use("/analytics/*", authMiddleware);
app.use("/analytics", authMiddleware);

// Per-user rate limit on authenticated routes.
app.use("/agents/*", userRateLimiter);
app.use("/agents", userRateLimiter);
app.use("/sessions/*", userRateLimiter);
app.use("/sessions", userRateLimiter);
app.use("/feature-flags/*", userRateLimiter);
app.use("/feature-flags", userRateLimiter);
app.use("/audit-logs/*", userRateLimiter);
app.use("/audit-logs", userRateLimiter);
app.use("/templates/*", userRateLimiter);
app.use("/templates", userRateLimiter);
app.use("/analytics/*", userRateLimiter);
app.use("/analytics", userRateLimiter);

// Mount route groups.
app.route("/agents", agentRoutes);
app.route("/sessions", sessionRoutes);
app.route("/feature-flags", featureFlagRoutes);
app.route("/audit-logs", auditRoutes);

// Analytics routes: owner-level dashboard (user-scoped).
app.route("/analytics", ownerAnalyticsRoutes);

// Template routes: templates and versions (user-scoped, not agent-scoped).
app.route("/templates", templateRoutes);
app.route("/templates/:templateId/versions", templateVersionRoutes);

// Permissions routes: /agents/:agentId/permissions/*
// Auth middleware on /agents/* already covers these paths.
app.route("/agents/:agentId/permissions", permissionRoutes);

// HITL routes: approval requests and policies under /agents/:agentId/*.
app.route("/agents/:agentId/approvals", approvalRoutes);
app.route("/agents/:agentId/hitl-policies", hitlPolicyRoutes);

// Eval routes: test suites, cases, and runs under /agents/:agentId/evals/*.
app.route("/agents/:agentId/evals/suites", evalSuiteRoutes);
app.route("/agents/:agentId/evals/suites/:suiteId/cases", evalCaseRoutes);
app.route("/agents/:agentId/evals/runs", evalRunRoutes);

// Data pipeline routes: connectors, pipelines, steps, and runs under /agents/:agentId/data/*.
app.route("/agents/:agentId/data/connectors", connectorRoutes);
app.route("/agents/:agentId/data/pipelines", pipelineRoutes);
app.route("/agents/:agentId/data/pipelines/:pipelineId/steps", pipelineStepRoutes);
app.route("/agents/:agentId/data/runs", pipelineRunRoutes);

// Agent-scoped analytics routes: per-agent metrics under /agents/:agentId/analytics/*.
app.route("/agents/:agentId/analytics", agentAnalyticsRoutes);

// Deployment routes: deployment lifecycle under /agents/:agentId/deployments/*.
app.route("/agents/:agentId/deployments", deploymentRoutes);

// Memory routes use nested paths under /agents/:agentId/... so mount at root.
// Auth middleware on /agents/* already covers these paths.
app.route("/", memoryRoutes);

export { app };
