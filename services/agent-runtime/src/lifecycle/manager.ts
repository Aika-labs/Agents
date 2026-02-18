import type { AgentConfig, AgentRuntimeStatus } from "../frameworks/types.js";
import type { AgentRunner } from "../frameworks/runner.js";
import { createRunner } from "../frameworks/registry.js";

/**
 * In-process Agent Lifecycle Manager for Cloud Run.
 *
 * Instead of creating Kubernetes Deployments (one container per agent), this
 * manager runs agents as in-process {@link AgentRunner} instances.  All agents
 * share the same Cloud Run container, which keeps costs near-zero at low scale
 * and removes the need for a K8s cluster.
 *
 * Trade-offs vs. the K8s LifecycleManager:
 *   - No per-agent isolation (CPU/memory limits are shared).
 *   - "Pause" stops the runner but keeps state in the map so it can be
 *     re-initialized quickly on resume.
 *   - If the Cloud Run instance is evicted, all agent state is lost.  Durable
 *     state should live in Supabase / Redis.
 *
 * When stronger isolation is needed (Phase 2), swap this implementation for
 * the K8s-based LifecycleManager in `src/k8s/lifecycle.ts` — the public API
 * is identical.
 */

/** Internal bookkeeping for a managed agent. */
interface ManagedAgent {
  config: AgentConfig;
  runner: AgentRunner;
  status: AgentRuntimeStatus;
  startedAt: Date;
}

export class InProcessLifecycleManager {
  /** Map of agentId -> managed agent. */
  private agents = new Map<string, ManagedAgent>();

  // -- Public API (mirrors K8s LifecycleManager) ------------------------------

  /**
   * Start an agent.  If it was previously paused, re-initialize its runner.
   * If it is already running, this is a no-op.
   */
  async startAgent(config: AgentConfig): Promise<void> {
    const existing = this.agents.get(config.id);

    if (existing && existing.status === "running") {
      console.log(
        `[Lifecycle] Agent ${config.id} is already running — skipping start`,
      );
      return;
    }

    // If paused, treat as resume.
    if (existing && existing.status === "paused") {
      console.log(`[Lifecycle] Resuming paused agent ${config.id}`);
      await this.resumeAgent(config.id);
      return;
    }

    console.log(
      `[Lifecycle] Starting agent "${config.name}" (${config.framework}) in-process`,
    );

    const runner = createRunner(config.framework);
    await runner.init(config);

    this.agents.set(config.id, {
      config,
      runner,
      status: "running",
      startedAt: new Date(),
    });

    console.log(`[Lifecycle] Agent ${config.id} started successfully`);
  }

  /**
   * Pause an agent — stop its runner but keep the config so it can be
   * resumed without a full re-init payload.
   */
  async pauseAgent(agentId: string): Promise<void> {
    const entry = this.agents.get(agentId);
    if (!entry) {
      console.warn(`[Lifecycle] Cannot pause unknown agent ${agentId}`);
      return;
    }

    console.log(`[Lifecycle] Pausing agent ${agentId}`);
    await entry.runner.stop();
    entry.status = "paused";
  }

  /**
   * Resume a paused agent by re-initializing its runner with the stored config.
   */
  async resumeAgent(agentId: string): Promise<void> {
    const entry = this.agents.get(agentId);
    if (!entry) {
      console.warn(`[Lifecycle] Cannot resume unknown agent ${agentId}`);
      return;
    }

    console.log(`[Lifecycle] Resuming agent ${agentId}`);
    const runner = createRunner(entry.config.framework);
    await runner.init(entry.config);

    entry.runner = runner;
    entry.status = "running";
    entry.startedAt = new Date();
  }

  /**
   * Stop an agent gracefully and remove it from the managed set.
   */
  async stopAgent(agentId: string): Promise<void> {
    const entry = this.agents.get(agentId);
    if (!entry) {
      console.warn(`[Lifecycle] Cannot stop unknown agent ${agentId}`);
      return;
    }

    console.log(`[Lifecycle] Stopping agent ${agentId}`);
    if (entry.status === "running") {
      await entry.runner.stop();
    }
    this.agents.delete(agentId);
  }

  /**
   * Kill an agent immediately (same as stop for in-process runners).
   */
  async killAgent(agentId: string): Promise<void> {
    const entry = this.agents.get(agentId);
    if (!entry) {
      console.warn(`[Lifecycle] Cannot kill unknown agent ${agentId}`);
      return;
    }

    console.log(`[Lifecycle] Killing agent ${agentId}`);
    // For in-process runners, kill == stop.  There is no grace period to skip.
    if (entry.status === "running") {
      await entry.runner.stop();
    }
    this.agents.delete(agentId);
  }

  /**
   * Get the runtime status of an agent.
   */
  async getAgentStatus(agentId: string): Promise<AgentRuntimeStatus> {
    const entry = this.agents.get(agentId);
    if (!entry) return "stopped";

    // If the runner reports unhealthy, reflect that.
    if (entry.status === "running") {
      const health = await entry.runner.healthCheck();
      if (!health.healthy) return "error";
    }

    return entry.status;
  }

  /**
   * List all managed agents.
   */
  async listAgents(): Promise<
    Array<{ agentId: string; name: string; status: AgentRuntimeStatus }>
  > {
    const results: Array<{
      agentId: string;
      name: string;
      status: AgentRuntimeStatus;
    }> = [];

    for (const [agentId, entry] of this.agents) {
      results.push({
        agentId,
        name: entry.config.name,
        status: entry.status,
      });
    }

    return results;
  }

  /**
   * Get the runner for an agent (for direct interaction, e.g. sending messages).
   * Returns null if the agent is not running.
   */
  getRunner(agentId: string): AgentRunner | null {
    const entry = this.agents.get(agentId);
    if (!entry || entry.status !== "running") return null;
    return entry.runner;
  }

  /**
   * Hot-swap the model configuration for a running agent.
   */
  async updateModelConfig(
    agentId: string,
    modelConfig: AgentConfig["modelConfig"],
  ): Promise<boolean> {
    const entry = this.agents.get(agentId);
    if (!entry || entry.status !== "running") return false;

    return entry.runner.updateModelConfig(modelConfig);
  }
}
