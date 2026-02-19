/**
 * API client for the Agent OS control plane.
 *
 * All methods return typed responses and handle auth token injection.
 * Uses the browser Supabase client to get the current session token.
 */

import { createClient } from "@/lib/supabase/client";
import type {
  Agent,
  Session,
  Message,
  FeatureFlag,
  AuditLog,
  AgentMemory,
  AgentPermission,
  ApprovalRequest,
  HitlPolicy,
  EvalSuite,
  EvalCase,
  EvalRun,
  DataConnector,
  DataPipeline,
  PipelineStep,
  PipelineRun,
  AgentTemplate,
  TemplateVersion,
  Deployment,
  Webhook,
  WebhookDelivery,
  PaginatedResponse,
  AnalyticsSummary,
  TopAgent,
  TimeSeriesPoint,
} from "./types";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";

// -- Core fetch helper --------------------------------------------------------

async function getAuthHeaders(): Promise<Record<string, string>> {
  const supabase = createClient();
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  return headers;
}

class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = await getAuthHeaders();
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { ...headers, ...init?.headers },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new ApiError(res.status, body);
  }
  return res.json() as Promise<T>;
}

function qs(params: Record<string, string | number | boolean | undefined>): string {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined);
  if (entries.length === 0) return "";
  return "?" + new URLSearchParams(entries.map(([k, v]) => [k, String(v)])).toString();
}

// -- Agents -------------------------------------------------------------------

export const agents = {
  list: (params?: { status?: string; framework?: string; include_shared?: boolean; limit?: number; offset?: number }) =>
    apiFetch<PaginatedResponse<Agent>>(`/agents${qs(params ?? {})}`),

  get: (id: string) => apiFetch<Agent>(`/agents/${id}`),

  create: (body: Record<string, unknown>) =>
    apiFetch<Agent>("/agents", { method: "POST", body: JSON.stringify(body) }),

  update: (id: string, body: Record<string, unknown>) =>
    apiFetch<Agent>(`/agents/${id}`, { method: "PATCH", body: JSON.stringify(body) }),

  delete: (id: string) =>
    apiFetch<{ deleted: boolean }>(`/agents/${id}`, { method: "DELETE" }),

  kill: (id: string) =>
    apiFetch<{ killed: boolean; agent: Agent }>(`/agents/${id}/kill`, { method: "POST" }),

  getModelConfig: (id: string) =>
    apiFetch<{ id: string; model_config: Record<string, unknown>; version: number }>(`/agents/${id}/model-config`),

  updateModelConfig: (id: string, config: Record<string, unknown>) =>
    apiFetch<{ id: string; model_config: Record<string, unknown>; version: number }>(
      `/agents/${id}/model-config`,
      { method: "PUT", body: JSON.stringify(config) },
    ),
};

// -- Sessions -----------------------------------------------------------------

export const sessions = {
  list: (params?: { agent_id?: string; status?: string; limit?: number; offset?: number }) =>
    apiFetch<PaginatedResponse<Session>>(`/sessions${qs(params ?? {})}`),

  get: (id: string) => apiFetch<Session>(`/sessions/${id}`),

  create: (body: { agent_id: string; title?: string }) =>
    apiFetch<Session>("/sessions", { method: "POST", body: JSON.stringify(body) }),

  update: (id: string, body: Record<string, unknown>) =>
    apiFetch<Session>(`/sessions/${id}`, { method: "PATCH", body: JSON.stringify(body) }),

  listMessages: (sessionId: string, params?: { limit?: number; offset?: number }) =>
    apiFetch<PaginatedResponse<Message>>(`/sessions/${sessionId}/messages${qs(params ?? {})}`),

  createMessage: (sessionId: string, body: Record<string, unknown>) =>
    apiFetch<Message>(`/sessions/${sessionId}/messages`, { method: "POST", body: JSON.stringify(body) }),
};

// -- Analytics ----------------------------------------------------------------

export const analytics = {
  ownerSummary: (params?: { from?: string; to?: string }) =>
    apiFetch<AnalyticsSummary>(`/analytics/summary${qs(params ?? {})}`),

  topAgents: (params?: { dimension?: string; from?: string; to?: string; limit?: number }) =>
    apiFetch<{ dimension: string; from: string; to: string; data: TopAgent[] }>(
      `/analytics/top-agents${qs(params ?? {})}`,
    ),

  agentSummary: (agentId: string, params?: { period?: string; from?: string; to?: string }) =>
    apiFetch<AnalyticsSummary & { agent_id: string }>(
      `/agents/${agentId}/analytics/summary${qs(params ?? {})}`,
    ),

  agentTimeSeries: (agentId: string, params?: { period?: string; from?: string; to?: string }) =>
    apiFetch<{ agent_id: string; period: string; from: string; to: string; data: TimeSeriesPoint[] }>(
      `/agents/${agentId}/analytics/time-series${qs(params ?? {})}`,
    ),

  agentDaily: (agentId: string, params?: { from?: string; to?: string }) =>
    apiFetch<{ agent_id: string; from: string; to: string; data: Record<string, unknown>[] }>(
      `/agents/${agentId}/analytics/daily${qs(params ?? {})}`,
    ),
};

// -- Feature Flags ------------------------------------------------------------

export const featureFlags = {
  list: (params?: { scope?: string; agent_id?: string; enabled?: string; limit?: number; offset?: number }) =>
    apiFetch<PaginatedResponse<FeatureFlag>>(`/feature-flags${qs(params ?? {})}`),

  get: (id: string) => apiFetch<FeatureFlag>(`/feature-flags/${id}`),

  create: (body: Record<string, unknown>) =>
    apiFetch<FeatureFlag>("/feature-flags", { method: "POST", body: JSON.stringify(body) }),

  update: (id: string, body: Record<string, unknown>) =>
    apiFetch<FeatureFlag>(`/feature-flags/${id}`, { method: "PATCH", body: JSON.stringify(body) }),

  delete: (id: string) =>
    apiFetch<{ deleted: boolean }>(`/feature-flags/${id}`, { method: "DELETE" }),

  evaluate: (body: { key: string; agent_id?: string; context?: Record<string, unknown> }) =>
    apiFetch<{ key: string; enabled: boolean; reason: string }>("/feature-flags/evaluate", {
      method: "POST",
      body: JSON.stringify(body),
    }),
};

// -- Audit Logs ---------------------------------------------------------------

export const auditLogs = {
  list: (params?: {
    action?: string; resource_type?: string; resource_id?: string;
    agent_id?: string; session_id?: string; severity?: string;
    since?: string; until?: string; limit?: number; offset?: number;
  }) => apiFetch<PaginatedResponse<AuditLog>>(`/audit-logs${qs(params ?? {})}`),

  get: (id: string) => apiFetch<AuditLog>(`/audit-logs/${id}`),
};

// -- Memory -------------------------------------------------------------------

export const memory = {
  list: (agentId: string, params?: { memory_type?: string; session_id?: string; limit?: number; offset?: number }) =>
    apiFetch<PaginatedResponse<AgentMemory>>(`/agents/${agentId}/memories${qs(params ?? {})}`),

  get: (agentId: string, memoryId: string) =>
    apiFetch<AgentMemory>(`/agents/${agentId}/memories/${memoryId}`),

  create: (agentId: string, body: Record<string, unknown>) =>
    apiFetch<AgentMemory>(`/agents/${agentId}/memories`, { method: "POST", body: JSON.stringify(body) }),

  delete: (agentId: string, memoryId: string) =>
    apiFetch<{ deleted: boolean }>(`/agents/${agentId}/memories/${memoryId}`, { method: "DELETE" }),

  search: (agentId: string, body: { embedding: number[]; limit?: number; similarity_threshold?: number; memory_type?: string }) =>
    apiFetch<{ data: (AgentMemory & { similarity: number })[]; total: number }>(
      `/agents/${agentId}/memories/search`,
      { method: "POST", body: JSON.stringify(body) },
    ),
};

// -- Permissions --------------------------------------------------------------

export const permissions = {
  list: (agentId: string, params?: { limit?: number; offset?: number }) =>
    apiFetch<PaginatedResponse<AgentPermission>>(`/agents/${agentId}/permissions${qs(params ?? {})}`),

  grant: (agentId: string, body: { user_id: string; role?: string; expires_at?: string }) =>
    apiFetch<AgentPermission>(`/agents/${agentId}/permissions`, { method: "POST", body: JSON.stringify(body) }),

  update: (agentId: string, permId: string, body: Record<string, unknown>) =>
    apiFetch<AgentPermission>(`/agents/${agentId}/permissions/${permId}`, { method: "PATCH", body: JSON.stringify(body) }),

  revoke: (agentId: string, permId: string) =>
    apiFetch<{ revoked: boolean }>(`/agents/${agentId}/permissions/${permId}`, { method: "DELETE" }),
};

// -- HITL (Approvals + Policies) ----------------------------------------------

export const approvals = {
  list: (agentId: string, params?: { status?: string; limit?: number; offset?: number }) =>
    apiFetch<PaginatedResponse<ApprovalRequest>>(`/agents/${agentId}/approvals${qs(params ?? {})}`),

  get: (agentId: string, approvalId: string) =>
    apiFetch<ApprovalRequest>(`/agents/${agentId}/approvals/${approvalId}`),

  create: (agentId: string, body: Record<string, unknown>) =>
    apiFetch<ApprovalRequest>(`/agents/${agentId}/approvals`, { method: "POST", body: JSON.stringify(body) }),

  resolve: (agentId: string, approvalId: string, body: { status: "approved" | "rejected"; response_note?: string }) =>
    apiFetch<ApprovalRequest>(`/agents/${agentId}/approvals/${approvalId}/resolve`, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  cancel: (agentId: string, approvalId: string) =>
    apiFetch<ApprovalRequest>(`/agents/${agentId}/approvals/${approvalId}/cancel`, { method: "POST" }),
};

export const hitlPolicies = {
  list: (agentId: string, params?: { is_active?: boolean; limit?: number; offset?: number }) =>
    apiFetch<PaginatedResponse<HitlPolicy>>(`/agents/${agentId}/hitl-policies${qs(params ?? {})}`),

  create: (agentId: string, body: Record<string, unknown>) =>
    apiFetch<HitlPolicy>(`/agents/${agentId}/hitl-policies`, { method: "POST", body: JSON.stringify(body) }),

  update: (agentId: string, policyId: string, body: Record<string, unknown>) =>
    apiFetch<HitlPolicy>(`/agents/${agentId}/hitl-policies/${policyId}`, { method: "PATCH", body: JSON.stringify(body) }),

  delete: (agentId: string, policyId: string) =>
    apiFetch<{ deleted: boolean }>(`/agents/${agentId}/hitl-policies/${policyId}`, { method: "DELETE" }),
};

// -- Evals --------------------------------------------------------------------

export const evalSuites = {
  list: (agentId: string, params?: { is_active?: boolean; limit?: number; offset?: number }) =>
    apiFetch<PaginatedResponse<EvalSuite>>(`/agents/${agentId}/evals/suites${qs(params ?? {})}`),

  get: (agentId: string, suiteId: string) =>
    apiFetch<EvalSuite>(`/agents/${agentId}/evals/suites/${suiteId}`),

  create: (agentId: string, body: Record<string, unknown>) =>
    apiFetch<EvalSuite>(`/agents/${agentId}/evals/suites`, { method: "POST", body: JSON.stringify(body) }),

  update: (agentId: string, suiteId: string, body: Record<string, unknown>) =>
    apiFetch<EvalSuite>(`/agents/${agentId}/evals/suites/${suiteId}`, { method: "PATCH", body: JSON.stringify(body) }),

  delete: (agentId: string, suiteId: string) =>
    apiFetch<{ deleted: boolean }>(`/agents/${agentId}/evals/suites/${suiteId}`, { method: "DELETE" }),
};

export const evalCases = {
  list: (agentId: string, suiteId: string, params?: { is_active?: boolean; limit?: number; offset?: number }) =>
    apiFetch<PaginatedResponse<EvalCase>>(`/agents/${agentId}/evals/suites/${suiteId}/cases${qs(params ?? {})}`),

  create: (agentId: string, suiteId: string, body: Record<string, unknown>) =>
    apiFetch<EvalCase>(`/agents/${agentId}/evals/suites/${suiteId}/cases`, { method: "POST", body: JSON.stringify(body) }),

  update: (agentId: string, suiteId: string, caseId: string, body: Record<string, unknown>) =>
    apiFetch<EvalCase>(`/agents/${agentId}/evals/suites/${suiteId}/cases/${caseId}`, { method: "PATCH", body: JSON.stringify(body) }),

  delete: (agentId: string, suiteId: string, caseId: string) =>
    apiFetch<{ deleted: boolean }>(`/agents/${agentId}/evals/suites/${suiteId}/cases/${caseId}`, { method: "DELETE" }),
};

export const evalRuns = {
  list: (agentId: string, params?: { suite_id?: string; status?: string; limit?: number; offset?: number }) =>
    apiFetch<PaginatedResponse<EvalRun>>(`/agents/${agentId}/evals/runs${qs(params ?? {})}`),

  get: (agentId: string, runId: string) =>
    apiFetch<EvalRun>(`/agents/${agentId}/evals/runs/${runId}`),

  trigger: (agentId: string, body: { suite_id: string; metadata?: Record<string, unknown> }) =>
    apiFetch<EvalRun>(`/agents/${agentId}/evals/runs`, { method: "POST", body: JSON.stringify(body) }),
};

// -- Data Pipelines -----------------------------------------------------------

export const connectors = {
  list: (agentId: string, params?: { connector_type?: string; is_active?: boolean; limit?: number; offset?: number }) =>
    apiFetch<PaginatedResponse<DataConnector>>(`/agents/${agentId}/data/connectors${qs(params ?? {})}`),

  get: (agentId: string, connectorId: string) =>
    apiFetch<DataConnector>(`/agents/${agentId}/data/connectors/${connectorId}`),

  create: (agentId: string, body: Record<string, unknown>) =>
    apiFetch<DataConnector>(`/agents/${agentId}/data/connectors`, { method: "POST", body: JSON.stringify(body) }),

  update: (agentId: string, connectorId: string, body: Record<string, unknown>) =>
    apiFetch<DataConnector>(`/agents/${agentId}/data/connectors/${connectorId}`, { method: "PATCH", body: JSON.stringify(body) }),

  delete: (agentId: string, connectorId: string) =>
    apiFetch<{ deleted: boolean }>(`/agents/${agentId}/data/connectors/${connectorId}`, { method: "DELETE" }),
};

export const pipelines = {
  list: (agentId: string, params?: { is_active?: boolean; limit?: number; offset?: number }) =>
    apiFetch<PaginatedResponse<DataPipeline>>(`/agents/${agentId}/data/pipelines${qs(params ?? {})}`),

  get: (agentId: string, pipelineId: string) =>
    apiFetch<DataPipeline>(`/agents/${agentId}/data/pipelines/${pipelineId}`),

  create: (agentId: string, body: Record<string, unknown>) =>
    apiFetch<DataPipeline>(`/agents/${agentId}/data/pipelines`, { method: "POST", body: JSON.stringify(body) }),

  update: (agentId: string, pipelineId: string, body: Record<string, unknown>) =>
    apiFetch<DataPipeline>(`/agents/${agentId}/data/pipelines/${pipelineId}`, { method: "PATCH", body: JSON.stringify(body) }),

  delete: (agentId: string, pipelineId: string) =>
    apiFetch<{ deleted: boolean }>(`/agents/${agentId}/data/pipelines/${pipelineId}`, { method: "DELETE" }),
};

export const pipelineSteps = {
  list: (agentId: string, pipelineId: string, params?: { is_active?: boolean; limit?: number; offset?: number }) =>
    apiFetch<PaginatedResponse<PipelineStep>>(
      `/agents/${agentId}/data/pipelines/${pipelineId}/steps${qs(params ?? {})}`,
    ),

  create: (agentId: string, pipelineId: string, body: Record<string, unknown>) =>
    apiFetch<PipelineStep>(`/agents/${agentId}/data/pipelines/${pipelineId}/steps`, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  update: (agentId: string, pipelineId: string, stepId: string, body: Record<string, unknown>) =>
    apiFetch<PipelineStep>(`/agents/${agentId}/data/pipelines/${pipelineId}/steps/${stepId}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),

  delete: (agentId: string, pipelineId: string, stepId: string) =>
    apiFetch<{ deleted: boolean }>(`/agents/${agentId}/data/pipelines/${pipelineId}/steps/${stepId}`, {
      method: "DELETE",
    }),
};

export const pipelineRuns = {
  list: (agentId: string, params?: { pipeline_id?: string; status?: string; limit?: number; offset?: number }) =>
    apiFetch<PaginatedResponse<PipelineRun>>(`/agents/${agentId}/data/runs${qs(params ?? {})}`),

  get: (agentId: string, runId: string) =>
    apiFetch<PipelineRun>(`/agents/${agentId}/data/runs/${runId}`),

  trigger: (agentId: string, body: { pipeline_id: string; metadata?: Record<string, unknown> }) =>
    apiFetch<PipelineRun>(`/agents/${agentId}/data/runs`, { method: "POST", body: JSON.stringify(body) }),
};

// -- Templates ----------------------------------------------------------------

export const templates = {
  list: (params?: { category?: string; is_public?: boolean; limit?: number; offset?: number }) =>
    apiFetch<PaginatedResponse<AgentTemplate>>(`/templates${qs(params ?? {})}`),

  get: (id: string) => apiFetch<AgentTemplate>(`/templates/${id}`),

  create: (body: Record<string, unknown>) =>
    apiFetch<AgentTemplate>("/templates", { method: "POST", body: JSON.stringify(body) }),

  update: (id: string, body: Record<string, unknown>) =>
    apiFetch<AgentTemplate>(`/templates/${id}`, { method: "PATCH", body: JSON.stringify(body) }),

  delete: (id: string) =>
    apiFetch<{ deleted: boolean }>(`/templates/${id}`, { method: "DELETE" }),

  instantiate: (id: string, body: Record<string, unknown>) =>
    apiFetch<Agent>(`/templates/${id}/instantiate`, { method: "POST", body: JSON.stringify(body) }),

  extract: (id: string, body: { agent_id: string; name: string; category?: string }) =>
    apiFetch<AgentTemplate>(`/templates/${id}/extract`, { method: "POST", body: JSON.stringify(body) }),
};

export const templateVersions = {
  list: (templateId: string, params?: { limit?: number; offset?: number }) =>
    apiFetch<PaginatedResponse<TemplateVersion>>(`/templates/${templateId}/versions${qs(params ?? {})}`),

  get: (templateId: string, versionNumber: number) =>
    apiFetch<TemplateVersion>(`/templates/${templateId}/versions/${versionNumber}`),

  publish: (templateId: string, body?: { changelog?: string }) =>
    apiFetch<TemplateVersion>(`/templates/${templateId}/versions`, {
      method: "POST",
      body: JSON.stringify(body ?? {}),
    }),

  diff: (templateId: string, a: number, b: number) =>
    apiFetch<{ template_id: string; version_a: number; version_b: number; changes: Record<string, unknown> }>(
      `/templates/${templateId}/versions/diff?a=${a}&b=${b}`,
    ),
};

// -- Deployments --------------------------------------------------------------

export const deployments = {
  list: (agentId: string, params?: { status?: string; limit?: number; offset?: number }) =>
    apiFetch<PaginatedResponse<Deployment>>(`/agents/${agentId}/deployments${qs(params ?? {})}`),

  get: (agentId: string, deploymentId: string) =>
    apiFetch<Deployment>(`/agents/${agentId}/deployments/${deploymentId}`),

  getActive: (agentId: string) =>
    apiFetch<Deployment>(`/agents/${agentId}/deployments/active`),

  create: (agentId: string, body: Record<string, unknown>) =>
    apiFetch<Deployment>(`/agents/${agentId}/deployments`, { method: "POST", body: JSON.stringify(body) }),

  updateStatus: (agentId: string, deploymentId: string, body: { status: string; error_message?: string; runtime_info?: Record<string, unknown> }) =>
    apiFetch<Deployment>(`/agents/${agentId}/deployments/${deploymentId}/status`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
};

// -- Webhooks -----------------------------------------------------------------

export const webhooks = {
  list: (agentId: string, params?: { is_active?: boolean; limit?: number; offset?: number }) =>
    apiFetch<PaginatedResponse<Webhook>>(`/agents/${agentId}/webhooks${qs(params ?? {})}`),

  get: (agentId: string, webhookId: string) =>
    apiFetch<Webhook>(`/agents/${agentId}/webhooks/${webhookId}`),

  create: (agentId: string, body: Record<string, unknown>) =>
    apiFetch<Webhook>(`/agents/${agentId}/webhooks`, { method: "POST", body: JSON.stringify(body) }),

  update: (agentId: string, webhookId: string, body: Record<string, unknown>) =>
    apiFetch<Webhook>(`/agents/${agentId}/webhooks/${webhookId}`, { method: "PATCH", body: JSON.stringify(body) }),

  delete: (agentId: string, webhookId: string) =>
    apiFetch<{ deleted: boolean }>(`/agents/${agentId}/webhooks/${webhookId}`, { method: "DELETE" }),

  test: (agentId: string, webhookId: string) =>
    apiFetch<{ delivered: boolean; webhook_id: string }>(`/agents/${agentId}/webhooks/${webhookId}/test`, {
      method: "POST",
    }),
};

export const webhookDeliveries = {
  list: (agentId: string, webhookId: string, params?: { status?: string; limit?: number; offset?: number }) =>
    apiFetch<PaginatedResponse<WebhookDelivery>>(
      `/agents/${agentId}/webhooks/${webhookId}/deliveries${qs(params ?? {})}`,
    ),

  get: (agentId: string, webhookId: string, deliveryId: string) =>
    apiFetch<WebhookDelivery>(`/agents/${agentId}/webhooks/${webhookId}/deliveries/${deliveryId}`),
};

// -- Batch Operations ---------------------------------------------------------

export const batch = {
  createAgents: (body: { agents: Record<string, unknown>[] }) =>
    apiFetch<{ total: number; succeeded: number; failed: number }>("/agents/batch/create", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  updateAgentStatus: (body: { updates: { agent_id: string; status: string }[] }) =>
    apiFetch<{ total: number; succeeded: number; failed: number }>("/agents/batch/update-status", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  deleteAgents: (body: { agent_ids: string[] }) =>
    apiFetch<{ total: number; succeeded: number; failed: number }>("/agents/batch/delete", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  closeStaleSessions: (agentId: string, body: { stale_threshold_minutes?: number }) =>
    apiFetch<{ total: number; succeeded: number }>(`/agents/${agentId}/sessions/batch/close-stale`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
};

// -- Health -------------------------------------------------------------------

export const health = {
  check: () => apiFetch<{ status: string }>("/health"),
  live: () => apiFetch<{ status: string }>("/live"),
  ready: () => apiFetch<{ status: string }>("/ready"),
};

export { ApiError };
