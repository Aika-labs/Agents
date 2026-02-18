/**
 * Data Pipeline routes.
 *
 * Four route groups mounted under /agents/:agentId/data:
 *
 *   Connectors (/connectors):
 *     POST   /                -- Create a data connector
 *     GET    /                -- List connectors
 *     GET    /:connectorId    -- Get connector detail
 *     PATCH  /:connectorId    -- Update a connector
 *     DELETE /:connectorId    -- Delete a connector
 *
 *   Pipelines (/pipelines):
 *     POST   /                -- Create a pipeline
 *     GET    /                -- List pipelines
 *     GET    /:pipelineId     -- Get pipeline detail
 *     PATCH  /:pipelineId     -- Update a pipeline
 *     DELETE /:pipelineId     -- Delete a pipeline
 *
 *   Steps (/pipelines/:pipelineId/steps):
 *     POST   /                -- Create a step
 *     GET    /                -- List steps in a pipeline
 *     PATCH  /:stepId         -- Update a step
 *     DELETE /:stepId         -- Delete a step
 *
 *   Runs (/runs):
 *     POST   /                -- Trigger a pipeline run
 *     GET    /                -- List runs
 *     GET    /:runId          -- Get run detail with step results
 */

import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { getSupabase } from "../lib/supabase.js";
import { parseBody, parseQuery } from "../lib/validate.js";
import { checkAgentAccess } from "../lib/permissions.js";
import { executePipeline } from "../lib/pipeline.js";
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

// =============================================================================
// Connector routes
// =============================================================================

export const connectorRoutes = new Hono<AppEnv>();

const connectorTypes = [
  "gcs",
  "supabase",
  "http_webhook",
  "redis",
  "postgresql",
  "custom",
] as const;

const createConnectorSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(2000).optional(),
  connector_type: z.enum(connectorTypes),
  config: z.record(z.unknown()).default({}),
  is_source: z.boolean().default(true),
  is_sink: z.boolean().default(false),
  is_active: z.boolean().default(true),
  metadata: z.record(z.unknown()).default({}),
});

const updateConnectorSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().max(2000).nullable().optional(),
  config: z.record(z.unknown()).optional(),
  is_source: z.boolean().optional(),
  is_sink: z.boolean().optional(),
  is_active: z.boolean().optional(),
  metadata: z.record(z.unknown()).optional(),
});

const listConnectorsQuery = z.object({
  connector_type: z.enum(connectorTypes).optional(),
  is_active: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

/** POST / -- Create a data connector. Requires editor+ access. */
connectorRoutes.post("/", async (c) => {
  const user = c.get("user");
  const agentId = getAgentId(c);
  const body = parseBody(createConnectorSchema, await c.req.json());
  const db = getSupabase();

  await checkAgentAccess(user.id, agentId, "editor");

  const { data, error } = await db
    .from("data_connectors")
    .insert({ ...body, agent_id: agentId, owner_id: user.id })
    .select()
    .single();

  if (error) {
    throw new HTTPException(500, { message: error.message });
  }

  await writeAuditLog(
    {
      action: "data_connector.created",
      resourceType: "data_connector",
      resourceId: data.id,
      agentId,
      evidence: { name: body.name, connector_type: body.connector_type },
    },
    c,
  );

  return c.json(data, 201);
});

/** GET / -- List connectors. Requires viewer+ access. */
connectorRoutes.get("/", async (c) => {
  const user = c.get("user");
  const agentId = getAgentId(c);
  const query = parseQuery(listConnectorsQuery, c.req.query());
  const db = getSupabase();

  await checkAgentAccess(user.id, agentId, "viewer");

  let q = db
    .from("data_connectors")
    .select("*", { count: "exact" })
    .eq("agent_id", agentId)
    .order("created_at", { ascending: false })
    .range(query.offset, query.offset + query.limit - 1);

  if (query.connector_type) q = q.eq("connector_type", query.connector_type);
  if (query.is_active !== undefined) q = q.eq("is_active", query.is_active);

  const { data, error, count } = await q;

  if (error) {
    throw new HTTPException(500, { message: error.message });
  }

  return c.json({ data, total: count, limit: query.limit, offset: query.offset });
});

/** GET /:connectorId -- Get connector detail. Requires viewer+ access. */
connectorRoutes.get("/:connectorId", async (c) => {
  const user = c.get("user");
  const agentId = getAgentId(c);
  const connectorId = c.req.param("connectorId");
  const db = getSupabase();

  await checkAgentAccess(user.id, agentId, "viewer");

  const { data, error } = await db
    .from("data_connectors")
    .select()
    .eq("id", connectorId)
    .eq("agent_id", agentId)
    .single();

  if (error || !data) {
    throw new HTTPException(404, { message: "Data connector not found" });
  }

  return c.json(data);
});

/** PATCH /:connectorId -- Update a connector. Requires editor+ access. */
connectorRoutes.patch("/:connectorId", async (c) => {
  const user = c.get("user");
  const agentId = getAgentId(c);
  const connectorId = c.req.param("connectorId");
  const body = parseBody(updateConnectorSchema, await c.req.json());
  const db = getSupabase();

  await checkAgentAccess(user.id, agentId, "editor");

  const { data: existing, error: fetchErr } = await db
    .from("data_connectors")
    .select("id")
    .eq("id", connectorId)
    .eq("agent_id", agentId)
    .single();

  if (fetchErr || !existing) {
    throw new HTTPException(404, { message: "Data connector not found" });
  }

  const { data, error } = await db
    .from("data_connectors")
    .update(body)
    .eq("id", connectorId)
    .select()
    .single();

  if (error) {
    throw new HTTPException(500, { message: error.message });
  }

  await writeAuditLog(
    {
      action: "data_connector.updated",
      resourceType: "data_connector",
      resourceId: connectorId,
      agentId,
      evidence: { changes: Object.keys(body) },
    },
    c,
  );

  return c.json(data);
});

/** DELETE /:connectorId -- Delete a connector. Requires admin+ access. */
connectorRoutes.delete("/:connectorId", async (c) => {
  const user = c.get("user");
  const agentId = getAgentId(c);
  const connectorId = c.req.param("connectorId");
  const db = getSupabase();

  await checkAgentAccess(user.id, agentId, "admin");

  const { data: existing, error: fetchErr } = await db
    .from("data_connectors")
    .select("id, name")
    .eq("id", connectorId)
    .eq("agent_id", agentId)
    .single();

  if (fetchErr || !existing) {
    throw new HTTPException(404, { message: "Data connector not found" });
  }

  const { error } = await db.from("data_connectors").delete().eq("id", connectorId);

  if (error) {
    throw new HTTPException(500, { message: error.message });
  }

  await writeAuditLog(
    {
      action: "data_connector.deleted",
      resourceType: "data_connector",
      resourceId: connectorId,
      agentId,
      evidence: { name: existing.name },
    },
    c,
  );

  return c.json({ deleted: true });
});

// =============================================================================
// Pipeline routes
// =============================================================================

export const pipelineRoutes = new Hono<AppEnv>();

const createPipelineSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(2000).optional(),
  source_connector_id: z.string().uuid().nullable().default(null),
  sink_connector_id: z.string().uuid().nullable().default(null),
  schedule_cron: z.string().max(100).nullable().default(null),
  is_active: z.boolean().default(true),
  max_concurrency: z.number().int().min(1).max(10).default(1),
  max_retries: z.number().int().min(0).max(10).default(0),
  retry_delay_seconds: z.number().int().min(1).max(3600).default(60),
  metadata: z.record(z.unknown()).default({}),
});

const updatePipelineSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().max(2000).nullable().optional(),
  source_connector_id: z.string().uuid().nullable().optional(),
  sink_connector_id: z.string().uuid().nullable().optional(),
  schedule_cron: z.string().max(100).nullable().optional(),
  is_active: z.boolean().optional(),
  max_concurrency: z.number().int().min(1).max(10).optional(),
  max_retries: z.number().int().min(0).max(10).optional(),
  retry_delay_seconds: z.number().int().min(1).max(3600).optional(),
  metadata: z.record(z.unknown()).optional(),
});

const listPipelinesQuery = z.object({
  is_active: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

/** POST / -- Create a pipeline. Requires editor+ access. */
pipelineRoutes.post("/", async (c) => {
  const user = c.get("user");
  const agentId = getAgentId(c);
  const body = parseBody(createPipelineSchema, await c.req.json());
  const db = getSupabase();

  await checkAgentAccess(user.id, agentId, "editor");

  const { data, error } = await db
    .from("data_pipelines")
    .insert({ ...body, agent_id: agentId, owner_id: user.id })
    .select()
    .single();

  if (error) {
    throw new HTTPException(500, { message: error.message });
  }

  await writeAuditLog(
    {
      action: "data_pipeline.created",
      resourceType: "data_pipeline",
      resourceId: data.id,
      agentId,
      evidence: { name: body.name },
    },
    c,
  );

  return c.json(data, 201);
});

/** GET / -- List pipelines. Requires viewer+ access. */
pipelineRoutes.get("/", async (c) => {
  const user = c.get("user");
  const agentId = getAgentId(c);
  const query = parseQuery(listPipelinesQuery, c.req.query());
  const db = getSupabase();

  await checkAgentAccess(user.id, agentId, "viewer");

  let q = db
    .from("data_pipelines")
    .select("*", { count: "exact" })
    .eq("agent_id", agentId)
    .order("created_at", { ascending: false })
    .range(query.offset, query.offset + query.limit - 1);

  if (query.is_active !== undefined) q = q.eq("is_active", query.is_active);

  const { data, error, count } = await q;

  if (error) {
    throw new HTTPException(500, { message: error.message });
  }

  return c.json({ data, total: count, limit: query.limit, offset: query.offset });
});

/** GET /:pipelineId -- Get pipeline detail with step count. Requires viewer+ access. */
pipelineRoutes.get("/:pipelineId", async (c) => {
  const user = c.get("user");
  const agentId = getAgentId(c);
  const pipelineId = c.req.param("pipelineId");
  const db = getSupabase();

  await checkAgentAccess(user.id, agentId, "viewer");

  const { data, error } = await db
    .from("data_pipelines")
    .select()
    .eq("id", pipelineId)
    .eq("agent_id", agentId)
    .single();

  if (error || !data) {
    throw new HTTPException(404, { message: "Pipeline not found" });
  }

  // Include step count.
  const { count } = await db
    .from("pipeline_steps")
    .select("id", { count: "exact", head: true })
    .eq("pipeline_id", pipelineId);

  return c.json({ ...data, step_count: count ?? 0 });
});

/** PATCH /:pipelineId -- Update a pipeline. Requires editor+ access. */
pipelineRoutes.patch("/:pipelineId", async (c) => {
  const user = c.get("user");
  const agentId = getAgentId(c);
  const pipelineId = c.req.param("pipelineId");
  const body = parseBody(updatePipelineSchema, await c.req.json());
  const db = getSupabase();

  await checkAgentAccess(user.id, agentId, "editor");

  const { data: existing, error: fetchErr } = await db
    .from("data_pipelines")
    .select("id")
    .eq("id", pipelineId)
    .eq("agent_id", agentId)
    .single();

  if (fetchErr || !existing) {
    throw new HTTPException(404, { message: "Pipeline not found" });
  }

  const { data, error } = await db
    .from("data_pipelines")
    .update(body)
    .eq("id", pipelineId)
    .select()
    .single();

  if (error) {
    throw new HTTPException(500, { message: error.message });
  }

  await writeAuditLog(
    {
      action: "data_pipeline.updated",
      resourceType: "data_pipeline",
      resourceId: pipelineId,
      agentId,
      evidence: { changes: Object.keys(body) },
    },
    c,
  );

  return c.json(data);
});

/** DELETE /:pipelineId -- Delete a pipeline (cascades to steps). Requires admin+ access. */
pipelineRoutes.delete("/:pipelineId", async (c) => {
  const user = c.get("user");
  const agentId = getAgentId(c);
  const pipelineId = c.req.param("pipelineId");
  const db = getSupabase();

  await checkAgentAccess(user.id, agentId, "admin");

  const { data: existing, error: fetchErr } = await db
    .from("data_pipelines")
    .select("id, name")
    .eq("id", pipelineId)
    .eq("agent_id", agentId)
    .single();

  if (fetchErr || !existing) {
    throw new HTTPException(404, { message: "Pipeline not found" });
  }

  const { error } = await db.from("data_pipelines").delete().eq("id", pipelineId);

  if (error) {
    throw new HTTPException(500, { message: error.message });
  }

  await writeAuditLog(
    {
      action: "data_pipeline.deleted",
      resourceType: "data_pipeline",
      resourceId: pipelineId,
      agentId,
      evidence: { name: existing.name },
    },
    c,
  );

  return c.json({ deleted: true });
});

// =============================================================================
// Step routes (nested under pipelines)
// =============================================================================

export const pipelineStepRoutes = new Hono<AppEnv>();

const stepTypes = [
  "extract",
  "transform",
  "load",
  "validate",
  "enrich",
  "branch",
  "custom",
] as const;

const createStepSchema = z.object({
  name: z.string().min(1).max(255),
  step_type: z.enum(stepTypes),
  config: z.record(z.unknown()).default({}),
  sort_order: z.number().int().default(0),
  connector_id: z.string().uuid().nullable().default(null),
  is_active: z.boolean().default(true),
  metadata: z.record(z.unknown()).default({}),
});

const updateStepSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  step_type: z.enum(stepTypes).optional(),
  config: z.record(z.unknown()).optional(),
  sort_order: z.number().int().optional(),
  connector_id: z.string().uuid().nullable().optional(),
  is_active: z.boolean().optional(),
  metadata: z.record(z.unknown()).optional(),
});

const listStepsQuery = z.object({
  is_active: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

function getPipelineId(c: { req: { param: (name: string) => string | undefined } }): string {
  const pipelineId = c.req.param("pipelineId");
  if (!pipelineId) {
    throw new HTTPException(400, { message: "Missing pipelineId parameter" });
  }
  return pipelineId;
}

/** POST / -- Create a pipeline step. Requires editor+ access. */
pipelineStepRoutes.post("/", async (c) => {
  const user = c.get("user");
  const agentId = getAgentId(c);
  const pipelineId = getPipelineId(c);
  const body = parseBody(createStepSchema, await c.req.json());
  const db = getSupabase();

  await checkAgentAccess(user.id, agentId, "editor");

  // Verify pipeline belongs to this agent.
  const { data: pipeline, error: pipeErr } = await db
    .from("data_pipelines")
    .select("id")
    .eq("id", pipelineId)
    .eq("agent_id", agentId)
    .single();

  if (pipeErr || !pipeline) {
    throw new HTTPException(404, { message: "Pipeline not found" });
  }

  const { data, error } = await db
    .from("pipeline_steps")
    .insert({ ...body, pipeline_id: pipelineId })
    .select()
    .single();

  if (error) {
    throw new HTTPException(500, { message: error.message });
  }

  return c.json(data, 201);
});

/** GET / -- List steps in a pipeline. Requires viewer+ access. */
pipelineStepRoutes.get("/", async (c) => {
  const user = c.get("user");
  const agentId = getAgentId(c);
  const pipelineId = getPipelineId(c);
  const query = parseQuery(listStepsQuery, c.req.query());
  const db = getSupabase();

  await checkAgentAccess(user.id, agentId, "viewer");

  let q = db
    .from("pipeline_steps")
    .select("*", { count: "exact" })
    .eq("pipeline_id", pipelineId)
    .order("sort_order", { ascending: true })
    .range(query.offset, query.offset + query.limit - 1);

  if (query.is_active !== undefined) q = q.eq("is_active", query.is_active);

  const { data, error, count } = await q;

  if (error) {
    throw new HTTPException(500, { message: error.message });
  }

  return c.json({ data, total: count, limit: query.limit, offset: query.offset });
});

/** PATCH /:stepId -- Update a step. Requires editor+ access. */
pipelineStepRoutes.patch("/:stepId", async (c) => {
  const user = c.get("user");
  const agentId = getAgentId(c);
  const stepId = c.req.param("stepId");
  const body = parseBody(updateStepSchema, await c.req.json());
  const db = getSupabase();

  await checkAgentAccess(user.id, agentId, "editor");

  const pipelineId = getPipelineId(c);

  // Verify step belongs to this pipeline.
  const { data: existing, error: fetchErr } = await db
    .from("pipeline_steps")
    .select()
    .eq("id", stepId)
    .eq("pipeline_id", pipelineId)
    .single();

  if (fetchErr || !existing) {
    throw new HTTPException(404, { message: "Pipeline step not found" });
  }

  const { data, error } = await db
    .from("pipeline_steps")
    .update(body)
    .eq("id", stepId)
    .select()
    .single();

  if (error) {
    throw new HTTPException(500, { message: error.message });
  }

  return c.json(data);
});

/** DELETE /:stepId -- Delete a step. Requires editor+ access. */
pipelineStepRoutes.delete("/:stepId", async (c) => {
  const user = c.get("user");
  const agentId = getAgentId(c);
  const stepId = c.req.param("stepId");
  const db = getSupabase();

  await checkAgentAccess(user.id, agentId, "editor");

  const pipelineId = getPipelineId(c);

  const { data: existing, error: fetchErr } = await db
    .from("pipeline_steps")
    .select("id")
    .eq("id", stepId)
    .eq("pipeline_id", pipelineId)
    .single();

  if (fetchErr || !existing) {
    throw new HTTPException(404, { message: "Pipeline step not found" });
  }

  const { error } = await db.from("pipeline_steps").delete().eq("id", stepId);

  if (error) {
    throw new HTTPException(500, { message: error.message });
  }

  return c.json({ deleted: true });
});

// =============================================================================
// Run routes
// =============================================================================

export const pipelineRunRoutes = new Hono<AppEnv>();

const triggerRunSchema = z.object({
  pipeline_id: z.string().uuid(),
  metadata: z.record(z.unknown()).default({}),
});

const listRunsQuery = z.object({
  pipeline_id: z.string().uuid().optional(),
  status: z
    .enum(["pending", "running", "completed", "failed", "cancelled"])
    .optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

/**
 * POST / -- Trigger a pipeline run.
 *
 * Validates the pipeline belongs to the agent, checks concurrency limits,
 * then delegates to the pipeline execution engine.
 *
 * Requires editor+ access.
 */
pipelineRunRoutes.post("/", async (c) => {
  const user = c.get("user");
  const agentId = getAgentId(c);
  const body = parseBody(triggerRunSchema, await c.req.json());
  const db = getSupabase();

  await checkAgentAccess(user.id, agentId, "editor");

  // Verify pipeline belongs to this agent.
  const { data: pipeline, error: pipeErr } = await db
    .from("data_pipelines")
    .select("id, name, max_concurrency, is_active")
    .eq("id", body.pipeline_id)
    .eq("agent_id", agentId)
    .single();

  if (pipeErr || !pipeline) {
    throw new HTTPException(404, { message: "Pipeline not found" });
  }

  if (!pipeline.is_active) {
    throw new HTTPException(400, { message: "Pipeline is not active" });
  }

  // Check concurrency limit.
  const { count: activeRuns } = await db
    .from("pipeline_runs")
    .select("id", { count: "exact", head: true })
    .eq("pipeline_id", body.pipeline_id)
    .in("status", ["pending", "running"]);

  if ((activeRuns ?? 0) >= pipeline.max_concurrency) {
    throw new HTTPException(429, {
      message: `Pipeline concurrency limit reached (${pipeline.max_concurrency})`,
    });
  }

  // Execute pipeline.
  const run = await executePipeline(body.pipeline_id, agentId, user.id);

  await writeAuditLog(
    {
      action: "pipeline_run.completed",
      resourceType: "pipeline_run",
      resourceId: run.id,
      agentId,
      evidence: {
        pipeline_name: pipeline.name,
        status: run.status,
        records_read: run.records_read,
        records_written: run.records_written,
      },
    },
    c,
  );

  return c.json(run, 201);
});

/** GET / -- List pipeline runs. Requires viewer+ access. */
pipelineRunRoutes.get("/", async (c) => {
  const user = c.get("user");
  const agentId = getAgentId(c);
  const query = parseQuery(listRunsQuery, c.req.query());
  const db = getSupabase();

  await checkAgentAccess(user.id, agentId, "viewer");

  let q = db
    .from("pipeline_runs")
    .select("*", { count: "exact" })
    .eq("agent_id", agentId)
    .order("created_at", { ascending: false })
    .range(query.offset, query.offset + query.limit - 1);

  if (query.pipeline_id) q = q.eq("pipeline_id", query.pipeline_id);
  if (query.status) q = q.eq("status", query.status);

  const { data, error, count } = await q;

  if (error) {
    throw new HTTPException(500, { message: error.message });
  }

  return c.json({ data, total: count, limit: query.limit, offset: query.offset });
});

/** GET /:runId -- Get run detail with step results. Requires viewer+ access. */
pipelineRunRoutes.get("/:runId", async (c) => {
  const user = c.get("user");
  const agentId = getAgentId(c);
  const runId = c.req.param("runId");
  const db = getSupabase();

  await checkAgentAccess(user.id, agentId, "viewer");

  const { data: run, error: runErr } = await db
    .from("pipeline_runs")
    .select()
    .eq("id", runId)
    .eq("agent_id", agentId)
    .single();

  if (runErr || !run) {
    throw new HTTPException(404, { message: "Pipeline run not found" });
  }

  return c.json(run);
});
