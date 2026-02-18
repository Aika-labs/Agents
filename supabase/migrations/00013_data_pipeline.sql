-- Sprint 13: Data Pipeline
-- Configurable data ingestion, transformation, and export pipelines for agents.

-- ---------------------------------------------------------------------------
-- Enum: connector_type
-- ---------------------------------------------------------------------------

CREATE TYPE connector_type AS ENUM (
  'gcs',            -- Google Cloud Storage bucket.
  'supabase',       -- Supabase table (internal).
  'http_webhook',   -- HTTP endpoint (POST/GET).
  'redis',          -- Redis stream/key.
  'postgresql',     -- External PostgreSQL database.
  'custom'          -- Custom connector via metadata.
);

-- ---------------------------------------------------------------------------
-- Enum: pipeline_status
-- ---------------------------------------------------------------------------

CREATE TYPE pipeline_status AS ENUM (
  'pending',
  'running',
  'completed',
  'failed',
  'cancelled'
);

-- ---------------------------------------------------------------------------
-- Enum: pipeline_step_type
-- ---------------------------------------------------------------------------

CREATE TYPE pipeline_step_type AS ENUM (
  'extract',        -- Pull data from a source connector.
  'transform',      -- Apply a transformation (filter, map, aggregate, etc.).
  'load',           -- Push data to a sink connector.
  'validate',       -- Validate data against a schema.
  'enrich',         -- Enrich data with external lookups.
  'branch',         -- Conditional branching.
  'custom'          -- Custom step via metadata.
);

-- ---------------------------------------------------------------------------
-- Table: data_connectors
-- ---------------------------------------------------------------------------
-- Reusable source/sink definitions for pipelines.

CREATE TABLE data_connectors (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id        UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  owner_id        UUID NOT NULL,
  name            TEXT NOT NULL,
  description     TEXT,
  connector_type  connector_type NOT NULL,
  -- Connection configuration (URLs, credentials ref, bucket names, etc.).
  -- Secrets should be stored as references, not plaintext.
  config          JSONB NOT NULL DEFAULT '{}',
  is_source       BOOLEAN NOT NULL DEFAULT true,
  is_sink         BOOLEAN NOT NULL DEFAULT false,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  metadata        JSONB NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Table: data_pipelines
-- ---------------------------------------------------------------------------
-- Pipeline definitions with scheduling and configuration.

CREATE TABLE data_pipelines (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id        UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  owner_id        UUID NOT NULL,
  name            TEXT NOT NULL,
  description     TEXT,
  -- Optional source/sink connector references.
  source_connector_id UUID REFERENCES data_connectors(id) ON DELETE SET NULL,
  sink_connector_id   UUID REFERENCES data_connectors(id) ON DELETE SET NULL,
  -- Schedule (cron expression). NULL = manual trigger only.
  schedule_cron   TEXT,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  -- Max concurrent runs.
  max_concurrency INTEGER NOT NULL DEFAULT 1,
  -- Retry configuration.
  max_retries     INTEGER NOT NULL DEFAULT 0,
  retry_delay_seconds INTEGER NOT NULL DEFAULT 60,
  metadata        JSONB NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Table: pipeline_steps
-- ---------------------------------------------------------------------------
-- Ordered steps within a pipeline.

CREATE TABLE pipeline_steps (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline_id     UUID NOT NULL REFERENCES data_pipelines(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  step_type       pipeline_step_type NOT NULL,
  -- Step-specific configuration.
  -- transform: { "operation": "filter", "expression": "amount > 100" }
  -- extract:   { "query": "SELECT * FROM ...", "format": "json" }
  -- load:      { "mode": "upsert", "key_columns": ["id"] }
  config          JSONB NOT NULL DEFAULT '{}',
  -- Ordering within the pipeline.
  sort_order      INTEGER NOT NULL DEFAULT 0,
  -- Optional connector override for this step.
  connector_id    UUID REFERENCES data_connectors(id) ON DELETE SET NULL,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  metadata        JSONB NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Table: pipeline_runs
-- ---------------------------------------------------------------------------
-- Execution records for pipeline runs.

CREATE TABLE pipeline_runs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline_id     UUID NOT NULL REFERENCES data_pipelines(id) ON DELETE CASCADE,
  agent_id        UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  owner_id        UUID NOT NULL,
  status          pipeline_status NOT NULL DEFAULT 'pending',
  -- Per-step execution log.
  step_results    JSONB NOT NULL DEFAULT '[]',
  -- Aggregate metrics.
  records_read    INTEGER NOT NULL DEFAULT 0,
  records_written INTEGER NOT NULL DEFAULT 0,
  records_failed  INTEGER NOT NULL DEFAULT 0,
  bytes_processed BIGINT NOT NULL DEFAULT 0,
  -- Timing.
  started_at      TIMESTAMPTZ,
  completed_at    TIMESTAMPTZ,
  -- Error info.
  error_message   TEXT,
  error_step      TEXT,
  -- Retry tracking.
  attempt_number  INTEGER NOT NULL DEFAULT 1,
  metadata        JSONB NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------

CREATE INDEX idx_data_connectors_agent   ON data_connectors (agent_id);
CREATE INDEX idx_data_pipelines_agent    ON data_pipelines (agent_id);
CREATE INDEX idx_pipeline_steps_pipeline ON pipeline_steps (pipeline_id);
CREATE INDEX idx_pipeline_runs_pipeline  ON pipeline_runs (pipeline_id);
CREATE INDEX idx_pipeline_runs_agent     ON pipeline_runs (agent_id);
CREATE INDEX idx_pipeline_runs_status    ON pipeline_runs (agent_id, status)
  WHERE status IN ('pending', 'running');

-- ---------------------------------------------------------------------------
-- Triggers: auto-update updated_at
-- ---------------------------------------------------------------------------

CREATE TRIGGER trg_data_connectors_updated_at
  BEFORE UPDATE ON data_connectors
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);

CREATE TRIGGER trg_data_pipelines_updated_at
  BEFORE UPDATE ON data_pipelines
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);

CREATE TRIGGER trg_pipeline_steps_updated_at
  BEFORE UPDATE ON pipeline_steps
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);

CREATE TRIGGER trg_pipeline_runs_updated_at
  BEFORE UPDATE ON pipeline_runs
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

ALTER TABLE data_connectors ENABLE ROW LEVEL SECURITY;
ALTER TABLE data_pipelines  ENABLE ROW LEVEL SECURITY;
ALTER TABLE pipeline_steps  ENABLE ROW LEVEL SECURITY;
ALTER TABLE pipeline_runs   ENABLE ROW LEVEL SECURITY;

-- Connectors: owner + shared users can read; owner manages.
CREATE POLICY data_connectors_select ON data_connectors
  FOR SELECT USING (
    owner_id = auth.uid()
    OR agent_id IN (SELECT agent_id FROM agent_permissions WHERE user_id = auth.uid())
  );
CREATE POLICY data_connectors_insert ON data_connectors
  FOR INSERT WITH CHECK (owner_id = auth.uid());
CREATE POLICY data_connectors_update ON data_connectors
  FOR UPDATE USING (owner_id = auth.uid());
CREATE POLICY data_connectors_delete ON data_connectors
  FOR DELETE USING (owner_id = auth.uid());

-- Pipelines: same pattern.
CREATE POLICY data_pipelines_select ON data_pipelines
  FOR SELECT USING (
    owner_id = auth.uid()
    OR agent_id IN (SELECT agent_id FROM agent_permissions WHERE user_id = auth.uid())
  );
CREATE POLICY data_pipelines_insert ON data_pipelines
  FOR INSERT WITH CHECK (owner_id = auth.uid());
CREATE POLICY data_pipelines_update ON data_pipelines
  FOR UPDATE USING (owner_id = auth.uid());
CREATE POLICY data_pipelines_delete ON data_pipelines
  FOR DELETE USING (owner_id = auth.uid());

-- Steps: inherit from pipeline owner.
CREATE POLICY pipeline_steps_select ON pipeline_steps
  FOR SELECT USING (
    pipeline_id IN (SELECT id FROM data_pipelines WHERE owner_id = auth.uid())
    OR pipeline_id IN (
      SELECT dp.id FROM data_pipelines dp
      JOIN agent_permissions ap ON ap.agent_id = dp.agent_id
      WHERE ap.user_id = auth.uid()
    )
  );
CREATE POLICY pipeline_steps_insert ON pipeline_steps
  FOR INSERT WITH CHECK (
    pipeline_id IN (SELECT id FROM data_pipelines WHERE owner_id = auth.uid())
  );
CREATE POLICY pipeline_steps_update ON pipeline_steps
  FOR UPDATE USING (
    pipeline_id IN (SELECT id FROM data_pipelines WHERE owner_id = auth.uid())
  );
CREATE POLICY pipeline_steps_delete ON pipeline_steps
  FOR DELETE USING (
    pipeline_id IN (SELECT id FROM data_pipelines WHERE owner_id = auth.uid())
  );

-- Runs: owner + shared users can read; owner manages.
CREATE POLICY pipeline_runs_select ON pipeline_runs
  FOR SELECT USING (
    owner_id = auth.uid()
    OR agent_id IN (SELECT agent_id FROM agent_permissions WHERE user_id = auth.uid())
  );
CREATE POLICY pipeline_runs_insert ON pipeline_runs
  FOR INSERT WITH CHECK (owner_id = auth.uid());
CREATE POLICY pipeline_runs_update ON pipeline_runs
  FOR UPDATE USING (owner_id = auth.uid());
