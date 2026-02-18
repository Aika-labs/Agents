import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { getSupabase } from "../lib/supabase.js";
import { parseBody, parseQuery } from "../lib/validate.js";
import { writeAuditLog } from "../lib/audit.js";
import type { FeatureFlagRow } from "../types/database.js";
import type { AppEnv } from "../types/env.js";

export const featureFlagRoutes = new Hono<AppEnv>();

// -- Zod schemas --------------------------------------------------------------

const flagScopes = ["platform", "agent", "user"] as const;

const createFlagSchema = z.object({
  key: z.string().min(1).max(255).regex(/^[a-z0-9_]+$/, {
    message: "Flag key must be lowercase alphanumeric with underscores only",
  }),
  name: z.string().min(1).max(255),
  description: z.string().max(2000).optional(),
  scope: z.enum(flagScopes).default("agent"),
  enabled: z.boolean().default(false),
  rollout_pct: z.number().int().min(0).max(100).default(100),
  targeting_rules: z.array(z.unknown()).default([]),
  agent_id: z.string().uuid().nullable().optional(),
  starts_at: z.string().datetime().nullable().optional(),
  expires_at: z.string().datetime().nullable().optional(),
  metadata: z.record(z.unknown()).default({}),
});

const updateFlagSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().max(2000).nullable().optional(),
  enabled: z.boolean().optional(),
  rollout_pct: z.number().int().min(0).max(100).optional(),
  targeting_rules: z.array(z.unknown()).optional(),
  starts_at: z.string().datetime().nullable().optional(),
  expires_at: z.string().datetime().nullable().optional(),
  metadata: z.record(z.unknown()).optional(),
});

const listFlagsQuery = z.object({
  scope: z.enum(flagScopes).optional(),
  agent_id: z.string().uuid().optional(),
  enabled: z
    .enum(["true", "false"])
    .transform((v) => v === "true")
    .optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

const evaluateFlagSchema = z.object({
  key: z.string().min(1),
  agent_id: z.string().uuid().optional(),
  context: z.record(z.unknown()).default({}),
});

// -- Routes -------------------------------------------------------------------

/** POST / -- Create a new feature flag. Owner is the authenticated user. */
featureFlagRoutes.post("/", async (c) => {
  const user = c.get("user");
  const body = parseBody(createFlagSchema, await c.req.json());
  const db = getSupabase();

  const { data, error } = await db
    .from("feature_flags")
    .insert({
      owner_id: user.id,
      key: body.key,
      name: body.name,
      description: body.description ?? null,
      scope: body.scope,
      enabled: body.enabled,
      rollout_pct: body.rollout_pct,
      targeting_rules: body.targeting_rules,
      agent_id: body.agent_id ?? null,
      starts_at: body.starts_at ?? null,
      expires_at: body.expires_at ?? null,
      metadata: body.metadata,
    })
    .select()
    .single();

  if (error) {
    if (error.code === "23505") {
      throw new HTTPException(409, {
        message: `Flag with key '${body.key}' already exists for this owner/agent`,
      });
    }
    throw new HTTPException(500, { message: error.message });
  }

  const flag = data as FeatureFlagRow;

  await writeAuditLog(
    {
      action: "flag.created",
      resourceType: "feature_flag",
      resourceId: flag.id,
      agentId: body.agent_id ?? null,
      evidence: { key: body.key, scope: body.scope, enabled: body.enabled },
    },
    c,
  );

  return c.json(flag, 201);
});

/** GET / -- List feature flags owned by the authenticated user. */
featureFlagRoutes.get("/", async (c) => {
  const user = c.get("user");
  const query = parseQuery(listFlagsQuery, c.req.query());
  const db = getSupabase();

  let q = db
    .from("feature_flags")
    .select("*", { count: "exact" })
    .eq("owner_id", user.id)
    .order("created_at", { ascending: false })
    .range(query.offset, query.offset + query.limit - 1);

  if (query.scope) q = q.eq("scope", query.scope);
  if (query.agent_id) q = q.eq("agent_id", query.agent_id);
  if (query.enabled !== undefined) q = q.eq("enabled", query.enabled);

  const { data, error, count } = await q;

  if (error) {
    throw new HTTPException(500, { message: error.message });
  }

  return c.json({
    data: data as FeatureFlagRow[],
    total: count,
    limit: query.limit,
    offset: query.offset,
  });
});

/** GET /:id -- Get a single feature flag (must be owned by user). */
featureFlagRoutes.get("/:id", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const db = getSupabase();

  const { data, error } = await db
    .from("feature_flags")
    .select()
    .eq("id", id)
    .eq("owner_id", user.id)
    .single();

  if (error || !data) {
    throw new HTTPException(404, { message: "Feature flag not found" });
  }

  return c.json(data as FeatureFlagRow);
});

/** PATCH /:id -- Update a feature flag. */
featureFlagRoutes.patch("/:id", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const body = parseBody(updateFlagSchema, await c.req.json());
  const db = getSupabase();

  const { data: current, error: fetchErr } = await db
    .from("feature_flags")
    .select()
    .eq("id", id)
    .eq("owner_id", user.id)
    .single();

  if (fetchErr || !current) {
    throw new HTTPException(404, { message: "Feature flag not found" });
  }

  const flag = current as FeatureFlagRow;

  const { data, error } = await db
    .from("feature_flags")
    .update(body)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    throw new HTTPException(500, { message: error.message });
  }

  const updated = data as FeatureFlagRow;

  // Log toggle events with higher visibility.
  const wasToggled =
    body.enabled !== undefined && body.enabled !== flag.enabled;

  await writeAuditLog(
    {
      action: wasToggled ? "flag.toggled" : "flag.updated",
      severity: wasToggled ? "warning" : "info",
      resourceType: "feature_flag",
      resourceId: id,
      agentId: flag.agent_id,
      evidence: {
        key: flag.key,
        before: { enabled: flag.enabled, rollout_pct: flag.rollout_pct },
        after: {
          enabled: updated.enabled,
          rollout_pct: updated.rollout_pct,
        },
        changes: Object.keys(body),
      },
    },
    c,
  );

  return c.json(updated);
});

/** DELETE /:id -- Delete a feature flag. */
featureFlagRoutes.delete("/:id", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const db = getSupabase();

  const { data: current, error: fetchErr } = await db
    .from("feature_flags")
    .select("id, owner_id, key, agent_id")
    .eq("id", id)
    .eq("owner_id", user.id)
    .single();

  if (fetchErr || !current) {
    throw new HTTPException(404, { message: "Feature flag not found" });
  }

  const flag = current as Pick<
    FeatureFlagRow,
    "id" | "owner_id" | "key" | "agent_id"
  >;

  const { error } = await db.from("feature_flags").delete().eq("id", id);

  if (error) {
    throw new HTTPException(500, { message: error.message });
  }

  await writeAuditLog(
    {
      action: "flag.deleted",
      resourceType: "feature_flag",
      resourceId: id,
      agentId: flag.agent_id,
      evidence: { key: flag.key },
    },
    c,
  );

  return c.json({ deleted: true });
});

/** POST /evaluate -- Evaluate whether a flag is active for the current user. */
featureFlagRoutes.post("/evaluate", async (c) => {
  const user = c.get("user");
  const body = parseBody(evaluateFlagSchema, await c.req.json());
  const db = getSupabase();

  // Look up the flag by key + owner, optionally scoped to an agent.
  let q = db
    .from("feature_flags")
    .select()
    .eq("key", body.key)
    .eq("owner_id", user.id);

  if (body.agent_id) {
    // Try agent-specific flag first, fall back to non-agent-scoped.
    q = q.or(`agent_id.eq.${body.agent_id},agent_id.is.null`);
  } else {
    q = q.is("agent_id", null);
  }

  const { data, error } = await q
    .order("agent_id", {
      ascending: false,
      nullsFirst: false,
    })
    .limit(1)
    .single();

  if (error || !data) {
    // Flag not found -- default to disabled.
    return c.json({ key: body.key, enabled: false, reason: "flag_not_found" });
  }

  const flag = data as FeatureFlagRow;

  // Check scheduling.
  const now = new Date();
  if (flag.starts_at && new Date(flag.starts_at) > now) {
    return c.json({
      key: body.key,
      enabled: false,
      reason: "not_started",
      starts_at: flag.starts_at,
    });
  }
  if (flag.expires_at && new Date(flag.expires_at) < now) {
    return c.json({
      key: body.key,
      enabled: false,
      reason: "expired",
      expires_at: flag.expires_at,
    });
  }

  // Check base enabled state.
  if (!flag.enabled) {
    return c.json({ key: body.key, enabled: false, reason: "disabled" });
  }

  // Check rollout percentage using a deterministic hash of the user ID.
  if (flag.rollout_pct < 100) {
    const hash = simpleHash(user.id + body.key);
    const bucket = hash % 100;
    if (bucket >= flag.rollout_pct) {
      return c.json({
        key: body.key,
        enabled: false,
        reason: "rollout_excluded",
        rollout_pct: flag.rollout_pct,
      });
    }
  }

  return c.json({ key: body.key, enabled: true, reason: "active" });
});

/**
 * Simple deterministic hash for rollout bucketing.
 * Not cryptographic -- just needs to be consistent and well-distributed.
 */
function simpleHash(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0; // Convert to 32-bit integer.
  }
  return Math.abs(hash);
}
