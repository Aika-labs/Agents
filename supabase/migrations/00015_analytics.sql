-- Sprint 15: Analytics Dashboard
-- Time-bucketed metrics and daily usage rollups for agent analytics.

-- ---------------------------------------------------------------------------
-- Enum: metric_period
-- ---------------------------------------------------------------------------

CREATE TYPE metric_period AS ENUM (
  'hourly',
  'daily',
  'weekly',
  'monthly'
);

-- ---------------------------------------------------------------------------
-- Table: agent_metrics
-- ---------------------------------------------------------------------------
-- Time-bucketed aggregate metrics for agents. Each row represents one
-- metric period (hour/day/week/month) for one agent.

CREATE TABLE agent_metrics (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id          UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  owner_id          UUID NOT NULL,
  period            metric_period NOT NULL,
  -- Bucket start time (e.g., 2025-01-15T14:00:00Z for hourly).
  bucket_start      TIMESTAMPTZ NOT NULL,
  bucket_end        TIMESTAMPTZ NOT NULL,
  -- Token usage.
  total_tokens      BIGINT NOT NULL DEFAULT 0,
  prompt_tokens     BIGINT NOT NULL DEFAULT 0,
  completion_tokens BIGINT NOT NULL DEFAULT 0,
  -- Session & message counts.
  session_count     INTEGER NOT NULL DEFAULT 0,
  message_count     INTEGER NOT NULL DEFAULT 0,
  -- Cost tracking (USD).
  estimated_cost_usd NUMERIC(12, 6) NOT NULL DEFAULT 0,
  -- Performance.
  avg_latency_ms    NUMERIC(10, 2) NOT NULL DEFAULT 0,
  p95_latency_ms    NUMERIC(10, 2) NOT NULL DEFAULT 0,
  p99_latency_ms    NUMERIC(10, 2) NOT NULL DEFAULT 0,
  -- Error tracking.
  error_count       INTEGER NOT NULL DEFAULT 0,
  -- Tool usage.
  tool_call_count   INTEGER NOT NULL DEFAULT 0,
  -- Eval metrics (if evals ran in this period).
  eval_run_count    INTEGER NOT NULL DEFAULT 0,
  avg_eval_score    NUMERIC(5, 4) NOT NULL DEFAULT 0,
  -- Pipeline metrics.
  pipeline_run_count INTEGER NOT NULL DEFAULT 0,
  records_processed  BIGINT NOT NULL DEFAULT 0,
  metadata          JSONB NOT NULL DEFAULT '{}',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (agent_id, period, bucket_start)
);

-- ---------------------------------------------------------------------------
-- Table: agent_usage_daily
-- ---------------------------------------------------------------------------
-- Simplified daily rollup for quick dashboard queries.
-- Denormalized for fast reads; populated by aggregation jobs.

CREATE TABLE agent_usage_daily (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id          UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  owner_id          UUID NOT NULL,
  usage_date        DATE NOT NULL,
  -- Cumulative counts for the day.
  total_tokens      BIGINT NOT NULL DEFAULT 0,
  prompt_tokens     BIGINT NOT NULL DEFAULT 0,
  completion_tokens BIGINT NOT NULL DEFAULT 0,
  session_count     INTEGER NOT NULL DEFAULT 0,
  message_count     INTEGER NOT NULL DEFAULT 0,
  unique_users      INTEGER NOT NULL DEFAULT 0,
  estimated_cost_usd NUMERIC(12, 6) NOT NULL DEFAULT 0,
  avg_latency_ms    NUMERIC(10, 2) NOT NULL DEFAULT 0,
  error_count       INTEGER NOT NULL DEFAULT 0,
  error_rate        NUMERIC(5, 4) NOT NULL DEFAULT 0,
  tool_call_count   INTEGER NOT NULL DEFAULT 0,
  -- Top models used (JSON array of { model, count }).
  top_models        JSONB NOT NULL DEFAULT '[]',
  -- Top tools used (JSON array of { tool, count }).
  top_tools         JSONB NOT NULL DEFAULT '[]',
  metadata          JSONB NOT NULL DEFAULT '{}',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (agent_id, usage_date)
);

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------

CREATE INDEX idx_agent_metrics_agent_period
  ON agent_metrics (agent_id, period, bucket_start DESC);
CREATE INDEX idx_agent_metrics_owner
  ON agent_metrics (owner_id, period, bucket_start DESC);
CREATE INDEX idx_agent_usage_daily_agent
  ON agent_usage_daily (agent_id, usage_date DESC);
CREATE INDEX idx_agent_usage_daily_owner
  ON agent_usage_daily (owner_id, usage_date DESC);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

ALTER TABLE agent_metrics      ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_usage_daily  ENABLE ROW LEVEL SECURITY;

-- Metrics: owner + shared users can read.
CREATE POLICY agent_metrics_select ON agent_metrics
  FOR SELECT USING (
    owner_id = auth.uid()
    OR agent_id IN (SELECT agent_id FROM agent_permissions WHERE user_id = auth.uid())
  );
CREATE POLICY agent_metrics_insert ON agent_metrics
  FOR INSERT WITH CHECK (owner_id = auth.uid());

-- Daily usage: same pattern.
CREATE POLICY agent_usage_daily_select ON agent_usage_daily
  FOR SELECT USING (
    owner_id = auth.uid()
    OR agent_id IN (SELECT agent_id FROM agent_permissions WHERE user_id = auth.uid())
  );
CREATE POLICY agent_usage_daily_insert ON agent_usage_daily
  FOR INSERT WITH CHECK (owner_id = auth.uid());
