/**
 * Eval & Testing Framework -- scoring and execution helpers.
 *
 * Provides pluggable scorers for evaluating agent outputs against expected
 * results, plus helpers for running individual cases and aggregating results.
 */

import { getSupabase } from "./supabase.js";
import type { EvalScorerType, EvalRunRow } from "../types/database.js";

// =============================================================================
// Scorer interface
// =============================================================================

export interface ScoreResult {
  /** Score from 0.0 (fail) to 1.0 (perfect). */
  score: number;
  /** Whether the case passed (score >= threshold, default 1.0). */
  passed: boolean;
  /** Scorer-specific details for debugging. */
  details: Record<string, unknown>;
}

type ScorerFn = (
  actual: string,
  expected: string | null,
  config: Record<string, unknown>,
) => ScoreResult;

// =============================================================================
// Built-in scorers
// =============================================================================

/** Exact string equality (case-sensitive by default). */
function exactMatchScorer(
  actual: string,
  expected: string | null,
  config: Record<string, unknown>,
): ScoreResult {
  if (expected === null) {
    return { score: 0, passed: false, details: { reason: "No expected output defined" } };
  }

  const ignoreCase = config["ignore_case"] === true;
  const a = ignoreCase ? actual.toLowerCase() : actual;
  const e = ignoreCase ? expected.toLowerCase() : expected;
  const match = a === e;

  return {
    score: match ? 1 : 0,
    passed: match,
    details: { ignore_case: ignoreCase },
  };
}

/** Check if actual output contains the expected substring. */
function containsScorer(
  actual: string,
  expected: string | null,
  config: Record<string, unknown>,
): ScoreResult {
  if (expected === null) {
    return { score: 0, passed: false, details: { reason: "No expected output defined" } };
  }

  const ignoreCase = config["ignore_case"] === true;
  const a = ignoreCase ? actual.toLowerCase() : actual;
  const e = ignoreCase ? expected.toLowerCase() : expected;
  const match = a.includes(e);

  return {
    score: match ? 1 : 0,
    passed: match,
    details: { ignore_case: ignoreCase, substring: expected },
  };
}

/** Match actual output against a regex pattern (expected is the pattern). */
function regexScorer(
  actual: string,
  expected: string | null,
  config: Record<string, unknown>,
): ScoreResult {
  if (expected === null) {
    return { score: 0, passed: false, details: { reason: "No regex pattern defined" } };
  }

  try {
    const flags = typeof config["flags"] === "string" ? config["flags"] : "";
    const regex = new RegExp(expected, flags);
    const match = regex.test(actual);

    return {
      score: match ? 1 : 0,
      passed: match,
      details: { pattern: expected, flags },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Invalid regex";
    return { score: 0, passed: false, details: { error: msg, pattern: expected } };
  }
}

/**
 * Semantic similarity scorer (stub).
 *
 * In production this would compute cosine similarity between embeddings
 * of actual and expected outputs. For now, falls back to contains matching
 * and returns a placeholder score.
 */
function semanticScorer(
  actual: string,
  expected: string | null,
  config: Record<string, unknown>,
): ScoreResult {
  if (expected === null) {
    return { score: 0, passed: false, details: { reason: "No expected output defined" } };
  }

  // Stub: use case-insensitive contains as a rough proxy.
  const a = actual.toLowerCase();
  const e = expected.toLowerCase();
  const contains = a.includes(e);

  const threshold =
    typeof config["threshold"] === "number" ? config["threshold"] : 0.7;
  const score = contains ? 1.0 : 0.0;

  return {
    score,
    passed: score >= threshold,
    details: {
      method: "stub_contains",
      threshold,
      note: "Semantic scoring requires embedding integration. Using contains fallback.",
    },
  };
}

/** JSON structure/value matching. Expected is a JSON string. */
function jsonMatchScorer(
  actual: string,
  expected: string | null,
  config: Record<string, unknown>,
): ScoreResult {
  if (expected === null) {
    return { score: 0, passed: false, details: { reason: "No expected JSON defined" } };
  }

  try {
    const actualObj = JSON.parse(actual) as unknown;
    const expectedObj = JSON.parse(expected) as unknown;

    // Deep equality check.
    const match = JSON.stringify(actualObj) === JSON.stringify(expectedObj);

    // Partial matching: check if all expected keys exist with correct values.
    let partialScore = 0;
    if (!match && typeof actualObj === "object" && typeof expectedObj === "object" &&
        actualObj !== null && expectedObj !== null) {
      const expectedEntries = Object.entries(expectedObj as Record<string, unknown>);
      const actualRecord = actualObj as Record<string, unknown>;
      if (expectedEntries.length > 0) {
        const matches = expectedEntries.filter(
          ([key, val]) => JSON.stringify(actualRecord[key]) === JSON.stringify(val),
        ).length;
        partialScore = matches / expectedEntries.length;
      }
    }

    const score = match ? 1.0 : partialScore;
    const threshold =
      typeof config["threshold"] === "number" ? config["threshold"] : 1.0;

    return {
      score,
      passed: score >= threshold,
      details: { exact_match: match, partial_score: partialScore, threshold },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "JSON parse error";
    return { score: 0, passed: false, details: { error: msg } };
  }
}

/** Custom scorer -- always passes with score from config or 0. */
function customScorer(
  _actual: string,
  _expected: string | null,
  config: Record<string, unknown>,
): ScoreResult {
  const score = typeof config["score"] === "number" ? config["score"] : 0;
  const passed = typeof config["passed"] === "boolean" ? config["passed"] : score >= 1.0;

  return {
    score,
    passed,
    details: {
      note: "Custom scorer. Override score/passed via scorer_config or external webhook.",
    },
  };
}

// =============================================================================
// Scorer registry
// =============================================================================

const SCORERS: Record<EvalScorerType, ScorerFn> = {
  exact_match: exactMatchScorer,
  contains: containsScorer,
  regex: regexScorer,
  semantic: semanticScorer,
  json_match: jsonMatchScorer,
  custom: customScorer,
};

/**
 * Score an agent's actual output against the expected output using the
 * specified scorer type and configuration.
 */
export function scoreOutput(
  scorerType: EvalScorerType,
  actual: string,
  expected: string | null,
  config: Record<string, unknown> = {},
): ScoreResult {
  const scorer = SCORERS[scorerType];
  if (!scorer) {
    return {
      score: 0,
      passed: false,
      details: { error: `Unknown scorer type: ${scorerType}` },
    };
  }
  return scorer(actual, expected, config);
}

// =============================================================================
// Run aggregation
// =============================================================================

export interface AggregateStats {
  totalCases: number;
  passedCases: number;
  failedCases: number;
  avgScore: number;
  avgLatencyMs: number;
}

/**
 * Compute aggregate statistics for an eval run from its individual results.
 */
export async function aggregateRunResults(runId: string): Promise<AggregateStats> {
  const db = getSupabase();

  const { data: results } = await db
    .from("eval_results")
    .select("score, passed, latency_ms")
    .eq("run_id", runId);

  if (!results || results.length === 0) {
    return { totalCases: 0, passedCases: 0, failedCases: 0, avgScore: 0, avgLatencyMs: 0 };
  }

  const totalCases = results.length;
  const passedCases = results.filter((r) => r.passed).length;
  const failedCases = totalCases - passedCases;

  const avgScore =
    results.reduce((sum, r) => sum + parseFloat(r.score), 0) / totalCases;

  const latencies = results
    .filter((r) => r.latency_ms !== null)
    .map((r) => parseFloat(r.latency_ms!));
  const avgLatencyMs =
    latencies.length > 0
      ? latencies.reduce((sum, l) => sum + l, 0) / latencies.length
      : 0;

  return { totalCases, passedCases, failedCases, avgScore, avgLatencyMs };
}

/**
 * Update an eval run record with aggregated results and mark it completed.
 */
export async function finalizeRun(
  runId: string,
  stats: AggregateStats,
): Promise<EvalRunRow> {
  const db = getSupabase();

  const { data, error } = await db
    .from("eval_runs")
    .update({
      status: "completed" as const,
      total_cases: stats.totalCases,
      passed_cases: stats.passedCases,
      failed_cases: stats.failedCases,
      avg_score: stats.avgScore.toFixed(4),
      avg_latency_ms: stats.avgLatencyMs.toFixed(2),
      completed_at: new Date().toISOString(),
    })
    .eq("id", runId)
    .select()
    .single();

  if (error || !data) {
    throw new Error(`Failed to finalize run ${runId}: ${error?.message ?? "not found"}`);
  }

  return data;
}
