/**
 * Batch operation helpers for high-throughput scenarios.
 *
 * Provides:
 *   - Chunked processing: split large arrays into manageable chunks.
 *   - Bulk agent operations: create, update status, delete.
 *   - Bulk session operations: close stale sessions.
 *   - Result tracking with per-item success/failure reporting.
 */

import { getSupabase } from "./supabase.js";
import { logger } from "./logger.js";
import { invalidateAgentCache } from "./cache.js";
import type { AgentFramework, AgentStatus, SessionStatus } from "../types/database.js";

// =============================================================================
// Types
// =============================================================================

export interface BatchItemResult {
  /** Index in the original input array. */
  index: number;
  /** Whether this item succeeded. */
  success: boolean;
  /** Resource ID (if created or found). */
  id?: string;
  /** Error message (if failed). */
  error?: string;
}

export interface BatchResult {
  total: number;
  succeeded: number;
  failed: number;
  items: BatchItemResult[];
  durationMs: number;
}

// =============================================================================
// Chunked processing
// =============================================================================

/**
 * Split an array into chunks of a given size.
 */
export function chunk<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

/**
 * Process items in chunks with a concurrency limit.
 *
 * Executes the processor function on each chunk sequentially to avoid
 * overwhelming the database with too many concurrent operations.
 */
export async function processInChunks<T, R>(
  items: T[],
  chunkSize: number,
  processor: (chunk: T[], startIndex: number) => Promise<R[]>,
): Promise<R[]> {
  const chunks = chunk(items, chunkSize);
  const results: R[] = [];

  for (let i = 0; i < chunks.length; i++) {
    const startIndex = i * chunkSize;
    const chunkResults = await processor(chunks[i], startIndex);
    results.push(...chunkResults);
  }

  return results;
}

// =============================================================================
// Bulk agent operations
// =============================================================================

/** Input for bulk agent creation. */
export interface BulkCreateAgentInput {
  name: string;
  description?: string;
  framework?: AgentFramework;
  model_config?: Record<string, unknown>;
  system_prompt?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

/** Default chunk size for bulk operations. */
const CHUNK_SIZE = 50;

/**
 * Bulk create agents.
 *
 * Creates multiple agents in chunks, returning per-item results.
 */
export async function bulkCreateAgents(
  ownerId: string,
  inputs: BulkCreateAgentInput[],
): Promise<BatchResult> {
  const start = performance.now();
  const db = getSupabase();

  const items = await processInChunks(
    inputs,
    CHUNK_SIZE,
    async (chunkItems, startIndex) => {
      const results: BatchItemResult[] = [];

      for (let i = 0; i < chunkItems.length; i++) {
        const input = chunkItems[i];
        const index = startIndex + i;

        try {
          const { data, error } = await db
            .from("agents")
            .insert({
              owner_id: ownerId,
              name: input.name,
              description: input.description ?? null,
              framework: input.framework ?? ("custom" as AgentFramework),
              model_config: input.model_config ?? {},
              system_prompt: input.system_prompt ?? null,
              tags: input.tags ?? [],
              metadata: input.metadata ?? {},
            })
            .select("id")
            .single();

          if (error || !data) {
            results.push({ index, success: false, error: error?.message ?? "Insert failed" });
          } else {
            results.push({ index, success: true, id: data.id });
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Unknown error";
          results.push({ index, success: false, error: msg });
        }
      }

      return results;
    },
  );

  const succeeded = items.filter((r) => r.success).length;
  const durationMs = Math.round((performance.now() - start) * 100) / 100;

  logger.info("Bulk create agents completed", {
    total: inputs.length,
    succeeded,
    failed: inputs.length - succeeded,
    durationMs,
  });

  return {
    total: inputs.length,
    succeeded,
    failed: inputs.length - succeeded,
    items,
    durationMs,
  };
}

/**
 * Bulk update agent status.
 *
 * Updates the status of multiple agents by ID.
 */
export async function bulkUpdateAgentStatus(
  ownerId: string,
  updates: Array<{ agent_id: string; status: AgentStatus }>,
): Promise<BatchResult> {
  const start = performance.now();
  const db = getSupabase();

  const items = await processInChunks(
    updates,
    CHUNK_SIZE,
    async (chunkItems, startIndex) => {
      const results: BatchItemResult[] = [];

      for (let i = 0; i < chunkItems.length; i++) {
        const update = chunkItems[i];
        const index = startIndex + i;

        try {
          const { data, error } = await db
            .from("agents")
            .update({ status: update.status })
            .eq("id", update.agent_id)
            .eq("owner_id", ownerId)
            .select("id")
            .single();

          if (error || !data) {
            results.push({
              index,
              success: false,
              id: update.agent_id,
              error: error?.message ?? "Agent not found or not owned",
            });
          } else {
            results.push({ index, success: true, id: data.id });
            void invalidateAgentCache(data.id);
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Unknown error";
          results.push({ index, success: false, id: update.agent_id, error: msg });
        }
      }

      return results;
    },
  );

  const succeeded = items.filter((r) => r.success).length;
  const durationMs = Math.round((performance.now() - start) * 100) / 100;

  logger.info("Bulk update agent status completed", {
    total: updates.length,
    succeeded,
    failed: updates.length - succeeded,
    durationMs,
  });

  return {
    total: updates.length,
    succeeded,
    failed: updates.length - succeeded,
    items,
    durationMs,
  };
}

/**
 * Bulk delete agents (soft delete by setting deleted_at).
 *
 * Only deletes agents owned by the specified user.
 */
export async function bulkDeleteAgents(
  ownerId: string,
  agentIds: string[],
): Promise<BatchResult> {
  const start = performance.now();
  const db = getSupabase();

  const items = await processInChunks(
    agentIds,
    CHUNK_SIZE,
    async (chunkItems, startIndex) => {
      const results: BatchItemResult[] = [];

      for (let i = 0; i < chunkItems.length; i++) {
        const agentId = chunkItems[i];
        const index = startIndex + i;

        try {
          const { data, error } = await db
            .from("agents")
            .update({
              deleted_at: new Date().toISOString(),
              status: "error" as AgentStatus,
            })
            .eq("id", agentId)
            .eq("owner_id", ownerId)
            .is("deleted_at", null)
            .select("id")
            .single();

          if (error || !data) {
            results.push({
              index,
              success: false,
              id: agentId,
              error: error?.message ?? "Agent not found, not owned, or already deleted",
            });
          } else {
            results.push({ index, success: true, id: data.id });
            void invalidateAgentCache(data.id);
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Unknown error";
          results.push({ index, success: false, id: agentId, error: msg });
        }
      }

      return results;
    },
  );

  const succeeded = items.filter((r) => r.success).length;
  const durationMs = Math.round((performance.now() - start) * 100) / 100;

  logger.info("Bulk delete agents completed", {
    total: agentIds.length,
    succeeded,
    failed: agentIds.length - succeeded,
    durationMs,
  });

  return {
    total: agentIds.length,
    succeeded,
    failed: agentIds.length - succeeded,
    items,
    durationMs,
  };
}

// =============================================================================
// Bulk session operations
// =============================================================================

/**
 * Bulk close stale sessions for an agent.
 *
 * Closes all sessions that have been inactive (no messages) for longer
 * than the specified threshold.
 */
export async function bulkCloseStaleSessions(
  agentId: string,
  ownerId: string,
  staleThresholdMinutes: number = 60,
): Promise<BatchResult> {
  const start = performance.now();
  const db = getSupabase();

  const cutoff = new Date(Date.now() - staleThresholdMinutes * 60 * 1000).toISOString();

  // Find stale active sessions.
  const { data: staleSessions, error: fetchErr } = await db
    .from("agent_sessions")
    .select("id")
    .eq("agent_id", agentId)
    .eq("owner_id", ownerId)
    .eq("status", "active" as SessionStatus)
    .lt("updated_at", cutoff);

  if (fetchErr || !staleSessions || staleSessions.length === 0) {
    const durationMs = Math.round((performance.now() - start) * 100) / 100;
    return { total: 0, succeeded: 0, failed: 0, items: [], durationMs };
  }

  const sessionIds = staleSessions.map((s) => s.id);

  const items = await processInChunks(
    sessionIds,
    CHUNK_SIZE,
    async (chunkItems, startIndex) => {
      const results: BatchItemResult[] = [];

      for (let i = 0; i < chunkItems.length; i++) {
        const sessionId = chunkItems[i];
        const index = startIndex + i;

        try {
          const { data, error } = await db
            .from("agent_sessions")
            .update({
              status: "ended" as SessionStatus,
              ended_at: new Date().toISOString(),
            })
            .eq("id", sessionId)
            .select("id")
            .single();

          if (error || !data) {
            results.push({ index, success: false, id: sessionId, error: error?.message ?? "Update failed" });
          } else {
            results.push({ index, success: true, id: data.id });
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Unknown error";
          results.push({ index, success: false, id: sessionId, error: msg });
        }
      }

      return results;
    },
  );

  const succeeded = items.filter((r) => r.success).length;
  const durationMs = Math.round((performance.now() - start) * 100) / 100;

  logger.info("Bulk close stale sessions completed", {
    agentId,
    total: sessionIds.length,
    succeeded,
    failed: sessionIds.length - succeeded,
    staleThresholdMinutes,
    durationMs,
  });

  return {
    total: sessionIds.length,
    succeeded,
    failed: sessionIds.length - succeeded,
    items,
    durationMs,
  };
}
