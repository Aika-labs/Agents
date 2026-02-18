/**
 * Webhook routes.
 *
 * Two route groups mounted under /agents/:agentId:
 *
 *   Webhooks (/webhooks):
 *     POST   /                    -- Create a webhook subscription
 *     GET    /                    -- List webhooks
 *     GET    /:webhookId          -- Get webhook detail
 *     PATCH  /:webhookId          -- Update a webhook
 *     DELETE /:webhookId          -- Delete a webhook
 *     POST   /:webhookId/test     -- Send a test delivery
 *
 *   Deliveries (/webhooks/:webhookId/deliveries):
 *     GET    /                    -- List deliveries for a webhook
 *     GET    /:deliveryId         -- Get delivery detail
 */

import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { randomBytes } from "node:crypto";
import { getSupabase } from "../lib/supabase.js";
import { parseBody, parseQuery } from "../lib/validate.js";
import { checkAgentAccess } from "../lib/permissions.js";
import { deliverWebhook } from "../lib/webhooks.js";
import { writeAuditLog } from "../lib/audit.js";
import type { AppEnv } from "../types/env.js";

/** Extract and validate the agentId path parameter from the parent route. */
function getAgentId(c: { req: { param: (name: string) => string | undefined } }): string {
  const agentId = c.req.param("agentId");
  if (!agentId) {
    throw new HTTPException(400, { message: "Missing agentId parameter" });
  }
  return agentId;
}

function getWebhookId(c: { req: { param: (name: string) => string | undefined } }): string {
  const webhookId = c.req.param("webhookId");
  if (!webhookId) {
    throw new HTTPException(400, { message: "Missing webhookId parameter" });
  }
  return webhookId;
}

// =============================================================================
// Webhook routes
// =============================================================================

export const webhookRoutes = new Hono<AppEnv>();

const webhookEvents = [
  "agent.created",
  "agent.updated",
  "agent.deleted",
  "session.started",
  "session.ended",
  "deployment.started",
  "deployment.completed",
  "deployment.failed",
  "eval.completed",
  "pipeline.completed",
  "pipeline.failed",
  "approval.requested",
  "approval.resolved",
  "error.occurred",
] as const;

const createWebhookSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(2000).optional(),
  url: z.string().url().max(2048),
  events: z.array(z.enum(webhookEvents)).min(1),
  is_active: z.boolean().default(true),
  max_retries: z.number().int().min(0).max(10).default(3),
  retry_delay_seconds: z.number().int().min(1).max(3600).default(30),
  timeout_ms: z.number().int().min(1000).max(30000).default(10000),
  metadata: z.record(z.unknown()).default({}),
});

const updateWebhookSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().max(2000).nullable().optional(),
  url: z.string().url().max(2048).optional(),
  events: z.array(z.enum(webhookEvents)).min(1).optional(),
  is_active: z.boolean().optional(),
  max_retries: z.number().int().min(0).max(10).optional(),
  retry_delay_seconds: z.number().int().min(1).max(3600).optional(),
  timeout_ms: z.number().int().min(1000).max(30000).optional(),
  metadata: z.record(z.unknown()).optional(),
});

const listWebhooksQuery = z.object({
  is_active: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

/** POST / -- Create a webhook subscription. Requires editor+ access. */
webhookRoutes.post("/", async (c) => {
  const user = c.get("user");
  const agentId = getAgentId(c);
  const body = parseBody(createWebhookSchema, await c.req.json());
  const db = getSupabase();

  await checkAgentAccess(user.id, agentId, "editor");

  // Generate a signing secret for this webhook.
  const secret = randomBytes(32).toString("hex");

  const { data, error } = await db
    .from("agent_webhooks")
    .insert({
      ...body,
      agent_id: agentId,
      owner_id: user.id,
      secret,
    })
    .select()
    .single();

  if (error) {
    throw new HTTPException(500, { message: error.message });
  }

  await writeAuditLog(
    {
      action: "webhook.created",
      resourceType: "agent_webhook",
      resourceId: data.id,
      agentId,
      evidence: { name: body.name, url: body.url, events: body.events },
    },
    c,
  );

  return c.json(data, 201);
});

/** GET / -- List webhooks. Requires viewer+ access. */
webhookRoutes.get("/", async (c) => {
  const user = c.get("user");
  const agentId = getAgentId(c);
  const query = parseQuery(listWebhooksQuery, c.req.query());
  const db = getSupabase();

  await checkAgentAccess(user.id, agentId, "viewer");

  let q = db
    .from("agent_webhooks")
    .select("*", { count: "exact" })
    .eq("agent_id", agentId)
    .order("created_at", { ascending: false })
    .range(query.offset, query.offset + query.limit - 1);

  if (query.is_active !== undefined) q = q.eq("is_active", query.is_active);

  const { data, error, count } = await q;

  if (error) {
    throw new HTTPException(500, { message: error.message });
  }

  // Mask secrets in list response.
  const masked = (data ?? []).map((w) => ({
    ...w,
    secret: `${w.secret.slice(0, 8)}...`,
  }));

  return c.json({ data: masked, total: count, limit: query.limit, offset: query.offset });
});

/** GET /:webhookId -- Get webhook detail. Requires viewer+ access. */
webhookRoutes.get("/:webhookId", async (c) => {
  const user = c.get("user");
  const agentId = getAgentId(c);
  const webhookId = getWebhookId(c);
  const db = getSupabase();

  await checkAgentAccess(user.id, agentId, "viewer");

  const { data, error } = await db
    .from("agent_webhooks")
    .select()
    .eq("id", webhookId)
    .eq("agent_id", agentId)
    .single();

  if (error || !data) {
    throw new HTTPException(404, { message: "Webhook not found" });
  }

  // Include recent delivery count.
  const { count } = await db
    .from("webhook_deliveries")
    .select("id", { count: "exact", head: true })
    .eq("webhook_id", webhookId);

  return c.json({
    ...data,
    secret: `${data.secret.slice(0, 8)}...`,
    delivery_count: count ?? 0,
  });
});

/** PATCH /:webhookId -- Update a webhook. Requires editor+ access. */
webhookRoutes.patch("/:webhookId", async (c) => {
  const user = c.get("user");
  const agentId = getAgentId(c);
  const webhookId = getWebhookId(c);
  const body = parseBody(updateWebhookSchema, await c.req.json());
  const db = getSupabase();

  await checkAgentAccess(user.id, agentId, "editor");

  const { data: existing, error: fetchErr } = await db
    .from("agent_webhooks")
    .select("id")
    .eq("id", webhookId)
    .eq("agent_id", agentId)
    .single();

  if (fetchErr || !existing) {
    throw new HTTPException(404, { message: "Webhook not found" });
  }

  const { data, error } = await db
    .from("agent_webhooks")
    .update(body)
    .eq("id", webhookId)
    .select()
    .single();

  if (error) {
    throw new HTTPException(500, { message: error.message });
  }

  await writeAuditLog(
    {
      action: "webhook.updated",
      resourceType: "agent_webhook",
      resourceId: webhookId,
      agentId,
      evidence: { changes: Object.keys(body) },
    },
    c,
  );

  return c.json({ ...data!, secret: `${data!.secret.slice(0, 8)}...` });
});

/** DELETE /:webhookId -- Delete a webhook. Requires admin+ access. */
webhookRoutes.delete("/:webhookId", async (c) => {
  const user = c.get("user");
  const agentId = getAgentId(c);
  const webhookId = getWebhookId(c);
  const db = getSupabase();

  await checkAgentAccess(user.id, agentId, "admin");

  const { data: existing, error: fetchErr } = await db
    .from("agent_webhooks")
    .select("id, name")
    .eq("id", webhookId)
    .eq("agent_id", agentId)
    .single();

  if (fetchErr || !existing) {
    throw new HTTPException(404, { message: "Webhook not found" });
  }

  const { error } = await db.from("agent_webhooks").delete().eq("id", webhookId);

  if (error) {
    throw new HTTPException(500, { message: error.message });
  }

  await writeAuditLog(
    {
      action: "webhook.deleted",
      resourceType: "agent_webhook",
      resourceId: webhookId,
      agentId,
      evidence: { name: existing.name },
    },
    c,
  );

  return c.json({ deleted: true });
});

/** POST /:webhookId/test -- Send a test delivery. Requires editor+ access. */
webhookRoutes.post("/:webhookId/test", async (c) => {
  const user = c.get("user");
  const agentId = getAgentId(c);
  const webhookId = getWebhookId(c);
  const db = getSupabase();

  await checkAgentAccess(user.id, agentId, "editor");

  const { data: webhook, error: fetchErr } = await db
    .from("agent_webhooks")
    .select()
    .eq("id", webhookId)
    .eq("agent_id", agentId)
    .single();

  if (fetchErr || !webhook) {
    throw new HTTPException(404, { message: "Webhook not found" });
  }

  // Send a test event synchronously so the caller gets the result.
  await deliverWebhook(webhook, "agent.updated", {
    test: true,
    message: "This is a test webhook delivery.",
    triggered_by: user.id,
    timestamp: new Date().toISOString(),
  });

  return c.json({ delivered: true, webhook_id: webhookId });
});

// =============================================================================
// Delivery routes (nested under webhooks)
// =============================================================================

export const webhookDeliveryRoutes = new Hono<AppEnv>();

const listDeliveriesQuery = z.object({
  status: z.enum(["pending", "success", "failed", "retrying"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

/** GET / -- List deliveries for a webhook. Requires viewer+ access. */
webhookDeliveryRoutes.get("/", async (c) => {
  const user = c.get("user");
  const agentId = getAgentId(c);
  const webhookId = getWebhookId(c);
  const query = parseQuery(listDeliveriesQuery, c.req.query());
  const db = getSupabase();

  await checkAgentAccess(user.id, agentId, "viewer");

  // Verify webhook belongs to this agent.
  const { data: webhook, error: whErr } = await db
    .from("agent_webhooks")
    .select("id")
    .eq("id", webhookId)
    .eq("agent_id", agentId)
    .single();

  if (whErr || !webhook) {
    throw new HTTPException(404, { message: "Webhook not found" });
  }

  let q = db
    .from("webhook_deliveries")
    .select("*", { count: "exact" })
    .eq("webhook_id", webhookId)
    .order("created_at", { ascending: false })
    .range(query.offset, query.offset + query.limit - 1);

  if (query.status) q = q.eq("status", query.status);

  const { data, error, count } = await q;

  if (error) {
    throw new HTTPException(500, { message: error.message });
  }

  return c.json({ data, total: count, limit: query.limit, offset: query.offset });
});

/** GET /:deliveryId -- Get delivery detail. Requires viewer+ access. */
webhookDeliveryRoutes.get("/:deliveryId", async (c) => {
  const user = c.get("user");
  const agentId = getAgentId(c);
  const webhookId = getWebhookId(c);
  const deliveryId = c.req.param("deliveryId");
  const db = getSupabase();

  await checkAgentAccess(user.id, agentId, "viewer");

  // Verify webhook belongs to this agent.
  const { data: webhook, error: whErr } = await db
    .from("agent_webhooks")
    .select("id")
    .eq("id", webhookId)
    .eq("agent_id", agentId)
    .single();

  if (whErr || !webhook) {
    throw new HTTPException(404, { message: "Webhook not found" });
  }

  const { data, error } = await db
    .from("webhook_deliveries")
    .select()
    .eq("id", deliveryId)
    .eq("webhook_id", webhookId)
    .single();

  if (error || !data) {
    throw new HTTPException(404, { message: "Delivery not found" });
  }

  return c.json(data);
});
