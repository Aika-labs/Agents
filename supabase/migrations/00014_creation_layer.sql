-- Sprint 14: Creation Layer
-- Agent templates, versioned snapshots, and deployment tracking.

-- ---------------------------------------------------------------------------
-- Enum: template_category
-- ---------------------------------------------------------------------------

CREATE TYPE template_category AS ENUM (
  'assistant',      -- General-purpose conversational agents.
  'coding',         -- Code generation / review agents.
  'data',           -- Data analysis / ETL agents.
  'research',       -- Web research / summarization agents.
  'customer_support', -- Customer-facing support agents.
  'automation',     -- Workflow automation agents.
  'creative',       -- Content creation agents.
  'custom'          -- User-defined category.
);

-- ---------------------------------------------------------------------------
-- Enum: deployment_status
-- ---------------------------------------------------------------------------

CREATE TYPE deployment_status AS ENUM (
  'pending',
  'building',
  'deploying',
  'running',
  'stopped',
  'failed',
  'rolled_back'
);

-- ---------------------------------------------------------------------------
-- Table: agent_templates
-- ---------------------------------------------------------------------------
-- Reusable agent blueprints. Templates capture a full agent configuration
-- (framework, model, tools, prompts) that can be instantiated into new agents.

CREATE TABLE agent_templates (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id        UUID NOT NULL,
  name            TEXT NOT NULL,
  description     TEXT,
  category        template_category NOT NULL DEFAULT 'custom',
  -- Template configuration: mirrors agent fields.
  framework       agent_framework NOT NULL DEFAULT 'custom',
  model_config    JSONB NOT NULL DEFAULT '{}',
  system_prompt   TEXT,
  tools           JSONB NOT NULL DEFAULT '[]',
  mcp_servers     JSONB NOT NULL DEFAULT '[]',
  a2a_config      JSONB NOT NULL DEFAULT '{}',
  -- Default tags applied to agents created from this template.
  default_tags    TEXT[] NOT NULL DEFAULT '{}',
  -- Whether this template is published to the org marketplace.
  is_public       BOOLEAN NOT NULL DEFAULT false,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  -- Usage tracking.
  use_count       INTEGER NOT NULL DEFAULT 0,
  -- Current version number (incremented on publish).
  current_version INTEGER NOT NULL DEFAULT 1,
  metadata        JSONB NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Table: template_versions
-- ---------------------------------------------------------------------------
-- Immutable snapshots of a template at a point in time.

CREATE TABLE template_versions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id     UUID NOT NULL REFERENCES agent_templates(id) ON DELETE CASCADE,
  version_number  INTEGER NOT NULL,
  -- Snapshot of the template configuration at this version.
  framework       agent_framework NOT NULL,
  model_config    JSONB NOT NULL DEFAULT '{}',
  system_prompt   TEXT,
  tools           JSONB NOT NULL DEFAULT '[]',
  mcp_servers     JSONB NOT NULL DEFAULT '[]',
  a2a_config      JSONB NOT NULL DEFAULT '{}',
  default_tags    TEXT[] NOT NULL DEFAULT '{}',
  -- Change description.
  changelog       TEXT,
  published_by    UUID NOT NULL,
  metadata        JSONB NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (template_id, version_number)
);

-- ---------------------------------------------------------------------------
-- Table: agent_deployments
-- ---------------------------------------------------------------------------
-- Tracks deployment lifecycle for agents (build, deploy, run, stop).

CREATE TABLE agent_deployments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id        UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  owner_id        UUID NOT NULL,
  -- Deployment target (e.g., cloud-run, gke, local).
  target          TEXT NOT NULL DEFAULT 'cloud-run',
  status          deployment_status NOT NULL DEFAULT 'pending',
  -- Agent version at time of deployment.
  agent_version   INTEGER NOT NULL DEFAULT 1,
  -- Template used (if created from template).
  template_id     UUID REFERENCES agent_templates(id) ON DELETE SET NULL,
  template_version INTEGER,
  -- Deployment configuration (env vars, resource limits, scaling).
  config          JSONB NOT NULL DEFAULT '{}',
  -- Runtime info (URL, container image, etc.).
  runtime_info    JSONB NOT NULL DEFAULT '{}',
  -- Timing.
  started_at      TIMESTAMPTZ,
  completed_at    TIMESTAMPTZ,
  stopped_at      TIMESTAMPTZ,
  -- Error info.
  error_message   TEXT,
  metadata        JSONB NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------

CREATE INDEX idx_agent_templates_owner    ON agent_templates (owner_id);
CREATE INDEX idx_agent_templates_category ON agent_templates (category)
  WHERE is_active = true;
CREATE INDEX idx_agent_templates_public   ON agent_templates (is_public)
  WHERE is_public = true AND is_active = true;
CREATE INDEX idx_template_versions_template ON template_versions (template_id);
CREATE INDEX idx_agent_deployments_agent  ON agent_deployments (agent_id);
CREATE INDEX idx_agent_deployments_status ON agent_deployments (agent_id, status)
  WHERE status IN ('pending', 'building', 'deploying', 'running');

-- ---------------------------------------------------------------------------
-- Triggers: auto-update updated_at
-- ---------------------------------------------------------------------------

CREATE TRIGGER trg_agent_templates_updated_at
  BEFORE UPDATE ON agent_templates
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);

CREATE TRIGGER trg_agent_deployments_updated_at
  BEFORE UPDATE ON agent_deployments
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

ALTER TABLE agent_templates    ENABLE ROW LEVEL SECURITY;
ALTER TABLE template_versions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_deployments  ENABLE ROW LEVEL SECURITY;

-- Templates: owner can manage; public templates readable by all authenticated users.
CREATE POLICY agent_templates_select ON agent_templates
  FOR SELECT USING (
    owner_id = auth.uid()
    OR is_public = true
  );
CREATE POLICY agent_templates_insert ON agent_templates
  FOR INSERT WITH CHECK (owner_id = auth.uid());
CREATE POLICY agent_templates_update ON agent_templates
  FOR UPDATE USING (owner_id = auth.uid());
CREATE POLICY agent_templates_delete ON agent_templates
  FOR DELETE USING (owner_id = auth.uid());

-- Versions: readable if template is accessible.
CREATE POLICY template_versions_select ON template_versions
  FOR SELECT USING (
    template_id IN (
      SELECT id FROM agent_templates
      WHERE owner_id = auth.uid() OR is_public = true
    )
  );
CREATE POLICY template_versions_insert ON template_versions
  FOR INSERT WITH CHECK (
    template_id IN (SELECT id FROM agent_templates WHERE owner_id = auth.uid())
  );

-- Deployments: owner + shared users can read; owner manages.
CREATE POLICY agent_deployments_select ON agent_deployments
  FOR SELECT USING (
    owner_id = auth.uid()
    OR agent_id IN (SELECT agent_id FROM agent_permissions WHERE user_id = auth.uid())
  );
CREATE POLICY agent_deployments_insert ON agent_deployments
  FOR INSERT WITH CHECK (owner_id = auth.uid());
CREATE POLICY agent_deployments_update ON agent_deployments
  FOR UPDATE USING (owner_id = auth.uid());
