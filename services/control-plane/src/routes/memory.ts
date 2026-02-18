import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { getSupabase } from "../lib/supabase.js";
import { parseBody, parseQuery } from "../lib/validate.js";
import { writeAuditLog } from "../lib/audit.js";
import {
  storeLongTermMemory,
  searchMemoriesBySimilarity,
  listLongTermMemories,
  deleteLongTermMemory,
  setShortTermMemory,
  getShortTermMemory,
  deleteShortTermMemory,
  getAllShortTermMemory,
  clearShortTermMemory,
  assembleContextWindow,
} from "../lib/memory.js";
import type { AgentMemoryRow } from "../types/database.js";
import type { AppEnv } from "../types/env.js";

export const memoryRoutes = new Hono<AppEnv>();

// -- Zod schemas --------------------------------------------------------------

const memoryTypes = ["episodic", "semantic", "procedural", "reflection"] as const;

const storeMemorySchema = z.object({
  content: z.string().min(1).max(50000),
  memory_type: z.enum(memoryTypes).default("semantic"),
  embedding: z.array(z.number()).length(1536).optional(),
  importance: z.number().min(0).max(1).default(0.5),
  session_id: z.string().uuid().optional(),
  message_id: z.string().uuid().optional(),
  metadata: z.record(z.unknown()).default({}),
});

const listMemoriesQuery = z.object({
  memory_type: z.enum(memoryTypes).optional(),
  session_id: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

const searchMemoriesSchema = z.object({
  embedding: z.array(z.number()).length(1536),
  limit: z.number().int().min(1).max(50).default(10),
  similarity_threshold: z.number().min(0).max(1).default(0.7),
  memory_type: z.enum(memoryTypes).optional(),
});

const stmSetSchema = z.object({
  key: z.string().min(1).max(255),
  value: z.string().min(1).max(100000),
  ttl_seconds: z.number().int().min(1).max(86400).default(7200),
});

const assembleContextSchema = z.object({
  session_id: z.string().uuid(),
  query_embedding: z.array(z.number()).length(1536).optional(),
  token_budget: z.number().int().min(256).max(128000).default(8192),
});

// =============================================================================
// Long-term memory routes: /agents/:agentId/memories
// =============================================================================

/** POST /agents/:agentId/memories -- Store a long-term memory. */
memoryRoutes.post("/agents/:agentId/memories", async (c) => {
  const user = c.get("user");
  const agentId = c.req.param("agentId");
  const body = parseBody(storeMemorySchema, await c.req.json());

  // Verify agent ownership.
  await verifyAgentOwnership(agentId, user.id);

  const memory = await storeLongTermMemory({
    agentId,
    ownerId: user.id,
    content: body.content,
    memoryType: body.memory_type,
    embedding: body.embedding,
    importance: body.importance,
    sessionId: body.session_id,
    messageId: body.message_id,
    metadata: body.metadata,
  });

  await writeAuditLog(
    {
      action: "memory.stored",
      resourceType: "agent_memory",
      resourceId: memory.id,
      agentId,
      evidence: {
        memory_type: body.memory_type,
        importance: body.importance,
        has_embedding: !!body.embedding,
      },
    },
    c,
  );

  return c.json(memory, 201);
});

/** GET /agents/:agentId/memories -- List long-term memories. */
memoryRoutes.get("/agents/:agentId/memories", async (c) => {
  const user = c.get("user");
  const agentId = c.req.param("agentId");
  const query = parseQuery(listMemoriesQuery, c.req.query());

  await verifyAgentOwnership(agentId, user.id);

  const { data, total } = await listLongTermMemories({
    agentId,
    memoryType: query.memory_type,
    sessionId: query.session_id,
    limit: query.limit,
    offset: query.offset,
  });

  return c.json({
    data,
    total,
    limit: query.limit,
    offset: query.offset,
  });
});

/** POST /agents/:agentId/memories/search -- Semantic similarity search. */
memoryRoutes.post("/agents/:agentId/memories/search", async (c) => {
  const user = c.get("user");
  const agentId = c.req.param("agentId");
  const body = parseBody(searchMemoriesSchema, await c.req.json());

  await verifyAgentOwnership(agentId, user.id);

  const results = await searchMemoriesBySimilarity({
    agentId,
    embedding: body.embedding,
    limit: body.limit,
    similarityThreshold: body.similarity_threshold,
    memoryType: body.memory_type,
  });

  return c.json({
    data: results.map((r) => ({
      ...r.memory,
      similarity: r.similarity,
    })),
    total: results.length,
  });
});

/** GET /agents/:agentId/memories/:memoryId -- Get a single memory. */
memoryRoutes.get("/agents/:agentId/memories/:memoryId", async (c) => {
  const user = c.get("user");
  const agentId = c.req.param("agentId");
  const memoryId = c.req.param("memoryId");

  await verifyAgentOwnership(agentId, user.id);

  const db = getSupabase();
  const { data, error } = await db
    .from("agent_memories")
    .select()
    .eq("id", memoryId)
    .eq("agent_id", agentId)
    .eq("owner_id", user.id)
    .single();

  if (error || !data) {
    throw new HTTPException(404, { message: "Memory not found" });
  }

  return c.json(data as AgentMemoryRow);
});

/** DELETE /agents/:agentId/memories/:memoryId -- Delete a memory. */
memoryRoutes.delete("/agents/:agentId/memories/:memoryId", async (c) => {
  const user = c.get("user");
  const agentId = c.req.param("agentId");
  const memoryId = c.req.param("memoryId");

  await verifyAgentOwnership(agentId, user.id);

  const deleted = await deleteLongTermMemory(memoryId, user.id);

  if (!deleted) {
    throw new HTTPException(404, { message: "Memory not found" });
  }

  await writeAuditLog(
    {
      action: "memory.deleted",
      resourceType: "agent_memory",
      resourceId: memoryId,
      agentId,
    },
    c,
  );

  return c.json({ deleted: true });
});

// =============================================================================
// Short-term memory routes: /agents/:agentId/sessions/:sessionId/stm
// =============================================================================

/** POST /agents/:agentId/sessions/:sessionId/stm -- Set a short-term memory entry. */
memoryRoutes.post(
  "/agents/:agentId/sessions/:sessionId/stm",
  async (c) => {
    const user = c.get("user");
    const agentId = c.req.param("agentId");
    const sessionId = c.req.param("sessionId");
    const body = parseBody(stmSetSchema, await c.req.json());

    await verifyAgentOwnership(agentId, user.id);
    await verifySessionOwnership(sessionId, user.id);

    await setShortTermMemory(
      agentId,
      sessionId,
      body.key,
      body.value,
      body.ttl_seconds,
    );

    return c.json({ key: body.key, ttl_seconds: body.ttl_seconds }, 201);
  },
);

/** GET /agents/:agentId/sessions/:sessionId/stm -- List all short-term memory. */
memoryRoutes.get(
  "/agents/:agentId/sessions/:sessionId/stm",
  async (c) => {
    const user = c.get("user");
    const agentId = c.req.param("agentId");
    const sessionId = c.req.param("sessionId");

    await verifyAgentOwnership(agentId, user.id);
    await verifySessionOwnership(sessionId, user.id);

    const entries = await getAllShortTermMemory(agentId, sessionId);

    return c.json({ data: entries });
  },
);

/** GET /agents/:agentId/sessions/:sessionId/stm/:key -- Get a single STM entry. */
memoryRoutes.get(
  "/agents/:agentId/sessions/:sessionId/stm/:key",
  async (c) => {
    const user = c.get("user");
    const agentId = c.req.param("agentId");
    const sessionId = c.req.param("sessionId");
    const key = c.req.param("key");

    await verifyAgentOwnership(agentId, user.id);
    await verifySessionOwnership(sessionId, user.id);

    const value = await getShortTermMemory(agentId, sessionId, key);

    if (value === null) {
      throw new HTTPException(404, { message: "Short-term memory key not found" });
    }

    return c.json({ key, value });
  },
);

/** DELETE /agents/:agentId/sessions/:sessionId/stm/:key -- Delete a single STM entry. */
memoryRoutes.delete(
  "/agents/:agentId/sessions/:sessionId/stm/:key",
  async (c) => {
    const user = c.get("user");
    const agentId = c.req.param("agentId");
    const sessionId = c.req.param("sessionId");
    const key = c.req.param("key");

    await verifyAgentOwnership(agentId, user.id);
    await verifySessionOwnership(sessionId, user.id);

    await deleteShortTermMemory(agentId, sessionId, key);

    return c.json({ deleted: true });
  },
);

/** DELETE /agents/:agentId/sessions/:sessionId/stm -- Clear all STM for a session. */
memoryRoutes.delete(
  "/agents/:agentId/sessions/:sessionId/stm",
  async (c) => {
    const user = c.get("user");
    const agentId = c.req.param("agentId");
    const sessionId = c.req.param("sessionId");

    await verifyAgentOwnership(agentId, user.id);
    await verifySessionOwnership(sessionId, user.id);

    const count = await clearShortTermMemory(agentId, sessionId);

    return c.json({ cleared: count });
  },
);

// =============================================================================
// Context assembly route
// =============================================================================

/** POST /agents/:agentId/context -- Assemble a context window for an agent turn. */
memoryRoutes.post("/agents/:agentId/context", async (c) => {
  const user = c.get("user");
  const agentId = c.req.param("agentId");
  const body = parseBody(assembleContextSchema, await c.req.json());

  await verifyAgentOwnership(agentId, user.id);

  const db = getSupabase();

  // Fetch agent's system prompt.
  const { data: agent, error: agentErr } = await db
    .from("agents")
    .select("system_prompt")
    .eq("id", agentId)
    .eq("owner_id", user.id)
    .is("deleted_at", null)
    .single();

  if (agentErr || !agent) {
    throw new HTTPException(404, { message: "Agent not found" });
  }

  // Fetch recent messages from the session.
  const { data: messages, error: msgErr } = await db
    .from("agent_messages")
    .select("role, content")
    .eq("session_id", body.session_id)
    .order("created_at", { ascending: true })
    .limit(100);

  if (msgErr) {
    throw new HTTPException(500, { message: msgErr.message });
  }

  const contextWindow = await assembleContextWindow({
    agentId,
    sessionId: body.session_id,
    systemPrompt: agent.system_prompt as string | null,
    recentMessages: (messages ?? []) as Array<{
      role: string;
      content: string | null;
    }>,
    queryEmbedding: body.query_embedding,
    tokenBudget: body.token_budget,
  });

  return c.json(contextWindow);
});

// =============================================================================
// Helpers
// =============================================================================

/**
 * Verify that the authenticated user owns the specified agent.
 * Throws 404 if the agent doesn't exist or isn't owned by the user.
 */
async function verifyAgentOwnership(
  agentId: string,
  userId: string,
): Promise<void> {
  const db = getSupabase();
  const { data, error } = await db
    .from("agents")
    .select("id")
    .eq("id", agentId)
    .eq("owner_id", userId)
    .is("deleted_at", null)
    .single();

  if (error || !data) {
    throw new HTTPException(404, { message: "Agent not found" });
  }
}

/**
 * Verify that the authenticated user owns the specified session.
 * Throws 404 if the session doesn't exist or isn't owned by the user.
 */
async function verifySessionOwnership(
  sessionId: string,
  userId: string,
): Promise<void> {
  const db = getSupabase();
  const { data, error } = await db
    .from("agent_sessions")
    .select("id")
    .eq("id", sessionId)
    .eq("owner_id", userId)
    .single();

  if (error || !data) {
    throw new HTTPException(404, { message: "Session not found" });
  }
}
