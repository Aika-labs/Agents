import express from "express";
import {
  DefaultRequestHandler,
  InMemoryTaskStore,
} from "@a2a-js/sdk/server";
import {
  agentCardHandler,
  jsonRpcHandler,
  UserBuilder,
} from "@a2a-js/sdk/server/express";
import { AGENT_CARD_PATH } from "@a2a-js/sdk";
import { buildPlatformAgentCard, buildAgentCard as buildAgentCardForAgent } from "./agent-card.js";
import { PlatformAgentExecutor } from "./executor.js";

/**
 * Create the A2A Express app.
 *
 * Sets up:
 *   - `/.well-known/agent-card.json` -- AgentCard discovery endpoint
 *   - `/a2a/jsonrpc` -- JSON-RPC endpoint for A2A protocol messages
 *
 * The Express app is designed to be mounted inside the main Hono app
 * or run standalone.
 */
export function createA2AApp(): express.Express {
  const baseUrl = getBaseUrl();
  const agentCard = buildPlatformAgentCard(baseUrl);

  // Create the executor and request handler.
  const executor = new PlatformAgentExecutor(null);
  const taskStore = new InMemoryTaskStore();
  const requestHandler = new DefaultRequestHandler(
    agentCard,
    taskStore,
    executor,
  );

  // Build Express app with A2A routes.
  const app = express();

  // AgentCard discovery endpoint.
  app.use(
    `/${AGENT_CARD_PATH}`,
    agentCardHandler({ agentCardProvider: requestHandler }),
  );

  // JSON-RPC endpoint for A2A protocol.
  app.use(
    "/a2a/jsonrpc",
    jsonRpcHandler({
      requestHandler,
      userBuilder: UserBuilder.noAuthentication,
    }),
  );

  // Health check for the A2A subsystem.
  app.get("/a2a/health", (_req, res) => {
    res.json({
      status: "ok",
      protocol: "a2a",
      protocolVersion: "0.3.0",
      agentCardUrl: `${baseUrl}/${AGENT_CARD_PATH}`,
    });
  });

  return app;
}

/**
 * Create an A2A Express app for a specific agent.
 *
 * Each agent on the platform can have its own A2A endpoint so remote
 * agents can communicate with it directly.
 */
export function createAgentA2AApp(agent: {
  id: string;
  name: string;
  description?: string | null;
  framework: string;
  tags?: string[];
}): express.Express {
  const baseUrl = getBaseUrl();

  const agentCard = buildAgentCardForAgent(baseUrl, agent);

  const executor = new PlatformAgentExecutor(agent.id);
  const taskStore = new InMemoryTaskStore();
  const requestHandler = new DefaultRequestHandler(
    agentCard,
    taskStore,
    executor,
  );

  const app = express();

  app.use(
    `/${AGENT_CARD_PATH}`,
    agentCardHandler({ agentCardProvider: requestHandler }),
  );

  app.use(
    "/jsonrpc",
    jsonRpcHandler({
      requestHandler,
      userBuilder: UserBuilder.noAuthentication,
    }),
  );

  return app;
}

function getBaseUrl(): string {
  return process.env["BASE_URL"] ?? "http://localhost:8082";
}
