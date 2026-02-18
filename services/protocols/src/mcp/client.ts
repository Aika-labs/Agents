import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";

/**
 * MCP Client Manager.
 *
 * Manages connections to external MCP tool servers on behalf of agents.
 * Each agent can connect to multiple MCP servers (e.g., a GitHub MCP server,
 * a database MCP server, a web search MCP server). The client manager:
 *
 *   1. Connects to MCP servers using Streamable HTTP or SSE transport
 *   2. Discovers available tools from each server
 *   3. Proxies tool calls from the agent runtime to the appropriate MCP server
 *   4. Manages connection lifecycle (connect, reconnect, disconnect)
 *
 * Connection key: `{agentId}:{serverName}` for per-agent isolation.
 */

export interface McpServerConnection {
  /** MCP server name. */
  name: string;
  /** Transport type. */
  transport: "streamable-http" | "sse";
  /** Server URL. */
  url: string;
  /** Optional auth headers. */
  headers?: Record<string, string>;
}

interface ActiveConnection {
  client: Client;
  transport: StreamableHTTPClientTransport | SSEClientTransport;
  serverName: string;
  tools: DiscoveredTool[];
  connectedAt: Date;
}

export interface DiscoveredTool {
  /** Tool name as reported by the MCP server. */
  name: string;
  /** Tool description. */
  description?: string;
  /** JSON Schema for the tool's input. */
  inputSchema?: Record<string, unknown>;
  /** Which MCP server provides this tool. */
  serverName: string;
}

export interface ToolCallResult {
  content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
  isError?: boolean;
}

export class McpClientManager {
  /** Active connections keyed by `{agentId}:{serverName}`. */
  private connections = new Map<string, ActiveConnection>();

  /**
   * Connect an agent to an MCP server and discover its tools.
   */
  async connect(
    agentId: string,
    server: McpServerConnection,
  ): Promise<DiscoveredTool[]> {
    const key = connectionKey(agentId, server.name);

    // Close existing connection if any.
    if (this.connections.has(key)) {
      await this.disconnect(agentId, server.name);
    }

    console.log(
      `[MCP Client] Connecting agent ${agentId} to MCP server "${server.name}" at ${server.url}`,
    );

    const transport = this.createTransport(server);
    const client = new Client(
      { name: `agent-${agentId}`, version: "0.1.0" },
      { capabilities: {} },
    );

    await client.connect(transport);

    // Discover tools.
    const toolsResult = await client.listTools();
    const tools: DiscoveredTool[] = (toolsResult.tools ?? []).map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema as Record<string, unknown> | undefined,
      serverName: server.name,
    }));

    this.connections.set(key, {
      client,
      transport,
      serverName: server.name,
      tools,
      connectedAt: new Date(),
    });

    console.log(
      `[MCP Client] Agent ${agentId} connected to "${server.name}". Discovered ${tools.length} tools: ${tools.map((t) => t.name).join(", ")}`,
    );

    return tools;
  }

  /**
   * Call a tool on an MCP server on behalf of an agent.
   */
  async callTool(
    agentId: string,
    serverName: string,
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<ToolCallResult> {
    const key = connectionKey(agentId, serverName);
    const conn = this.connections.get(key);

    if (!conn) {
      return {
        content: [
          {
            type: "text",
            text: `Not connected to MCP server "${serverName}". Call connect() first.`,
          },
        ],
        isError: true,
      };
    }

    console.log(
      `[MCP Client] Agent ${agentId} calling tool "${toolName}" on "${serverName}"`,
    );

    const result = await conn.client.callTool({
      name: toolName,
      arguments: args,
    });

    return {
      content: (result.content ?? []) as ToolCallResult["content"],
      isError: (result.isError as boolean | undefined) ?? false,
    };
  }

  /**
   * List all tools available to an agent across all connected MCP servers.
   */
  listTools(agentId: string): DiscoveredTool[] {
    const tools: DiscoveredTool[] = [];

    for (const [key, conn] of this.connections) {
      if (key.startsWith(`${agentId}:`)) {
        tools.push(...conn.tools);
      }
    }

    return tools;
  }

  /**
   * List all active connections for an agent.
   */
  listConnections(
    agentId: string,
  ): Array<{ serverName: string; toolCount: number; connectedAt: string }> {
    const result: Array<{
      serverName: string;
      toolCount: number;
      connectedAt: string;
    }> = [];

    for (const [key, conn] of this.connections) {
      if (key.startsWith(`${agentId}:`)) {
        result.push({
          serverName: conn.serverName,
          toolCount: conn.tools.length,
          connectedAt: conn.connectedAt.toISOString(),
        });
      }
    }

    return result;
  }

  /**
   * Disconnect an agent from a specific MCP server.
   */
  async disconnect(agentId: string, serverName: string): Promise<void> {
    const key = connectionKey(agentId, serverName);
    const conn = this.connections.get(key);

    if (conn) {
      console.log(
        `[MCP Client] Disconnecting agent ${agentId} from "${serverName}"`,
      );
      await conn.client.close();
      this.connections.delete(key);
    }
  }

  /**
   * Disconnect an agent from all MCP servers.
   */
  async disconnectAll(agentId: string): Promise<void> {
    const keysToRemove: string[] = [];

    for (const key of this.connections.keys()) {
      if (key.startsWith(`${agentId}:`)) {
        keysToRemove.push(key);
      }
    }

    for (const key of keysToRemove) {
      const conn = this.connections.get(key);
      if (conn) {
        await conn.client.close();
        this.connections.delete(key);
      }
    }
  }

  /**
   * Close all connections (shutdown).
   */
  async closeAll(): Promise<void> {
    for (const conn of this.connections.values()) {
      await conn.client.close();
    }
    this.connections.clear();
  }

  // -- Private helpers --------------------------------------------------------

  private createTransport(
    server: McpServerConnection,
  ): StreamableHTTPClientTransport | SSEClientTransport {
    const url = new URL(server.url);

    if (server.transport === "sse") {
      return new SSEClientTransport(url, {
        requestInit: server.headers
          ? { headers: server.headers }
          : undefined,
      });
    }

    // Default: Streamable HTTP (preferred for MCP 2025-06-18 spec).
    return new StreamableHTTPClientTransport(url, {
      requestInit: server.headers
        ? { headers: server.headers }
        : undefined,
    });
  }
}

function connectionKey(agentId: string, serverName: string): string {
  return `${agentId}:${serverName}`;
}

/** Singleton MCP client manager. */
let instance: McpClientManager | null = null;

export function getMcpClientManager(): McpClientManager {
  if (!instance) {
    instance = new McpClientManager();
  }
  return instance;
}
