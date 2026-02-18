import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { getSupabase } from "../lib/supabase.js";
import { parseQuery } from "../lib/validate.js";
import type { AuditLogRow } from "../types/database.js";
import type { AppEnv } from "../types/env.js";

export const auditRoutes = new Hono<AppEnv>();

// -- Zod schemas --------------------------------------------------------------

const auditSeverities = ["info", "warning", "critical"] as const;

const listAuditLogsQuery = z.object({
  action: z.string().max(255).optional(),
  resource_type: z.string().max(255).optional(),
  resource_id: z.string().uuid().optional(),
  agent_id: z.string().uuid().optional(),
  session_id: z.string().uuid().optional(),
  severity: z.enum(auditSeverities).optional(),
  since: z.string().datetime().optional(),
  until: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

// -- Routes -------------------------------------------------------------------

/** GET / -- Query audit logs for the authenticated user. */
auditRoutes.get("/", async (c) => {
  const user = c.get("user");
  const query = parseQuery(listAuditLogsQuery, c.req.query());
  const db = getSupabase();

  let q = db
    .from("audit_logs")
    .select("*", { count: "exact" })
    .eq("actor_id", user.id)
    .order("created_at", { ascending: false })
    .range(query.offset, query.offset + query.limit - 1);

  if (query.action) q = q.eq("action", query.action);
  if (query.resource_type) q = q.eq("resource_type", query.resource_type);
  if (query.resource_id) q = q.eq("resource_id", query.resource_id);
  if (query.agent_id) q = q.eq("agent_id", query.agent_id);
  if (query.session_id) q = q.eq("session_id", query.session_id);
  if (query.severity) q = q.eq("severity", query.severity);
  if (query.since) q = q.gte("created_at", query.since);
  if (query.until) q = q.lte("created_at", query.until);

  const { data, error, count } = await q;

  if (error) {
    throw new HTTPException(500, { message: error.message });
  }

  return c.json({
    data: data as AuditLogRow[],
    total: count,
    limit: query.limit,
    offset: query.offset,
  });
});

/** GET /:id -- Get a single audit log entry (must belong to user). */
auditRoutes.get("/:id", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const db = getSupabase();

  const { data, error } = await db
    .from("audit_logs")
    .select()
    .eq("id", id)
    .eq("actor_id", user.id)
    .single();

  if (error || !data) {
    throw new HTTPException(404, { message: "Audit log entry not found" });
  }

  return c.json(data as AuditLogRow);
});
