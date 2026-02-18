import type * as k8s from "@kubernetes/client-node";
import type { AgentConfig } from "../frameworks/types.js";

/**
 * Kubernetes manifest generators for agent workloads.
 *
 * Each agent runs as a Deployment with 1 replica (scale to 0 for pause,
 * delete for stop). The pod spec includes:
 * - Agent container with resource limits
 * - Environment variables for configuration
 * - Health/readiness probes
 * - Workload Identity annotation for GCP SA binding
 * - Labels for service discovery and monitoring
 */

/** Namespace where agent workloads run. */
export const AGENT_NAMESPACE = "agents";

/** Container image registry prefix (set via env). */
function getImageRegistry(): string {
  return process.env["AGENT_IMAGE_REGISTRY"] ?? "us-central1-docker.pkg.dev/placeholder/agents-dev";
}

/** GCP service account for Workload Identity. */
function getGcpServiceAccount(): string {
  return process.env["AGENT_GCP_SA"] ?? "agents-rt-dev@placeholder.iam.gserviceaccount.com";
}

/** Standard labels applied to all agent resources. */
function agentLabels(agentId: string, agentName: string): Record<string, string> {
  return {
    "app.kubernetes.io/name": "agent",
    "app.kubernetes.io/instance": agentId,
    "app.kubernetes.io/component": "agent-workload",
    "app.kubernetes.io/managed-by": "agent-runtime",
    "agents.platform/agent-id": agentId,
    "agents.platform/agent-name": sanitizeLabel(agentName),
  };
}

/** Sanitize a string for use as a K8s label value (max 63 chars, alphanumeric + -_.). */
function sanitizeLabel(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, "-")
    .slice(0, 63)
    .replace(/^-+|-+$/g, "");
}

/** Deployment name for an agent. */
export function deploymentName(agentId: string): string {
  return `agent-${agentId.slice(0, 8)}`;
}

/**
 * Generate a Kubernetes Deployment spec for an agent.
 */
export function createAgentDeployment(
  config: AgentConfig,
): k8s.V1Deployment {
  const name = deploymentName(config.id);
  const labels = agentLabels(config.id, config.name);
  const registry = getImageRegistry();

  // Framework-specific image. Each framework has its own container image
  // with the appropriate SDK pre-installed.
  const image = `${registry}/agent-${config.framework}:latest`;

  const deployment: k8s.V1Deployment = {
    apiVersion: "apps/v1",
    kind: "Deployment",
    metadata: {
      name,
      namespace: AGENT_NAMESPACE,
      labels,
      annotations: {
        "agents.platform/agent-id": config.id,
        "agents.platform/framework": config.framework,
        "agents.platform/model": `${config.modelConfig.provider}/${config.modelConfig.model}`,
      },
    },
    spec: {
      replicas: 1,
      selector: {
        matchLabels: {
          "agents.platform/agent-id": config.id,
        },
      },
      template: {
        metadata: {
          labels,
          annotations: {
            // Workload Identity: bind K8s SA to GCP SA.
            "iam.gke.io/gcp-service-account": getGcpServiceAccount(),
          },
        },
        spec: {
          serviceAccountName: "agent-workload",
          terminationGracePeriodSeconds: 30,
          containers: [
            {
              name: "agent",
              image,
              imagePullPolicy: "Always",
              ports: [{ containerPort: 8090, name: "agent-http" }],
              env: buildEnvVars(config),
              resources: {
                requests: {
                  cpu: config.resources.cpuRequest,
                  memory: config.resources.memoryRequest,
                },
                limits: {
                  cpu: config.resources.cpuLimit,
                  memory: config.resources.memoryLimit,
                },
              },
              livenessProbe: {
                httpGet: { path: "/health", port: 8090 },
                initialDelaySeconds: 10,
                periodSeconds: 30,
                timeoutSeconds: 5,
                failureThreshold: 3,
              },
              readinessProbe: {
                httpGet: { path: "/health", port: 8090 },
                initialDelaySeconds: 5,
                periodSeconds: 10,
                timeoutSeconds: 3,
                failureThreshold: 2,
              },
            },
          ],
          // Spread agents across nodes for resilience.
          topologySpreadConstraints: [
            {
              maxSkew: 1,
              topologyKey: "kubernetes.io/hostname",
              whenUnsatisfiable: "ScheduleAnyway",
              labelSelector: {
                matchLabels: {
                  "app.kubernetes.io/name": "agent",
                },
              },
            },
          ],
        },
      },
    },
  };

  return deployment;
}

/**
 * Build environment variables for the agent container.
 * Injects agent configuration as env vars so the framework adapter
 * can read them at startup.
 */
function buildEnvVars(config: AgentConfig): k8s.V1EnvVar[] {
  const envs: k8s.V1EnvVar[] = [
    { name: "AGENT_ID", value: config.id },
    { name: "AGENT_NAME", value: config.name },
    { name: "AGENT_FRAMEWORK", value: config.framework },
    { name: "MODEL_PROVIDER", value: config.modelConfig.provider },
    { name: "MODEL_NAME", value: config.modelConfig.model },
    { name: "AGENT_PORT", value: "8090" },
  ];

  if (config.systemPrompt) {
    envs.push({ name: "SYSTEM_PROMPT", value: config.systemPrompt });
  }

  if (config.modelConfig.temperature !== undefined) {
    envs.push({
      name: "MODEL_TEMPERATURE",
      value: String(config.modelConfig.temperature),
    });
  }

  if (config.modelConfig.maxTokens !== undefined) {
    envs.push({
      name: "MODEL_MAX_TOKENS",
      value: String(config.modelConfig.maxTokens),
    });
  }

  if (config.resources.maxTokensPerMinute) {
    envs.push({
      name: "MAX_TOKENS_PER_MINUTE",
      value: String(config.resources.maxTokensPerMinute),
    });
  }

  // Serialize complex config as JSON env vars.
  if (config.tools.length > 0) {
    envs.push({ name: "AGENT_TOOLS", value: JSON.stringify(config.tools) });
  }

  if (config.mcpServers.length > 0) {
    envs.push({
      name: "MCP_SERVERS",
      value: JSON.stringify(config.mcpServers),
    });
  }

  // Redis connection for state and pub/sub.
  envs.push({
    name: "REDIS_URL",
    value: process.env["REDIS_URL"] ?? "redis://localhost:6379",
  });

  return envs;
}

/**
 * Generate a Kubernetes Service for an agent (ClusterIP for internal access).
 */
export function createAgentService(
  agentId: string,
  agentName: string,
): k8s.V1Service {
  const name = deploymentName(agentId);
  const labels = agentLabels(agentId, agentName);

  return {
    apiVersion: "v1",
    kind: "Service",
    metadata: {
      name,
      namespace: AGENT_NAMESPACE,
      labels,
    },
    spec: {
      type: "ClusterIP",
      selector: {
        "agents.platform/agent-id": agentId,
      },
      ports: [
        {
          name: "http",
          port: 80,
          targetPort: 8090,
          protocol: "TCP",
        },
      ],
    },
  };
}
