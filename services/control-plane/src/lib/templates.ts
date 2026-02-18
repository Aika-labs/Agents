/**
 * Creation Layer -- template instantiation, versioning, and deployment helpers.
 *
 * Provides:
 *   - instantiateTemplate(): clone a template's config into a new agent row.
 *   - publishVersion(): snapshot current template state as an immutable version.
 *   - Deployment state machine with valid transitions.
 */

import { getSupabase } from "./supabase.js";
import { logger } from "./logger.js";
import type {
  AgentFramework,
  DeploymentStatus,
  AgentTemplateRow,
  AgentDeploymentRow,
} from "../types/database.js";

// =============================================================================
// Template instantiation
// =============================================================================

export interface InstantiateOptions {
  /** Override the agent name (defaults to template name). */
  name?: string;
  /** Additional tags merged with template defaults. */
  extraTags?: string[];
  /** Override model config fields. */
  modelConfigOverrides?: Record<string, unknown>;
  /** Override system prompt. */
  systemPrompt?: string;
  /** Extra metadata attached to the new agent. */
  metadata?: Record<string, unknown>;
}

/**
 * Create a new agent from a template.
 *
 * Clones the template's framework, model_config, system_prompt, tools,
 * mcp_servers, a2a_config, and tags into a fresh agent row. Increments
 * the template's use_count.
 *
 * Returns the newly created agent row.
 */
export async function instantiateTemplate(
  templateId: string,
  ownerId: string,
  options: InstantiateOptions = {},
) {
  const db = getSupabase();

  // Fetch template.
  const { data: template, error: tplErr } = await db
    .from("agent_templates")
    .select()
    .eq("id", templateId)
    .eq("is_active", true)
    .single();

  if (tplErr || !template) {
    throw new Error(`Template not found or inactive: ${templateId}`);
  }

  // Merge overrides.
  const modelConfig = options.modelConfigOverrides
    ? { ...template.model_config, ...options.modelConfigOverrides }
    : template.model_config;

  const tags = [
    ...template.default_tags,
    ...(options.extraTags ?? []),
    `template:${templateId}`,
  ];

  // Create agent.
  const { data: agent, error: agentErr } = await db
    .from("agents")
    .insert({
      owner_id: ownerId,
      name: options.name ?? `${template.name} (copy)`,
      description: template.description,
      framework: template.framework,
      model_config: modelConfig,
      system_prompt: options.systemPrompt ?? template.system_prompt,
      tools: template.tools as Record<string, unknown>[],
      mcp_servers: template.mcp_servers as Record<string, unknown>[],
      a2a_config: template.a2a_config,
      tags,
      metadata: {
        ...(options.metadata ?? {}),
        created_from_template: templateId,
        template_version: template.current_version,
      },
    })
    .select()
    .single();

  if (agentErr || !agent) {
    throw new Error(`Failed to create agent from template: ${agentErr?.message ?? "unknown"}`);
  }

  // Increment use_count.
  await db
    .from("agent_templates")
    .update({ use_count: template.use_count + 1 })
    .eq("id", templateId);

  logger.info("Agent instantiated from template", {
    agentId: agent.id,
    templateId,
    templateVersion: template.current_version,
  });

  return agent;
}

// =============================================================================
// Version management
// =============================================================================

/**
 * Publish a new version of a template.
 *
 * Snapshots the current template configuration into an immutable
 * template_versions row and increments the template's current_version.
 */
export async function publishVersion(
  templateId: string,
  publishedBy: string,
  changelog?: string,
) {
  const db = getSupabase();

  // Fetch current template state.
  const { data: template, error: tplErr } = await db
    .from("agent_templates")
    .select()
    .eq("id", templateId)
    .single();

  if (tplErr || !template) {
    throw new Error(`Template not found: ${templateId}`);
  }

  const nextVersion = template.current_version + 1;

  // Create version snapshot.
  const { data: version, error: verErr } = await db
    .from("template_versions")
    .insert({
      template_id: templateId,
      version_number: nextVersion,
      framework: template.framework,
      model_config: template.model_config,
      system_prompt: template.system_prompt,
      tools: template.tools as Record<string, unknown>[],
      mcp_servers: template.mcp_servers as Record<string, unknown>[],
      a2a_config: template.a2a_config,
      default_tags: template.default_tags,
      changelog: changelog ?? null,
      published_by: publishedBy,
    })
    .select()
    .single();

  if (verErr || !version) {
    throw new Error(`Failed to publish version: ${verErr?.message ?? "unknown"}`);
  }

  // Update template's current_version.
  await db
    .from("agent_templates")
    .update({ current_version: nextVersion })
    .eq("id", templateId);

  logger.info("Template version published", {
    templateId,
    version: nextVersion,
  });

  return version;
}

/**
 * Compute a simple diff between two template versions.
 *
 * Returns an object listing which fields changed between the two versions.
 */
export async function diffVersions(
  templateId: string,
  versionA: number,
  versionB: number,
): Promise<Record<string, { from: unknown; to: unknown }>> {
  const db = getSupabase();

  const { data: versions, error } = await db
    .from("template_versions")
    .select()
    .eq("template_id", templateId)
    .in("version_number", [versionA, versionB])
    .order("version_number", { ascending: true });

  if (error || !versions || versions.length !== 2) {
    throw new Error("Could not fetch both versions for diff");
  }

  const a = versions[0];
  const b = versions[1];

  const diffFields: string[] = [
    "framework",
    "model_config",
    "system_prompt",
    "tools",
    "mcp_servers",
    "a2a_config",
    "default_tags",
  ];

  const changes: Record<string, { from: unknown; to: unknown }> = {};

  for (const field of diffFields) {
    const valA = JSON.stringify(a[field as keyof typeof a]);
    const valB = JSON.stringify(b[field as keyof typeof b]);
    if (valA !== valB) {
      changes[field] = {
        from: a[field as keyof typeof a],
        to: b[field as keyof typeof b],
      };
    }
  }

  return changes;
}

// =============================================================================
// Deployment state machine
// =============================================================================

/** Valid deployment status transitions. */
const DEPLOYMENT_TRANSITIONS: Record<DeploymentStatus, DeploymentStatus[]> = {
  pending: ["building", "failed", "stopped"],
  building: ["deploying", "failed", "stopped"],
  deploying: ["running", "failed", "stopped"],
  running: ["stopped", "failed"],
  stopped: ["pending"], // Allow restart.
  failed: ["pending"],  // Allow retry.
  rolled_back: ["pending"],
};

/**
 * Transition a deployment to a new status.
 *
 * Validates the transition is legal, updates timing fields, and persists.
 */
export async function transitionDeployment(
  deploymentId: string,
  newStatus: DeploymentStatus,
  extra?: {
    errorMessage?: string;
    runtimeInfo?: Record<string, unknown>;
  },
): Promise<AgentDeploymentRow> {
  const db = getSupabase();

  // Fetch current deployment.
  const { data: deployment, error: fetchErr } = await db
    .from("agent_deployments")
    .select()
    .eq("id", deploymentId)
    .single();

  if (fetchErr || !deployment) {
    throw new Error(`Deployment not found: ${deploymentId}`);
  }

  const currentStatus = deployment.status as DeploymentStatus;
  const allowed = DEPLOYMENT_TRANSITIONS[currentStatus];

  if (!allowed || !allowed.includes(newStatus)) {
    throw new Error(
      `Invalid deployment transition: ${currentStatus} -> ${newStatus}. ` +
      `Allowed: ${(allowed ?? []).join(", ")}`,
    );
  }

  // Build update payload.
  const update: Record<string, unknown> = { status: newStatus };

  if (newStatus === "building" || newStatus === "deploying") {
    update["started_at"] = new Date().toISOString();
  }
  if (newStatus === "running" || newStatus === "failed") {
    update["completed_at"] = new Date().toISOString();
  }
  if (newStatus === "stopped") {
    update["stopped_at"] = new Date().toISOString();
  }
  if (extra?.errorMessage) {
    update["error_message"] = extra.errorMessage;
  }
  if (extra?.runtimeInfo) {
    update["runtime_info"] = {
      ...(deployment.runtime_info as Record<string, unknown>),
      ...extra.runtimeInfo,
    };
  }

  const { data: updated, error: updateErr } = await db
    .from("agent_deployments")
    .update(update)
    .eq("id", deploymentId)
    .select()
    .single();

  if (updateErr || !updated) {
    throw new Error(`Failed to update deployment: ${updateErr?.message ?? "unknown"}`);
  }

  logger.info("Deployment status transitioned", {
    deploymentId,
    from: currentStatus,
    to: newStatus,
  });

  return updated;
}

/**
 * Create a new deployment record for an agent.
 */
export async function createDeployment(
  agentId: string,
  ownerId: string,
  options: {
    target?: string;
    templateId?: string;
    templateVersion?: number;
    config?: Record<string, unknown>;
  } = {},
): Promise<AgentDeploymentRow> {
  const db = getSupabase();

  // Get agent version.
  const { data: agent } = await db
    .from("agents")
    .select("version")
    .eq("id", agentId)
    .single();

  const { data: deployment, error } = await db
    .from("agent_deployments")
    .insert({
      agent_id: agentId,
      owner_id: ownerId,
      target: options.target ?? "cloud-run",
      agent_version: agent?.version ?? 1,
      template_id: options.templateId ?? null,
      template_version: options.templateVersion ?? null,
      config: options.config ?? {},
    })
    .select()
    .single();

  if (error || !deployment) {
    throw new Error(`Failed to create deployment: ${error?.message ?? "unknown"}`);
  }

  return deployment;
}

/**
 * Get the latest active deployment for an agent.
 */
export async function getActiveDeployment(
  agentId: string,
): Promise<AgentDeploymentRow | null> {
  const db = getSupabase();

  const { data } = await db
    .from("agent_deployments")
    .select()
    .eq("agent_id", agentId)
    .eq("status", "running")
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  return data ?? null;
}

/**
 * Extract a template configuration from an existing agent.
 *
 * Useful for "save as template" workflows.
 */
export async function extractTemplateFromAgent(
  agentId: string,
  ownerId: string,
  templateName: string,
  category: AgentTemplateRow["category"] = "custom",
): Promise<AgentTemplateRow> {
  const db = getSupabase();

  const { data: agent, error: agentErr } = await db
    .from("agents")
    .select()
    .eq("id", agentId)
    .single();

  if (agentErr || !agent) {
    throw new Error(`Agent not found: ${agentId}`);
  }

  const { data: template, error: tplErr } = await db
    .from("agent_templates")
    .insert({
      owner_id: ownerId,
      name: templateName,
      description: agent.description,
      category,
      framework: agent.framework as AgentFramework,
      model_config: agent.model_config as Record<string, unknown>,
      system_prompt: agent.system_prompt,
      tools: agent.tools as Record<string, unknown>[],
      mcp_servers: agent.mcp_servers as Record<string, unknown>[],
      a2a_config: agent.a2a_config as Record<string, unknown>,
      default_tags: agent.tags as string[],
      metadata: { extracted_from_agent: agentId },
    })
    .select()
    .single();

  if (tplErr || !template) {
    throw new Error(`Failed to create template: ${tplErr?.message ?? "unknown"}`);
  }

  logger.info("Template extracted from agent", {
    templateId: template.id,
    agentId,
  });

  return template;
}
