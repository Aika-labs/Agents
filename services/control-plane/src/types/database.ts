/**
 * Supabase Database type definitions.
 *
 * These types mirror the schema defined in supabase/migrations/.
 * In production, generate these automatically with:
 *   npx supabase gen types typescript --project-id <ref> > src/types/database.ts
 *
 * For now, we maintain them manually to stay in sync with Sprint 2 migrations.
 */

// -- Enums (matching the SQL create type statements) --------------------------

export type AgentStatus =
  | "draft"
  | "running"
  | "paused"
  | "stopped"
  | "error"
  | "archived";

export type AgentFramework =
  | "google_adk"
  | "langgraph"
  | "crewai"
  | "autogen"
  | "openai_sdk"
  | "custom";

export type SessionStatus =
  | "active"
  | "idle"
  | "completed"
  | "expired"
  | "error";

export type MessageRole = "system" | "user" | "assistant" | "tool" | "a2a";

export type WalletProvider =
  | "coinbase_agentkit"
  | "metamask"
  | "walletconnect"
  | "custom";

export type WalletNetwork =
  | "ethereum_mainnet"
  | "ethereum_sepolia"
  | "base_mainnet"
  | "base_sepolia"
  | "polygon_mainnet"
  | "polygon_amoy"
  | "arbitrum_mainnet"
  | "solana_mainnet"
  | "solana_devnet";

export type TxStatus = "pending" | "confirmed" | "failed" | "reverted";

export type FlagScope = "platform" | "agent" | "user";

export type ListingStatus =
  | "draft"
  | "pending"
  | "published"
  | "suspended"
  | "archived";

export type PricingModel =
  | "free"
  | "one_time"
  | "per_use"
  | "subscription"
  | "revenue_share";

export type AuditSeverity = "info" | "warning" | "critical";

export type MemoryType = "episodic" | "semantic" | "procedural" | "reflection";

export type AgentRole = "owner" | "admin" | "editor" | "viewer";

export type ApprovalStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "expired"
  | "cancelled";

export type HitlTriggerType =
  | "tool_call"
  | "spending"
  | "external_api"
  | "data_mutation"
  | "escalation"
  | "custom";

export type EvalRunStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export type EvalScorerType =
  | "exact_match"
  | "contains"
  | "regex"
  | "semantic"
  | "json_match"
  | "custom";

export type ConnectorType =
  | "gcs"
  | "supabase"
  | "http_webhook"
  | "redis"
  | "postgresql"
  | "custom";

export type PipelineStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export type PipelineStepType =
  | "extract"
  | "transform"
  | "load"
  | "validate"
  | "enrich"
  | "branch"
  | "custom";

export type TemplateCategory =
  | "assistant"
  | "coding"
  | "data"
  | "research"
  | "customer_support"
  | "automation"
  | "creative"
  | "custom";

export type DeploymentStatus =
  | "pending"
  | "building"
  | "deploying"
  | "running"
  | "stopped"
  | "failed"
  | "rolled_back";

// -- Row types ----------------------------------------------------------------

export interface AgentRow {
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
  embedding: string | null;
  tags: string[];
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface AgentSessionRow {
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

export interface AgentMessageRow {
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

export interface AgentWalletRow {
  id: string;
  agent_id: string;
  owner_id: string;
  provider: WalletProvider;
  network: WalletNetwork;
  wallet_address: string;
  label: string | null;
  balance: string;
  balance_usd: string;
  last_synced_at: string | null;
  x402_enabled: boolean;
  spending_limit_usd: string | null;
  is_active: boolean;
  provider_config: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface WalletTransactionRow {
  id: string;
  wallet_id: string;
  agent_id: string;
  tx_hash: string | null;
  from_address: string;
  to_address: string;
  amount: string;
  amount_usd: string | null;
  token_symbol: string;
  status: TxStatus;
  block_number: number | null;
  purpose: string | null;
  session_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  confirmed_at: string | null;
}

export interface FeatureFlagRow {
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

export interface AuditLogRow {
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

export interface AgentMemoryRow {
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

export interface AgentPermissionRow {
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

export interface HitlPolicyRow {
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

export interface ApprovalRequestRow {
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

export interface EvalSuiteRow {
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
}

export interface EvalCaseRow {
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

export interface EvalRunRow {
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
}

export interface EvalResultRow {
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

export interface DataConnectorRow {
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

export interface DataPipelineRow {
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
}

export interface PipelineStepRow {
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

export interface PipelineRunRow {
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

export interface AgentTemplateRow {
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
}

export interface TemplateVersionRow {
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

export interface AgentDeploymentRow {
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

export interface MarketplaceListingRow {
  id: string;
  agent_id: string;
  owner_id: string;
  title: string;
  short_desc: string;
  long_desc: string | null;
  category: string;
  tags: string[];
  pricing_model: PricingModel;
  price_usd: string | null;
  revenue_share_pct: number | null;
  a2a_agent_card_url: string | null;
  install_count: number;
  rating_avg: string;
  rating_count: number;
  status: ListingStatus;
  published_at: string | null;
  featured: boolean;
  embedding: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface MarketplaceReviewRow {
  id: string;
  listing_id: string;
  reviewer_id: string;
  rating: number;
  title: string | null;
  body: string | null;
  verified: boolean;
  created_at: string;
  updated_at: string;
}

// -- Supabase Database interface ----------------------------------------------
// Matches the GenericSchema / GenericTable shape expected by @supabase/postgrest-js v2.

type Rel = {
  foreignKeyName: string;
  columns: string[];
  isOneToOne?: boolean;
  referencedRelation: string;
  referencedColumns: string[];
};

// The Supabase client requires concrete Insert/Update types per table.
// We define them explicitly for the tables we actively write to.

export interface Database {
  public: {
    Tables: {
      agents: {
        Row: AgentRow;
        Insert: Partial<AgentRow> & { owner_id: string; name: string };
        Update: Partial<AgentRow>;
        Relationships: Rel[];
      };
      agent_sessions: {
        Row: AgentSessionRow;
        Insert: Partial<AgentSessionRow> & { agent_id: string; owner_id: string };
        Update: Partial<AgentSessionRow>;
        Relationships: Rel[];
      };
      agent_messages: {
        Row: AgentMessageRow;
        Insert: Partial<AgentMessageRow> & {
          session_id: string;
          agent_id: string;
          role: MessageRole;
        };
        Update: Partial<AgentMessageRow>;
        Relationships: Rel[];
      };
      agent_wallets: {
        Row: AgentWalletRow;
        Insert: Partial<AgentWalletRow> & {
          agent_id: string;
          owner_id: string;
          network: WalletNetwork;
          wallet_address: string;
        };
        Update: Partial<AgentWalletRow>;
        Relationships: Rel[];
      };
      wallet_transactions: {
        Row: WalletTransactionRow;
        Insert: Partial<WalletTransactionRow> & {
          wallet_id: string;
          agent_id: string;
          from_address: string;
          to_address: string;
          amount: string;
        };
        Update: Partial<WalletTransactionRow>;
        Relationships: Rel[];
      };
      feature_flags: {
        Row: FeatureFlagRow;
        Insert: Partial<FeatureFlagRow> & {
          owner_id: string;
          key: string;
          name: string;
        };
        Update: Partial<FeatureFlagRow>;
        Relationships: Rel[];
      };
      audit_logs: {
        Row: AuditLogRow;
        Insert: Partial<AuditLogRow> & {
          action: string;
          resource_type: string;
        };
        Update: Partial<AuditLogRow>;
        Relationships: Rel[];
      };
      agent_memories: {
        Row: AgentMemoryRow;
        Insert: Partial<AgentMemoryRow> & {
          agent_id: string;
          owner_id: string;
          content: string;
        };
        Update: Partial<AgentMemoryRow>;
        Relationships: Rel[];
      };
      agent_permissions: {
        Row: AgentPermissionRow;
        Insert: Partial<AgentPermissionRow> & {
          agent_id: string;
          user_id: string;
        };
        Update: Partial<AgentPermissionRow>;
        Relationships: Rel[];
      };
      hitl_policies: {
        Row: HitlPolicyRow;
        Insert: Partial<HitlPolicyRow> & {
          agent_id: string;
          owner_id: string;
          name: string;
          trigger_type: HitlTriggerType;
        };
        Update: Partial<HitlPolicyRow>;
        Relationships: Rel[];
      };
      approval_requests: {
        Row: ApprovalRequestRow;
        Insert: Partial<ApprovalRequestRow> & {
          agent_id: string;
          owner_id: string;
          action_type: string;
          action_summary: string;
        };
        Update: Partial<ApprovalRequestRow>;
        Relationships: Rel[];
      };
      eval_suites: {
        Row: EvalSuiteRow;
        Insert: Partial<EvalSuiteRow> & {
          agent_id: string;
          owner_id: string;
          name: string;
        };
        Update: Partial<EvalSuiteRow>;
        Relationships: Rel[];
      };
      eval_cases: {
        Row: EvalCaseRow;
        Insert: Partial<EvalCaseRow> & {
          suite_id: string;
          name: string;
          input: string;
        };
        Update: Partial<EvalCaseRow>;
        Relationships: Rel[];
      };
      eval_runs: {
        Row: EvalRunRow;
        Insert: Partial<EvalRunRow> & {
          suite_id: string;
          agent_id: string;
          owner_id: string;
        };
        Update: Partial<EvalRunRow>;
        Relationships: Rel[];
      };
      eval_results: {
        Row: EvalResultRow;
        Insert: Partial<EvalResultRow> & {
          run_id: string;
          case_id: string;
        };
        Update: Partial<EvalResultRow>;
        Relationships: Rel[];
      };
      data_connectors: {
        Row: DataConnectorRow;
        Insert: Partial<DataConnectorRow> & {
          agent_id: string;
          owner_id: string;
          name: string;
          connector_type: ConnectorType;
        };
        Update: Partial<DataConnectorRow>;
        Relationships: Rel[];
      };
      data_pipelines: {
        Row: DataPipelineRow;
        Insert: Partial<DataPipelineRow> & {
          agent_id: string;
          owner_id: string;
          name: string;
        };
        Update: Partial<DataPipelineRow>;
        Relationships: Rel[];
      };
      pipeline_steps: {
        Row: PipelineStepRow;
        Insert: Partial<PipelineStepRow> & {
          pipeline_id: string;
          name: string;
          step_type: PipelineStepType;
        };
        Update: Partial<PipelineStepRow>;
        Relationships: Rel[];
      };
      pipeline_runs: {
        Row: PipelineRunRow;
        Insert: Partial<PipelineRunRow> & {
          pipeline_id: string;
          agent_id: string;
          owner_id: string;
        };
        Update: Partial<PipelineRunRow>;
        Relationships: Rel[];
      };
      agent_templates: {
        Row: AgentTemplateRow;
        Insert: Partial<AgentTemplateRow> & {
          owner_id: string;
          name: string;
        };
        Update: Partial<AgentTemplateRow>;
        Relationships: Rel[];
      };
      template_versions: {
        Row: TemplateVersionRow;
        Insert: Partial<TemplateVersionRow> & {
          template_id: string;
          version_number: number;
          framework: AgentFramework;
          published_by: string;
        };
        Update: Partial<TemplateVersionRow>;
        Relationships: Rel[];
      };
      agent_deployments: {
        Row: AgentDeploymentRow;
        Insert: Partial<AgentDeploymentRow> & {
          agent_id: string;
          owner_id: string;
        };
        Update: Partial<AgentDeploymentRow>;
        Relationships: Rel[];
      };
      marketplace_listings: {
        Row: MarketplaceListingRow;
        Insert: Partial<MarketplaceListingRow> & {
          agent_id: string;
          owner_id: string;
          title: string;
          short_desc: string;
        };
        Update: Partial<MarketplaceListingRow>;
        Relationships: Rel[];
      };
      marketplace_reviews: {
        Row: MarketplaceReviewRow;
        Insert: Partial<MarketplaceReviewRow> & {
          listing_id: string;
          reviewer_id: string;
          rating: number;
        };
        Update: Partial<MarketplaceReviewRow>;
        Relationships: Rel[];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      [_ in never]: never;
    };
  };
}
