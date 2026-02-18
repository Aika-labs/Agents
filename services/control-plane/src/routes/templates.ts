/**
 * Creation Layer routes.
 *
 * Four route groups:
 *
 *   Templates (/templates):
 *     POST   /                       -- Create a template
 *     GET    /                       -- List templates (own + public)
 *     GET    /:templateId            -- Get template detail
 *     PATCH  /:templateId            -- Update a template
 *     DELETE /:templateId            -- Delete a template
 *     POST   /:templateId/instantiate -- Create agent from template
 *     POST   /:templateId/extract    -- Create template from existing agent
 *
 *   Versions (/templates/:templateId/versions):
 *     POST   /                       -- Publish a new version
 *     GET    /                       -- List versions
 *     GET    /:versionNumber         -- Get version detail
 *     GET    /diff?a=N&b=M           -- Diff two versions
 *
 *   Deployments (/agents/:agentId/deployments):
 *     POST   /                       -- Create a deployment
 *     GET    /                       -- List deployments
 *     GET    /active                 -- Get active deployment
 *     GET    /:deploymentId          -- Get deployment detail
 *     PATCH  /:deploymentId/status   -- Transition deployment status
 */

import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { getSupabase } from "../lib/supabase.js";
import { parseBody, parseQuery } from "../lib/validate.js";
import { checkAgentAccess } from "../lib/permissions.js";
import {
  instantiateTemplate,
  publishVersion,
  diffVersions,
  createDeployment,
  getActiveDeployment,
  transitionDeployment,
  extractTemplateFromAgent,
} from "../lib/templates.js";
import { writeAuditLog } from "../lib/audit.js";
import type { AppEnv } from "../types/env.js";

// =============================================================================
// Template routes
// =============================================================================

export const templateRoutes = new Hono<AppEnv>();

const templateCategories = [
  "assistant",
  "coding",
  "data",
  "research",
  "customer_support",
  "automation",
  "creative",
  "custom",
] as const;

const agentFrameworks = [
  "langchain",
  "autogen",
  "crewai",
  "openai_assistants",
  "custom",
] as const;

const createTemplateSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(2000).optional(),
  category: z.enum(templateCategories).default("custom"),
  framework: z.enum(agentFrameworks).default("custom"),
  model_config: z.record(z.unknown()).default({}),
  system_prompt: z.string().max(100000).nullable().default(null),
  tools: z.array(z.unknown()).default([]),
  mcp_servers: z.array(z.unknown()).default([]),
  a2a_config: z.record(z.unknown()).default({}),
  default_tags: z.array(z.string()).default([]),
  is_public: z.boolean().default(false),
  metadata: z.record(z.unknown()).default({}),
});

const updateTemplateSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().max(2000).nullable().optional(),
  category: z.enum(templateCategories).optional(),
  framework: z.enum(agentFrameworks).optional(),
  model_config: z.record(z.unknown()).optional(),
  system_prompt: z.string().max(100000).nullable().optional(),
  tools: z.array(z.unknown()).optional(),
  mcp_servers: z.array(z.unknown()).optional(),
  a2a_config: z.record(z.unknown()).optional(),
  default_tags: z.array(z.string()).optional(),
  is_public: z.boolean().optional(),
  is_active: z.boolean().optional(),
  metadata: z.record(z.unknown()).optional(),
});

const listTemplatesQuery = z.object({
  category: z.enum(templateCategories).optional(),
  is_public: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

const instantiateSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  extra_tags: z.array(z.string()).default([]),
  model_config_overrides: z.record(z.unknown()).optional(),
  system_prompt: z.string().max(100000).optional(),
  metadata: z.record(z.unknown()).default({}),
});

const extractSchema = z.object({
  agent_id: z.string().uuid(),
  name: z.string().min(1).max(255),
  category: z.enum(templateCategories).default("custom"),
});

/** POST / -- Create a template. */
templateRoutes.post("/", async (c) => {
  const user = c.get("user");
  const body = parseBody(createTemplateSchema, await c.req.json());
  const db = getSupabase();

  const { data, error } = await db
    .from("agent_templates")
    .insert({ ...body, owner_id: user.id })
    .select()
    .single();

  if (error) {
    throw new HTTPException(500, { message: error.message });
  }

  await writeAuditLog(
    {
      action: "template.created",
      resourceType: "agent_template",
      resourceId: data.id,
      evidence: { name: body.name, category: body.category },
    },
    c,
  );

  return c.json(data, 201);
});

/** GET / -- List templates (own + public). */
templateRoutes.get("/", async (c) => {
  const user = c.get("user");
  const query = parseQuery(listTemplatesQuery, c.req.query());
  const db = getSupabase();

  // Build query: own templates + public templates.
  let q = db
    .from("agent_templates")
    .select("*", { count: "exact" })
    .eq("is_active", true)
    .or(`owner_id.eq.${user.id},is_public.eq.true`)
    .order("use_count", { ascending: false })
    .range(query.offset, query.offset + query.limit - 1);

  if (query.category) q = q.eq("category", query.category);
  if (query.is_public !== undefined) q = q.eq("is_public", query.is_public);

  const { data, error, count } = await q;

  if (error) {
    throw new HTTPException(500, { message: error.message });
  }

  return c.json({ data, total: count, limit: query.limit, offset: query.offset });
});

/** GET /:templateId -- Get template detail. */
templateRoutes.get("/:templateId", async (c) => {
  const user = c.get("user");
  const templateId = c.req.param("templateId");
  const db = getSupabase();

  const { data, error } = await db
    .from("agent_templates")
    .select()
    .eq("id", templateId)
    .or(`owner_id.eq.${user.id},is_public.eq.true`)
    .single();

  if (error || !data) {
    throw new HTTPException(404, { message: "Template not found" });
  }

  // Include version count.
  const { count } = await db
    .from("template_versions")
    .select("id", { count: "exact", head: true })
    .eq("template_id", templateId);

  return c.json({ ...data, version_count: count ?? 0 });
});

/** PATCH /:templateId -- Update a template. Owner only. */
templateRoutes.patch("/:templateId", async (c) => {
  const user = c.get("user");
  const templateId = c.req.param("templateId");
  const body = parseBody(updateTemplateSchema, await c.req.json());
  const db = getSupabase();

  const { data: existing, error: fetchErr } = await db
    .from("agent_templates")
    .select("id")
    .eq("id", templateId)
    .eq("owner_id", user.id)
    .single();

  if (fetchErr || !existing) {
    throw new HTTPException(404, { message: "Template not found or not owned by you" });
  }

  const { data, error } = await db
    .from("agent_templates")
    .update(body)
    .eq("id", templateId)
    .select()
    .single();

  if (error) {
    throw new HTTPException(500, { message: error.message });
  }

  await writeAuditLog(
    {
      action: "template.updated",
      resourceType: "agent_template",
      resourceId: templateId,
      evidence: { changes: Object.keys(body) },
    },
    c,
  );

  return c.json(data);
});

/** DELETE /:templateId -- Delete a template. Owner only. */
templateRoutes.delete("/:templateId", async (c) => {
  const user = c.get("user");
  const templateId = c.req.param("templateId");
  const db = getSupabase();

  const { data: existing, error: fetchErr } = await db
    .from("agent_templates")
    .select("id, name")
    .eq("id", templateId)
    .eq("owner_id", user.id)
    .single();

  if (fetchErr || !existing) {
    throw new HTTPException(404, { message: "Template not found or not owned by you" });
  }

  const { error } = await db.from("agent_templates").delete().eq("id", templateId);

  if (error) {
    throw new HTTPException(500, { message: error.message });
  }

  await writeAuditLog(
    {
      action: "template.deleted",
      resourceType: "agent_template",
      resourceId: templateId,
      evidence: { name: existing.name },
    },
    c,
  );

  return c.json({ deleted: true });
});

/** POST /:templateId/instantiate -- Create an agent from a template. */
templateRoutes.post("/:templateId/instantiate", async (c) => {
  const user = c.get("user");
  const templateId = c.req.param("templateId");
  const body = parseBody(instantiateSchema, await c.req.json());

  const agent = await instantiateTemplate(templateId, user.id, {
    name: body.name,
    extraTags: body.extra_tags,
    modelConfigOverrides: body.model_config_overrides,
    systemPrompt: body.system_prompt,
    metadata: body.metadata,
  });

  await writeAuditLog(
    {
      action: "template.instantiated",
      resourceType: "agent_template",
      resourceId: templateId,
      agentId: agent.id,
      evidence: { agent_name: agent.name },
    },
    c,
  );

  return c.json(agent, 201);
});

/** POST /:templateId/extract -- Create a template from an existing agent. */
templateRoutes.post("/:templateId/extract", async (c) => {
  const user = c.get("user");
  const body = parseBody(extractSchema, await c.req.json());

  // Verify user has access to the source agent.
  await checkAgentAccess(user.id, body.agent_id, "viewer");

  const template = await extractTemplateFromAgent(
    body.agent_id,
    user.id,
    body.name,
    body.category,
  );

  await writeAuditLog(
    {
      action: "template.extracted",
      resourceType: "agent_template",
      resourceId: template.id,
      agentId: body.agent_id,
      evidence: { template_name: body.name },
    },
    c,
  );

  return c.json(template, 201);
});

// =============================================================================
// Version routes (nested under templates)
// =============================================================================

export const templateVersionRoutes = new Hono<AppEnv>();

const publishVersionSchema = z.object({
  changelog: z.string().max(5000).optional(),
});

const listVersionsQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

const diffQuery = z.object({
  a: z.coerce.number().int().min(1),
  b: z.coerce.number().int().min(1),
});

function getTemplateId(c: { req: { param: (name: string) => string | undefined } }): string {
  const templateId = c.req.param("templateId");
  if (!templateId) {
    throw new HTTPException(400, { message: "Missing templateId parameter" });
  }
  return templateId;
}

/** POST / -- Publish a new version. Owner only. */
templateVersionRoutes.post("/", async (c) => {
  const user = c.get("user");
  const templateId = getTemplateId(c);
  const body = parseBody(publishVersionSchema, await c.req.json());
  const db = getSupabase();

  // Verify ownership.
  const { data: template, error: tplErr } = await db
    .from("agent_templates")
    .select("id")
    .eq("id", templateId)
    .eq("owner_id", user.id)
    .single();

  if (tplErr || !template) {
    throw new HTTPException(404, { message: "Template not found or not owned by you" });
  }

  const version = await publishVersion(templateId, user.id, body.changelog);

  await writeAuditLog(
    {
      action: "template_version.published",
      resourceType: "template_version",
      resourceId: version.id,
      evidence: { template_id: templateId, version: version.version_number },
    },
    c,
  );

  return c.json(version, 201);
});

/** GET / -- List versions. */
templateVersionRoutes.get("/", async (c) => {
  const user = c.get("user");
  const templateId = getTemplateId(c);
  const query = parseQuery(listVersionsQuery, c.req.query());
  const db = getSupabase();

  // Verify template is accessible.
  const { data: template, error: tplErr } = await db
    .from("agent_templates")
    .select("id")
    .eq("id", templateId)
    .or(`owner_id.eq.${user.id},is_public.eq.true`)
    .single();

  if (tplErr || !template) {
    throw new HTTPException(404, { message: "Template not found" });
  }

  const { data, error, count } = await db
    .from("template_versions")
    .select("*", { count: "exact" })
    .eq("template_id", templateId)
    .order("version_number", { ascending: false })
    .range(query.offset, query.offset + query.limit - 1);

  if (error) {
    throw new HTTPException(500, { message: error.message });
  }

  return c.json({ data, total: count, limit: query.limit, offset: query.offset });
});

/** GET /diff?a=N&b=M -- Diff two versions. */
templateVersionRoutes.get("/diff", async (c) => {
  const user = c.get("user");
  const templateId = getTemplateId(c);
  const query = parseQuery(diffQuery, c.req.query());
  const db = getSupabase();

  // Verify template is accessible.
  const { data: template, error: tplErr } = await db
    .from("agent_templates")
    .select("id")
    .eq("id", templateId)
    .or(`owner_id.eq.${user.id},is_public.eq.true`)
    .single();

  if (tplErr || !template) {
    throw new HTTPException(404, { message: "Template not found" });
  }

  const changes = await diffVersions(templateId, query.a, query.b);

  return c.json({
    template_id: templateId,
    version_a: query.a,
    version_b: query.b,
    changes,
  });
});

/** GET /:versionNumber -- Get a specific version. */
templateVersionRoutes.get("/:versionNumber", async (c) => {
  const user = c.get("user");
  const templateId = getTemplateId(c);
  const versionNumber = parseInt(c.req.param("versionNumber") ?? "", 10);
  const db = getSupabase();

  if (isNaN(versionNumber)) {
    throw new HTTPException(400, { message: "Invalid version number" });
  }

  // Verify template is accessible.
  const { data: template, error: tplErr } = await db
    .from("agent_templates")
    .select("id")
    .eq("id", templateId)
    .or(`owner_id.eq.${user.id},is_public.eq.true`)
    .single();

  if (tplErr || !template) {
    throw new HTTPException(404, { message: "Template not found" });
  }

  const { data, error } = await db
    .from("template_versions")
    .select()
    .eq("template_id", templateId)
    .eq("version_number", versionNumber)
    .single();

  if (error || !data) {
    throw new HTTPException(404, { message: "Version not found" });
  }

  return c.json(data);
});

// =============================================================================
// Deployment routes (under /agents/:agentId/deployments)
// =============================================================================

export const deploymentRoutes = new Hono<AppEnv>();

/** Extract and validate the agentId path parameter from the parent route. */
function getAgentId(c: { req: { param: (name: string) => string | undefined } }): string {
  const agentId = c.req.param("agentId");
  if (!agentId) {
    throw new HTTPException(400, { message: "Missing agentId parameter" });
  }
  return agentId;
}

const createDeploymentSchema = z.object({
  target: z.string().min(1).max(100).default("cloud-run"),
  template_id: z.string().uuid().nullable().default(null),
  template_version: z.number().int().nullable().default(null),
  config: z.record(z.unknown()).default({}),
});

const transitionStatusSchema = z.object({
  status: z.enum([
    "pending",
    "building",
    "deploying",
    "running",
    "stopped",
    "failed",
    "rolled_back",
  ]),
  error_message: z.string().max(5000).optional(),
  runtime_info: z.record(z.unknown()).optional(),
});

const listDeploymentsQuery = z.object({
  status: z
    .enum(["pending", "building", "deploying", "running", "stopped", "failed", "rolled_back"])
    .optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

/** POST / -- Create a deployment. Requires editor+ access. */
deploymentRoutes.post("/", async (c) => {
  const user = c.get("user");
  const agentId = getAgentId(c);
  const body = parseBody(createDeploymentSchema, await c.req.json());

  await checkAgentAccess(user.id, agentId, "editor");

  const deployment = await createDeployment(agentId, user.id, {
    target: body.target,
    templateId: body.template_id ?? undefined,
    templateVersion: body.template_version ?? undefined,
    config: body.config,
  });

  await writeAuditLog(
    {
      action: "deployment.created",
      resourceType: "agent_deployment",
      resourceId: deployment.id,
      agentId,
      evidence: { target: body.target },
    },
    c,
  );

  return c.json(deployment, 201);
});

/** GET / -- List deployments. Requires viewer+ access. */
deploymentRoutes.get("/", async (c) => {
  const user = c.get("user");
  const agentId = getAgentId(c);
  const query = parseQuery(listDeploymentsQuery, c.req.query());
  const db = getSupabase();

  await checkAgentAccess(user.id, agentId, "viewer");

  let q = db
    .from("agent_deployments")
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

/** GET /active -- Get the currently running deployment. Requires viewer+ access. */
deploymentRoutes.get("/active", async (c) => {
  const user = c.get("user");
  const agentId = getAgentId(c);

  await checkAgentAccess(user.id, agentId, "viewer");

  const deployment = await getActiveDeployment(agentId);

  if (!deployment) {
    throw new HTTPException(404, { message: "No active deployment found" });
  }

  return c.json(deployment);
});

/** GET /:deploymentId -- Get deployment detail. Requires viewer+ access. */
deploymentRoutes.get("/:deploymentId", async (c) => {
  const user = c.get("user");
  const agentId = getAgentId(c);
  const deploymentId = c.req.param("deploymentId");
  const db = getSupabase();

  await checkAgentAccess(user.id, agentId, "viewer");

  const { data, error } = await db
    .from("agent_deployments")
    .select()
    .eq("id", deploymentId)
    .eq("agent_id", agentId)
    .single();

  if (error || !data) {
    throw new HTTPException(404, { message: "Deployment not found" });
  }

  return c.json(data);
});

/** PATCH /:deploymentId/status -- Transition deployment status. Requires admin+ access. */
deploymentRoutes.patch("/:deploymentId/status", async (c) => {
  const user = c.get("user");
  const agentId = getAgentId(c);
  const deploymentId = c.req.param("deploymentId");
  const body = parseBody(transitionStatusSchema, await c.req.json());

  await checkAgentAccess(user.id, agentId, "admin");

  const updated = await transitionDeployment(deploymentId, body.status, {
    errorMessage: body.error_message,
    runtimeInfo: body.runtime_info,
  });

  await writeAuditLog(
    {
      action: "deployment.status_changed",
      resourceType: "agent_deployment",
      resourceId: deploymentId,
      agentId,
      evidence: { new_status: body.status },
    },
    c,
  );

  return c.json(updated);
});
