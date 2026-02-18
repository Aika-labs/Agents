import { getRedis } from "./redis.js";
import { getSupabase } from "./supabase.js";
import type { AgentMemoryRow, MemoryType } from "../types/database.js";

// =============================================================================
// Short-term memory (Redis)
// =============================================================================

/**
 * Redis key prefix for short-term session memory.
 * Key format: `stm:{agentId}:{sessionId}:{key}`
 */
const STM_PREFIX = "stm";

/** Default TTL for short-term memory entries: 2 hours. */
const STM_DEFAULT_TTL_SECONDS = 7200;

/**
 * Store a short-term memory entry in Redis with TTL.
 *
 * Short-term memory is scoped to an agent + session and automatically
 * expires. Used for scratchpad state, working memory, and intermediate
 * reasoning that doesn't need to persist beyond the session.
 */
export async function setShortTermMemory(
  agentId: string,
  sessionId: string,
  key: string,
  value: string,
  ttlSeconds: number = STM_DEFAULT_TTL_SECONDS,
): Promise<void> {
  const redis = getRedis();
  const redisKey = `${STM_PREFIX}:${agentId}:${sessionId}:${key}`;
  await redis.set(redisKey, value, "EX", ttlSeconds);
}

/**
 * Retrieve a short-term memory entry from Redis.
 * Returns null if the key doesn't exist or has expired.
 */
export async function getShortTermMemory(
  agentId: string,
  sessionId: string,
  key: string,
): Promise<string | null> {
  const redis = getRedis();
  const redisKey = `${STM_PREFIX}:${agentId}:${sessionId}:${key}`;
  return redis.get(redisKey);
}

/**
 * Delete a specific short-term memory entry.
 */
export async function deleteShortTermMemory(
  agentId: string,
  sessionId: string,
  key: string,
): Promise<void> {
  const redis = getRedis();
  const redisKey = `${STM_PREFIX}:${agentId}:${sessionId}:${key}`;
  await redis.del(redisKey);
}

/**
 * List all short-term memory keys for an agent + session.
 */
export async function listShortTermMemoryKeys(
  agentId: string,
  sessionId: string,
): Promise<string[]> {
  const redis = getRedis();
  const pattern = `${STM_PREFIX}:${agentId}:${sessionId}:*`;
  const keys = await redis.keys(pattern);
  const prefix = `${STM_PREFIX}:${agentId}:${sessionId}:`;
  return keys.map((k) => k.slice(prefix.length));
}

/**
 * Retrieve all short-term memory entries for an agent + session.
 */
export async function getAllShortTermMemory(
  agentId: string,
  sessionId: string,
): Promise<Record<string, string>> {
  const redis = getRedis();
  const pattern = `${STM_PREFIX}:${agentId}:${sessionId}:*`;
  const keys = await redis.keys(pattern);

  if (keys.length === 0) return {};

  const values = await redis.mget(...keys);
  const prefix = `${STM_PREFIX}:${agentId}:${sessionId}:`;
  const result: Record<string, string> = {};

  for (let i = 0; i < keys.length; i++) {
    const shortKey = keys[i].slice(prefix.length);
    const val = values[i];
    if (val !== null) {
      result[shortKey] = val;
    }
  }

  return result;
}

/**
 * Delete all short-term memory for an agent + session.
 * Called when a session ends to clean up working memory.
 */
export async function clearShortTermMemory(
  agentId: string,
  sessionId: string,
): Promise<number> {
  const redis = getRedis();
  const pattern = `${STM_PREFIX}:${agentId}:${sessionId}:*`;
  const keys = await redis.keys(pattern);

  if (keys.length === 0) return 0;

  return redis.del(...keys);
}

// =============================================================================
// Long-term memory (Supabase + pgvector)
// =============================================================================

/** Options for storing a long-term memory. */
export interface StoreMemoryOptions {
  agentId: string;
  ownerId: string;
  content: string;
  memoryType?: MemoryType;
  /** Pre-computed embedding vector (1536 dimensions). */
  embedding?: number[];
  importance?: number;
  sessionId?: string;
  messageId?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Store a long-term memory in Supabase.
 *
 * If an embedding vector is provided, it's stored alongside the content
 * for later similarity search. If not, the memory is stored without an
 * embedding (can be backfilled later).
 */
export async function storeLongTermMemory(
  opts: StoreMemoryOptions,
): Promise<AgentMemoryRow> {
  const db = getSupabase();

  const insertData: Record<string, unknown> = {
    agent_id: opts.agentId,
    owner_id: opts.ownerId,
    content: opts.content,
    memory_type: opts.memoryType ?? "semantic",
    importance: opts.importance ?? 0.5,
    session_id: opts.sessionId ?? null,
    message_id: opts.messageId ?? null,
    metadata: opts.metadata ?? {},
  };

  // pgvector expects the embedding as a string like '[0.1, 0.2, ...]'.
  if (opts.embedding) {
    insertData.embedding = `[${opts.embedding.join(",")}]`;
  }

  const { data, error } = await db
    .from("agent_memories")
    .insert(insertData)
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to store memory: ${error.message}`);
  }

  return data as AgentMemoryRow;
}

/** Options for searching long-term memories by similarity. */
export interface SearchMemoryOptions {
  agentId: string;
  /** Query embedding vector (1536 dimensions). */
  embedding: number[];
  /** Maximum number of results. */
  limit?: number;
  /** Minimum similarity threshold (0.0 - 1.0). */
  similarityThreshold?: number;
  /** Filter by memory type. */
  memoryType?: MemoryType;
}

/** A memory result with its similarity score. */
export interface MemorySearchResult {
  memory: AgentMemoryRow;
  similarity: number;
}

/**
 * Search long-term memories by vector similarity using pgvector.
 *
 * Uses cosine distance (1 - cosine_similarity) via Supabase RPC.
 * Falls back to a direct query with ordering if the RPC function
 * isn't available yet.
 */
export async function searchMemoriesBySimilarity(
  opts: SearchMemoryOptions,
): Promise<MemorySearchResult[]> {
  const db = getSupabase();
  const limit = opts.limit ?? 10;
  const threshold = opts.similarityThreshold ?? 0.7;
  const embeddingStr = `[${opts.embedding.join(",")}]`;

  // Try the RPC function first (requires a Supabase function to be deployed).
  const { data: rpcData, error: rpcError } = await db.rpc(
    "search_agent_memories",
    {
      p_agent_id: opts.agentId,
      p_embedding: embeddingStr,
      p_match_threshold: threshold,
      p_match_count: limit,
      p_memory_type: opts.memoryType ?? null,
    },
  );

  if (!rpcError && rpcData) {
    // RPC returns rows with a `similarity` column.
    return (rpcData as Array<AgentMemoryRow & { similarity: number }>).map(
      (row) => ({
        memory: row,
        similarity: row.similarity,
      }),
    );
  }

  // Fallback: direct query ordered by cosine distance.
  // This works but is slower without the RPC function's optimizations.
  let query = db
    .from("agent_memories")
    .select("*")
    .eq("agent_id", opts.agentId)
    .not("embedding", "is", null)
    .limit(limit);

  if (opts.memoryType) {
    query = query.eq("memory_type", opts.memoryType);
  }

  // Order by cosine distance to the query embedding.
  // Supabase PostgREST doesn't natively support vector ordering,
  // so we fetch and sort client-side as a fallback.
  const { data, error } = await query.order("created_at", {
    ascending: false,
  });

  if (error) {
    throw new Error(`Failed to search memories: ${error.message}`);
  }

  if (!data || data.length === 0) return [];

  // Client-side cosine similarity ranking (fallback path).
  const results: MemorySearchResult[] = [];
  for (const row of data as AgentMemoryRow[]) {
    if (!row.embedding) continue;
    const memEmbedding = parseEmbedding(row.embedding);
    const sim = cosineSimilarity(opts.embedding, memEmbedding);
    if (sim >= threshold) {
      results.push({ memory: row, similarity: sim });
    }
  }

  results.sort((a, b) => b.similarity - a.similarity);
  return results.slice(0, limit);
}

/**
 * List long-term memories for an agent with optional filters.
 */
export async function listLongTermMemories(opts: {
  agentId: string;
  memoryType?: MemoryType;
  sessionId?: string;
  limit?: number;
  offset?: number;
}): Promise<{ data: AgentMemoryRow[]; total: number | null }> {
  const db = getSupabase();
  const limit = opts.limit ?? 20;
  const offset = opts.offset ?? 0;

  let query = db
    .from("agent_memories")
    .select("*", { count: "exact" })
    .eq("agent_id", opts.agentId)
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (opts.memoryType) query = query.eq("memory_type", opts.memoryType);
  if (opts.sessionId) query = query.eq("session_id", opts.sessionId);

  const { data, error, count } = await query;

  if (error) {
    throw new Error(`Failed to list memories: ${error.message}`);
  }

  return { data: (data ?? []) as AgentMemoryRow[], total: count };
}

/**
 * Record a memory access (bump access_count and last_accessed_at).
 * Called when a memory is recalled during context assembly.
 */
export async function touchMemory(memoryId: string): Promise<void> {
  const db = getSupabase();

  // Use raw SQL via RPC or a two-step read-update.
  const { data: current, error: fetchErr } = await db
    .from("agent_memories")
    .select("access_count")
    .eq("id", memoryId)
    .single();

  if (fetchErr || !current) return;

  await db
    .from("agent_memories")
    .update({
      access_count: (current.access_count as number) + 1,
      last_accessed_at: new Date().toISOString(),
    })
    .eq("id", memoryId);
}

/**
 * Delete a long-term memory by ID.
 */
export async function deleteLongTermMemory(
  memoryId: string,
  ownerId: string,
): Promise<boolean> {
  const db = getSupabase();

  const { error } = await db
    .from("agent_memories")
    .delete()
    .eq("id", memoryId)
    .eq("owner_id", ownerId);

  return !error;
}

// =============================================================================
// Context window manager
// =============================================================================

/** A message formatted for the context window. */
export interface ContextMessage {
  role: string;
  content: string;
  /** Estimated token count for this message. */
  tokens: number;
}

/** Assembled context window ready for LLM consumption. */
export interface ContextWindow {
  /** System prompt (always first). */
  systemPrompt: string | null;
  /** Recalled long-term memories injected as context. */
  memories: Array<{ content: string; type: MemoryType; similarity?: number }>;
  /** Short-term working memory from Redis. */
  workingMemory: Record<string, string>;
  /** Recent conversation messages (trimmed to fit budget). */
  messages: ContextMessage[];
  /** Token accounting. */
  tokenBudget: number;
  tokensUsed: number;
}

/**
 * Assemble a context window for an agent turn.
 *
 * Priority order (highest to lowest):
 *   1. System prompt (always included)
 *   2. Short-term working memory from Redis
 *   3. Relevant long-term memories (by similarity to the latest user message)
 *   4. Recent conversation messages (most recent first, trimmed to fit)
 *
 * @param agentId - Agent UUID.
 * @param sessionId - Session UUID.
 * @param systemPrompt - Agent's system prompt.
 * @param recentMessages - Recent messages from the session (newest last).
 * @param queryEmbedding - Embedding of the latest user message for memory recall.
 * @param tokenBudget - Maximum tokens for the context window.
 */
export async function assembleContextWindow(opts: {
  agentId: string;
  sessionId: string;
  systemPrompt: string | null;
  recentMessages: Array<{ role: string; content: string | null }>;
  queryEmbedding?: number[];
  tokenBudget?: number;
}): Promise<ContextWindow> {
  const budget = opts.tokenBudget ?? 8192;
  let tokensUsed = 0;

  // 1. System prompt.
  const systemPrompt = opts.systemPrompt ?? null;
  if (systemPrompt) {
    tokensUsed += estimateTokens(systemPrompt);
  }

  // 2. Short-term working memory from Redis.
  const workingMemory = await getAllShortTermMemory(
    opts.agentId,
    opts.sessionId,
  );
  const workingMemoryStr = Object.entries(workingMemory)
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n");
  if (workingMemoryStr) {
    tokensUsed += estimateTokens(workingMemoryStr);
  }

  // 3. Long-term memories (if we have a query embedding).
  const memories: ContextWindow["memories"] = [];
  if (opts.queryEmbedding) {
    // Reserve ~15% of remaining budget for memories.
    const memoryBudget = Math.floor((budget - tokensUsed) * 0.15);
    let memoryTokens = 0;

    const results = await searchMemoriesBySimilarity({
      agentId: opts.agentId,
      embedding: opts.queryEmbedding,
      limit: 5,
      similarityThreshold: 0.7,
    });

    for (const result of results) {
      const memTokens = estimateTokens(result.memory.content);
      if (memoryTokens + memTokens > memoryBudget) break;

      memories.push({
        content: result.memory.content,
        type: result.memory.memory_type,
        similarity: result.similarity,
      });
      memoryTokens += memTokens;

      // Touch the memory to track access.
      void touchMemory(result.memory.id);
    }

    tokensUsed += memoryTokens;
  }

  // 4. Recent messages (fill remaining budget, most recent first).
  const messages: ContextMessage[] = [];
  const remainingBudget = budget - tokensUsed;
  let messageTokens = 0;

  // Walk backwards through messages (newest first) to prioritize recency.
  for (let i = opts.recentMessages.length - 1; i >= 0; i--) {
    const msg = opts.recentMessages[i];
    const content = msg.content ?? "";
    const tokens = estimateTokens(content);

    if (messageTokens + tokens > remainingBudget) break;

    messages.unshift({ role: msg.role, content, tokens });
    messageTokens += tokens;
  }

  tokensUsed += messageTokens;

  return {
    systemPrompt,
    memories,
    workingMemory,
    messages,
    tokenBudget: budget,
    tokensUsed,
  };
}

// =============================================================================
// Utilities
// =============================================================================

/**
 * Rough token estimation: ~4 characters per token (English text average).
 * For production, use tiktoken or a provider-specific tokenizer.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Parse a pgvector embedding string like '[0.1, 0.2, ...]' into a number array.
 */
function parseEmbedding(embeddingStr: string): number[] {
  const cleaned = embeddingStr.replace(/^\[|\]$/g, "");
  return cleaned.split(",").map(Number);
}

/**
 * Compute cosine similarity between two vectors.
 */
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) return 0;

  return dotProduct / denominator;
}
