-- Sprint 11: Human-in-the-Loop (HITL) Workflows
-- Enables agents to pause and request human approval before sensitive actions.

-- ---------------------------------------------------------------------------
-- Enum: approval_status
-- ---------------------------------------------------------------------------

CREATE TYPE approval_status AS ENUM (
  'pending',      -- Awaiting human review.
  'approved',     -- Human approved the action.
  'rejected',     -- Human rejected the action.
  'expired',      -- Timed out without a response.
  'cancelled'     -- Agent or system cancelled the request.
);

-- ---------------------------------------------------------------------------
-- Enum: hitl_trigger_type
-- ---------------------------------------------------------------------------

CREATE TYPE hitl_trigger_type AS ENUM (
  'tool_call',        -- Specific tool invocation.
  'spending',         -- Financial threshold exceeded.
  'external_api',     -- External API call.
  'data_mutation',    -- Data create/update/delete.
  'escalation',       -- Agent-initiated escalation.
  'custom'            -- Custom trigger via metadata match.
);

-- ---------------------------------------------------------------------------
-- Table: hitl_policies
-- ---------------------------------------------------------------------------
-- Per-agent rules that define when human approval is required.
-- An agent can have multiple policies. When an action matches any active
-- policy, an approval request is created and the agent pauses.

CREATE TABLE hitl_policies (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id        UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  owner_id        UUID NOT NULL,
  name            TEXT NOT NULL,
  description     TEXT,
  trigger_type    hitl_trigger_type NOT NULL,
  -- JSON conditions that must match for the policy to fire.
  -- Structure depends on trigger_type:
  --   tool_call:     { "tool_names": ["send_email", "delete_*"] }
  --   spending:      { "threshold_usd": 100 }
  --   external_api:  { "url_patterns": ["https://api.stripe.com/*"] }
  --   data_mutation: { "tables": ["agents", "wallets"], "operations": ["delete"] }
  --   escalation:    {} (always fires on agent escalation)
  --   custom:        { "match": { ... } }
  conditions      JSONB NOT NULL DEFAULT '{}',
  -- Whether to auto-approve after timeout (true) or auto-reject (false).
  auto_approve    BOOLEAN NOT NULL DEFAULT false,
  -- Timeout in seconds. NULL means no timeout (wait indefinitely).
  timeout_seconds INTEGER,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  priority        INTEGER NOT NULL DEFAULT 0,
  metadata        JSONB NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Table: approval_requests
-- ---------------------------------------------------------------------------
-- Individual approval requests created when an agent action matches a policy.

CREATE TABLE approval_requests (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id        UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  session_id      UUID REFERENCES agent_sessions(id) ON DELETE SET NULL,
  policy_id       UUID REFERENCES hitl_policies(id) ON DELETE SET NULL,
  owner_id        UUID NOT NULL,
  -- What the agent wants to do.
  action_type     TEXT NOT NULL,
  action_summary  TEXT NOT NULL,
  action_details  JSONB NOT NULL DEFAULT '{}',
  -- Current status.
  status          approval_status NOT NULL DEFAULT 'pending',
  -- Who reviewed and when.
  reviewer_id     UUID,
  reviewed_at     TIMESTAMPTZ,
  -- Human response (reason for approval/rejection, additional input).
  response_note   TEXT,
  response_data   JSONB NOT NULL DEFAULT '{}',
  -- Timeout handling.
  expires_at      TIMESTAMPTZ,
  auto_resolve    BOOLEAN NOT NULL DEFAULT false,
  metadata        JSONB NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------

CREATE INDEX idx_hitl_policies_agent     ON hitl_policies (agent_id);
CREATE INDEX idx_hitl_policies_active    ON hitl_policies (agent_id, is_active)
  WHERE is_active = true;

CREATE INDEX idx_approval_requests_agent   ON approval_requests (agent_id);
CREATE INDEX idx_approval_requests_status  ON approval_requests (agent_id, status)
  WHERE status = 'pending';
CREATE INDEX idx_approval_requests_session ON approval_requests (session_id)
  WHERE session_id IS NOT NULL;
CREATE INDEX idx_approval_requests_expires ON approval_requests (expires_at)
  WHERE expires_at IS NOT NULL AND status = 'pending';

-- ---------------------------------------------------------------------------
-- Triggers: auto-update updated_at
-- ---------------------------------------------------------------------------

CREATE TRIGGER trg_hitl_policies_updated_at
  BEFORE UPDATE ON hitl_policies
  FOR EACH ROW
  EXECUTE FUNCTION moddatetime(updated_at);

CREATE TRIGGER trg_approval_requests_updated_at
  BEFORE UPDATE ON approval_requests
  FOR EACH ROW
  EXECUTE FUNCTION moddatetime(updated_at);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

ALTER TABLE hitl_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE approval_requests ENABLE ROW LEVEL SECURITY;

-- Policies: owner can manage; users with agent access can read.
CREATE POLICY hitl_policies_select ON hitl_policies
  FOR SELECT USING (
    owner_id = auth.uid()
    OR agent_id IN (
      SELECT agent_id FROM agent_permissions WHERE user_id = auth.uid()
    )
  );

CREATE POLICY hitl_policies_insert ON hitl_policies
  FOR INSERT WITH CHECK (owner_id = auth.uid());

CREATE POLICY hitl_policies_update ON hitl_policies
  FOR UPDATE USING (owner_id = auth.uid());

CREATE POLICY hitl_policies_delete ON hitl_policies
  FOR DELETE USING (owner_id = auth.uid());

-- Approval requests: owner and shared users can view; only owner/admin can resolve.
CREATE POLICY approval_requests_select ON approval_requests
  FOR SELECT USING (
    owner_id = auth.uid()
    OR agent_id IN (
      SELECT agent_id FROM agent_permissions WHERE user_id = auth.uid()
    )
  );

CREATE POLICY approval_requests_insert ON approval_requests
  FOR INSERT WITH CHECK (
    owner_id = auth.uid()
    OR agent_id IN (
      SELECT id FROM agents WHERE owner_id = auth.uid()
    )
  );

CREATE POLICY approval_requests_update ON approval_requests
  FOR UPDATE USING (
    owner_id = auth.uid()
    OR agent_id IN (
      SELECT agent_id FROM agent_permissions
      WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
    )
  );
