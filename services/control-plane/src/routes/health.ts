import { Hono } from "hono";
import { getSupabase } from "../lib/supabase.js";
import { getRedis } from "../lib/redis.js";
import { renderMetrics } from "../lib/metrics.js";

export const healthRoutes = new Hono();

const SERVICE_VERSION = process.env["SERVICE_VERSION"] ?? "0.1.0";
const startedAt = new Date();

// -- GET / -- Basic health (backward-compatible). -----------------------------

healthRoutes.get("/", (c) => {
  return c.json({
    status: "ok",
    service: "control-plane",
    version: SERVICE_VERSION,
    timestamp: new Date().toISOString(),
  });
});

// -- GET /live -- Liveness probe (Cloud Run startup check). -------------------

healthRoutes.get("/live", (c) => {
  return c.json({ status: "ok" });
});

// -- GET /ready -- Readiness probe (dependency health). -----------------------

healthRoutes.get("/ready", async (c) => {
  const checks: Record<string, DependencyCheck> = {};

  checks.supabase = await checkSupabase();
  checks.redis = await checkRedis();

  const allHealthy = Object.values(checks).every((ch) => ch.status === "ok");

  const body = {
    status: allHealthy ? "ok" : "degraded",
    service: "control-plane",
    version: SERVICE_VERSION,
    uptime: uptimeString(),
    started_at: startedAt.toISOString(),
    timestamp: new Date().toISOString(),
    checks,
  };

  return c.json(body, allHealthy ? 200 : 503);
});

// -- GET /metrics -- Prometheus text exposition. ------------------------------

healthRoutes.get("/metrics", (c) => {
  c.header("Content-Type", "text/plain; version=0.0.4; charset=utf-8");
  return c.text(renderMetrics());
});

// =============================================================================
// Dependency checks
// =============================================================================

interface DependencyCheck {
  status: "ok" | "error";
  latency_ms: number;
  error?: string;
}

async function checkSupabase(): Promise<DependencyCheck> {
  const start = performance.now();
  try {
    const db = getSupabase();
    const { error } = await db.from("agents").select("id", { count: "exact", head: true });
    const latency = performance.now() - start;
    if (error) {
      return { status: "error", latency_ms: round(latency), error: error.message };
    }
    return { status: "ok", latency_ms: round(latency) };
  } catch (err) {
    const latency = performance.now() - start;
    const msg = err instanceof Error ? err.message : "Unknown error";
    return { status: "error", latency_ms: round(latency), error: msg };
  }
}

async function checkRedis(): Promise<DependencyCheck> {
  const start = performance.now();
  try {
    const redis = getRedis();
    const pong = await redis.ping();
    const latency = performance.now() - start;
    if (pong !== "PONG") {
      return { status: "error", latency_ms: round(latency), error: `Unexpected ping response: ${pong}` };
    }
    return { status: "ok", latency_ms: round(latency) };
  } catch (err) {
    const latency = performance.now() - start;
    const msg = err instanceof Error ? err.message : "Unknown error";
    return { status: "error", latency_ms: round(latency), error: msg };
  }
}

// =============================================================================
// Helpers
// =============================================================================

function round(ms: number): number {
  return Math.round(ms * 100) / 100;
}

function uptimeString(): string {
  const seconds = Math.floor((Date.now() - startedAt.getTime()) / 1000);
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const parts: string[] = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0) parts.push(`${h}h`);
  if (m > 0) parts.push(`${m}m`);
  parts.push(`${s}s`);
  return parts.join(" ");
}
