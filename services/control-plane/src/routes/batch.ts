/**
 * Batch operation routes.
 *
 * Two route groups:
 *
 *   Agent batch (/agents/batch):
 *     POST /create          -- Bulk create agents
 *     POST /update-status   -- Bulk update agent status
 *     POST /delete          -- Bulk soft-delete agents
 *
 *   Session batch (/agents/:agentId/sessions/batch):
 *     POST /close-stale     -- Bulk close stale sessions
 */

import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { parseBody } from "../lib/validate.js";
import { checkAgentAccess } from "../lib/permissions.js";
import {
  bulkCreateAgents,
  bulkUpdateAgentStatus,
  bulkDeleteAgents,
  bulkCloseStaleSessions,
} from "../lib/batch.js";
import { writeAuditLog } from "../lib/audit.js";
import type { AppEnv } from "../types/env.js";

// =============================================================================
// Agent batch routes
// =============================================================================

export const agentBatchRoutes = new Hono<AppEnv>();

const agentFrameworks = [
  "google_adk",
  "langgraph",
  "crewai",
  "autogen",
  "openai_sdk",
  "custom",
] as const;

const agentStatuses = [
  "draft",
  "running",
  "paused",
  "stopped",
  "error",
  "archived",
] as const;

const bulkCreateSchema = z.object({
  agents: z
    .array(
      z.object({
        name: z.string().min(1).max(255),
        description: z.string().max(2000).optional(),
        framework: z.enum(agentFrameworks).default("custom"),
        model_config: z.record(z.unknown()).default({}),
        system_prompt: z.string().max(100000).optional(),
        tags: z.array(z.string()).default([]),
        metadata: z.record(z.unknown()).default({}),
      }),
    )
    .min(1)
    .max(100),
});

const bulkUpdateStatusSchema = z.object({
  updates: z
    .array(
      z.object({
        agent_id: z.string().uuid(),
        status: z.enum(agentStatuses),
      }),
    )
    .min(1)
    .max(100),
});

const bulkDeleteSchema = z.object({
  agent_ids: z.array(z.string().uuid()).min(1).max(100),
});

/** POST /create -- Bulk create agents. */
agentBatchRoutes.post("/create", async (c) => {
  const user = c.get("user");
  const body = parseBody(bulkCreateSchema, await c.req.json());

  const result = await bulkCreateAgents(user.id, body.agents);

  await writeAuditLog(
    {
      action: "batch.agents_created",
      resourceType: "agent",
      resourceId: "batch",
      evidence: {
        total: result.total,
        succeeded: result.succeeded,
        failed: result.failed,
      },
    },
    c,
  );

  return c.json(result, 201);
});

/** POST /update-status -- Bulk update agent status. */
agentBatchRoutes.post("/update-status", async (c) => {
  const user = c.get("user");
  const body = parseBody(bulkUpdateStatusSchema, await c.req.json());

  const result = await bulkUpdateAgentStatus(user.id, body.updates);

  await writeAuditLog(
    {
      action: "batch.agents_status_updated",
      resourceType: "agent",
      resourceId: "batch",
      evidence: {
        total: result.total,
        succeeded: result.succeeded,
        failed: result.failed,
      },
    },
    c,
  );

  return c.json(result);
});

/** POST /delete -- Bulk soft-delete agents. */
agentBatchRoutes.post("/delete", async (c) => {
  const user = c.get("user");
  const body = parseBody(bulkDeleteSchema, await c.req.json());

  const result = await bulkDeleteAgents(user.id, body.agent_ids);

  await writeAuditLog(
    {
      action: "batch.agents_deleted",
      resourceType: "agent",
      resourceId: "batch",
      evidence: {
        total: result.total,
        succeeded: result.succeeded,
        failed: result.failed,
      },
    },
    c,
  );

  return c.json(result);
});

// =============================================================================
// Session batch routes (under /agents/:agentId/sessions/batch)
// =============================================================================

export const sessionBatchRoutes = new Hono<AppEnv>();

/** Extract and validate the agentId path parameter from the parent route. */
function getAgentId(c: { req: { param: (name: string) => string | undefined } }): string {
  const agentId = c.req.param("agentId");
  if (!agentId) {
    throw new HTTPException(400, { message: "Missing agentId parameter" });
  }
  return agentId;
}

const closeStaleSchema = z.object({
  stale_threshold_minutes: z.number().int().min(1).max(43200).default(60),
});

/** POST /close-stale -- Bulk close stale sessions. Requires editor+ access. */
sessionBatchRoutes.post("/close-stale", async (c) => {
  const user = c.get("user");
  const agentId = getAgentId(c);
  const body = parseBody(closeStaleSchema, await c.req.json());

  await checkAgentAccess(user.id, agentId, "editor");

  const result = await bulkCloseStaleSessions(
    agentId,
    user.id,
    body.stale_threshold_minutes,
  );

  await writeAuditLog(
    {
      action: "batch.sessions_closed",
      resourceType: "agent_session",
      resourceId: "batch",
      agentId,
      evidence: {
        total: result.total,
        succeeded: result.succeeded,
        stale_threshold_minutes: body.stale_threshold_minutes,
      },
    },
    c,
  );

  return c.json(result);
});
