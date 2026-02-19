/**
 * Shared TypeScript types mirroring the control-plane API responses.
 * These match the Row types in services/control-plane/src/types/database.ts.
 */

// -- Enums --------------------------------------------------------------------

export type AgentStatus = "draft" | "running" | "paused" | "stopped" | "error" | "archived";
export type AgentFramework = "google_adk" | "langgraph" | "crewai" | "autogen" | "openai_sdk" | "custom";
export type SessionStatus = "active" | "idle" | "completed" | "expired" | "error";
export type MessageRole = "system" | "user" | "assistant" | "tool" | "a2a";
export type AuditSeverity = "info" | "warning" | "critical";
export type FlagScope = "platform" | "agent" | "user";
export type MemoryType = "episodic" | "semantic" | "procedural" | "reflection";
export type AgentRole = "owner" | "admin" | "editor" | "viewer";
export type ApprovalStatus = "pending" | "approved" | "rejected" | "expired" | "cancelled";
export type HitlTriggerType = "tool_call" | "spending" | "external_api" | "data_mutation" | "escalation" | "custom";
export type EvalRunStatus = "pending" | "running" | "completed" | "failed" | "cancelled";
export type EvalScorerType = "exact_match" | "contains" | "regex" | "semantic" | "json_match" | "custom";
export type ConnectorType = "gcs" | "supabase" | "http_webhook" | "redis" | "postgresql" | "custom";
export type PipelineStatus = "pending" | "running" | "completed" | "failed" | "cancelled";
export type PipelineStepType = "extract" | "transform" | "load" | "validate" | "enrich" | "branch" | "custom";
export type TemplateCategory = "assistant" | "coding" | "data" | "research" | "customer_support" | "automation" | "creative" | "custom";
export type DeploymentStatus = "pending" | "building" | "deploying" | "running" | "stopped" | "failed" | "rolled_back";
export type WebhookEvent = "agent.created" | "agent.updated" | "agent.deleted" | "session.started" | "session.ended" | "deployment.started" | "deployment.completed" | "deployment.failed" | "eval.completed" | "pipeline.completed" | "pipeline.failed" | "approval.requested" | "approval.resolved" | "error.occurred";
export type DeliveryStatus = "pending" | "success" | "failed" | "retrying";

// -- Row types ----------------------------------------------------------------

export interface Agent {
  id: string;
  owner_id: string;
  name: string;
  description: string | null;
  avatar_url: string | null;
  framework: AgentFramework;
  model_config: Record<string, unknown>;
  system_prompt: string | null;
  tools: unknown[];
  mcp_servers: unknown[];
  a2a_config: Record<string, unknown>;
  status: AgentStatus;
  version: number;
  tags: string[];
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  access_role?: AgentRole;
}

export interface Session {
  id: string;
  agent_id: string;
  owner_id: string;
  status: SessionStatus;
  title: string | null;
  total_tokens: number;
  turn_count: number;
  context: Record<string, unknown>;
  parent_agent_id: string | null;
  a2a_task_id: string | null;
  created_at: string;
  updated_at: string;
  ended_at: string | null;
}

export interface Message {
  id: string;
  session_id: string;
  agent_id: string;
  role: MessageRole;
  content: string | null;
  prompt_tokens: number;
  completion_tokens: number;
  tool_calls: unknown[] | null;
  tool_call_id: string | null;
  tool_name: string | null;
  model: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface FeatureFlag {
  id: string;
  owner_id: string;
  key: string;
  name: string;
  description: string | null;
  scope: FlagScope;
  enabled: boolean;
  rollout_pct: number;
  targeting_rules: unknown[];
  agent_id: string | null;
  starts_at: string | null;
  expires_at: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface AuditLog {
  id: string;
  actor_id: string | null;
  actor_type: string;
  action: string;
  severity: AuditSeverity;
  resource_type: string;
  resource_id: string | null;
  evidence: Record<string, unknown>;
  ip_address: string | null;
  user_agent: string | null;
  request_id: string | null;
  agent_id: string | null;
  session_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface AgentMemory {
  id: string;
  agent_id: string;
  owner_id: string;
  content: string;
  memory_type: MemoryType;
  embedding: string | null;
  session_id: string | null;
  message_id: string | null;
  importance: number;
  access_count: number;
  last_accessed_at: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface AgentPermission {
  id: string;
  agent_id: string;
  user_id: string;
  role: AgentRole;
  granted_by: string | null;
  expires_at: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface ApprovalRequest {
  id: string;
  agent_id: string;
  session_id: string | null;
  policy_id: string | null;
  owner_id: string;
  action_type: string;
  action_summary: string;
  action_details: Record<string, unknown>;
  status: ApprovalStatus;
  reviewer_id: string | null;
  reviewed_at: string | null;
  response_note: string | null;
  response_data: Record<string, unknown>;
  expires_at: string | null;
  auto_resolve: boolean;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface HitlPolicy {
  id: string;
  agent_id: string;
  owner_id: string;
  name: string;
  description: string | null;
  trigger_type: HitlTriggerType;
  conditions: Record<string, unknown>;
  auto_approve: boolean;
  timeout_seconds: number | null;
  is_active: boolean;
  priority: number;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface EvalSuite {
  id: string;
  agent_id: string;
  owner_id: string;
  name: string;
  description: string | null;
  tags: string[];
  is_active: boolean;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  case_count?: number;
}

export interface EvalCase {
  id: string;
  suite_id: string;
  name: string;
  description: string | null;
  input: string;
  expected_output: string | null;
  scorer_type: EvalScorerType;
  scorer_config: Record<string, unknown>;
  timeout_seconds: number;
  sort_order: number;
  is_active: boolean;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface EvalRun {
  id: string;
  suite_id: string;
  agent_id: string;
  owner_id: string;
  status: EvalRunStatus;
  total_cases: number;
  passed_cases: number;
  failed_cases: number;
  avg_score: string;
  avg_latency_ms: string;
  agent_version: number | null;
  error_message: string | null;
  started_at: string | null;
  completed_at: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  results?: EvalResult[];
}

export interface EvalResult {
  id: string;
  run_id: string;
  case_id: string;
  actual_output: string | null;
  score: string;
  passed: boolean;
  latency_ms: string | null;
  token_count: number | null;
  scorer_output: Record<string, unknown>;
  error_message: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface DataConnector {
  id: string;
  agent_id: string;
  owner_id: string;
  name: string;
  description: string | null;
  connector_type: ConnectorType;
  config: Record<string, unknown>;
  is_source: boolean;
  is_sink: boolean;
  is_active: boolean;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface DataPipeline {
  id: string;
  agent_id: string;
  owner_id: string;
  name: string;
  description: string | null;
  source_connector_id: string | null;
  sink_connector_id: string | null;
  schedule_cron: string | null;
  is_active: boolean;
  max_concurrency: number;
  max_retries: number;
  retry_delay_seconds: number;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  step_count?: number;
}

export interface PipelineStep {
  id: string;
  pipeline_id: string;
  name: string;
  step_type: PipelineStepType;
  config: Record<string, unknown>;
  sort_order: number;
  connector_id: string | null;
  is_active: boolean;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface PipelineRun {
  id: string;
  pipeline_id: string;
  agent_id: string;
  owner_id: string;
  status: PipelineStatus;
  step_results: unknown[];
  records_read: number;
  records_written: number;
  records_failed: number;
  bytes_processed: number;
  started_at: string | null;
  completed_at: string | null;
  error_message: string | null;
  error_step: string | null;
  attempt_number: number;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface AgentTemplate {
  id: string;
  owner_id: string;
  name: string;
  description: string | null;
  category: TemplateCategory;
  framework: AgentFramework;
  model_config: Record<string, unknown>;
  system_prompt: string | null;
  tools: unknown[];
  mcp_servers: unknown[];
  a2a_config: Record<string, unknown>;
  default_tags: string[];
  is_public: boolean;
  is_active: boolean;
  use_count: number;
  current_version: number;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  version_count?: number;
}

export interface TemplateVersion {
  id: string;
  template_id: string;
  version_number: number;
  framework: AgentFramework;
  model_config: Record<string, unknown>;
  system_prompt: string | null;
  tools: unknown[];
  mcp_servers: unknown[];
  a2a_config: Record<string, unknown>;
  default_tags: string[];
  changelog: string | null;
  published_by: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface Deployment {
  id: string;
  agent_id: string;
  owner_id: string;
  target: string;
  status: DeploymentStatus;
  agent_version: number;
  template_id: string | null;
  template_version: number | null;
  config: Record<string, unknown>;
  runtime_info: Record<string, unknown>;
  started_at: string | null;
  completed_at: string | null;
  stopped_at: string | null;
  error_message: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface Webhook {
  id: string;
  agent_id: string;
  owner_id: string;
  name: string;
  description: string | null;
  url: string;
  secret: string;
  events: WebhookEvent[];
  is_active: boolean;
  max_retries: number;
  retry_delay_seconds: number;
  timeout_ms: number;
  total_deliveries: number;
  failed_deliveries: number;
  last_delivered_at: string | null;
  last_error: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  delivery_count?: number;
}

export interface WebhookDelivery {
  id: string;
  webhook_id: string;
  agent_id: string;
  event: WebhookEvent;
  status: DeliveryStatus;
  payload: Record<string, unknown>;
  response_status: number | null;
  response_body: string | null;
  response_time_ms: string | null;
  attempt_number: number;
  max_attempts: number;
  next_retry_at: string | null;
  error_message: string | null;
  delivered_at: string | null;
  created_at: string;
}

export interface ApiKey {
  id: string;
  owner_id: string;
  key_hash: string;
  label: string;
  scopes: string[];
  is_active: boolean;
  last_used_at: string | null;
  expires_at: string | null;
  created_at: string;
}

// -- API response wrappers ----------------------------------------------------

export interface PaginatedResponse<T> {
  data: T[];
  total: number | null;
  limit: number;
  offset: number;
}

export interface AnalyticsSummary {
  total_tokens: number;
  total_sessions: number;
  total_messages: number;
  estimated_cost_usd: number;
  error_count: number;
  avg_latency_ms: number;
}

export interface TopAgent {
  agent_id: string;
  agent_name: string;
  value: number;
}

export interface TimeSeriesPoint {
  bucket_start: string;
  bucket_end: string;
  total_tokens: number;
  session_count: number;
  message_count: number;
  estimated_cost_usd: string;
  error_count: number;
}
