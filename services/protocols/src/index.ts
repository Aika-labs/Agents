import http from "node:http";
import { getRequestListener } from "@hono/node-server";
import { app } from "./app.js";
import { createA2AApp } from "./a2a/server.js";

const port = parseInt(process.env["PORT"] ?? "8082", 10);

/**
 * Protocols service entry point.
 *
 * Runs two protocol servers on the same port:
 *   - Hono app: /health, /discovery, /mcp (MCP Streamable HTTP)
 *   - Express app: /.well-known/agent-card.json, /a2a/* (A2A protocol)
 *
 * The Node.js HTTP server dispatches requests to the appropriate handler
 * based on the URL path prefix.
 */

// Create the A2A Express app.
const a2aApp = createA2AApp();

// Create the Hono request listener for Node.js HTTP.
const honoListener = getRequestListener(app.fetch);

// Create a combined HTTP server that routes by path.
const server = http.createServer((req, res) => {
  const url = req.url ?? "/";

  // Route A2A paths to the Express app.
  if (url.startsWith("/.well-known/") || url.startsWith("/a2a/")) {
    a2aApp(req, res);
    return;
  }

  // Everything else goes to the Hono app.
  honoListener(req, res);
});

server.listen(port, () => {
  console.log(`Protocols service listening on port ${port}`);
  console.log(`  MCP endpoint:     http://localhost:${port}/mcp`);
  console.log(`  A2A AgentCard:    http://localhost:${port}/.well-known/agent-card.json`);
  console.log(`  A2A JSON-RPC:     http://localhost:${port}/a2a/jsonrpc`);
  console.log(`  Health:           http://localhost:${port}/health`);
  console.log(`  Discovery:        http://localhost:${port}/discovery`);
});
