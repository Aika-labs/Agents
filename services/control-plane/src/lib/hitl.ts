/**
 * Human-in-the-Loop (HITL) workflow engine.
 *
 * Provides helpers for:
 *   - Matching agent actions against HITL policies.
 *   - Creating approval requests when a policy fires.
 *   - Resolving (approve/reject) pending requests.
 *   - Expiring timed-out requests.
 */

import { HTTPException } from "hono/http-exception";
import { getSupabase } from "./supabase.js";
import type {
  ApprovalStatus,
  HitlTriggerType,
  HitlPolicyRow,
} from "../types/database.js";

// -- Policy matching ----------------------------------------------------------

/** Context describing an agent action to evaluate against HITL policies. */
export interface ActionContext {
  triggerType: HitlTriggerType;
  /** Tool name, API URL, table name, etc. depending on trigger type. */
  actionType: string;
  /** Human-readable summary of what the agent wants to do. */
  actionSummary: string;
  /** Structured details (tool args, amounts, etc.). */
  actionDetails: Record<string, unknown>;
  /** Optional session context. */
  sessionId?: string;
}

/**
 * Check whether an action matches a single policy's conditions.
 *
 * Matching rules by trigger type:
 *   - tool_call:     actionType matches any entry in conditions.tool_names
 *   - spending:      actionDetails.amount_usd >= conditions.threshold_usd
 *   - external_api:  actionType starts with any conditions.url_patterns prefix
 *   - data_mutation: actionDetails.table in conditions.tables AND
 *                    actionDetails.operation in conditions.operations
 *   - escalation:    always matches (agent explicitly requested escalation)
 *   - custom:        all keys in conditions.match must exist and equal in actionDetails
 */
export function policyMatches(
  policy: HitlPolicyRow,
  ctx: ActionContext,
): boolean {
  if (policy.trigger_type !== ctx.triggerType) return false;

  const cond = policy.conditions;

  switch (policy.trigger_type) {
    case "tool_call": {
      const toolNames = cond["tool_names"];
      if (!Array.isArray(toolNames)) return false;
      return toolNames.some((name: unknown) => {
        if (typeof name !== "string") return false;
        // Support trailing wildcard: "delete_*" matches "delete_user".
        if (name.endsWith("*")) {
          return ctx.actionType.startsWith(name.slice(0, -1));
        }
        return ctx.actionType === name;
      });
    }

    case "spending": {
      const threshold = cond["threshold_usd"];
      const amount = ctx.actionDetails["amount_usd"];
      if (typeof threshold !== "number" || typeof amount !== "number") return false;
      return amount >= threshold;
    }

    case "external_api": {
      const patterns = cond["url_patterns"];
      if (!Array.isArray(patterns)) return false;
      return patterns.some((pattern: unknown) => {
        if (typeof pattern !== "string") return false;
        if (pattern.endsWith("*")) {
          return ctx.actionType.startsWith(pattern.slice(0, -1));
        }
        return ctx.actionType === pattern;
      });
    }

    case "data_mutation": {
      const tables = cond["tables"];
      const operations = cond["operations"];
      const table = ctx.actionDetails["table"];
      const operation = ctx.actionDetails["operation"];
      if (!Array.isArray(tables) || !Array.isArray(operations)) return false;
      return (
        tables.includes(table as string) &&
        operations.includes(operation as string)
      );
    }

    case "escalation":
      // Always matches -- the agent explicitly asked for human review.
      return true;

    case "custom": {
      const match = cond["match"];
      if (typeof match !== "object" || match === null) return false;
      return Object.entries(match).every(
        ([key, value]) => ctx.actionDetails[key] === value,
      );
    }

    default:
      return false;
  }
}

/**
 * Evaluate an action against all active HITL policies for an agent.
 * Returns the first matching policy (highest priority), or null if no match.
 */
export async function findMatchingPolicy(
  agentId: string,
  ctx: ActionContext,
): Promise<HitlPolicyRow | null> {
  const db = getSupabase();

  const { data: policies } = await db
    .from("hitl_policies")
    .select()
    .eq("agent_id", agentId)
    .eq("is_active", true)
    .order("priority", { ascending: false });

  if (!policies || policies.length === 0) return null;

  for (const policy of policies) {
    if (policyMatches(policy, ctx)) {
      return policy;
    }
  }

  return null;
}

// -- Approval request lifecycle -----------------------------------------------

export interface CreateApprovalParams {
  agentId: string;
  ownerId: string;
  ctx: ActionContext;
  policy: HitlPolicyRow | null;
}

/**
 * Create an approval request. If a matching policy is provided, its timeout
 * and auto-resolve settings are applied.
 */
export async function createApprovalRequest(params: CreateApprovalParams) {
  const { agentId, ownerId, ctx, policy } = params;
  const db = getSupabase();

  let expiresAt: string | null = null;
  let autoResolve = false;

  if (policy?.timeout_seconds) {
    const expiry = new Date(Date.now() + policy.timeout_seconds * 1000);
    expiresAt = expiry.toISOString();
    autoResolve = policy.auto_approve;
  }

  const { data, error } = await db
    .from("approval_requests")
    .insert({
      agent_id: agentId,
      owner_id: ownerId,
      session_id: ctx.sessionId ?? null,
      policy_id: policy?.id ?? null,
      action_type: ctx.actionType,
      action_summary: ctx.actionSummary,
      action_details: ctx.actionDetails,
      status: "pending" as const,
      expires_at: expiresAt,
      auto_resolve: autoResolve,
    })
    .select()
    .single();

  if (error) {
    throw new HTTPException(500, { message: error.message });
  }

  return data;
}

export interface ResolveParams {
  requestId: string;
  reviewerId: string;
  status: "approved" | "rejected";
  responseNote?: string;
  responseData?: Record<string, unknown>;
}

/**
 * Resolve a pending approval request (approve or reject).
 * Throws 404 if not found, 400 if already resolved.
 */
export async function resolveApproval(params: ResolveParams) {
  const db = getSupabase();

  const { data: existing, error: fetchErr } = await db
    .from("approval_requests")
    .select()
    .eq("id", params.requestId)
    .single();

  if (fetchErr || !existing) {
    throw new HTTPException(404, { message: "Approval request not found" });
  }

  if (existing.status !== "pending") {
    throw new HTTPException(400, {
      message: `Cannot resolve request in '${existing.status}' status. Only 'pending' requests can be resolved.`,
    });
  }

  const { data, error } = await db
    .from("approval_requests")
    .update({
      status: params.status as ApprovalStatus,
      reviewer_id: params.reviewerId,
      reviewed_at: new Date().toISOString(),
      response_note: params.responseNote ?? null,
      response_data: params.responseData ?? {},
    })
    .eq("id", params.requestId)
    .select()
    .single();

  if (error) {
    throw new HTTPException(500, { message: error.message });
  }

  return data;
}

/**
 * Expire pending approval requests that have passed their expires_at.
 * Auto-resolves based on the auto_resolve flag (approve or reject).
 *
 * Returns the number of expired requests.
 */
export async function expireTimedOutRequests(): Promise<number> {
  const db = getSupabase();
  const now = new Date().toISOString();

  // Find expired pending requests.
  const { data: expired } = await db
    .from("approval_requests")
    .select("id, auto_resolve")
    .eq("status", "pending")
    .not("expires_at", "is", null)
    .lte("expires_at", now);

  if (!expired || expired.length === 0) return 0;

  let count = 0;
  for (const req of expired) {
    const newStatus: ApprovalStatus = req.auto_resolve ? "approved" : "expired";
    const { error } = await db
      .from("approval_requests")
      .update({
        status: newStatus,
        reviewed_at: now,
        response_note: req.auto_resolve
          ? "Auto-approved after timeout"
          : "Expired without review",
      })
      .eq("id", req.id)
      .eq("status", "pending"); // Optimistic lock.

    if (!error) count++;
  }

  return count;
}
