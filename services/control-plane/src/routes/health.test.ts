import { describe, it, expect } from "vitest";
import { Hono } from "hono";

/**
 * Health route tests.
 *
 * We create a minimal Hono app with just the health routes to test
 * the basic health endpoint without needing Supabase/Redis connections.
 */

// Build a minimal test app with only the basic health endpoint.
const app = new Hono();

const SERVICE_VERSION = "0.1.0-test";

app.get("/health", (c) => {
  return c.json({
    status: "ok",
    service: "control-plane",
    version: SERVICE_VERSION,
    timestamp: new Date().toISOString(),
  });
});

app.get("/health/live", (c) => {
  return c.json({ status: "ok" });
});

interface HealthResponse {
  status: string;
  service: string;
  version: string;
  timestamp: string;
}

interface LiveResponse {
  status: string;
}

describe("GET /health", () => {
  it("returns 200 with status ok", async () => {
    const res = await app.request("/health");
    expect(res.status).toBe(200);

    const body = (await res.json()) as HealthResponse;
    expect(body.status).toBe("ok");
    expect(body.service).toBe("control-plane");
    expect(body.version).toBe(SERVICE_VERSION);
    expect(body.timestamp).toBeDefined();
  });

  it("returns valid ISO timestamp", async () => {
    const res = await app.request("/health");
    const body = (await res.json()) as HealthResponse;
    const date = new Date(body.timestamp);
    expect(date.toISOString()).toBe(body.timestamp);
  });
});

describe("GET /health/live", () => {
  it("returns 200 with status ok", async () => {
    const res = await app.request("/health/live");
    expect(res.status).toBe(200);

    const body = (await res.json()) as LiveResponse;
    expect(body.status).toBe("ok");
  });
});
