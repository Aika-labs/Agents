/**
 * Framework-agnostic types for the Agent Runtime Engine.
 *
 * These types define the contract between the runtime orchestrator and
 * individual framework adapters (Google ADK, LangGraph, CrewAI, etc.).
 */

/** Supported agent frameworks (mirrors the DB enum). */
export type AgentFramework =
  | "google_adk"
  | "langgraph"
  | "crewai"
  | "autogen"
  | "openai_sdk"
  | "custom";

/** Agent configuration passed from the control plane to the runtime. */
export interface AgentConfig {
  /** Agent UUID from the database. */
  id: string;
  /** Human-readable name. */
  name: string;
  /** Which framework to use. */
  framework: AgentFramework;
  /** LLM provider + model configuration. */
  modelConfig: ModelConfig;
  /** System prompt / instructions. */
  systemPrompt: string | null;
  /** Tool definitions (MCP-compatible). */
  tools: ToolConfig[];
  /** MCP server connections. */
  mcpServers: McpServerConfig[];
  /** A2A protocol configuration. */
  a2aConfig: Record<string, unknown>;
  /** Resource limits for the agent container. */
  resources: AgentResources;
  /** Arbitrary metadata. */
  metadata: Record<string, unknown>;
}

/** LLM model configuration. */
export interface ModelConfig {
  /** Provider name (e.g. "openai", "google", "anthropic"). */
  provider: string;
  /** Model identifier (e.g. "gpt-4o", "gemini-2.0-flash"). */
  model: string;
  /** Sampling temperature. */
  temperature?: number;
  /** Maximum output tokens. */
  maxTokens?: number;
  /** Additional provider-specific parameters. */
  params?: Record<string, unknown>;
}

/** Tool configuration (MCP-compatible). */
export interface ToolConfig {
  /** Unique tool name. */
  name: string;
  /** Human-readable description. */
  description: string;
  /** JSON Schema for the tool's input parameters. */
  inputSchema: Record<string, unknown>;
  /** MCP server that provides this tool (if external). */
  mcpServer?: string;
}

/** MCP server connection configuration. */
export interface McpServerConfig {
  /** Server name / identifier. */
  name: string;
  /** Transport type. */
  transport: "stdio" | "sse" | "http";
  /** Connection URL (for sse/http transports). */
  url?: string;
  /** Command to run (for stdio transport). */
  command?: string;
  /** Command arguments (for stdio transport). */
  args?: string[];
  /** Environment variables to pass. */
  env?: Record<string, string>;
}

/** Resource limits for an agent container. */
export interface AgentResources {
  /** CPU limit (e.g. "500m", "1"). */
  cpuLimit: string;
  /** Memory limit (e.g. "256Mi", "1Gi"). */
  memoryLimit: string;
  /** CPU request (e.g. "250m"). */
  cpuRequest: string;
  /** Memory request (e.g. "128Mi"). */
  memoryRequest: string;
  /** Maximum tokens per minute (rate limit). */
  maxTokensPerMinute?: number;
}

/** Runtime status of an agent instance. */
export type AgentRuntimeStatus =
  | "starting"
  | "running"
  | "paused"
  | "stopping"
  | "stopped"
  | "error"
  | "unknown";

/** Health check result from an agent. */
export interface HealthCheckResult {
  healthy: boolean;
  status: AgentRuntimeStatus;
  uptime?: number;
  lastActivity?: string;
  error?: string;
}

/** Result of an agent execution (single turn). */
export interface AgentRunResult {
  /** Output text from the agent. */
  output: string;
  /** Token usage for this turn. */
  tokenUsage: {
    promptTokens: number;
    completionTokens: number;
  };
  /** Tool calls made during this turn. */
  toolCalls: Array<{
    name: string;
    input: Record<string, unknown>;
    output: unknown;
  }>;
  /** Model used for this turn. */
  model: string;
  /** Execution duration in milliseconds. */
  durationMs: number;
  /** Arbitrary metadata from the framework. */
  metadata: Record<string, unknown>;
}
