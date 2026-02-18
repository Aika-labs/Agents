import { Hono } from "hono";
import { logger } from "hono/logger";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createMcpServer } from "./mcp/server.js";

/**
 * Main Hono application for the Protocols service.
 *
 * Mounts:
 *   - GET  /health           -- Service health check
 *   - GET  /discovery        -- Protocol discovery (lists available protocols)
 *   - *    /mcp              -- MCP Streamable HTTP endpoint
 *
 * The A2A endpoints are served via a separate Express app (see index.ts)
 * because the @a2a-js/sdk server integration is Express-native.
 */

const app = new Hono();

// -- Middleware ----------------------------------------------------------------

app.use("*", logger());

// -- Health check -------------------------------------------------------------

app.get("/health", (c) => {
  return c.json({
    status: "ok",
    service: "protocols",
    protocols: ["mcp", "a2a"],
    timestamp: new Date().toISOString(),
  });
});

// -- Protocol discovery -------------------------------------------------------

app.get("/discovery", (c) => {
  const baseUrl = process.env["BASE_URL"] ?? `http://localhost:${process.env["PORT"] ?? "8082"}`;

  return c.json({
    protocols: {
      mcp: {
        version: "2025-06-18",
        endpoint: `${baseUrl}/mcp`,
        transport: "streamable-http",
        description: "Model Context Protocol -- exposes platform tools for LLM integration",
      },
      a2a: {
        version: "0.3.0",
        agentCardUrl: `${baseUrl}/.well-known/agent-card.json`,
        jsonRpcEndpoint: `${baseUrl}/a2a/jsonrpc`,
        description: "Agent-to-Agent protocol -- enables inter-agent collaboration",
      },
    },
  });
});

// -- MCP Streamable HTTP endpoint ---------------------------------------------

/**
 * MCP transport sessions. Each session gets its own transport instance
 * for stateful communication. Stateless mode uses a single transport.
 */
const mcpServer: McpServer = createMcpServer();
const mcpTransports = new Map<string, WebStandardStreamableHTTPServerTransport>();

/**
 * Handle MCP requests via Streamable HTTP.
 *
 * The MCP SDK's WebStandardStreamableHTTPServerTransport handles the
 * full protocol: initialization, tool listing, tool calls, SSE streaming.
 */
app.all("/mcp", async (c) => {
  // Check for existing session.
  const sessionId = c.req.header("mcp-session-id");

  if (c.req.method === "GET" || c.req.method === "DELETE") {
    // GET = SSE stream reconnect, DELETE = session close.
    if (sessionId && mcpTransports.has(sessionId)) {
      const transport = mcpTransports.get(sessionId)!;
      return transport.handleRequest(c.req.raw);
    }

    if (c.req.method === "DELETE" && sessionId) {
      mcpTransports.delete(sessionId);
      return new Response(null, { status: 204 });
    }

    return new Response("No active session", { status: 400 });
  }

  // POST = new request or continuation.
  if (sessionId && mcpTransports.has(sessionId)) {
    const transport = mcpTransports.get(sessionId)!;
    return transport.handleRequest(c.req.raw);
  }

  // New session: create transport and connect to MCP server.
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: () => crypto.randomUUID(),
    onsessioninitialized: (id) => {
      mcpTransports.set(id, transport);
      console.log(`[MCP] Session initialized: ${id}`);
    },
    onsessionclosed: (id) => {
      mcpTransports.delete(id);
      console.log(`[MCP] Session closed: ${id}`);
    },
  });

  await mcpServer.connect(transport);

  return transport.handleRequest(c.req.raw);
});

// -- Error handler ------------------------------------------------------------

app.onError((err, c) => {
  console.error("[Protocols] Unhandled error:", err);
  const status =
    "status" in err && typeof err.status === "number" ? err.status : 500;
  return c.json(
    { error: err.message || "Internal server error", status },
    status as 500,
  );
});

export { app };
