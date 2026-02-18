-- Sprint 12: Eval & Testing Framework
-- Enables defining test suites, running evaluations, and tracking results.

-- ---------------------------------------------------------------------------
-- Enum: eval_run_status
-- ---------------------------------------------------------------------------

CREATE TYPE eval_run_status AS ENUM (
  'pending',      -- Queued but not started.
  'running',      -- Currently executing.
  'completed',    -- All cases evaluated.
  'failed',       -- Run aborted due to error.
  'cancelled'     -- Manually cancelled.
);

-- ---------------------------------------------------------------------------
-- Enum: eval_scorer_type
-- ---------------------------------------------------------------------------

CREATE TYPE eval_scorer_type AS ENUM (
  'exact_match',      -- Output must exactly equal expected.
  'contains',         -- Output must contain expected substring.
  'regex',            -- Output must match regex pattern.
  'semantic',         -- Semantic similarity (embedding cosine distance).
  'json_match',       -- JSON structure/value matching.
  'custom'            -- Custom scorer via metadata.
);

-- ---------------------------------------------------------------------------
-- Table: eval_suites
-- ---------------------------------------------------------------------------
-- A test suite groups related test cases for an agent.

CREATE TABLE eval_suites (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id    UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  owner_id    UUID NOT NULL,
  name        TEXT NOT NULL,
  description TEXT,
  tags        TEXT[] NOT NULL DEFAULT '{}',
  is_active   BOOLEAN NOT NULL DEFAULT true,
  metadata    JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Table: eval_cases
-- ---------------------------------------------------------------------------
-- Individual test cases within a suite.

CREATE TABLE eval_cases (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  suite_id        UUID NOT NULL REFERENCES eval_suites(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  description     TEXT,
  -- Input to send to the agent.
  input           TEXT NOT NULL,
  -- Expected output or pattern to match against.
  expected_output TEXT,
  -- How to score the result.
  scorer_type     eval_scorer_type NOT NULL DEFAULT 'contains',
  scorer_config   JSONB NOT NULL DEFAULT '{}',
  -- Execution constraints.
  timeout_seconds INTEGER NOT NULL DEFAULT 30,
  -- Ordering within the suite.
  sort_order      INTEGER NOT NULL DEFAULT 0,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  metadata        JSONB NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Table: eval_runs
-- ---------------------------------------------------------------------------
-- A single execution of a test suite against an agent.

CREATE TABLE eval_runs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  suite_id        UUID NOT NULL REFERENCES eval_suites(id) ON DELETE CASCADE,
  agent_id        UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  owner_id        UUID NOT NULL,
  status          eval_run_status NOT NULL DEFAULT 'pending',
  -- Aggregate scores.
  total_cases     INTEGER NOT NULL DEFAULT 0,
  passed_cases    INTEGER NOT NULL DEFAULT 0,
  failed_cases    INTEGER NOT NULL DEFAULT 0,
  avg_score       NUMERIC(5,4) NOT NULL DEFAULT 0,
  avg_latency_ms  NUMERIC(10,2) NOT NULL DEFAULT 0,
  -- Agent version at time of run.
  agent_version   INTEGER,
  -- Error info if run failed.
  error_message   TEXT,
  started_at      TIMESTAMPTZ,
  completed_at    TIMESTAMPTZ,
  metadata        JSONB NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Table: eval_results
-- ---------------------------------------------------------------------------
-- Per-case results within a run.

CREATE TABLE eval_results (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id          UUID NOT NULL REFERENCES eval_runs(id) ON DELETE CASCADE,
  case_id         UUID NOT NULL REFERENCES eval_cases(id) ON DELETE CASCADE,
  -- What the agent actually produced.
  actual_output   TEXT,
  -- Score from 0.0 to 1.0.
  score           NUMERIC(5,4) NOT NULL DEFAULT 0,
  passed          BOOLEAN NOT NULL DEFAULT false,
  -- Execution metrics.
  latency_ms      NUMERIC(10,2),
  token_count     INTEGER,
  -- Scorer details.
  scorer_output   JSONB NOT NULL DEFAULT '{}',
  error_message   TEXT,
  metadata        JSONB NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------

CREATE INDEX idx_eval_suites_agent    ON eval_suites (agent_id);
CREATE INDEX idx_eval_cases_suite     ON eval_cases (suite_id);
CREATE INDEX idx_eval_runs_suite      ON eval_runs (suite_id);
CREATE INDEX idx_eval_runs_agent      ON eval_runs (agent_id);
CREATE INDEX idx_eval_runs_status     ON eval_runs (agent_id, status)
  WHERE status IN ('pending', 'running');
CREATE INDEX idx_eval_results_run     ON eval_results (run_id);

-- ---------------------------------------------------------------------------
-- Triggers: auto-update updated_at
-- ---------------------------------------------------------------------------

CREATE TRIGGER trg_eval_suites_updated_at
  BEFORE UPDATE ON eval_suites
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);

CREATE TRIGGER trg_eval_cases_updated_at
  BEFORE UPDATE ON eval_cases
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);

CREATE TRIGGER trg_eval_runs_updated_at
  BEFORE UPDATE ON eval_runs
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

ALTER TABLE eval_suites  ENABLE ROW LEVEL SECURITY;
ALTER TABLE eval_cases   ENABLE ROW LEVEL SECURITY;
ALTER TABLE eval_runs    ENABLE ROW LEVEL SECURITY;
ALTER TABLE eval_results ENABLE ROW LEVEL SECURITY;

-- Suites: owner + shared users can read; owner manages.
CREATE POLICY eval_suites_select ON eval_suites
  FOR SELECT USING (
    owner_id = auth.uid()
    OR agent_id IN (SELECT agent_id FROM agent_permissions WHERE user_id = auth.uid())
  );
CREATE POLICY eval_suites_insert ON eval_suites
  FOR INSERT WITH CHECK (owner_id = auth.uid());
CREATE POLICY eval_suites_update ON eval_suites
  FOR UPDATE USING (owner_id = auth.uid());
CREATE POLICY eval_suites_delete ON eval_suites
  FOR DELETE USING (owner_id = auth.uid());

-- Cases: inherit access from suite's agent.
CREATE POLICY eval_cases_select ON eval_cases
  FOR SELECT USING (
    suite_id IN (SELECT id FROM eval_suites WHERE owner_id = auth.uid())
    OR suite_id IN (
      SELECT es.id FROM eval_suites es
      JOIN agent_permissions ap ON ap.agent_id = es.agent_id
      WHERE ap.user_id = auth.uid()
    )
  );
CREATE POLICY eval_cases_insert ON eval_cases
  FOR INSERT WITH CHECK (
    suite_id IN (SELECT id FROM eval_suites WHERE owner_id = auth.uid())
  );
CREATE POLICY eval_cases_update ON eval_cases
  FOR UPDATE USING (
    suite_id IN (SELECT id FROM eval_suites WHERE owner_id = auth.uid())
  );
CREATE POLICY eval_cases_delete ON eval_cases
  FOR DELETE USING (
    suite_id IN (SELECT id FROM eval_suites WHERE owner_id = auth.uid())
  );

-- Runs: owner + shared users can read; owner manages.
CREATE POLICY eval_runs_select ON eval_runs
  FOR SELECT USING (
    owner_id = auth.uid()
    OR agent_id IN (SELECT agent_id FROM agent_permissions WHERE user_id = auth.uid())
  );
CREATE POLICY eval_runs_insert ON eval_runs
  FOR INSERT WITH CHECK (owner_id = auth.uid());
CREATE POLICY eval_runs_update ON eval_runs
  FOR UPDATE USING (owner_id = auth.uid());

-- Results: inherit from run.
CREATE POLICY eval_results_select ON eval_results
  FOR SELECT USING (
    run_id IN (SELECT id FROM eval_runs WHERE owner_id = auth.uid())
    OR run_id IN (
      SELECT er.id FROM eval_runs er
      JOIN agent_permissions ap ON ap.agent_id = er.agent_id
      WHERE ap.user_id = auth.uid()
    )
  );
CREATE POLICY eval_results_insert ON eval_results
  FOR INSERT WITH CHECK (
    run_id IN (SELECT id FROM eval_runs WHERE owner_id = auth.uid())
  );
