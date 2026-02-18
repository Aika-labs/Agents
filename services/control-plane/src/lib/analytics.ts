/**
 * Analytics Dashboard -- metric aggregation and dashboard summary helpers.
 *
 * Provides:
 *   - Time-series queries for agent metrics (tokens, sessions, costs, latency).
 *   - Dashboard summary builder (aggregate stats across a date range).
 *   - Usage breakdown helpers (by model, tool, day).
 *   - Top agents ranking by various dimensions.
 */

import { getSupabase } from "./supabase.js";
import type { MetricPeriod } from "../types/database.js";

// =============================================================================
// Types
// =============================================================================

export interface TimeSeriesPoint {
  bucket_start: string;
  bucket_end: string;
  total_tokens: number;
  prompt_tokens: number;
  completion_tokens: number;
  session_count: number;
  message_count: number;
  estimated_cost_usd: number;
  avg_latency_ms: number;
  error_count: number;
  tool_call_count: number;
}

export interface DashboardSummary {
  /** Date range covered. */
  from: string;
  to: string;
  /** Aggregate totals. */
  total_tokens: number;
  prompt_tokens: number;
  completion_tokens: number;
  total_sessions: number;
  total_messages: number;
  total_cost_usd: number;
  avg_latency_ms: number;
  p95_latency_ms: number;
  total_errors: number;
  error_rate: number;
  total_tool_calls: number;
  total_eval_runs: number;
  avg_eval_score: number;
  total_pipeline_runs: number;
  total_records_processed: number;
  /** Number of data points used. */
  data_points: number;
}

export interface UsageBreakdown {
  usage_date: string;
  total_tokens: number;
  session_count: number;
  message_count: number;
  estimated_cost_usd: number;
  error_count: number;
}

export interface TopAgentEntry {
  agent_id: string;
  agent_name: string | null;
  value: number;
}

// =============================================================================
// Time-series queries
// =============================================================================

/**
 * Fetch time-series metric data for an agent over a date range.
 *
 * Returns ordered data points at the specified period granularity.
 */
export async function getTimeSeries(
  agentId: string,
  period: MetricPeriod,
  from: string,
  to: string,
): Promise<TimeSeriesPoint[]> {
  const db = getSupabase();

  const { data, error } = await db
    .from("agent_metrics")
    .select()
    .eq("agent_id", agentId)
    .eq("period", period)
    .gte("bucket_start", from)
    .lte("bucket_start", to)
    .order("bucket_start", { ascending: true });

  if (error) {
    throw new Error(`Failed to fetch time series: ${error.message}`);
  }

  return (data ?? []).map((row) => ({
    bucket_start: row.bucket_start,
    bucket_end: row.bucket_end,
    total_tokens: Number(row.total_tokens),
    prompt_tokens: Number(row.prompt_tokens),
    completion_tokens: Number(row.completion_tokens),
    session_count: Number(row.session_count),
    message_count: Number(row.message_count),
    estimated_cost_usd: parseFloat(row.estimated_cost_usd),
    avg_latency_ms: parseFloat(row.avg_latency_ms),
    error_count: Number(row.error_count),
    tool_call_count: Number(row.tool_call_count),
  }));
}

// =============================================================================
// Dashboard summary
// =============================================================================

/**
 * Build an aggregate dashboard summary for an agent over a date range.
 *
 * Reads from agent_metrics at the specified period granularity and
 * computes totals, averages, and rates.
 */
export async function getDashboardSummary(
  agentId: string,
  period: MetricPeriod,
  from: string,
  to: string,
): Promise<DashboardSummary> {
  const db = getSupabase();

  const { data, error } = await db
    .from("agent_metrics")
    .select()
    .eq("agent_id", agentId)
    .eq("period", period)
    .gte("bucket_start", from)
    .lte("bucket_start", to);

  if (error) {
    throw new Error(`Failed to fetch metrics: ${error.message}`);
  }

  const rows = data ?? [];

  if (rows.length === 0) {
    return {
      from,
      to,
      total_tokens: 0,
      prompt_tokens: 0,
      completion_tokens: 0,
      total_sessions: 0,
      total_messages: 0,
      total_cost_usd: 0,
      avg_latency_ms: 0,
      p95_latency_ms: 0,
      total_errors: 0,
      error_rate: 0,
      total_tool_calls: 0,
      total_eval_runs: 0,
      avg_eval_score: 0,
      total_pipeline_runs: 0,
      total_records_processed: 0,
      data_points: 0,
    };
  }

  let totalTokens = 0;
  let promptTokens = 0;
  let completionTokens = 0;
  let totalSessions = 0;
  let totalMessages = 0;
  let totalCost = 0;
  let totalErrors = 0;
  let totalToolCalls = 0;
  let totalEvalRuns = 0;
  let evalScoreSum = 0;
  let evalScoreCount = 0;
  let totalPipelineRuns = 0;
  let totalRecordsProcessed = 0;
  let latencySum = 0;
  const p95Values: number[] = [];

  for (const row of rows) {
    totalTokens += Number(row.total_tokens);
    promptTokens += Number(row.prompt_tokens);
    completionTokens += Number(row.completion_tokens);
    totalSessions += Number(row.session_count);
    totalMessages += Number(row.message_count);
    totalCost += parseFloat(row.estimated_cost_usd);
    totalErrors += Number(row.error_count);
    totalToolCalls += Number(row.tool_call_count);
    totalEvalRuns += Number(row.eval_run_count);
    totalPipelineRuns += Number(row.pipeline_run_count);
    totalRecordsProcessed += Number(row.records_processed);
    latencySum += parseFloat(row.avg_latency_ms);
    p95Values.push(parseFloat(row.p95_latency_ms));

    const evalScore = parseFloat(row.avg_eval_score);
    if (evalScore > 0) {
      evalScoreSum += evalScore;
      evalScoreCount++;
    }
  }

  const avgLatency = rows.length > 0 ? latencySum / rows.length : 0;
  const avgEvalScore = evalScoreCount > 0 ? evalScoreSum / evalScoreCount : 0;

  // Approximate p95 from per-bucket p95 values.
  p95Values.sort((a, b) => a - b);
  const p95Index = Math.floor(p95Values.length * 0.95);
  const p95Latency = p95Values.length > 0 ? p95Values[Math.min(p95Index, p95Values.length - 1)] : 0;

  const errorRate = totalMessages > 0 ? totalErrors / totalMessages : 0;

  return {
    from,
    to,
    total_tokens: totalTokens,
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_sessions: totalSessions,
    total_messages: totalMessages,
    total_cost_usd: Math.round(totalCost * 1000000) / 1000000,
    avg_latency_ms: Math.round(avgLatency * 100) / 100,
    p95_latency_ms: Math.round(p95Latency * 100) / 100,
    total_errors: totalErrors,
    error_rate: Math.round(errorRate * 10000) / 10000,
    total_tool_calls: totalToolCalls,
    total_eval_runs: totalEvalRuns,
    avg_eval_score: Math.round(avgEvalScore * 10000) / 10000,
    total_pipeline_runs: totalPipelineRuns,
    total_records_processed: totalRecordsProcessed,
    data_points: rows.length,
  };
}

// =============================================================================
// Daily usage breakdown
// =============================================================================

/**
 * Fetch daily usage breakdown for an agent over a date range.
 *
 * Reads from the agent_usage_daily rollup table for fast queries.
 */
export async function getDailyUsage(
  agentId: string,
  from: string,
  to: string,
): Promise<UsageBreakdown[]> {
  const db = getSupabase();

  const { data, error } = await db
    .from("agent_usage_daily")
    .select()
    .eq("agent_id", agentId)
    .gte("usage_date", from)
    .lte("usage_date", to)
    .order("usage_date", { ascending: true });

  if (error) {
    throw new Error(`Failed to fetch daily usage: ${error.message}`);
  }

  return (data ?? []).map((row) => ({
    usage_date: row.usage_date,
    total_tokens: Number(row.total_tokens),
    session_count: Number(row.session_count),
    message_count: Number(row.message_count),
    estimated_cost_usd: parseFloat(row.estimated_cost_usd),
    error_count: Number(row.error_count),
  }));
}

// =============================================================================
// Top agents
// =============================================================================

/**
 * Get top agents for an owner ranked by a metric dimension.
 *
 * Aggregates from agent_usage_daily over the date range.
 */
export async function getTopAgents(
  ownerId: string,
  dimension: "tokens" | "sessions" | "cost" | "errors",
  from: string,
  to: string,
  limit: number = 10,
): Promise<TopAgentEntry[]> {
  const db = getSupabase();

  // Fetch daily usage for all agents owned by this user.
  const { data: usage, error: usageErr } = await db
    .from("agent_usage_daily")
    .select()
    .eq("owner_id", ownerId)
    .gte("usage_date", from)
    .lte("usage_date", to);

  if (usageErr) {
    throw new Error(`Failed to fetch usage: ${usageErr.message}`);
  }

  if (!usage || usage.length === 0) {
    return [];
  }

  // Aggregate by agent.
  const agentTotals = new Map<string, number>();

  for (const row of usage) {
    const agentId = row.agent_id;
    const current = agentTotals.get(agentId) ?? 0;

    let value: number;
    switch (dimension) {
      case "tokens":
        value = Number(row.total_tokens);
        break;
      case "sessions":
        value = Number(row.session_count);
        break;
      case "cost":
        value = parseFloat(row.estimated_cost_usd);
        break;
      case "errors":
        value = Number(row.error_count);
        break;
    }

    agentTotals.set(agentId, current + value);
  }

  // Sort and limit.
  const sorted = Array.from(agentTotals.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit);

  // Fetch agent names.
  const agentIds = sorted.map(([id]) => id);
  const { data: agents } = await db
    .from("agents")
    .select("id, name")
    .in("id", agentIds);

  const nameMap = new Map<string, string>();
  if (agents) {
    for (const agent of agents) {
      nameMap.set(agent.id, agent.name);
    }
  }

  return sorted.map(([agentId, value]) => ({
    agent_id: agentId,
    agent_name: nameMap.get(agentId) ?? null,
    value: Math.round(value * 1000000) / 1000000,
  }));
}

// =============================================================================
// Owner-level summary
// =============================================================================

/**
 * Build an aggregate summary across all agents for an owner.
 *
 * Useful for the top-level analytics dashboard.
 */
export async function getOwnerSummary(
  ownerId: string,
  from: string,
  to: string,
): Promise<DashboardSummary & { agent_count: number }> {
  const db = getSupabase();

  const { data, error } = await db
    .from("agent_usage_daily")
    .select()
    .eq("owner_id", ownerId)
    .gte("usage_date", from)
    .lte("usage_date", to);

  if (error) {
    throw new Error(`Failed to fetch owner usage: ${error.message}`);
  }

  const rows = data ?? [];
  const agentIds = new Set<string>();

  let totalTokens = 0;
  let promptTokens = 0;
  let completionTokens = 0;
  let totalSessions = 0;
  let totalMessages = 0;
  let totalCost = 0;
  let totalErrors = 0;
  let totalToolCalls = 0;
  let latencySum = 0;
  let latencyCount = 0;

  for (const row of rows) {
    agentIds.add(row.agent_id);
    totalTokens += Number(row.total_tokens);
    promptTokens += Number(row.prompt_tokens);
    completionTokens += Number(row.completion_tokens);
    totalSessions += Number(row.session_count);
    totalMessages += Number(row.message_count);
    totalCost += parseFloat(row.estimated_cost_usd);
    totalErrors += Number(row.error_count);
    totalToolCalls += Number(row.tool_call_count);

    const latency = parseFloat(row.avg_latency_ms);
    if (latency > 0) {
      latencySum += latency;
      latencyCount++;
    }
  }

  const avgLatency = latencyCount > 0 ? latencySum / latencyCount : 0;
  const errorRate = totalMessages > 0 ? totalErrors / totalMessages : 0;

  return {
    from,
    to,
    agent_count: agentIds.size,
    total_tokens: totalTokens,
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_sessions: totalSessions,
    total_messages: totalMessages,
    total_cost_usd: Math.round(totalCost * 1000000) / 1000000,
    avg_latency_ms: Math.round(avgLatency * 100) / 100,
    p95_latency_ms: 0, // Not available from daily rollups.
    total_errors: totalErrors,
    error_rate: Math.round(errorRate * 10000) / 10000,
    total_tool_calls: totalToolCalls,
    total_eval_runs: 0,
    avg_eval_score: 0,
    total_pipeline_runs: 0,
    total_records_processed: 0,
    data_points: rows.length,
  };
}
