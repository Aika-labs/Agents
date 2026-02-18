import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { getSupabase } from "../lib/supabase.js";
import { parseBody, parseQuery } from "../lib/validate.js";
import { writeAuditLog } from "../lib/audit.js";
import { checkAgentAccess } from "../lib/permissions.js";
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
  /** When true, also return agents shared with the user. Default: true. */
  include_shared: z.coerce.boolean().default(true),
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

/**
 * GET / -- List agents accessible to the authenticated user.
 *
 * Returns owned agents and (when include_shared=true) agents shared via
 * agent_permissions. Each result includes an `access_role` field indicating
 * the user's effective role.
 */
agentRoutes.get("/", async (c) => {
  const user = c.get("user");
  const query = parseQuery(listAgentsQuery, c.req.query());
  const db = getSupabase();

  // 1. Owned agents.
  let ownedQ = db
    .from("agents")
    .select("*", { count: "exact" })
    .eq("owner_id", user.id)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .range(query.offset, query.offset + query.limit - 1);

  if (query.status) ownedQ = ownedQ.eq("status", query.status);
  if (query.framework) ownedQ = ownedQ.eq("framework", query.framework);

  const { data: ownedData, error: ownedErr, count: ownedCount } = await ownedQ;

  if (ownedErr) {
    throw new HTTPException(500, { message: ownedErr.message });
  }

  // Tag owned agents with access_role.
  const owned = (ownedData ?? []).map((a) => ({ ...a, access_role: "owner" as const }));

  // 2. Shared agents (if requested).
  let shared: Array<Record<string, unknown> & { access_role: string }> = [];
  let sharedCount = 0;

  if (query.include_shared) {
    // Get agent IDs the user has non-expired permissions for.
    const { data: perms } = await db
      .from("agent_permissions")
      .select("agent_id, role, expires_at")
      .eq("user_id", user.id);

    const now = new Date();
    const validPerms = (perms ?? []).filter(
      (p) => !p.expires_at || new Date(p.expires_at) > now,
    );

    if (validPerms.length > 0) {
      const sharedIds = validPerms.map((p) => p.agent_id);
      const roleMap = new Map(validPerms.map((p) => [p.agent_id, p.role]));

      let sharedQ = db
        .from("agents")
        .select("*", { count: "exact" })
        .in("id", sharedIds)
        .is("deleted_at", null)
        .order("created_at", { ascending: false });

      if (query.status) sharedQ = sharedQ.eq("status", query.status);
      if (query.framework) sharedQ = sharedQ.eq("framework", query.framework);

      const { data: sharedData, error: sharedErr, count: sc } = await sharedQ;

      if (sharedErr) {
        throw new HTTPException(500, { message: sharedErr.message });
      }

      shared = (sharedData ?? []).map((a) => ({
        ...a,
        access_role: roleMap.get(a.id) ?? "viewer",
      }));
      sharedCount = sc ?? 0;
    }
  }

  // Merge results. Owned first, then shared.
  const data = [...owned, ...shared];
  const total = (ownedCount ?? 0) + sharedCount;

  return c.json({ data, total, limit: query.limit, offset: query.offset });
});

/** GET /:id -- Get a single agent. Requires viewer+ access. */
agentRoutes.get("/:id", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const db = getSupabase();

  // Permission check (throws 404 if no access, 403 if insufficient role).
  const access = await checkAgentAccess(user.id, id, "viewer");

  const { data, error } = await db
    .from("agents")
    .select()
    .eq("id", id)
    .is("deleted_at", null)
    .single();

  if (error || !data) {
    throw new HTTPException(404, { message: "Agent not found" });
  }

  return c.json({ ...data, access_role: access.role });
});

/** PATCH /:id -- Update an agent. Requires editor+ access. */
agentRoutes.patch("/:id", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const body = parseBody(updateAgentSchema, await c.req.json());
  const db = getSupabase();

  // Editor can update fields; status transitions require editor+.
  await checkAgentAccess(user.id, id, "editor");

  // Fetch current state for transition validation and audit evidence.
  const { data: current, error: fetchErr } = await db
    .from("agents")
    .select()
    .eq("id", id)
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

/** DELETE /:id -- Soft-delete an agent. Requires owner role. */
agentRoutes.delete("/:id", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const db = getSupabase();

  // Only the owner can delete an agent.
  await checkAgentAccess(user.id, id, "owner");

  const { data: current, error: fetchErr } = await db
    .from("agents")
    .select("id, owner_id, name, status")
    .eq("id", id)
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

/** POST /:id/kill -- Emergency kill switch. Requires owner role. Strict rate limit. */
agentRoutes.post("/:id/kill", strictRateLimiter, async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const db = getSupabase();

  // Only the owner can kill an agent.
  await checkAgentAccess(user.id, id, "owner");

  const { data: current, error: fetchErr } = await db
    .from("agents")
    .select()
    .eq("id", id)
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

/** GET /:id/model-config -- Get current model configuration. Requires viewer+ access. */
agentRoutes.get("/:id/model-config", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const db = getSupabase();

  await checkAgentAccess(user.id, id, "viewer");

  const { data, error } = await db
    .from("agents")
    .select("id, model_config, version")
    .eq("id", id)
    .is("deleted_at", null)
    .single();

  if (error || !data) {
    throw new HTTPException(404, { message: "Agent not found" });
  }

  return c.json(data);
});

/** PUT /:id/model-config -- Hot-swap model configuration. Requires admin+ access. */
agentRoutes.put("/:id/model-config", strictRateLimiter, async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const modelConfig = parseBody(z.record(z.unknown()), await c.req.json());
  const db = getSupabase();

  await checkAgentAccess(user.id, id, "admin");

  const { data: current, error: fetchErr } = await db
    .from("agents")
    .select("id, owner_id, model_config, version")
    .eq("id", id)
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
