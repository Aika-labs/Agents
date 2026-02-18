/**
 * Human-in-the-Loop (HITL) routes.
 *
 * Two route groups mounted under /agents/:agentId:
 *
 *   Approval requests (/approvals):
 *     POST   /                    -- Create an approval request
 *     GET    /                    -- List approval requests
 *     GET    /:approvalId         -- Get a single approval request
 *     POST   /:approvalId/resolve -- Approve or reject
 *     POST   /:approvalId/cancel  -- Cancel a pending request
 *
 *   HITL policies (/hitl-policies):
 *     POST   /                    -- Create a policy
 *     GET    /                    -- List policies
 *     PATCH  /:policyId           -- Update a policy
 *     DELETE /:policyId           -- Delete a policy
 */

import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { getSupabase } from "../lib/supabase.js";
import { parseBody, parseQuery } from "../lib/validate.js";
import { checkAgentAccess } from "../lib/permissions.js";
import {
  createApprovalRequest,
  resolveApproval,
  findMatchingPolicy,
} from "../lib/hitl.js";
import { writeAuditLog } from "../lib/audit.js";
import type { AppEnv } from "../types/env.js";

// =============================================================================
// Approval request routes
// =============================================================================

export const approvalRoutes = new Hono<AppEnv>();

/** Extract and validate the agentId path parameter from the parent route. */
function getAgentId(c: { req: { param: (name: string) => string | undefined } }): string {
  const agentId = c.req.param("agentId");
  if (!agentId) {
    throw new HTTPException(400, { message: "Missing agentId parameter" });
  }
  return agentId;
}

// -- Schemas ------------------------------------------------------------------

const triggerTypes = [
  "tool_call",
  "spending",
  "external_api",
  "data_mutation",
  "escalation",
  "custom",
] as const;

const createApprovalSchema = z.object({
  trigger_type: z.enum(triggerTypes),
  action_type: z.string().min(1).max(500),
  action_summary: z.string().min(1).max(2000),
  action_details: z.record(z.unknown()).default({}),
  session_id: z.string().uuid().optional(),
});

const resolveSchema = z.object({
  status: z.enum(["approved", "rejected"]),
  response_note: z.string().max(2000).optional(),
  response_data: z.record(z.unknown()).default({}),
});

const listApprovalsQuery = z.object({
  status: z
    .enum(["pending", "approved", "rejected", "expired", "cancelled"])
    .optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

// -- Routes -------------------------------------------------------------------

/** POST / -- Create an approval request. Requires editor+ access. */
approvalRoutes.post("/", async (c) => {
  const user = c.get("user");
  const agentId = getAgentId(c);
  const body = parseBody(createApprovalSchema, await c.req.json());

  await checkAgentAccess(user.id, agentId, "editor");

  // Check if a HITL policy matches this action.
  const policy = await findMatchingPolicy(agentId, {
    triggerType: body.trigger_type,
    actionType: body.action_type,
    actionSummary: body.action_summary,
    actionDetails: body.action_details,
    sessionId: body.session_id,
  });

  const data = await createApprovalRequest({
    agentId,
    ownerId: user.id,
    ctx: {
      triggerType: body.trigger_type,
      actionType: body.action_type,
      actionSummary: body.action_summary,
      actionDetails: body.action_details,
      sessionId: body.session_id,
    },
    policy,
  });

  await writeAuditLog(
    {
      action: "approval.requested",
      resourceType: "approval_request",
      resourceId: data.id,
      agentId,
      evidence: {
        action_type: body.action_type,
        trigger_type: body.trigger_type,
        policy_id: policy?.id ?? null,
        policy_name: policy?.name ?? null,
      },
    },
    c,
  );

  return c.json(data, 201);
});

/** GET / -- List approval requests for an agent. Requires viewer+ access. */
approvalRoutes.get("/", async (c) => {
  const user = c.get("user");
  const agentId = getAgentId(c);
  const query = parseQuery(listApprovalsQuery, c.req.query());
  const db = getSupabase();

  await checkAgentAccess(user.id, agentId, "viewer");

  let q = db
    .from("approval_requests")
    .select("*", { count: "exact" })
    .eq("agent_id", agentId)
    .order("created_at", { ascending: false })
    .range(query.offset, query.offset + query.limit - 1);

  if (query.status) q = q.eq("status", query.status);

  const { data, error, count } = await q;

  if (error) {
    throw new HTTPException(500, { message: error.message });
  }

  return c.json({ data, total: count, limit: query.limit, offset: query.offset });
});

/** GET /:approvalId -- Get a single approval request. Requires viewer+ access. */
approvalRoutes.get("/:approvalId", async (c) => {
  const user = c.get("user");
  const agentId = getAgentId(c);
  const approvalId = c.req.param("approvalId");
  const db = getSupabase();

  await checkAgentAccess(user.id, agentId, "viewer");

  const { data, error } = await db
    .from("approval_requests")
    .select()
    .eq("id", approvalId)
    .eq("agent_id", agentId)
    .single();

  if (error || !data) {
    throw new HTTPException(404, { message: "Approval request not found" });
  }

  return c.json(data);
});

/** POST /:approvalId/resolve -- Approve or reject. Requires admin+ access. */
approvalRoutes.post("/:approvalId/resolve", async (c) => {
  const user = c.get("user");
  const agentId = getAgentId(c);
  const approvalId = c.req.param("approvalId");
  const body = parseBody(resolveSchema, await c.req.json());

  await checkAgentAccess(user.id, agentId, "admin");

  const data = await resolveApproval({
    requestId: approvalId!,
    reviewerId: user.id,
    status: body.status,
    responseNote: body.response_note,
    responseData: body.response_data,
  });

  await writeAuditLog(
    {
      action: `approval.${body.status}`,
      resourceType: "approval_request",
      resourceId: approvalId,
      agentId,
      evidence: {
        action_type: data.action_type,
        response_note: body.response_note ?? null,
      },
    },
    c,
  );

  return c.json(data);
});

/** POST /:approvalId/cancel -- Cancel a pending request. Requires editor+ access. */
approvalRoutes.post("/:approvalId/cancel", async (c) => {
  const user = c.get("user");
  const agentId = getAgentId(c);
  const approvalId = c.req.param("approvalId");
  const db = getSupabase();

  await checkAgentAccess(user.id, agentId, "editor");

  const { data: existing, error: fetchErr } = await db
    .from("approval_requests")
    .select("id, status, action_type")
    .eq("id", approvalId)
    .eq("agent_id", agentId)
    .single();

  if (fetchErr || !existing) {
    throw new HTTPException(404, { message: "Approval request not found" });
  }

  if (existing.status !== "pending") {
    throw new HTTPException(400, {
      message: `Cannot cancel request in '${existing.status}' status`,
    });
  }

  const { data, error } = await db
    .from("approval_requests")
    .update({ status: "cancelled" as const })
    .eq("id", approvalId)
    .select()
    .single();

  if (error) {
    throw new HTTPException(500, { message: error.message });
  }

  await writeAuditLog(
    {
      action: "approval.cancelled",
      resourceType: "approval_request",
      resourceId: approvalId,
      agentId,
      evidence: { action_type: existing.action_type },
    },
    c,
  );

  return c.json(data);
});

// =============================================================================
// HITL policy routes
// =============================================================================

export const hitlPolicyRoutes = new Hono<AppEnv>();

// -- Schemas ------------------------------------------------------------------

const createPolicySchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(2000).optional(),
  trigger_type: z.enum(triggerTypes),
  conditions: z.record(z.unknown()).default({}),
  auto_approve: z.boolean().default(false),
  timeout_seconds: z.number().int().min(0).nullable().default(null),
  is_active: z.boolean().default(true),
  priority: z.number().int().default(0),
  metadata: z.record(z.unknown()).default({}),
});

const updatePolicySchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().max(2000).nullable().optional(),
  trigger_type: z.enum(triggerTypes).optional(),
  conditions: z.record(z.unknown()).optional(),
  auto_approve: z.boolean().optional(),
  timeout_seconds: z.number().int().min(0).nullable().optional(),
  is_active: z.boolean().optional(),
  priority: z.number().int().optional(),
  metadata: z.record(z.unknown()).optional(),
});

const listPoliciesQuery = z.object({
  is_active: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

// -- Routes -------------------------------------------------------------------

/** POST / -- Create a HITL policy. Requires admin+ access. */
hitlPolicyRoutes.post("/", async (c) => {
  const user = c.get("user");
  const agentId = getAgentId(c);
  const body = parseBody(createPolicySchema, await c.req.json());
  const db = getSupabase();

  await checkAgentAccess(user.id, agentId, "admin");

  const { data, error } = await db
    .from("hitl_policies")
    .insert({
      ...body,
      agent_id: agentId,
      owner_id: user.id,
    })
    .select()
    .single();

  if (error) {
    throw new HTTPException(500, { message: error.message });
  }

  await writeAuditLog(
    {
      action: "hitl_policy.created",
      resourceType: "hitl_policy",
      resourceId: data.id,
      agentId,
      evidence: {
        name: body.name,
        trigger_type: body.trigger_type,
      },
    },
    c,
  );

  return c.json(data, 201);
});

/** GET / -- List HITL policies for an agent. Requires viewer+ access. */
hitlPolicyRoutes.get("/", async (c) => {
  const user = c.get("user");
  const agentId = getAgentId(c);
  const query = parseQuery(listPoliciesQuery, c.req.query());
  const db = getSupabase();

  await checkAgentAccess(user.id, agentId, "viewer");

  let q = db
    .from("hitl_policies")
    .select("*", { count: "exact" })
    .eq("agent_id", agentId)
    .order("priority", { ascending: false })
    .range(query.offset, query.offset + query.limit - 1);

  if (query.is_active !== undefined) q = q.eq("is_active", query.is_active);

  const { data, error, count } = await q;

  if (error) {
    throw new HTTPException(500, { message: error.message });
  }

  return c.json({ data, total: count, limit: query.limit, offset: query.offset });
});

/** PATCH /:policyId -- Update a HITL policy. Requires admin+ access. */
hitlPolicyRoutes.patch("/:policyId", async (c) => {
  const user = c.get("user");
  const agentId = getAgentId(c);
  const policyId = c.req.param("policyId");
  const body = parseBody(updatePolicySchema, await c.req.json());
  const db = getSupabase();

  await checkAgentAccess(user.id, agentId, "admin");

  const { data: existing, error: fetchErr } = await db
    .from("hitl_policies")
    .select()
    .eq("id", policyId)
    .eq("agent_id", agentId)
    .single();

  if (fetchErr || !existing) {
    throw new HTTPException(404, { message: "HITL policy not found" });
  }

  const { data, error } = await db
    .from("hitl_policies")
    .update(body)
    .eq("id", policyId)
    .select()
    .single();

  if (error) {
    throw new HTTPException(500, { message: error.message });
  }

  await writeAuditLog(
    {
      action: "hitl_policy.updated",
      resourceType: "hitl_policy",
      resourceId: policyId,
      agentId,
      evidence: {
        changes: Object.keys(body),
        before: { name: existing.name, is_active: existing.is_active },
        after: { name: data.name, is_active: data.is_active },
      },
    },
    c,
  );

  return c.json(data);
});

/** DELETE /:policyId -- Delete a HITL policy. Requires admin+ access. */
hitlPolicyRoutes.delete("/:policyId", async (c) => {
  const user = c.get("user");
  const agentId = getAgentId(c);
  const policyId = c.req.param("policyId");
  const db = getSupabase();

  await checkAgentAccess(user.id, agentId, "admin");

  const { data: existing, error: fetchErr } = await db
    .from("hitl_policies")
    .select("id, name")
    .eq("id", policyId)
    .eq("agent_id", agentId)
    .single();

  if (fetchErr || !existing) {
    throw new HTTPException(404, { message: "HITL policy not found" });
  }

  const { error } = await db
    .from("hitl_policies")
    .delete()
    .eq("id", policyId);

  if (error) {
    throw new HTTPException(500, { message: error.message });
  }

  await writeAuditLog(
    {
      action: "hitl_policy.deleted",
      resourceType: "hitl_policy",
      resourceId: policyId,
      agentId,
      evidence: { name: existing.name },
    },
    c,
  );

  return c.json({ deleted: true });
});
