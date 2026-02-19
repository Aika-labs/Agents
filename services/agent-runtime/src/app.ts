import { Hono } from "hono";
import { logger } from "hono/logger";
import { agentRuntimeRoutes } from "./routes/agents.js";
import { subscribeToCommands } from "./redis/events.js";
import { lifecycle } from "./lifecycle/instance.js";
import type { AgentCommand } from "./redis/events.js";
import type { AgentConfig } from "./frameworks/types.js";

const app = new Hono();

// -- Middleware ----------------------------------------------------------------

app.use("*", logger());

// -- Health check (public) ----------------------------------------------------

app.get("/health", (c) => {
  return c.json({
    status: "ok",
    service: "agent-runtime",
    timestamp: new Date().toISOString(),
  });
});

// -- Agent runtime routes (mounted under /agents) -----------------------------

app.route("/agents", agentRuntimeRoutes);

// -- Global error handler -----------------------------------------------------

app.onError((err, c) => {
  console.error("[Runtime] Unhandled error:", err);
  const status = "status" in err && typeof err.status === "number" ? err.status : 500;
  return c.json(
    {
      error: err.message || "Internal server error",
      status,
    },
    status as 500,
  );
});

// -- Redis command subscriber -------------------------------------------------

/**
 * Start the Redis command subscriber.
 *
 * Listens for agent lifecycle commands published by the control plane
 * and dispatches them to the InProcessLifecycleManager.  This runs
 * alongside the HTTP server so the runtime can receive commands via
 * both HTTP API and Redis pub/sub.
 */
export function startCommandSubscriber(): { unsubscribe: () => Promise<void> } {
  const handleCommand = async (cmd: AgentCommand): Promise<void> => {
    console.log(
      `[Subscriber] Received ${cmd.command} for agent ${cmd.agentId}`,
    );

    switch (cmd.command) {
      case "start":
        // Start requires full agent config in the payload.
        if (cmd.payload && typeof cmd.payload === "object") {
          await lifecycle.startAgent(cmd.payload as unknown as AgentConfig);
        } else {
          console.error("[Subscriber] Start command missing agent config in payload");
        }
        break;
      case "stop":
        await lifecycle.stopAgent(cmd.agentId);
        break;
      case "pause":
        await lifecycle.pauseAgent(cmd.agentId);
        break;
      case "resume":
        await lifecycle.resumeAgent(cmd.agentId);
        break;
      case "kill":
        await lifecycle.killAgent(cmd.agentId);
        break;
      case "update_model":
        if (cmd.payload && typeof cmd.payload === "object") {
          const success = await lifecycle.updateModelConfig(
            cmd.agentId,
            cmd.payload as unknown as AgentConfig["modelConfig"],
          );
          console.log(
            `[Subscriber] Model update for ${cmd.agentId}: ${success ? "success" : "failed"}`,
          );
        } else {
          console.error("[Subscriber] update_model command missing model config in payload");
        }
        break;
    }
  };

  return subscribeToCommands(handleCommand);
}

export { app };
