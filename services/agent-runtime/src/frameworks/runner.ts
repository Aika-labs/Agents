import type {
  AgentConfig,
  AgentRunResult,
  HealthCheckResult,
} from "./types.js";

/**
 * Framework-agnostic agent runner interface.
 *
 * Each framework adapter (Google ADK, LangGraph, CrewAI, etc.) implements
 * this interface. The lifecycle manager uses it to start, run, and stop
 * agents without knowing which framework is underneath.
 *
 * Lifecycle:
 *   1. init(config)    -- Load the framework, configure the model, register tools.
 *   2. run(input)      -- Execute a single turn (user message -> agent response).
 *   3. healthCheck()   -- Verify the agent is responsive.
 *   4. stop()          -- Gracefully shut down, release resources.
 */
export interface AgentRunner {
  /** Framework identifier. */
  readonly framework: string;

  /**
   * Initialize the agent with the given configuration.
   * Called once when the agent container starts.
   */
  init(config: AgentConfig): Promise<void>;

  /**
   * Execute a single turn: process the input and return the agent's response.
   * Supports both text input and structured messages.
   */
  run(input: AgentInput): Promise<AgentRunResult>;

  /**
   * Check if the agent is healthy and responsive.
   */
  healthCheck(): Promise<HealthCheckResult>;

  /**
   * Gracefully stop the agent. Release model connections, close MCP servers, etc.
   */
  stop(): Promise<void>;

  /**
   * Hot-swap the model configuration without restarting the agent.
   * Returns true if the swap was successful.
   */
  updateModelConfig(modelConfig: AgentConfig["modelConfig"]): Promise<boolean>;
}

/** Input for a single agent turn. */
export interface AgentInput {
  /** Session ID for conversation context. */
  sessionId: string;
  /** The user's message. */
  message: string;
  /** Conversation history (for stateless frameworks). */
  history?: Array<{
    role: "user" | "assistant" | "system" | "tool";
    content: string;
  }>;
  /** Additional context / metadata. */
  context?: Record<string, unknown>;
}
