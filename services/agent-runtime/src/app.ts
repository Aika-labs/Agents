import { Hono } from "hono";
import { logger } from "hono/logger";
import { agentRuntimeRoutes } from "./routes/agents.js";
import { subscribeToCommands } from "./redis/events.js";
import { LifecycleManager } from "./k8s/lifecycle.js";
import type { AgentCommand } from "./redis/events.js";

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
 * and dispatches them to the LifecycleManager. This runs alongside
 * the HTTP server so the runtime can receive commands via both
 * HTTP API and Redis pub/sub.
 */
export function startCommandSubscriber(): { unsubscribe: () => Promise<void> } {
  const lifecycle = new LifecycleManager();

  const handleCommand = async (cmd: AgentCommand): Promise<void> => {
    console.log(
      `[Subscriber] Received ${cmd.command} for agent ${cmd.agentId}`,
    );

    switch (cmd.command) {
      case "start":
        // Start requires full config in payload.
        if (cmd.payload && typeof cmd.payload === "object") {
          await lifecycle.startAgent(cmd.payload as unknown as Parameters<typeof lifecycle.startAgent>[0]);
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
        // Model hot-swap is handled at the agent container level, not K8s.
        console.log(
          `[Subscriber] Model update for ${cmd.agentId} -- forwarding to agent container`,
        );
        break;
    }
  };

  return subscribeToCommands(handleCommand);
}

export { app };
