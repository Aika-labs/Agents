/**
 * Analytics Dashboard routes.
 *
 * Two route groups:
 *
 *   Agent-scoped (/agents/:agentId/analytics):
 *     GET /summary          -- Dashboard summary for one agent
 *     GET /time-series      -- Time-series metrics
 *     GET /daily            -- Daily usage breakdown
 *
 *   Owner-scoped (/analytics):
 *     GET /summary          -- Aggregate summary across all agents
 *     GET /top-agents       -- Top agents by dimension (tokens, sessions, cost, errors)
 */

import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { parseQuery } from "../lib/validate.js";
import { checkAgentAccess } from "../lib/permissions.js";
import {
  getDashboardSummary,
  getTimeSeries,
  getDailyUsage,
  getOwnerSummary,
  getTopAgents,
} from "../lib/analytics.js";
import type { AppEnv } from "../types/env.js";

/** Extract and validate the agentId path parameter from the parent route. */
function getAgentId(c: { req: { param: (name: string) => string | undefined } }): string {
  const agentId = c.req.param("agentId");
  if (!agentId) {
    throw new HTTPException(400, { message: "Missing agentId parameter" });
  }
  return agentId;
}

// =============================================================================
// Shared schemas
// =============================================================================

/** Default date range: last 30 days. */
function defaultFrom(): string {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  return d.toISOString().slice(0, 10);
}

function defaultTo(): string {
  return new Date().toISOString().slice(0, 10);
}

const periods = ["hourly", "daily", "weekly", "monthly"] as const;

const summaryQuery = z.object({
  period: z.enum(periods).default("daily"),
  from: z.string().default(defaultFrom()),
  to: z.string().default(defaultTo()),
});

const timeSeriesQuery = z.object({
  period: z.enum(periods).default("daily"),
  from: z.string().default(defaultFrom()),
  to: z.string().default(defaultTo()),
});

const dailyQuery = z.object({
  from: z.string().default(defaultFrom()),
  to: z.string().default(defaultTo()),
});

const topAgentsQuery = z.object({
  dimension: z.enum(["tokens", "sessions", "cost", "errors"]).default("tokens"),
  from: z.string().default(defaultFrom()),
  to: z.string().default(defaultTo()),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

// =============================================================================
// Agent-scoped analytics routes
// =============================================================================

export const agentAnalyticsRoutes = new Hono<AppEnv>();

/** GET /summary -- Dashboard summary for one agent. Requires viewer+ access. */
agentAnalyticsRoutes.get("/summary", async (c) => {
  const user = c.get("user");
  const agentId = getAgentId(c);
  const query = parseQuery(summaryQuery, c.req.query());

  await checkAgentAccess(user.id, agentId, "viewer");

  const summary = await getDashboardSummary(agentId, query.period, query.from, query.to);

  return c.json({ agent_id: agentId, ...summary });
});

/** GET /time-series -- Time-series metrics. Requires viewer+ access. */
agentAnalyticsRoutes.get("/time-series", async (c) => {
  const user = c.get("user");
  const agentId = getAgentId(c);
  const query = parseQuery(timeSeriesQuery, c.req.query());

  await checkAgentAccess(user.id, agentId, "viewer");

  const series = await getTimeSeries(agentId, query.period, query.from, query.to);

  return c.json({
    agent_id: agentId,
    period: query.period,
    from: query.from,
    to: query.to,
    data: series,
  });
});

/** GET /daily -- Daily usage breakdown. Requires viewer+ access. */
agentAnalyticsRoutes.get("/daily", async (c) => {
  const user = c.get("user");
  const agentId = getAgentId(c);
  const query = parseQuery(dailyQuery, c.req.query());

  await checkAgentAccess(user.id, agentId, "viewer");

  const usage = await getDailyUsage(agentId, query.from, query.to);

  return c.json({
    agent_id: agentId,
    from: query.from,
    to: query.to,
    data: usage,
  });
});

// =============================================================================
// Owner-scoped analytics routes
// =============================================================================

export const ownerAnalyticsRoutes = new Hono<AppEnv>();

/** GET /summary -- Aggregate summary across all agents for the current user. */
ownerAnalyticsRoutes.get("/summary", async (c) => {
  const user = c.get("user");
  const query = parseQuery(dailyQuery, c.req.query());

  const summary = await getOwnerSummary(user.id, query.from, query.to);

  return c.json(summary);
});

/** GET /top-agents -- Top agents ranked by a metric dimension. */
ownerAnalyticsRoutes.get("/top-agents", async (c) => {
  const user = c.get("user");
  const query = parseQuery(topAgentsQuery, c.req.query());

  const top = await getTopAgents(
    user.id,
    query.dimension,
    query.from,
    query.to,
    query.limit,
  );

  return c.json({
    dimension: query.dimension,
    from: query.from,
    to: query.to,
    data: top,
  });
});
