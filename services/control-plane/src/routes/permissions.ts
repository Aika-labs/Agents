/**
 * Agent permissions routes.
 *
 * Mounted under /agents/:agentId/permissions in app.ts.
 * Only agent owners (or admins) can manage permissions.
 *
 * Endpoints:
 *   POST   /                 -- Grant access to a user
 *   GET    /                 -- List all permissions for the agent
 *   PATCH  /:permissionId    -- Update a permission (change role, expiry)
 *   DELETE /:permissionId    -- Revoke a permission
 */

import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { getSupabase } from "../lib/supabase.js";
import { parseBody, parseQuery } from "../lib/validate.js";
import { checkAgentAccess } from "../lib/permissions.js";
import { writeAuditLog } from "../lib/audit.js";
import type { AppEnv } from "../types/env.js";

// The agentId param is provided by the parent mount point in app.ts:
//   app.route("/agents/:agentId/permissions", permissionRoutes)
type PermEnv = AppEnv & { Variables: AppEnv["Variables"] };

export const permissionRoutes = new Hono<PermEnv>();

/** Extract and validate the agentId path parameter from the parent route. */
function getAgentId(c: { req: { param: (name: string) => string | undefined } }): string {
  const agentId = getAgentId(c);
  if (!agentId) {
    throw new HTTPException(400, { message: "Missing agentId parameter" });
  }
  return agentId;
}

// -- Zod schemas --------------------------------------------------------------

const agentRoles = ["admin", "editor", "viewer"] as const;

const grantSchema = z.object({
  user_id: z.string().uuid(),
  role: z.enum(agentRoles).default("viewer"),
  expires_at: z.string().datetime().optional(),
  metadata: z.record(z.unknown()).default({}),
});

const updatePermSchema = z.object({
  role: z.enum(agentRoles).optional(),
  expires_at: z.string().datetime().nullable().optional(),
  metadata: z.record(z.unknown()).optional(),
});

const listPermQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

// -- Routes -------------------------------------------------------------------

/** POST / -- Grant a user access to an agent. Requires admin+ role. */
permissionRoutes.post("/", async (c) => {
  const user = c.get("user");
  const agentId = getAgentId(c);
  const body = parseBody(grantSchema, await c.req.json());
  const db = getSupabase();

  // Caller must be admin or owner.
  await checkAgentAccess(user.id, agentId, "admin");

  // Cannot grant to yourself.
  if (body.user_id === user.id) {
    throw new HTTPException(400, {
      message: "Cannot grant permissions to yourself",
    });
  }

  // Cannot grant "owner" role via API (owner is implicit via agents.owner_id).
  // The schema already restricts to admin/editor/viewer, but double-check.

  const { data, error } = await db
    .from("agent_permissions")
    .upsert(
      {
        agent_id: agentId,
        user_id: body.user_id,
        role: body.role,
        granted_by: user.id,
        expires_at: body.expires_at ?? null,
        metadata: body.metadata,
      },
      { onConflict: "agent_id,user_id" },
    )
    .select()
    .single();

  if (error) {
    throw new HTTPException(500, { message: error.message });
  }

  await writeAuditLog(
    {
      action: "permission.granted",
      resourceType: "agent_permission",
      resourceId: data.id,
      agentId,
      evidence: {
        target_user_id: body.user_id,
        role: body.role,
        expires_at: body.expires_at ?? null,
      },
    },
    c,
  );

  return c.json(data, 201);
});

/** GET / -- List permissions for an agent. Requires viewer+ role. */
permissionRoutes.get("/", async (c) => {
  const user = c.get("user");
  const agentId = getAgentId(c);
  const query = parseQuery(listPermQuery, c.req.query());
  const db = getSupabase();

  // Caller must have at least viewer access.
  await checkAgentAccess(user.id, agentId, "viewer");

  const { data, error, count } = await db
    .from("agent_permissions")
    .select("*", { count: "exact" })
    .eq("agent_id", agentId)
    .order("created_at", { ascending: false })
    .range(query.offset, query.offset + query.limit - 1);

  if (error) {
    throw new HTTPException(500, { message: error.message });
  }

  return c.json({
    data,
    total: count,
    limit: query.limit,
    offset: query.offset,
  });
});

/** PATCH /:permissionId -- Update a permission. Requires admin+ role. */
permissionRoutes.patch("/:permissionId", async (c) => {
  const user = c.get("user");
  const agentId = getAgentId(c);
  const permissionId = c.req.param("permissionId");
  const body = parseBody(updatePermSchema, await c.req.json());
  const db = getSupabase();

  await checkAgentAccess(user.id, agentId, "admin");

  // Verify the permission belongs to this agent.
  const { data: existing, error: fetchErr } = await db
    .from("agent_permissions")
    .select()
    .eq("id", permissionId)
    .eq("agent_id", agentId)
    .single();

  if (fetchErr || !existing) {
    throw new HTTPException(404, { message: "Permission not found" });
  }

  const { data, error } = await db
    .from("agent_permissions")
    .update(body)
    .eq("id", permissionId)
    .select()
    .single();

  if (error) {
    throw new HTTPException(500, { message: error.message });
  }

  await writeAuditLog(
    {
      action: "permission.updated",
      resourceType: "agent_permission",
      resourceId: permissionId,
      agentId,
      evidence: {
        target_user_id: existing.user_id,
        before: { role: existing.role, expires_at: existing.expires_at },
        after: { role: data.role, expires_at: data.expires_at },
        changes: Object.keys(body),
      },
    },
    c,
  );

  return c.json(data);
});

/** DELETE /:permissionId -- Revoke a permission. Requires admin+ role. */
permissionRoutes.delete("/:permissionId", async (c) => {
  const user = c.get("user");
  const agentId = getAgentId(c);
  const permissionId = c.req.param("permissionId");
  const db = getSupabase();

  await checkAgentAccess(user.id, agentId, "admin");

  // Verify the permission belongs to this agent.
  const { data: existing, error: fetchErr } = await db
    .from("agent_permissions")
    .select("id, user_id, role")
    .eq("id", permissionId)
    .eq("agent_id", agentId)
    .single();

  if (fetchErr || !existing) {
    throw new HTTPException(404, { message: "Permission not found" });
  }

  const { error } = await db
    .from("agent_permissions")
    .delete()
    .eq("id", permissionId);

  if (error) {
    throw new HTTPException(500, { message: error.message });
  }

  await writeAuditLog(
    {
      action: "permission.revoked",
      resourceType: "agent_permission",
      resourceId: permissionId,
      agentId,
      evidence: {
        target_user_id: existing.user_id,
        revoked_role: existing.role,
      },
    },
    c,
  );

  return c.json({ revoked: true });
});
