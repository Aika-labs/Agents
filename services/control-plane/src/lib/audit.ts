import type { Context } from "hono";
import { getSupabase } from "./supabase.js";
import type { AuditSeverity } from "../types/database.js";
import type { AppEnv } from "../types/env.js";

interface AuditEntry {
  action: string;
  resourceType: string;
  /** Override actor ID. If omitted, uses the authenticated user from context. */
  actorId?: string | null;
  actorType?: string;
  severity?: AuditSeverity;
  resourceId?: string | null;
  evidence?: Record<string, unknown>;
  agentId?: string | null;
  sessionId?: string | null;
}

/**
 * Write an audit log entry. Fire-and-forget -- errors are logged but
 * never block the request.
 *
 * When a Hono context is provided, automatically captures:
 * - actor_id from the authenticated user (if not overridden)
 * - ip_address from X-Forwarded-For or remote address
 * - user_agent from the User-Agent header
 * - request_id from the requestId context variable
 */
export async function writeAuditLog(
  entry: AuditEntry,
  c?: Context<AppEnv>,
): Promise<void> {
  try {
    const db = getSupabase();

    // Extract request metadata from Hono context when available.
    let actorId = entry.actorId ?? null;
    let ipAddress: string | null = null;
    let userAgent: string | null = null;
    let requestId: string | null = null;

    if (c) {
      // Use authenticated user if actorId not explicitly provided.
      if (!actorId) {
        try {
          const user = c.get("user");
          actorId = user?.id ?? null;
        } catch {
          // No user in context (public route). Leave actorId as null.
        }
      }

      ipAddress =
        c.req.header("X-Forwarded-For")?.split(",")[0]?.trim() ?? null;
      userAgent = c.req.header("User-Agent") ?? null;

      try {
        requestId = c.get("requestId") ?? null;
      } catch {
        // requestId middleware not mounted.
      }
    }

    const { error } = await db.from("audit_logs").insert({
      actor_id: actorId,
      actor_type: entry.actorType ?? "user",
      action: entry.action,
      severity: entry.severity ?? "info",
      resource_type: entry.resourceType,
      resource_id: entry.resourceId ?? null,
      evidence: entry.evidence ?? {},
      agent_id: entry.agentId ?? null,
      session_id: entry.sessionId ?? null,
      ip_address: ipAddress,
      user_agent: userAgent,
      request_id: requestId,
      metadata: {},
    });
    if (error) {
      console.error("[AUDIT] Failed to write audit log:", error.message);
    }
  } catch (err) {
    console.error("[AUDIT] Unexpected error:", err);
  }
}
