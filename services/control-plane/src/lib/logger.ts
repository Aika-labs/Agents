/**
 * Structured JSON logger compatible with GCP Cloud Logging.
 *
 * GCP Cloud Logging expects a `severity` field (not `level`) and
 * recognises these values: DEBUG, INFO, WARNING, ERROR, CRITICAL.
 * Additional fields like `httpRequest`, `labels`, and `trace` are
 * automatically indexed by Cloud Logging when present.
 *
 * Usage:
 *   import { logger } from "./logger.js";
 *   logger.info("Agent started", { agentId, sessionId });
 *   logger.error("DB query failed", { error: err.message, table: "agents" });
 */

type Severity = "DEBUG" | "INFO" | "WARNING" | "ERROR" | "CRITICAL";

interface LogEntry {
  /** GCP Cloud Logging severity. */
  severity: Severity;
  /** Human-readable message. */
  message: string;
  /** ISO-8601 timestamp. */
  timestamp: string;
  /** Service identifier. */
  serviceContext: { service: string; version: string };
  /** Optional structured fields. */
  [key: string]: unknown;
}

const SERVICE_NAME = "control-plane";
const SERVICE_VERSION = process.env["SERVICE_VERSION"] ?? "0.1.0";

function emit(severity: Severity, message: string, fields?: Record<string, unknown>): void {
  const entry: LogEntry = {
    severity,
    message,
    timestamp: new Date().toISOString(),
    serviceContext: { service: SERVICE_NAME, version: SERVICE_VERSION },
    ...fields,
  };

  const output = JSON.stringify(entry);

  if (severity === "ERROR" || severity === "CRITICAL") {
    process.stderr.write(output + "\n");
  } else {
    process.stdout.write(output + "\n");
  }
}

export const logger = {
  debug: (message: string, fields?: Record<string, unknown>) =>
    emit("DEBUG", message, fields),

  info: (message: string, fields?: Record<string, unknown>) =>
    emit("INFO", message, fields),

  warn: (message: string, fields?: Record<string, unknown>) =>
    emit("WARNING", message, fields),

  error: (message: string, fields?: Record<string, unknown>) =>
    emit("ERROR", message, fields),

  critical: (message: string, fields?: Record<string, unknown>) =>
    emit("CRITICAL", message, fields),
};

/**
 * Create a child logger with pre-bound context fields.
 * Useful for request-scoped logging where requestId, userId, etc.
 * should appear on every log line.
 */
export function createChildLogger(context: Record<string, unknown>) {
  return {
    debug: (message: string, fields?: Record<string, unknown>) =>
      emit("DEBUG", message, { ...context, ...fields }),

    info: (message: string, fields?: Record<string, unknown>) =>
      emit("INFO", message, { ...context, ...fields }),

    warn: (message: string, fields?: Record<string, unknown>) =>
      emit("WARNING", message, { ...context, ...fields }),

    error: (message: string, fields?: Record<string, unknown>) =>
      emit("ERROR", message, { ...context, ...fields }),

    critical: (message: string, fields?: Record<string, unknown>) =>
      emit("CRITICAL", message, { ...context, ...fields }),
  };
}
