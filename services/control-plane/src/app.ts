import { Hono } from "hono";
import { logger } from "hono/logger";
import { cors } from "hono/cors";
import { errorHandler } from "./middleware/error-handler.js";
import { agentRoutes } from "./routes/agents.js";
import { sessionRoutes } from "./routes/sessions.js";
import { featureFlagRoutes } from "./routes/feature-flags.js";
import { auditRoutes } from "./routes/audit.js";
import { healthRoutes } from "./routes/health.js";

const app = new Hono();

// Global middleware.
app.use("*", logger());
app.use("*", cors());
app.onError(errorHandler);

// Mount route groups.
app.route("/health", healthRoutes);
app.route("/agents", agentRoutes);
app.route("/sessions", sessionRoutes);
app.route("/feature-flags", featureFlagRoutes);
app.route("/audit-logs", auditRoutes);

export { app };
