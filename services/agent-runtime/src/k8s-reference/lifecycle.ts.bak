import * as k8s from "@kubernetes/client-node";
import type { AgentConfig, AgentRuntimeStatus } from "../frameworks/types.js";
import {
  createAgentDeployment,
  createAgentService,
  deploymentName,
  AGENT_NAMESPACE,
} from "./manifests.js";

/**
 * Agent Lifecycle Manager.
 *
 * Maps control-plane commands to Kubernetes operations on the GKE Autopilot
 * cluster. Each agent is a Deployment with 0 or 1 replicas:
 *
 *   start  -> create Deployment (replicas=1) + Service
 *   pause  -> scale Deployment to 0 replicas
 *   resume -> scale Deployment to 1 replica
 *   stop   -> delete Deployment + Service
 *   kill   -> delete Deployment + Service (immediate, no grace period)
 *
 * Uses in-cluster config when running inside GKE, or kubeconfig for local dev.
 */
export class LifecycleManager {
  private appsApi: k8s.AppsV1Api;
  private coreApi: k8s.CoreV1Api;
  private initialized = false;

  constructor() {
    const kc = new k8s.KubeConfig();

    // In-cluster config when running on GKE; fallback to default kubeconfig.
    try {
      kc.loadFromCluster();
    } catch {
      kc.loadFromDefault();
    }

    this.appsApi = kc.makeApiClient(k8s.AppsV1Api);
    this.coreApi = kc.makeApiClient(k8s.CoreV1Api);
    this.initialized = true;
  }

  /**
   * Start an agent: create its Deployment and Service on K8s.
   * If the deployment already exists, scale it to 1 replica (resume).
   */
  async startAgent(config: AgentConfig): Promise<void> {
    this.ensureInitialized();
    const name = deploymentName(config.id);

    // Check if deployment already exists (agent was paused).
    const existing = await this.getDeployment(name);

    if (existing) {
      // Agent was paused -- scale back to 1.
      console.log(`[Lifecycle] Resuming existing deployment ${name}`);
      await this.scaleDeployment(name, 1);
      return;
    }

    // Create new deployment and service.
    console.log(
      `[Lifecycle] Creating deployment ${name} for agent "${config.name}" (${config.framework})`,
    );

    const deployment = createAgentDeployment(config);
    const service = createAgentService(config.id, config.name);

    await this.ensureNamespace();

    await this.appsApi.createNamespacedDeployment({
      namespace: AGENT_NAMESPACE,
      body: deployment,
    });

    // Create service for internal routing.
    try {
      await this.coreApi.createNamespacedService({
        namespace: AGENT_NAMESPACE,
        body: service,
      });
    } catch (err) {
      // Service may already exist from a previous run. Ignore 409 Conflict.
      if (!isConflict(err)) throw err;
    }

    console.log(`[Lifecycle] Agent ${config.id} started successfully`);
  }

  /**
   * Pause an agent: scale its Deployment to 0 replicas.
   * The deployment and service remain so the agent can be resumed quickly.
   */
  async pauseAgent(agentId: string): Promise<void> {
    this.ensureInitialized();
    const name = deploymentName(agentId);

    console.log(`[Lifecycle] Pausing agent ${agentId} (scaling ${name} to 0)`);
    await this.scaleDeployment(name, 0);
  }

  /**
   * Resume a paused agent: scale its Deployment back to 1 replica.
   */
  async resumeAgent(agentId: string): Promise<void> {
    this.ensureInitialized();
    const name = deploymentName(agentId);

    console.log(`[Lifecycle] Resuming agent ${agentId} (scaling ${name} to 1)`);
    await this.scaleDeployment(name, 1);
  }

  /**
   * Stop an agent: delete its Deployment and Service.
   * Allows graceful shutdown (respects terminationGracePeriodSeconds).
   */
  async stopAgent(agentId: string): Promise<void> {
    this.ensureInitialized();
    const name = deploymentName(agentId);

    console.log(`[Lifecycle] Stopping agent ${agentId} (deleting ${name})`);
    await this.deleteAgentResources(name, 30);
  }

  /**
   * Kill an agent: delete its Deployment and Service immediately.
   * No grace period -- pods are terminated instantly.
   */
  async killAgent(agentId: string): Promise<void> {
    this.ensureInitialized();
    const name = deploymentName(agentId);

    console.log(`[Lifecycle] Killing agent ${agentId} (force-deleting ${name})`);
    await this.deleteAgentResources(name, 0);
  }

  /**
   * Get the runtime status of an agent by inspecting its K8s Deployment.
   */
  async getAgentStatus(agentId: string): Promise<AgentRuntimeStatus> {
    this.ensureInitialized();
    const name = deploymentName(agentId);

    const deployment = await this.getDeployment(name);
    if (!deployment) return "stopped";

    const replicas = deployment.spec?.replicas ?? 0;
    const readyReplicas = deployment.status?.readyReplicas ?? 0;
    const availableReplicas = deployment.status?.availableReplicas ?? 0;

    if (replicas === 0) return "paused";
    if (readyReplicas > 0 && availableReplicas > 0) return "running";
    if (readyReplicas === 0 && replicas > 0) return "starting";

    // Check for error conditions.
    const conditions = deployment.status?.conditions ?? [];
    const progressing = conditions.find((c) => c.type === "Progressing");
    if (progressing?.status === "False") return "error";

    return "unknown";
  }

  /**
   * List all running agent deployments.
   */
  async listAgents(): Promise<
    Array<{ agentId: string; name: string; status: AgentRuntimeStatus }>
  > {
    this.ensureInitialized();

    try {
      const response = await this.appsApi.listNamespacedDeployment({
        namespace: AGENT_NAMESPACE,
        labelSelector: "app.kubernetes.io/managed-by=agent-runtime",
      });

      const results: Array<{
        agentId: string;
        name: string;
        status: AgentRuntimeStatus;
      }> = [];

      for (const dep of response.items) {
        const agentId =
          dep.metadata?.annotations?.["agents.platform/agent-id"] ?? "";
        if (!agentId) continue;

        const status = await this.getAgentStatus(agentId);
        results.push({
          agentId,
          name: dep.metadata?.name ?? "",
          status,
        });
      }

      return results;
    } catch (err) {
      if (isNotFound(err)) return [];
      throw err;
    }
  }

  // -- Private helpers --------------------------------------------------------

  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error("LifecycleManager not initialized");
    }
  }

  /** Ensure the agent namespace exists. */
  private async ensureNamespace(): Promise<void> {
    try {
      await this.coreApi.readNamespace({ name: AGENT_NAMESPACE });
    } catch (err) {
      if (isNotFound(err)) {
        await this.coreApi.createNamespace({
          body: {
            metadata: {
              name: AGENT_NAMESPACE,
              labels: {
                "app.kubernetes.io/managed-by": "agent-runtime",
              },
            },
          },
        });
        console.log(`[Lifecycle] Created namespace ${AGENT_NAMESPACE}`);
      } else {
        throw err;
      }
    }
  }

  /** Get a deployment by name, or null if it doesn't exist. */
  private async getDeployment(
    name: string,
  ): Promise<k8s.V1Deployment | null> {
    try {
      const response = await this.appsApi.readNamespacedDeployment({
        name,
        namespace: AGENT_NAMESPACE,
      });
      return response;
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
  }

  /** Scale a deployment to the given number of replicas via patch. */
  private async scaleDeployment(
    name: string,
    replicas: number,
  ): Promise<void> {
    await this.appsApi.patchNamespacedDeployment({
      name,
      namespace: AGENT_NAMESPACE,
      body: { spec: { replicas } },
    });
  }

  /** Delete deployment and service for an agent. */
  private async deleteAgentResources(
    name: string,
    gracePeriodSeconds: number,
  ): Promise<void> {
    // Delete deployment.
    try {
      await this.appsApi.deleteNamespacedDeployment({
        name,
        namespace: AGENT_NAMESPACE,
        gracePeriodSeconds,
      });
    } catch (err) {
      if (!isNotFound(err)) throw err;
    }

    // Delete service.
    try {
      await this.coreApi.deleteNamespacedService({
        name,
        namespace: AGENT_NAMESPACE,
      });
    } catch (err) {
      if (!isNotFound(err)) throw err;
    }
  }
}

// -- Error helpers ------------------------------------------------------------

function isNotFound(err: unknown): boolean {
  return isHttpStatus(err, 404);
}

function isConflict(err: unknown): boolean {
  return isHttpStatus(err, 409);
}

function isHttpStatus(err: unknown, status: number): boolean {
  if (err && typeof err === "object" && "statusCode" in err) {
    return (err as { statusCode: number }).statusCode === status;
  }
  if (err && typeof err === "object" && "response" in err) {
    const resp = (err as { response: { statusCode?: number } }).response;
    return resp?.statusCode === status;
  }
  return false;
}
