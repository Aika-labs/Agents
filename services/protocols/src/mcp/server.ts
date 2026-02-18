import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type { ServerRequest, ServerNotification } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

/**
 * MCP Server for the Agent Operating System.
 *
 * Exposes platform capabilities as MCP tools that any MCP-compatible client
 * (Claude Desktop, Cursor, custom agents) can discover and invoke.
 *
 * Tools exposed:
 *   - list_agents: List all agents owned by the caller
 *   - get_agent: Get details of a specific agent
 *   - create_agent: Create a new agent
 *   - start_agent: Start an agent on the runtime
 *   - stop_agent: Stop a running agent
 *   - get_agent_status: Get runtime status of an agent
 *   - send_message: Send a message to an agent session
 *
 * Auth: The MCP client's Authorization / X-API-Key headers are forwarded
 * to the control plane so requests are authenticated as the calling user.
 */

type ToolExtra = RequestHandlerExtra<ServerRequest, ServerNotification>;

/** Control plane base URL (internal service). */
function getControlPlaneUrl(): string {
  return process.env["CONTROL_PLANE_URL"] ?? "http://localhost:8080";
}

/** Agent runtime base URL (internal service). */
function getRuntimeUrl(): string {
  return process.env["AGENT_RUNTIME_URL"] ?? "http://localhost:8081";
}

/**
 * Extract auth-related headers from the incoming MCP request.
 *
 * The MCP SDK's Streamable HTTP transport populates `extra.requestInfo.headers`
 * with the original HTTP request headers as a plain Record (IsomorphicHeaders).
 * We forward Authorization and X-API-Key so the control plane can authenticate
 * the caller.
 */
function getAuthHeaders(extra: ToolExtra): Record<string, string> {
  const headers: Record<string, string> = {};
  const reqHeaders = extra.requestInfo?.headers;

  if (!reqHeaders) return headers;

  // IsomorphicHeaders is Record<string, string | string[] | undefined>.
  // Header keys may be lowercase (Node.js convention).
  const auth = reqHeaders["authorization"] ?? reqHeaders["Authorization"];
  if (typeof auth === "string") {
    headers["Authorization"] = auth;
  } else if (Array.isArray(auth) && auth[0]) {
    headers["Authorization"] = auth[0];
  }

  const apiKey = reqHeaders["x-api-key"] ?? reqHeaders["X-API-Key"];
  if (typeof apiKey === "string") {
    headers["X-API-Key"] = apiKey;
  } else if (Array.isArray(apiKey) && apiKey[0]) {
    headers["X-API-Key"] = apiKey[0];
  }

  return headers;
}

/**
 * Create and configure the MCP server with all platform tools.
 */
export function createMcpServer(): McpServer {
  const mcp = new McpServer(
    {
      name: "agent-os",
      version: "0.1.0",
    },
    {
      capabilities: {
        tools: {},
        resources: {},
      },
    },
  );

  registerTools(mcp);
  registerResources(mcp);

  return mcp;
}

// -- Tool registration --------------------------------------------------------

function registerTools(mcp: McpServer): void {
  // List agents
  mcp.tool(
    "list_agents",
    "List all agents on the platform. Returns agent IDs, names, frameworks, and statuses.",
    {
      status: z
        .enum(["draft", "running", "paused", "stopped", "error", "archived"])
        .optional()
        .describe("Filter by agent status"),
      framework: z
        .enum([
          "google_adk",
          "langgraph",
          "crewai",
          "autogen",
          "openai_sdk",
          "custom",
        ])
        .optional()
        .describe("Filter by framework"),
      limit: z.number().int().min(1).max(100).default(20).describe("Max results"),
    },
    async (args, extra) => {
      const params = new URLSearchParams();
      if (args.status) params.set("status", args.status);
      if (args.framework) params.set("framework", args.framework);
      params.set("limit", String(args.limit));

      const res = await fetch(
        `${getControlPlaneUrl()}/agents?${params.toString()}`,
        { headers: getAuthHeaders(extra) },
      );
      const data = await res.json();

      return {
        content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
      };
    },
  );

  // Get agent details
  mcp.tool(
    "get_agent",
    "Get detailed information about a specific agent.",
    {
      agent_id: z.string().uuid().describe("Agent UUID"),
    },
    async (args, extra) => {
      const res = await fetch(
        `${getControlPlaneUrl()}/agents/${args.agent_id}`,
        { headers: getAuthHeaders(extra) },
      );

      if (!res.ok) {
        return {
          content: [{ type: "text" as const, text: `Error: Agent not found (${res.status})` }],
          isError: true,
        };
      }

      const data = await res.json();
      return {
        content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
      };
    },
  );

  // Create agent
  mcp.tool(
    "create_agent",
    "Create a new AI agent on the platform.",
    {
      name: z.string().min(1).max(255).describe("Agent name"),
      description: z.string().max(2000).optional().describe("Agent description"),
      framework: z
        .enum([
          "google_adk",
          "langgraph",
          "crewai",
          "autogen",
          "openai_sdk",
          "custom",
        ])
        .default("google_adk")
        .describe("Agent framework"),
      system_prompt: z
        .string()
        .max(50000)
        .optional()
        .describe("System prompt / instructions"),
      model_provider: z
        .string()
        .default("openai")
        .describe("LLM provider (openai, google, anthropic)"),
      model_name: z
        .string()
        .default("gpt-4o")
        .describe("Model identifier"),
    },
    async (args, extra) => {
      const body = {
        name: args.name,
        description: args.description,
        framework: args.framework,
        system_prompt: args.system_prompt,
        model_config: {
          provider: args.model_provider,
          model: args.model_name,
        },
      };

      const res = await fetch(`${getControlPlaneUrl()}/agents`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAuthHeaders(extra) },
        body: JSON.stringify(body),
      });

      const data = await res.json();

      if (!res.ok) {
        return {
          content: [{ type: "text" as const, text: `Error creating agent: ${JSON.stringify(data)}` }],
          isError: true,
        };
      }

      return {
        content: [
          {
            type: "text" as const,
            text: `Agent created successfully:\n${JSON.stringify(data, null, 2)}`,
          },
        ],
      };
    },
  );

  // Start agent
  mcp.tool(
    "start_agent",
    "Start an agent on the runtime.",
    {
      agent_id: z.string().uuid().describe("Agent UUID to start"),
    },
    async (args, extra) => {
      const res = await fetch(
        `${getRuntimeUrl()}/agents/${args.agent_id}/start`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", ...getAuthHeaders(extra) },
          body: "{}",
        },
      );

      const data = await res.json();
      return {
        content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
        isError: !res.ok,
      };
    },
  );

  // Stop agent
  mcp.tool(
    "stop_agent",
    "Stop a running agent gracefully.",
    {
      agent_id: z.string().uuid().describe("Agent UUID to stop"),
    },
    async (args, extra) => {
      const res = await fetch(
        `${getRuntimeUrl()}/agents/${args.agent_id}/stop`,
        { method: "POST", headers: getAuthHeaders(extra) },
      );

      const data = await res.json();
      return {
        content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
        isError: !res.ok,
      };
    },
  );

  // Get agent runtime status
  mcp.tool(
    "get_agent_status",
    "Get the runtime status of an agent (running, paused, stopped, etc.).",
    {
      agent_id: z.string().uuid().describe("Agent UUID"),
    },
    async (args, extra) => {
      const res = await fetch(
        `${getRuntimeUrl()}/agents/${args.agent_id}/status`,
        { headers: getAuthHeaders(extra) },
      );

      const data = await res.json();
      return {
        content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
        isError: !res.ok,
      };
    },
  );

  // Send message to agent
  mcp.tool(
    "send_message",
    "Send a message to an agent session and get a response.",
    {
      agent_id: z.string().uuid().describe("Agent UUID"),
      session_id: z.string().uuid().describe("Session UUID"),
      message: z.string().min(1).describe("Message content"),
    },
    async (args, extra) => {
      const res = await fetch(
        `${getControlPlaneUrl()}/agents/${args.agent_id}/sessions/${args.session_id}/messages`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", ...getAuthHeaders(extra) },
          body: JSON.stringify({ content: args.message, role: "user" }),
        },
      );

      const data = await res.json();
      return {
        content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
        isError: !res.ok,
      };
    },
  );
}

// -- Resource registration ----------------------------------------------------

function registerResources(mcp: McpServer): void {
  // Expose the platform capabilities as a resource.
  mcp.resource(
    "platform-info",
    "agents://platform/info",
    {
      description: "Agent Operating System platform information and capabilities",
      mimeType: "application/json",
    },
    async () => ({
      contents: [
        {
          uri: "agents://platform/info",
          mimeType: "application/json",
          text: JSON.stringify(
            {
              name: "Agent Operating System",
              version: "0.1.0",
              protocols: ["mcp", "a2a"],
              frameworks: [
                "google_adk",
                "langgraph",
                "crewai",
                "autogen",
                "openai_sdk",
                "custom",
              ],
              capabilities: [
                "agent_lifecycle",
                "model_hot_swap",
                "feature_flags",
                "crypto_wallets",
                "marketplace",
                "observability",
              ],
            },
            null,
            2,
          ),
        },
      ],
    }),
  );
}
