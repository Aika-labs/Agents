import type { AgentRunner, AgentInput } from "./runner.js";
import type {
  AgentConfig,
  AgentRunResult,
  HealthCheckResult,
  ModelConfig,
} from "./types.js";

/**
 * Custom framework adapter.
 *
 * A generic adapter for user-provided agent implementations. The custom
 * agent is expected to expose an HTTP API that conforms to the Agent
 * Runtime protocol:
 *
 *   POST /run     -- Execute a single turn
 *   GET  /health  -- Health check
 *   POST /stop    -- Graceful shutdown
 *
 * The adapter proxies requests to the custom agent's HTTP endpoint,
 * which is specified in config.metadata.endpoint.
 *
 * This is a structural implementation that defines the integration points.
 */
export class CustomAdapter implements AgentRunner {
  readonly framework = "custom";

  private config: AgentConfig | null = null;
  private startedAt: Date | null = null;
  private isRunning = false;

  async init(config: AgentConfig): Promise<void> {
    this.config = config;
    this.startedAt = new Date();
    this.isRunning = true;

    console.log(
      `[Custom] Initialized agent "${config.name}" with endpoint ${String(config.metadata["endpoint"] ?? "not-set")}`,
    );

    // TODO: Verify the custom agent endpoint is reachable.
    // Configuration:
    // - Endpoint: config.metadata.endpoint (e.g., "http://localhost:9000")
    // - Auth: config.metadata.authToken (optional bearer token)
    // - Timeout: config.metadata.timeoutMs (default 30000)
  }

  async run(input: AgentInput): Promise<AgentRunResult> {
    if (!this.config || !this.isRunning) {
      throw new Error("Agent not initialized or not running");
    }

    const startTime = Date.now();

    // TODO: Forward the input to the custom agent's /run endpoint.
    // Expected request body: { sessionId, message, history?, context? }
    // Expected response: { output, tokenUsage, toolCalls, model, metadata }
    console.log(
      `[Custom] Processing message for session ${input.sessionId}: "${input.message.slice(0, 50)}..."`,
    );

    return {
      output: `[Custom placeholder] Received: ${input.message}`,
      tokenUsage: { promptTokens: 0, completionTokens: 0 },
      toolCalls: [],
      model: `${this.config.modelConfig.provider}/${this.config.modelConfig.model}`,
      durationMs: Date.now() - startTime,
      metadata: { framework: "custom", sessionId: input.sessionId },
    };
  }

  async healthCheck(): Promise<HealthCheckResult> {
    if (!this.isRunning || !this.startedAt) {
      return { healthy: false, status: "stopped" };
    }

    const uptime = Date.now() - this.startedAt.getTime();

    // TODO: Proxy health check to the custom agent's /health endpoint.
    return {
      healthy: true,
      status: "running",
      uptime,
      lastActivity: new Date().toISOString(),
    };
  }

  async stop(): Promise<void> {
    console.log(`[Custom] Stopping agent "${this.config?.name}"`);
    this.isRunning = false;

    // TODO: Send POST /stop to the custom agent endpoint.
  }

  async updateModelConfig(modelConfig: ModelConfig): Promise<boolean> {
    if (!this.config) return false;

    console.log(
      `[Custom] Hot-swapping model to ${modelConfig.provider}/${modelConfig.model}`,
    );

    this.config.modelConfig = modelConfig;

    // TODO: Forward model config update to the custom agent.
    return true;
  }
}
