import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { getSupabase } from "../lib/supabase.js";
import { parseBody, parseQuery } from "../lib/validate.js";
import { writeAuditLog } from "../lib/audit.js";
import type {
  AgentSessionRow,
  AgentMessageRow,
  SessionStatus,
} from "../types/database.js";
import type { AppEnv } from "../types/env.js";

export const sessionRoutes = new Hono<AppEnv>();

// -- Zod schemas --------------------------------------------------------------

const sessionStatuses = [
  "active",
  "idle",
  "completed",
  "expired",
  "error",
] as const;

const messageRoles = ["system", "user", "assistant", "tool", "a2a"] as const;

const createSessionSchema = z.object({
  agent_id: z.string().uuid(),
  title: z.string().max(500).optional(),
  parent_agent_id: z.string().uuid().optional(),
  a2a_task_id: z.string().max(255).optional(),
});

const listSessionsQuery = z.object({
  agent_id: z.string().uuid().optional(),
  status: z.enum(sessionStatuses).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

const updateSessionSchema = z.object({
  status: z.enum(sessionStatuses).optional(),
  title: z.string().max(500).nullable().optional(),
  context: z.record(z.unknown()).optional(),
});

const createMessageSchema = z.object({
  agent_id: z.string().uuid(),
  role: z.enum(messageRoles),
  content: z.string().max(100000).nullable().optional(),
  prompt_tokens: z.number().int().min(0).default(0),
  completion_tokens: z.number().int().min(0).default(0),
  tool_calls: z.array(z.unknown()).nullable().optional(),
  tool_call_id: z.string().max(255).nullable().optional(),
  tool_name: z.string().max(255).nullable().optional(),
  model: z.string().max(255).nullable().optional(),
  metadata: z.record(z.unknown()).default({}),
});

const listMessagesQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

// -- Valid session status transitions -----------------------------------------

const validSessionTransitions: Record<SessionStatus, SessionStatus[]> = {
  active: ["idle", "completed", "error"],
  idle: ["active", "completed", "expired"],
  completed: [],
  expired: [],
  error: [],
};

// -- Session routes -----------------------------------------------------------

/** POST / -- Create a new session for an agent. Owner is the authenticated user. */
sessionRoutes.post("/", async (c) => {
  const user = c.get("user");
  const body = parseBody(createSessionSchema, await c.req.json());
  const db = getSupabase();

  // Verify the agent exists, belongs to the user, and is in a runnable state.
  const { data: agent, error: agentErr } = await db
    .from("agents")
    .select("id, status, owner_id")
    .eq("id", body.agent_id)
    .eq("owner_id", user.id)
    .is("deleted_at", null)
    .single();

  if (agentErr || !agent) {
    throw new HTTPException(404, { message: "Agent not found" });
  }

  if (agent.status !== "running" && agent.status !== "paused") {
    throw new HTTPException(400, {
      message: `Cannot create session for agent in '${agent.status}' state. Agent must be 'running' or 'paused'.`,
    });
  }

  const { data, error } = await db
    .from("agent_sessions")
    .insert({
      agent_id: body.agent_id,
      owner_id: user.id,
      title: body.title ?? null,
      status: "active" as const,
      total_tokens: 0,
      turn_count: 0,
      context: {},
      parent_agent_id: body.parent_agent_id ?? null,
      a2a_task_id: body.a2a_task_id ?? null,
    })
    .select()
    .single();

  if (error) {
    throw new HTTPException(500, { message: error.message });
  }

  const session = data as AgentSessionRow;

  await writeAuditLog(
    {
      action: "session.created",
      resourceType: "session",
      resourceId: session.id,
      agentId: body.agent_id,
      evidence: {
        title: body.title,
        isA2A: !!body.parent_agent_id,
      },
    },
    c,
  );

  return c.json(session, 201);
});

/** GET / -- List sessions owned by the authenticated user. */
sessionRoutes.get("/", async (c) => {
  const user = c.get("user");
  const query = parseQuery(listSessionsQuery, c.req.query());
  const db = getSupabase();

  let q = db
    .from("agent_sessions")
    .select("*", { count: "exact" })
    .eq("owner_id", user.id)
    .order("created_at", { ascending: false })
    .range(query.offset, query.offset + query.limit - 1);

  if (query.agent_id) q = q.eq("agent_id", query.agent_id);
  if (query.status) q = q.eq("status", query.status);

  const { data, error, count } = await q;

  if (error) {
    throw new HTTPException(500, { message: error.message });
  }

  return c.json({
    data: data as AgentSessionRow[],
    total: count,
    limit: query.limit,
    offset: query.offset,
  });
});

/** GET /:id -- Get a single session by ID (must be owned by user). */
sessionRoutes.get("/:id", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const db = getSupabase();

  const { data, error } = await db
    .from("agent_sessions")
    .select()
    .eq("id", id)
    .eq("owner_id", user.id)
    .single();

  if (error || !data) {
    throw new HTTPException(404, { message: "Session not found" });
  }

  return c.json(data as AgentSessionRow);
});

/** PATCH /:id -- Update session status or context. */
sessionRoutes.patch("/:id", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const body = parseBody(updateSessionSchema, await c.req.json());
  const db = getSupabase();

  const { data: current, error: fetchErr } = await db
    .from("agent_sessions")
    .select()
    .eq("id", id)
    .eq("owner_id", user.id)
    .single();

  if (fetchErr || !current) {
    throw new HTTPException(404, { message: "Session not found" });
  }

  const session = current as AgentSessionRow;

  // Validate status transition.
  if (body.status && body.status !== session.status) {
    const allowed = validSessionTransitions[session.status] ?? [];
    if (!allowed.includes(body.status)) {
      throw new HTTPException(400, {
        message: `Invalid session transition: ${session.status} -> ${body.status}. Allowed: ${allowed.join(", ") || "none"}`,
      });
    }
  }

  const isEnding =
    body.status === "completed" ||
    body.status === "expired" ||
    body.status === "error";

  const updatePayload: Record<string, unknown> = { ...body };
  if (isEnding) {
    updatePayload.ended_at = new Date().toISOString();
  }

  const { data, error } = await db
    .from("agent_sessions")
    .update(updatePayload)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    throw new HTTPException(500, { message: error.message });
  }

  const updated = data as AgentSessionRow;

  if (body.status) {
    await writeAuditLog(
      {
        action: "session.status_changed",
        resourceType: "session",
        resourceId: id,
        agentId: session.agent_id,
        sessionId: id,
        evidence: {
          before: session.status,
          after: body.status,
        },
      },
      c,
    );
  }

  return c.json(updated);
});

// -- Message routes (nested under sessions) -----------------------------------

/** POST /:id/messages -- Add a message to a session. */
sessionRoutes.post("/:id/messages", async (c) => {
  const user = c.get("user");
  const sessionId = c.req.param("id");
  const body = parseBody(createMessageSchema, await c.req.json());
  const db = getSupabase();

  // Verify session exists, is active, and belongs to the user.
  const { data: session, error: sessionErr } = await db
    .from("agent_sessions")
    .select("id, status, agent_id, owner_id, total_tokens, turn_count")
    .eq("id", sessionId)
    .eq("owner_id", user.id)
    .single();

  if (sessionErr || !session) {
    throw new HTTPException(404, { message: "Session not found" });
  }

  if (session.status !== "active") {
    throw new HTTPException(400, {
      message: `Cannot add messages to session in '${session.status}' state.`,
    });
  }

  // Insert the message.
  const { data, error } = await db
    .from("agent_messages")
    .insert({
      session_id: sessionId,
      agent_id: body.agent_id,
      role: body.role,
      content: body.content ?? null,
      prompt_tokens: body.prompt_tokens,
      completion_tokens: body.completion_tokens,
      tool_calls: body.tool_calls ?? null,
      tool_call_id: body.tool_call_id ?? null,
      tool_name: body.tool_name ?? null,
      model: body.model ?? null,
      metadata: body.metadata,
    })
    .select()
    .single();

  if (error) {
    throw new HTTPException(500, { message: error.message });
  }

  const message = data as AgentMessageRow;

  // Update session token counts and turn count.
  const newTokens = body.prompt_tokens + body.completion_tokens;
  const isTurn = body.role === "assistant" || body.role === "a2a";

  await db
    .from("agent_sessions")
    .update({
      total_tokens: (session.total_tokens as number) + newTokens,
      turn_count: (session.turn_count as number) + (isTurn ? 1 : 0),
    })
    .eq("id", sessionId);

  return c.json(message, 201);
});

/** GET /:id/messages -- List messages in a session (chronological). */
sessionRoutes.get("/:id/messages", async (c) => {
  const user = c.get("user");
  const sessionId = c.req.param("id");
  const query = parseQuery(listMessagesQuery, c.req.query());
  const db = getSupabase();

  // Verify session exists and belongs to the user.
  const { data: session, error: sessionErr } = await db
    .from("agent_sessions")
    .select("id")
    .eq("id", sessionId)
    .eq("owner_id", user.id)
    .single();

  if (sessionErr || !session) {
    throw new HTTPException(404, { message: "Session not found" });
  }

  const { data, error, count } = await db
    .from("agent_messages")
    .select("*", { count: "exact" })
    .eq("session_id", sessionId)
    .order("created_at", { ascending: true })
    .range(query.offset, query.offset + query.limit - 1);

  if (error) {
    throw new HTTPException(500, { message: error.message });
  }

  return c.json({
    data: data as AgentMessageRow[],
    total: count,
    limit: query.limit,
    offset: query.offset,
  });
});
