import { getSupabase } from "./supabase.js";
import type { AuditSeverity } from "../types/database.js";

interface AuditEntry {
  actorId: string | null;
  actorType?: string;
  action: string;
  severity?: AuditSeverity;
  resourceType: string;
  resourceId?: string | null;
  evidence?: Record<string, unknown>;
  agentId?: string | null;
  sessionId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
}

/**
 * Write an audit log entry. Fire-and-forget -- errors are logged but
 * never block the request.
 */
export async function writeAuditLog(entry: AuditEntry): Promise<void> {
  try {
    const db = getSupabase();
    const { error } = await db.from("audit_logs").insert({
      actor_id: entry.actorId,
      actor_type: entry.actorType ?? "user",
      action: entry.action,
      severity: entry.severity ?? "info",
      resource_type: entry.resourceType,
      resource_id: entry.resourceId ?? null,
      evidence: entry.evidence ?? {},
      agent_id: entry.agentId ?? null,
      session_id: entry.sessionId ?? null,
      ip_address: entry.ipAddress ?? null,
      user_agent: entry.userAgent ?? null,
      request_id: entry.requestId ?? null,
      metadata: {},
    });
    if (error) {
      console.error("[AUDIT] Failed to write audit log:", error.message);
    }
  } catch (err) {
    console.error("[AUDIT] Unexpected error:", err);
  }
}
