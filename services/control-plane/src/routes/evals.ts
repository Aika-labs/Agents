/**
 * Eval & Testing Framework routes.
 *
 * Three route groups mounted under /agents/:agentId:
 *
 *   Suites (/evals/suites):
 *     POST   /                -- Create a test suite
 *     GET    /                -- List suites
 *     GET    /:suiteId        -- Get suite detail
 *     PATCH  /:suiteId        -- Update a suite
 *     DELETE /:suiteId        -- Delete a suite
 *
 *   Cases (/evals/suites/:suiteId/cases):
 *     POST   /                -- Create a test case
 *     GET    /                -- List cases in a suite
 *     PATCH  /:caseId         -- Update a case
 *     DELETE /:caseId         -- Delete a case
 *
 *   Runs (/evals/runs):
 *     POST   /                -- Trigger a new eval run
 *     GET    /                -- List runs
 *     GET    /:runId          -- Get run detail with results
 */

import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { getSupabase } from "../lib/supabase.js";
import { parseBody, parseQuery } from "../lib/validate.js";
import { checkAgentAccess } from "../lib/permissions.js";
import { scoreOutput, aggregateRunResults, finalizeRun } from "../lib/evals.js";
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
// Suite routes
// =============================================================================

export const evalSuiteRoutes = new Hono<AppEnv>();

const scorerTypes = [
  "exact_match",
  "contains",
  "regex",
  "semantic",
  "json_match",
  "custom",
] as const;

const createSuiteSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(2000).optional(),
  tags: z.array(z.string()).default([]),
  is_active: z.boolean().default(true),
  metadata: z.record(z.unknown()).default({}),
});

const updateSuiteSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().max(2000).nullable().optional(),
  tags: z.array(z.string()).optional(),
  is_active: z.boolean().optional(),
  metadata: z.record(z.unknown()).optional(),
});

const listSuitesQuery = z.object({
  is_active: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

/** POST / -- Create a test suite. Requires editor+ access. */
evalSuiteRoutes.post("/", async (c) => {
  const user = c.get("user");
  const agentId = getAgentId(c);
  const body = parseBody(createSuiteSchema, await c.req.json());
  const db = getSupabase();

  await checkAgentAccess(user.id, agentId, "editor");

  const { data, error } = await db
    .from("eval_suites")
    .insert({ ...body, agent_id: agentId, owner_id: user.id })
    .select()
    .single();

  if (error) {
    throw new HTTPException(500, { message: error.message });
  }

  await writeAuditLog(
    {
      action: "eval_suite.created",
      resourceType: "eval_suite",
      resourceId: data.id,
      agentId,
      evidence: { name: body.name },
    },
    c,
  );

  return c.json(data, 201);
});

/** GET / -- List test suites. Requires viewer+ access. */
evalSuiteRoutes.get("/", async (c) => {
  const user = c.get("user");
  const agentId = getAgentId(c);
  const query = parseQuery(listSuitesQuery, c.req.query());
  const db = getSupabase();

  await checkAgentAccess(user.id, agentId, "viewer");

  let q = db
    .from("eval_suites")
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

/** GET /:suiteId -- Get suite detail with case count. Requires viewer+ access. */
evalSuiteRoutes.get("/:suiteId", async (c) => {
  const user = c.get("user");
  const agentId = getAgentId(c);
  const suiteId = c.req.param("suiteId");
  const db = getSupabase();

  await checkAgentAccess(user.id, agentId, "viewer");

  const { data, error } = await db
    .from("eval_suites")
    .select()
    .eq("id", suiteId)
    .eq("agent_id", agentId)
    .single();

  if (error || !data) {
    throw new HTTPException(404, { message: "Eval suite not found" });
  }

  // Include case count.
  const { count } = await db
    .from("eval_cases")
    .select("id", { count: "exact", head: true })
    .eq("suite_id", suiteId);

  return c.json({ ...data, case_count: count ?? 0 });
});

/** PATCH /:suiteId -- Update a suite. Requires editor+ access. */
evalSuiteRoutes.patch("/:suiteId", async (c) => {
  const user = c.get("user");
  const agentId = getAgentId(c);
  const suiteId = c.req.param("suiteId");
  const body = parseBody(updateSuiteSchema, await c.req.json());
  const db = getSupabase();

  await checkAgentAccess(user.id, agentId, "editor");

  const { data: existing, error: fetchErr } = await db
    .from("eval_suites")
    .select()
    .eq("id", suiteId)
    .eq("agent_id", agentId)
    .single();

  if (fetchErr || !existing) {
    throw new HTTPException(404, { message: "Eval suite not found" });
  }

  const { data, error } = await db
    .from("eval_suites")
    .update(body)
    .eq("id", suiteId)
    .select()
    .single();

  if (error) {
    throw new HTTPException(500, { message: error.message });
  }

  await writeAuditLog(
    {
      action: "eval_suite.updated",
      resourceType: "eval_suite",
      resourceId: suiteId,
      agentId,
      evidence: { changes: Object.keys(body) },
    },
    c,
  );

  return c.json(data);
});

/** DELETE /:suiteId -- Delete a suite (cascades to cases). Requires admin+ access. */
evalSuiteRoutes.delete("/:suiteId", async (c) => {
  const user = c.get("user");
  const agentId = getAgentId(c);
  const suiteId = c.req.param("suiteId");
  const db = getSupabase();

  await checkAgentAccess(user.id, agentId, "admin");

  const { data: existing, error: fetchErr } = await db
    .from("eval_suites")
    .select("id, name")
    .eq("id", suiteId)
    .eq("agent_id", agentId)
    .single();

  if (fetchErr || !existing) {
    throw new HTTPException(404, { message: "Eval suite not found" });
  }

  const { error } = await db.from("eval_suites").delete().eq("id", suiteId);

  if (error) {
    throw new HTTPException(500, { message: error.message });
  }

  await writeAuditLog(
    {
      action: "eval_suite.deleted",
      resourceType: "eval_suite",
      resourceId: suiteId,
      agentId,
      evidence: { name: existing.name },
    },
    c,
  );

  return c.json({ deleted: true });
});

// =============================================================================
// Case routes (nested under suites)
// =============================================================================

export const evalCaseRoutes = new Hono<AppEnv>();

const createCaseSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(2000).optional(),
  input: z.string().min(1).max(50000),
  expected_output: z.string().max(50000).nullable().default(null),
  scorer_type: z.enum(scorerTypes).default("contains"),
  scorer_config: z.record(z.unknown()).default({}),
  timeout_seconds: z.number().int().min(1).max(300).default(30),
  sort_order: z.number().int().default(0),
  is_active: z.boolean().default(true),
  metadata: z.record(z.unknown()).default({}),
});

const updateCaseSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().max(2000).nullable().optional(),
  input: z.string().min(1).max(50000).optional(),
  expected_output: z.string().max(50000).nullable().optional(),
  scorer_type: z.enum(scorerTypes).optional(),
  scorer_config: z.record(z.unknown()).optional(),
  timeout_seconds: z.number().int().min(1).max(300).optional(),
  sort_order: z.number().int().optional(),
  is_active: z.boolean().optional(),
  metadata: z.record(z.unknown()).optional(),
});

const listCasesQuery = z.object({
  is_active: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

function getSuiteId(c: { req: { param: (name: string) => string | undefined } }): string {
  const suiteId = c.req.param("suiteId");
  if (!suiteId) {
    throw new HTTPException(400, { message: "Missing suiteId parameter" });
  }
  return suiteId;
}

/** POST / -- Create a test case. Requires editor+ access. */
evalCaseRoutes.post("/", async (c) => {
  const user = c.get("user");
  const agentId = getAgentId(c);
  const suiteId = getSuiteId(c);
  const body = parseBody(createCaseSchema, await c.req.json());
  const db = getSupabase();

  await checkAgentAccess(user.id, agentId, "editor");

  // Verify suite belongs to this agent.
  const { data: suite, error: suiteErr } = await db
    .from("eval_suites")
    .select("id")
    .eq("id", suiteId)
    .eq("agent_id", agentId)
    .single();

  if (suiteErr || !suite) {
    throw new HTTPException(404, { message: "Eval suite not found" });
  }

  const { data, error } = await db
    .from("eval_cases")
    .insert({ ...body, suite_id: suiteId })
    .select()
    .single();

  if (error) {
    throw new HTTPException(500, { message: error.message });
  }

  return c.json(data, 201);
});

/** GET / -- List cases in a suite. Requires viewer+ access. */
evalCaseRoutes.get("/", async (c) => {
  const user = c.get("user");
  const agentId = getAgentId(c);
  const suiteId = getSuiteId(c);
  const query = parseQuery(listCasesQuery, c.req.query());
  const db = getSupabase();

  await checkAgentAccess(user.id, agentId, "viewer");

  let q = db
    .from("eval_cases")
    .select("*", { count: "exact" })
    .eq("suite_id", suiteId)
    .order("sort_order", { ascending: true })
    .range(query.offset, query.offset + query.limit - 1);

  if (query.is_active !== undefined) q = q.eq("is_active", query.is_active);

  const { data, error, count } = await q;

  if (error) {
    throw new HTTPException(500, { message: error.message });
  }

  return c.json({ data, total: count, limit: query.limit, offset: query.offset });
});

/** PATCH /:caseId -- Update a case. Requires editor+ access. */
evalCaseRoutes.patch("/:caseId", async (c) => {
  const user = c.get("user");
  const agentId = getAgentId(c);
  const caseId = c.req.param("caseId");
  const body = parseBody(updateCaseSchema, await c.req.json());
  const db = getSupabase();

  await checkAgentAccess(user.id, agentId, "editor");

  const suiteId = getSuiteId(c);

  // Verify case belongs to this suite.
  const { data: existing, error: fetchErr } = await db
    .from("eval_cases")
    .select()
    .eq("id", caseId)
    .eq("suite_id", suiteId)
    .single();

  if (fetchErr || !existing) {
    throw new HTTPException(404, { message: "Eval case not found" });
  }

  const { data, error } = await db
    .from("eval_cases")
    .update(body)
    .eq("id", caseId)
    .select()
    .single();

  if (error) {
    throw new HTTPException(500, { message: error.message });
  }

  return c.json(data);
});

/** DELETE /:caseId -- Delete a case. Requires editor+ access. */
evalCaseRoutes.delete("/:caseId", async (c) => {
  const user = c.get("user");
  const agentId = getAgentId(c);
  const caseId = c.req.param("caseId");
  const db = getSupabase();

  await checkAgentAccess(user.id, agentId, "editor");

  const suiteId = getSuiteId(c);

  const { data: existing, error: fetchErr } = await db
    .from("eval_cases")
    .select("id")
    .eq("id", caseId)
    .eq("suite_id", suiteId)
    .single();

  if (fetchErr || !existing) {
    throw new HTTPException(404, { message: "Eval case not found" });
  }

  const { error } = await db.from("eval_cases").delete().eq("id", caseId);

  if (error) {
    throw new HTTPException(500, { message: error.message });
  }

  return c.json({ deleted: true });
});

// =============================================================================
// Run routes
// =============================================================================

export const evalRunRoutes = new Hono<AppEnv>();

const triggerRunSchema = z.object({
  suite_id: z.string().uuid(),
  metadata: z.record(z.unknown()).default({}),
});

const listRunsQuery = z.object({
  suite_id: z.string().uuid().optional(),
  status: z
    .enum(["pending", "running", "completed", "failed", "cancelled"])
    .optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

/**
 * POST / -- Trigger a new eval run.
 *
 * Creates the run record, fetches active cases from the suite, scores each
 * case synchronously (agent output is simulated as the case input echo for
 * now -- real agent invocation will be wired in the Runtime layer), and
 * finalizes the run with aggregate stats.
 *
 * Requires editor+ access.
 */
evalRunRoutes.post("/", async (c) => {
  const user = c.get("user");
  const agentId = getAgentId(c);
  const body = parseBody(triggerRunSchema, await c.req.json());
  const db = getSupabase();

  await checkAgentAccess(user.id, agentId, "editor");

  // Verify suite belongs to this agent.
  const { data: suite, error: suiteErr } = await db
    .from("eval_suites")
    .select("id, name")
    .eq("id", body.suite_id)
    .eq("agent_id", agentId)
    .single();

  if (suiteErr || !suite) {
    throw new HTTPException(404, { message: "Eval suite not found" });
  }

  // Get agent version.
  const { data: agent } = await db
    .from("agents")
    .select("version")
    .eq("id", agentId)
    .single();

  // Create run record.
  const { data: run, error: runErr } = await db
    .from("eval_runs")
    .insert({
      suite_id: body.suite_id,
      agent_id: agentId,
      owner_id: user.id,
      status: "running" as const,
      agent_version: agent?.version ?? null,
      started_at: new Date().toISOString(),
      metadata: body.metadata,
    })
    .select()
    .single();

  if (runErr || !run) {
    throw new HTTPException(500, { message: runErr?.message ?? "Failed to create run" });
  }

  // Fetch active cases.
  const { data: cases } = await db
    .from("eval_cases")
    .select()
    .eq("suite_id", body.suite_id)
    .eq("is_active", true)
    .order("sort_order", { ascending: true });

  if (!cases || cases.length === 0) {
    // No cases -- finalize immediately.
    const stats = { totalCases: 0, passedCases: 0, failedCases: 0, avgScore: 0, avgLatencyMs: 0 };
    const finalRun = await finalizeRun(run.id, stats);

    return c.json(finalRun, 201);
  }

  // Execute each case.
  // NOTE: In production, this would invoke the agent runtime. For now, we
  // use a placeholder that echoes the input as the "actual output", allowing
  // the scoring pipeline to be exercised end-to-end.
  for (const evalCase of cases) {
    const start = performance.now();

    try {
      // Placeholder: echo input as agent output.
      // TODO: Wire to agent runtime for real invocation.
      const actualOutput = evalCase.input;
      const latencyMs = performance.now() - start;

      const result = scoreOutput(
        evalCase.scorer_type,
        actualOutput,
        evalCase.expected_output,
        evalCase.scorer_config,
      );

      await db.from("eval_results").insert({
        run_id: run.id,
        case_id: evalCase.id,
        actual_output: actualOutput,
        score: result.score.toFixed(4),
        passed: result.passed,
        latency_ms: latencyMs.toFixed(2),
        scorer_output: result.details,
      });
    } catch (err) {
      const latencyMs = performance.now() - start;
      const msg = err instanceof Error ? err.message : "Unknown error";

      await db.from("eval_results").insert({
        run_id: run.id,
        case_id: evalCase.id,
        actual_output: null,
        score: "0",
        passed: false,
        latency_ms: latencyMs.toFixed(2),
        error_message: msg,
      });
    }
  }

  // Aggregate and finalize.
  const stats = await aggregateRunResults(run.id);
  const finalRun = await finalizeRun(run.id, stats);

  await writeAuditLog(
    {
      action: "eval_run.completed",
      resourceType: "eval_run",
      resourceId: run.id,
      agentId,
      evidence: {
        suite_name: suite.name,
        total_cases: stats.totalCases,
        passed_cases: stats.passedCases,
        avg_score: stats.avgScore,
      },
    },
    c,
  );

  return c.json(finalRun, 201);
});

/** GET / -- List eval runs. Requires viewer+ access. */
evalRunRoutes.get("/", async (c) => {
  const user = c.get("user");
  const agentId = getAgentId(c);
  const query = parseQuery(listRunsQuery, c.req.query());
  const db = getSupabase();

  await checkAgentAccess(user.id, agentId, "viewer");

  let q = db
    .from("eval_runs")
    .select("*", { count: "exact" })
    .eq("agent_id", agentId)
    .order("created_at", { ascending: false })
    .range(query.offset, query.offset + query.limit - 1);

  if (query.suite_id) q = q.eq("suite_id", query.suite_id);
  if (query.status) q = q.eq("status", query.status);

  const { data, error, count } = await q;

  if (error) {
    throw new HTTPException(500, { message: error.message });
  }

  return c.json({ data, total: count, limit: query.limit, offset: query.offset });
});

/** GET /:runId -- Get run detail with individual results. Requires viewer+ access. */
evalRunRoutes.get("/:runId", async (c) => {
  const user = c.get("user");
  const agentId = getAgentId(c);
  const runId = c.req.param("runId");
  const db = getSupabase();

  await checkAgentAccess(user.id, agentId, "viewer");

  const { data: run, error: runErr } = await db
    .from("eval_runs")
    .select()
    .eq("id", runId)
    .eq("agent_id", agentId)
    .single();

  if (runErr || !run) {
    throw new HTTPException(404, { message: "Eval run not found" });
  }

  const { data: results } = await db
    .from("eval_results")
    .select()
    .eq("run_id", runId)
    .order("created_at", { ascending: true });

  return c.json({ ...run, results: results ?? [] });
});
