/**
 * Data Pipeline execution engine.
 *
 * Provides:
 *   - Step executors for each pipeline_step_type (extract, transform, load, etc.)
 *   - Pipeline runner that executes steps sequentially with error handling.
 *   - Connector validation helpers.
 */

import { getSupabase } from "./supabase.js";
import { logger } from "./logger.js";
import type {
  PipelineStepType,
  PipelineStepRow,
  PipelineRunRow,
} from "../types/database.js";

// =============================================================================
// Step execution context
// =============================================================================

/** Data flowing between pipeline steps. */
export interface StepData {
  records: Record<string, unknown>[];
  metadata: Record<string, unknown>;
}

/** Result of executing a single step. */
export interface StepResult {
  stepId: string;
  stepName: string;
  stepType: PipelineStepType;
  status: "success" | "error" | "skipped";
  recordsIn: number;
  recordsOut: number;
  durationMs: number;
  error?: string;
  details: Record<string, unknown>;
}

// =============================================================================
// Step executors
// =============================================================================

type StepExecutor = (
  step: PipelineStepRow,
  data: StepData,
) => Promise<StepData>;

/**
 * Extract step: simulates pulling data from a source connector.
 *
 * In production, this would read from GCS, HTTP, PostgreSQL, etc.
 * For now, it reads sample data from step config or passes through.
 */
async function executeExtract(
  step: PipelineStepRow,
  data: StepData,
): Promise<StepData> {
  const config = step.config;

  // If config provides sample_data, use it as the extracted records.
  if (Array.isArray(config["sample_data"])) {
    const records = config["sample_data"] as Record<string, unknown>[];
    return { records, metadata: { ...data.metadata, source: "sample_data" } };
  }

  // If config provides a query, log it (actual DB execution deferred to runtime).
  if (typeof config["query"] === "string") {
    return {
      records: data.records,
      metadata: { ...data.metadata, query: config["query"], source: "query_stub" },
    };
  }

  // Pass through existing data.
  return data;
}

/**
 * Transform step: applies data transformations.
 *
 * Supported operations via config.operation:
 *   - filter:    Keep records matching config.expression (field == value).
 *   - map:       Add/rename fields via config.mappings.
 *   - aggregate: Group by config.group_by, count records per group.
 *   - sort:      Sort by config.sort_by field.
 *   - limit:     Keep first config.limit records.
 *   - dedupe:    Remove duplicates by config.key field.
 */
async function executeTransform(
  step: PipelineStepRow,
  data: StepData,
): Promise<StepData> {
  const config = step.config;
  const operation = config["operation"];
  let records = [...data.records];

  switch (operation) {
    case "filter": {
      const field = config["field"] as string | undefined;
      const value = config["value"];
      if (field !== undefined) {
        records = records.filter((r) => r[field] === value);
      }
      break;
    }

    case "map": {
      const mappings = config["mappings"] as Record<string, string> | undefined;
      if (mappings) {
        records = records.map((r) => {
          const mapped = { ...r };
          for (const [from, to] of Object.entries(mappings)) {
            if (from in mapped) {
              mapped[to] = mapped[from];
              if (from !== to) delete mapped[from];
            }
          }
          return mapped;
        });
      }
      break;
    }

    case "aggregate": {
      const groupBy = config["group_by"] as string | undefined;
      if (groupBy) {
        const groups = new Map<unknown, number>();
        for (const r of records) {
          const key = r[groupBy];
          groups.set(key, (groups.get(key) ?? 0) + 1);
        }
        records = Array.from(groups.entries()).map(([key, count]) => ({
          [groupBy]: key,
          count,
        }));
      }
      break;
    }

    case "sort": {
      const sortBy = config["sort_by"] as string | undefined;
      const ascending = config["ascending"] !== false;
      if (sortBy) {
        records.sort((a, b) => {
          const va = a[sortBy];
          const vb = b[sortBy];
          if (va === vb) return 0;
          if (va === undefined || va === null) return 1;
          if (vb === undefined || vb === null) return -1;
          const cmp = va < vb ? -1 : 1;
          return ascending ? cmp : -cmp;
        });
      }
      break;
    }

    case "limit": {
      const limit = config["limit"];
      if (typeof limit === "number" && limit > 0) {
        records = records.slice(0, limit);
      }
      break;
    }

    case "dedupe": {
      const key = config["key"] as string | undefined;
      if (key) {
        const seen = new Set<unknown>();
        records = records.filter((r) => {
          const val = r[key];
          if (seen.has(val)) return false;
          seen.add(val);
          return true;
        });
      }
      break;
    }

    default:
      // Unknown operation -- pass through.
      break;
  }

  return { records, metadata: data.metadata };
}

/**
 * Load step: simulates writing data to a sink connector.
 *
 * In production, this would write to GCS, HTTP webhook, PostgreSQL, etc.
 * For now, it logs the output and returns the data unchanged.
 */
async function executeLoad(
  step: PipelineStepRow,
  data: StepData,
): Promise<StepData> {
  const config = step.config;
  const mode = (config["mode"] as string) ?? "append";

  logger.info("Pipeline load step executed", {
    stepId: step.id,
    mode,
    recordCount: data.records.length,
  });

  return {
    records: data.records,
    metadata: {
      ...data.metadata,
      loaded: true,
      load_mode: mode,
      records_loaded: data.records.length,
    },
  };
}

/**
 * Validate step: checks records against a simple schema.
 *
 * config.required_fields: string[] -- fields that must exist and be non-null.
 * Records failing validation are removed; count is tracked.
 */
async function executeValidate(
  step: PipelineStepRow,
  data: StepData,
): Promise<StepData> {
  const config = step.config;
  const requiredFields = config["required_fields"];

  if (!Array.isArray(requiredFields)) {
    return data;
  }

  const valid: Record<string, unknown>[] = [];
  let invalidCount = 0;

  for (const record of data.records) {
    const isValid = requiredFields.every(
      (field: unknown) =>
        typeof field === "string" &&
        record[field] !== undefined &&
        record[field] !== null,
    );
    if (isValid) {
      valid.push(record);
    } else {
      invalidCount++;
    }
  }

  return {
    records: valid,
    metadata: {
      ...data.metadata,
      validation_passed: valid.length,
      validation_failed: invalidCount,
    },
  };
}

/**
 * Enrich step: adds fields to records from a lookup source.
 *
 * config.enrichments: Array<{ field: string, value: unknown }> -- static enrichments.
 * In production, this would support external API lookups.
 */
async function executeEnrich(
  step: PipelineStepRow,
  data: StepData,
): Promise<StepData> {
  const config = step.config;
  const enrichments = config["enrichments"];

  if (!Array.isArray(enrichments)) {
    return data;
  }

  const records = data.records.map((r) => {
    const enriched = { ...r };
    for (const e of enrichments) {
      if (typeof e === "object" && e !== null && "field" in e && "value" in e) {
        const entry = e as { field: string; value: unknown };
        enriched[entry.field] = entry.value;
      }
    }
    return enriched;
  });

  return { records, metadata: data.metadata };
}

/**
 * Branch step: splits records based on a condition.
 *
 * config.field: string -- field to evaluate.
 * config.value: unknown -- value to match.
 * config.keep: "matching" | "non_matching" -- which records to keep.
 */
async function executeBranch(
  step: PipelineStepRow,
  data: StepData,
): Promise<StepData> {
  const config = step.config;
  const field = config["field"] as string | undefined;
  const value = config["value"];
  const keep = (config["keep"] as string) ?? "matching";

  if (!field) return data;

  const records = data.records.filter((r) => {
    const matches = r[field] === value;
    return keep === "matching" ? matches : !matches;
  });

  return { records, metadata: data.metadata };
}

/** Custom step: pass-through (placeholder for webhook-based custom logic). */
async function executeCustom(
  _step: PipelineStepRow,
  data: StepData,
): Promise<StepData> {
  return data;
}

// =============================================================================
// Executor registry
// =============================================================================

const EXECUTORS: Record<PipelineStepType, StepExecutor> = {
  extract: executeExtract,
  transform: executeTransform,
  load: executeLoad,
  validate: executeValidate,
  enrich: executeEnrich,
  branch: executeBranch,
  custom: executeCustom,
};

// =============================================================================
// Pipeline runner
// =============================================================================

/**
 * Execute a pipeline: run all active steps in order, tracking results.
 *
 * Creates a pipeline_run record, executes each step sequentially,
 * records per-step results, and finalizes the run with aggregate metrics.
 */
export async function executePipeline(
  pipelineId: string,
  agentId: string,
  ownerId: string,
): Promise<PipelineRunRow> {
  const db = getSupabase();

  // Create run record.
  const { data: run, error: runErr } = await db
    .from("pipeline_runs")
    .insert({
      pipeline_id: pipelineId,
      agent_id: agentId,
      owner_id: ownerId,
      status: "running" as const,
      started_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (runErr || !run) {
    throw new Error(`Failed to create pipeline run: ${runErr?.message ?? "unknown"}`);
  }

  // Fetch active steps.
  const { data: steps } = await db
    .from("pipeline_steps")
    .select()
    .eq("pipeline_id", pipelineId)
    .eq("is_active", true)
    .order("sort_order", { ascending: true });

  if (!steps || steps.length === 0) {
    // No steps -- finalize immediately.
    const { data: finalRun } = await db
      .from("pipeline_runs")
      .update({
        status: "completed" as const,
        completed_at: new Date().toISOString(),
      })
      .eq("id", run.id)
      .select()
      .single();

    return finalRun ?? run;
  }

  // Execute steps sequentially.
  let currentData: StepData = { records: [], metadata: {} };
  const stepResults: StepResult[] = [];
  let totalRecordsRead = 0;
  let totalRecordsWritten = 0;
  let errorMessage: string | null = null;
  let errorStep: string | null = null;

  for (const step of steps) {
    const start = performance.now();
    const recordsIn = currentData.records.length;

    try {
      const stepType = step.step_type as PipelineStepType;
      const executor = EXECUTORS[stepType];
      if (!executor) {
        throw new Error(`Unknown step type: ${step.step_type}`);
      }

      currentData = await executor(step, currentData);
      const durationMs = performance.now() - start;

      const result: StepResult = {
        stepId: step.id,
        stepName: step.name,
        stepType: step.step_type,
        status: "success",
        recordsIn,
        recordsOut: currentData.records.length,
        durationMs: Math.round(durationMs * 100) / 100,
        details: {},
      };

      stepResults.push(result);

      if (step.step_type === "extract") {
        totalRecordsRead += currentData.records.length;
      }
      if (step.step_type === "load") {
        totalRecordsWritten += currentData.records.length;
      }
    } catch (err) {
      const durationMs = performance.now() - start;
      const msg = err instanceof Error ? err.message : "Unknown error";

      stepResults.push({
        stepId: step.id,
        stepName: step.name,
        stepType: step.step_type,
        status: "error",
        recordsIn,
        recordsOut: 0,
        durationMs: Math.round(durationMs * 100) / 100,
        error: msg,
        details: {},
      });

      errorMessage = msg;
      errorStep = step.name;
      break; // Stop pipeline on first error.
    }
  }

  // Finalize run.
  const finalStatus = errorMessage ? "failed" : "completed";

  const { data: finalRun, error: updateErr } = await db
    .from("pipeline_runs")
    .update({
      status: finalStatus as "completed" | "failed",
      step_results: stepResults as unknown as Record<string, unknown>[],
      records_read: totalRecordsRead,
      records_written: totalRecordsWritten,
      completed_at: new Date().toISOString(),
      error_message: errorMessage,
      error_step: errorStep,
    })
    .eq("id", run.id)
    .select()
    .single();

  if (updateErr) {
    logger.error("Failed to finalize pipeline run", {
      runId: run.id,
      error: updateErr.message,
    });
  }

  return finalRun ?? run;
}
