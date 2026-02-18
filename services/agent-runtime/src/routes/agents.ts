import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { LifecycleManager } from "../k8s/lifecycle.js";
import { publishStatus } from "../redis/events.js";
import type { AgentConfig } from "../frameworks/types.js";

export const agentRuntimeRoutes = new Hono();

// Singleton lifecycle manager. Initialized lazily on first request.
let lifecycle: LifecycleManager | null = null;

function getLifecycle(): LifecycleManager {
  if (!lifecycle) {
    lifecycle = new LifecycleManager();
  }
  return lifecycle;
}

// -- Zod schemas --------------------------------------------------------------

const startAgentSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(255),
  framework: z.enum([
    "google_adk",
    "langgraph",
    "crewai",
    "autogen",
    "openai_sdk",
    "custom",
  ]),
  modelConfig: z.object({
    provider: z.string().min(1),
    model: z.string().min(1),
    temperature: z.number().min(0).max(2).optional(),
    maxTokens: z.number().int().min(1).optional(),
    params: z.record(z.unknown()).optional(),
  }),
  systemPrompt: z.string().nullable().default(null),
  tools: z
    .array(
      z.object({
        name: z.string(),
        description: z.string(),
        inputSchema: z.record(z.unknown()),
        mcpServer: z.string().optional(),
      }),
    )
    .default([]),
  mcpServers: z
    .array(
      z.object({
        name: z.string(),
        transport: z.enum(["stdio", "sse", "http"]),
        url: z.string().optional(),
        command: z.string().optional(),
        args: z.array(z.string()).optional(),
        env: z.record(z.string()).optional(),
      }),
    )
    .default([]),
  a2aConfig: z.record(z.unknown()).default({}),
  resources: z
    .object({
      cpuLimit: z.string().default("500m"),
      memoryLimit: z.string().default("512Mi"),
      cpuRequest: z.string().default("250m"),
      memoryRequest: z.string().default("256Mi"),
      maxTokensPerMinute: z.number().int().optional(),
    })
    .default({}),
  metadata: z.record(z.unknown()).default({}),
});

// -- Routes -------------------------------------------------------------------

/** POST /:id/start -- Start an agent on GKE. */
agentRuntimeRoutes.post("/:id/start", async (c) => {
  const agentId = c.req.param("id");
  const body = await c.req.json();

  // Override the id from the URL path.
  const parsed = startAgentSchema.safeParse({ ...body, id: agentId });
  if (!parsed.success) {
    const details = parsed.error.issues.map((i) => ({
      path: i.path.join("."),
      message: i.message,
    }));
    throw new HTTPException(400, {
      message: `Validation failed: ${details.map((d) => d.message).join("; ")}`,
    });
  }

  const config: AgentConfig = parsed.data;
  const mgr = getLifecycle();

  // Check if already running.
  const currentStatus = await mgr.getAgentStatus(agentId);
  if (currentStatus === "running" || currentStatus === "starting") {
    return c.json(
      { agentId, status: currentStatus, message: "Agent is already running" },
      200,
    );
  }

  await mgr.startAgent(config);

  await publishStatus({
    agentId,
    status: "starting",
    timestamp: new Date().toISOString(),
    metadata: { framework: config.framework },
  });

  return c.json({ agentId, status: "starting" }, 202);
});

/** POST /:id/stop -- Stop an agent gracefully. */
agentRuntimeRoutes.post("/:id/stop", async (c) => {
  const agentId = c.req.param("id");
  const mgr = getLifecycle();

  const currentStatus = await mgr.getAgentStatus(agentId);
  if (currentStatus === "stopped") {
    return c.json({ agentId, status: "stopped", message: "Agent is already stopped" });
  }

  await mgr.stopAgent(agentId);

  await publishStatus({
    agentId,
    status: "stopping",
    timestamp: new Date().toISOString(),
  });

  return c.json({ agentId, status: "stopping" }, 202);
});

/** POST /:id/pause -- Pause an agent (scale to 0). */
agentRuntimeRoutes.post("/:id/pause", async (c) => {
  const agentId = c.req.param("id");
  const mgr = getLifecycle();

  const currentStatus = await mgr.getAgentStatus(agentId);
  if (currentStatus === "paused") {
    return c.json({ agentId, status: "paused", message: "Agent is already paused" });
  }
  if (currentStatus !== "running") {
    throw new HTTPException(400, {
      message: `Cannot pause agent in '${currentStatus}' state. Must be 'running'.`,
    });
  }

  await mgr.pauseAgent(agentId);

  await publishStatus({
    agentId,
    status: "paused",
    timestamp: new Date().toISOString(),
  });

  return c.json({ agentId, status: "paused" }, 202);
});

/** POST /:id/resume -- Resume a paused agent (scale to 1). */
agentRuntimeRoutes.post("/:id/resume", async (c) => {
  const agentId = c.req.param("id");
  const mgr = getLifecycle();

  const currentStatus = await mgr.getAgentStatus(agentId);
  if (currentStatus !== "paused") {
    throw new HTTPException(400, {
      message: `Cannot resume agent in '${currentStatus}' state. Must be 'paused'.`,
    });
  }

  await mgr.resumeAgent(agentId);

  await publishStatus({
    agentId,
    status: "starting",
    timestamp: new Date().toISOString(),
  });

  return c.json({ agentId, status: "starting" }, 202);
});

/** POST /:id/kill -- Kill an agent immediately (no grace period). */
agentRuntimeRoutes.post("/:id/kill", async (c) => {
  const agentId = c.req.param("id");
  const mgr = getLifecycle();

  await mgr.killAgent(agentId);

  await publishStatus({
    agentId,
    status: "stopped",
    timestamp: new Date().toISOString(),
    metadata: { reason: "killed" },
  });

  return c.json({ agentId, status: "stopped", killed: true }, 200);
});

/** GET /:id/status -- Get the runtime status of an agent. */
agentRuntimeRoutes.get("/:id/status", async (c) => {
  const agentId = c.req.param("id");
  const mgr = getLifecycle();

  const status = await mgr.getAgentStatus(agentId);

  return c.json({ agentId, status });
});

/** GET / -- List all agent deployments managed by the runtime. */
agentRuntimeRoutes.get("/", async (c) => {
  const mgr = getLifecycle();
  const agents = await mgr.listAgents();

  return c.json({ data: agents, total: agents.length });
});
