import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { getSupabase } from "../lib/supabase.js";
import { parseBody, parseQuery } from "../lib/validate.js";
import { writeAuditLog } from "../lib/audit.js";
import { strictRateLimiter } from "../middleware/rate-limit.js";
import type { AgentStatus } from "../types/database.js";
import type { AppEnv } from "../types/env.js";

export const agentRoutes = new Hono<AppEnv>();

// -- Zod schemas --------------------------------------------------------------

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

const createAgentSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(2000).optional(),
  framework: z.enum(agentFrameworks).default("google_adk"),
  model_config: z.record(z.unknown()).default({}),
  system_prompt: z.string().max(50000).optional(),
  tools: z.array(z.unknown()).default([]),
  mcp_servers: z.array(z.unknown()).default([]),
  a2a_config: z.record(z.unknown()).default({}),
  tags: z.array(z.string()).default([]),
  metadata: z.record(z.unknown()).default({}),
});

const updateAgentSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().max(2000).nullable().optional(),
  framework: z.enum(agentFrameworks).optional(),
  model_config: z.record(z.unknown()).optional(),
  system_prompt: z.string().max(50000).nullable().optional(),
  tools: z.array(z.unknown()).optional(),
  mcp_servers: z.array(z.unknown()).optional(),
  a2a_config: z.record(z.unknown()).optional(),
  status: z.enum(agentStatuses).optional(),
  tags: z.array(z.string()).optional(),
  metadata: z.record(z.unknown()).optional(),
});

const listAgentsQuery = z.object({
  status: z.enum(agentStatuses).optional(),
  framework: z.enum(agentFrameworks).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

// -- Valid status transitions -------------------------------------------------

const validTransitions: Record<AgentStatus, AgentStatus[]> = {
  draft: ["running", "archived"],
  running: ["paused", "stopped", "error"],
  paused: ["running", "stopped", "archived"],
  stopped: ["running", "archived"],
  error: ["running", "stopped", "archived"],
  archived: [], // Terminal state.
};

// -- Routes -------------------------------------------------------------------

/** POST / -- Create a new agent. Owner is the authenticated user. */
agentRoutes.post("/", async (c) => {
  const user = c.get("user");
  const body = parseBody(createAgentSchema, await c.req.json());
  const db = getSupabase();

  const { data, error } = await db
    .from("agents")
    .insert({ ...body, owner_id: user.id, status: "draft" as const, version: 1 })
    .select()
    .single();

  if (error) {
    throw new HTTPException(500, { message: error.message });
  }

  await writeAuditLog(
    {
      action: "agent.created",
      resourceType: "agent",
      resourceId: data.id,
      agentId: data.id,
      evidence: { name: body.name, framework: body.framework },
    },
    c,
  );

  return c.json(data, 201);
});

/** GET / -- List agents owned by the authenticated user. */
agentRoutes.get("/", async (c) => {
  const user = c.get("user");
  const query = parseQuery(listAgentsQuery, c.req.query());
  const db = getSupabase();

  let q = db
    .from("agents")
    .select("*", { count: "exact" })
    .eq("owner_id", user.id)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .range(query.offset, query.offset + query.limit - 1);

  if (query.status) q = q.eq("status", query.status);
  if (query.framework) q = q.eq("framework", query.framework);

  const { data, error, count } = await q;

  if (error) {
    throw new HTTPException(500, { message: error.message });
  }

  return c.json({ data, total: count, limit: query.limit, offset: query.offset });
});

/** GET /:id -- Get a single agent by ID (must be owned by user). */
agentRoutes.get("/:id", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const db = getSupabase();

  const { data, error } = await db
    .from("agents")
    .select()
    .eq("id", id)
    .eq("owner_id", user.id)
    .is("deleted_at", null)
    .single();

  if (error || !data) {
    throw new HTTPException(404, { message: "Agent not found" });
  }

  return c.json(data);
});

/** PATCH /:id -- Update an agent. Validates status transitions. */
agentRoutes.patch("/:id", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const body = parseBody(updateAgentSchema, await c.req.json());
  const db = getSupabase();

  // Fetch current state for transition validation and audit evidence.
  const { data: current, error: fetchErr } = await db
    .from("agents")
    .select()
    .eq("id", id)
    .eq("owner_id", user.id)
    .is("deleted_at", null)
    .single();

  if (fetchErr || !current) {
    throw new HTTPException(404, { message: "Agent not found" });
  }

  // Validate status transition if status is being changed.
  if (body.status && body.status !== current.status) {
    const allowed = validTransitions[current.status as AgentStatus] ?? [];
    if (!allowed.includes(body.status)) {
      throw new HTTPException(400, {
        message: `Invalid status transition: ${current.status} -> ${body.status}. Allowed: ${allowed.join(", ") || "none"}`,
      });
    }
  }

  // Bump version on any update.
  const updatePayload = { ...body, version: current.version + 1 };

  const { data, error } = await db
    .from("agents")
    .update(updatePayload)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    throw new HTTPException(500, { message: error.message });
  }

  await writeAuditLog(
    {
      action: body.status ? "agent.status_changed" : "agent.updated",
      resourceType: "agent",
      resourceId: id,
      agentId: id,
      severity: body.status === "error" ? "warning" : "info",
      evidence: {
        before: { status: current.status, version: current.version },
        after: { status: data.status, version: data.version },
        changes: Object.keys(body),
      },
    },
    c,
  );

  return c.json(data);
});

/** DELETE /:id -- Soft-delete an agent (sets deleted_at). */
agentRoutes.delete("/:id", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const db = getSupabase();

  const { data: current, error: fetchErr } = await db
    .from("agents")
    .select("id, owner_id, name, status")
    .eq("id", id)
    .eq("owner_id", user.id)
    .is("deleted_at", null)
    .single();

  if (fetchErr || !current) {
    throw new HTTPException(404, { message: "Agent not found" });
  }

  const { error } = await db
    .from("agents")
    .update({ deleted_at: new Date().toISOString(), status: "archived" as const })
    .eq("id", id);

  if (error) {
    throw new HTTPException(500, { message: error.message });
  }

  await writeAuditLog(
    {
      action: "agent.deleted",
      resourceType: "agent",
      resourceId: id,
      agentId: id,
      evidence: { name: current.name, previousStatus: current.status },
    },
    c,
  );

  return c.json({ deleted: true });
});

/** POST /:id/kill -- Emergency kill switch. Strict rate limit. */
agentRoutes.post("/:id/kill", strictRateLimiter, async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const db = getSupabase();

  const { data: current, error: fetchErr } = await db
    .from("agents")
    .select()
    .eq("id", id)
    .eq("owner_id", user.id)
    .is("deleted_at", null)
    .single();

  if (fetchErr || !current) {
    throw new HTTPException(404, { message: "Agent not found" });
  }

  if (current.status !== "running" && current.status !== "paused") {
    throw new HTTPException(400, {
      message: `Cannot kill agent in '${current.status}' state. Must be 'running' or 'paused'.`,
    });
  }

  const { data, error } = await db
    .from("agents")
    .update({ status: "stopped" as const, version: current.version + 1 })
    .eq("id", id)
    .select()
    .single();

  if (error) {
    throw new HTTPException(500, { message: error.message });
  }

  // End all active sessions for this agent.
  await db
    .from("agent_sessions")
    .update({ status: "completed" as const, ended_at: new Date().toISOString() })
    .eq("agent_id", id)
    .eq("status", "active");

  // Deactivate all wallets for this agent.
  await db
    .from("agent_wallets")
    .update({ is_active: false })
    .eq("agent_id", id);

  await writeAuditLog(
    {
      action: "agent.killed",
      severity: "critical",
      resourceType: "agent",
      resourceId: id,
      agentId: id,
      evidence: {
        previousStatus: current.status,
        reason: "Emergency kill switch activated",
        sessionsTerminated: true,
        walletsDeactivated: true,
      },
    },
    c,
  );

  return c.json({ killed: true, agent: data });
});

/** GET /:id/model-config -- Get current model configuration. */
agentRoutes.get("/:id/model-config", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const db = getSupabase();

  const { data, error } = await db
    .from("agents")
    .select("id, model_config, version")
    .eq("id", id)
    .eq("owner_id", user.id)
    .is("deleted_at", null)
    .single();

  if (error || !data) {
    throw new HTTPException(404, { message: "Agent not found" });
  }

  return c.json(data);
});

/** PUT /:id/model-config -- Hot-swap model configuration. Strict rate limit. */
agentRoutes.put("/:id/model-config", strictRateLimiter, async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const modelConfig = parseBody(z.record(z.unknown()), await c.req.json());
  const db = getSupabase();

  const { data: current, error: fetchErr } = await db
    .from("agents")
    .select("id, owner_id, model_config, version")
    .eq("id", id)
    .eq("owner_id", user.id)
    .is("deleted_at", null)
    .single();

  if (fetchErr || !current) {
    throw new HTTPException(404, { message: "Agent not found" });
  }

  const { data, error } = await db
    .from("agents")
    .update({ model_config: modelConfig, version: current.version + 1 })
    .eq("id", id)
    .select("id, model_config, version")
    .single();

  if (error) {
    throw new HTTPException(500, { message: error.message });
  }

  await writeAuditLog(
    {
      action: "agent.model_swapped",
      resourceType: "agent",
      resourceId: id,
      agentId: id,
      evidence: {
        before: current.model_config,
        after: modelConfig,
      },
    },
    c,
  );

  return c.json(data);
});
