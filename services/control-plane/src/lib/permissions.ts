/**
 * Agent IAM & Permissions library.
 *
 * Provides role-based access control for agents. The role hierarchy is:
 *   owner > admin > editor > viewer
 *
 * Access resolution order:
 *   1. Check if the user is the agent's owner (agents.owner_id) → implicit "owner" role.
 *   2. Check agent_permissions table for an explicit grant.
 *   3. Reject if no matching permission or if the granted role is insufficient.
 *
 * Expired permissions (expires_at < now) are treated as non-existent.
 */

import { HTTPException } from "hono/http-exception";
import { getSupabase } from "./supabase.js";
import type { AgentRole } from "../types/database.js";

// -- Role hierarchy -----------------------------------------------------------

const ROLE_LEVEL: Record<AgentRole, number> = {
  viewer: 0,
  editor: 1,
  admin: 2,
  owner: 3,
};

/**
 * Returns true if `held` role meets or exceeds `required` role.
 */
export function roleSatisfies(held: AgentRole, required: AgentRole): boolean {
  return ROLE_LEVEL[held] >= ROLE_LEVEL[required];
}

// -- Access check -------------------------------------------------------------

export interface AccessResult {
  /** Whether access is granted. */
  granted: boolean;
  /** The effective role the user holds on this agent. */
  role: AgentRole | null;
  /** Whether the user is the agent's owner (via agents.owner_id). */
  isOwner: boolean;
}

/**
 * Resolve the effective role a user holds on an agent.
 *
 * Returns the highest role between implicit ownership and explicit
 * permission grant. Returns `null` role if the user has no access.
 */
export async function resolveAgentRole(
  userId: string,
  agentId: string,
): Promise<AccessResult> {
  const db = getSupabase();

  // 1. Check ownership via agents table.
  const { data: agent } = await db
    .from("agents")
    .select("owner_id")
    .eq("id", agentId)
    .is("deleted_at", null)
    .single();

  if (!agent) {
    return { granted: false, role: null, isOwner: false };
  }

  if (agent.owner_id === userId) {
    return { granted: true, role: "owner", isOwner: true };
  }

  // 2. Check explicit permission grant.
  const { data: perm } = await db
    .from("agent_permissions")
    .select("role, expires_at")
    .eq("agent_id", agentId)
    .eq("user_id", userId)
    .single();

  if (!perm) {
    return { granted: false, role: null, isOwner: false };
  }

  // Check expiration.
  if (perm.expires_at && new Date(perm.expires_at) < new Date()) {
    return { granted: false, role: null, isOwner: false };
  }

  return { granted: true, role: perm.role, isOwner: false };
}

/**
 * Assert that a user has at least `requiredRole` on an agent.
 *
 * Throws 404 if the agent doesn't exist or the user has no access at all
 * (to avoid leaking agent existence). Throws 403 if the user has access
 * but insufficient role.
 */
export async function checkAgentAccess(
  userId: string,
  agentId: string,
  requiredRole: AgentRole,
): Promise<AccessResult> {
  const result = await resolveAgentRole(userId, agentId);

  if (!result.granted || !result.role) {
    throw new HTTPException(404, { message: "Agent not found" });
  }

  if (!roleSatisfies(result.role, requiredRole)) {
    throw new HTTPException(403, {
      message: `Insufficient permissions: requires '${requiredRole}' role, you have '${result.role}'`,
    });
  }

  return result;
}
