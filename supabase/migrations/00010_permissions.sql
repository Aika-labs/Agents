-- Sprint 10: Agent IAM & Permissions
-- Granular access control for agents with role-based sharing.

-- ---------------------------------------------------------------------------
-- Enum: agent_role
-- ---------------------------------------------------------------------------

CREATE TYPE agent_role AS ENUM ('owner', 'admin', 'editor', 'viewer');

-- ---------------------------------------------------------------------------
-- Table: agent_permissions
-- ---------------------------------------------------------------------------
-- Maps users to agents with a specific role. The agent owner always has
-- implicit "owner" role (checked in application code via agents.owner_id),
-- so this table is primarily for shared/delegated access.

CREATE TABLE agent_permissions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id    UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL,
  role        agent_role NOT NULL DEFAULT 'viewer',
  granted_by  UUID,
  expires_at  TIMESTAMPTZ,
  metadata    JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Each user can have at most one permission entry per agent.
ALTER TABLE agent_permissions
  ADD CONSTRAINT uq_agent_permissions_agent_user UNIQUE (agent_id, user_id);

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------

CREATE INDEX idx_agent_permissions_user    ON agent_permissions (user_id);
CREATE INDEX idx_agent_permissions_agent   ON agent_permissions (agent_id);
CREATE INDEX idx_agent_permissions_expires ON agent_permissions (expires_at)
  WHERE expires_at IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Trigger: auto-update updated_at
-- ---------------------------------------------------------------------------

CREATE TRIGGER trg_agent_permissions_updated_at
  BEFORE UPDATE ON agent_permissions
  FOR EACH ROW
  EXECUTE FUNCTION moddatetime(updated_at);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

ALTER TABLE agent_permissions ENABLE ROW LEVEL SECURITY;

-- Users can see permissions for agents they own or have access to.
CREATE POLICY agent_permissions_select ON agent_permissions
  FOR SELECT USING (
    user_id = auth.uid()
    OR agent_id IN (
      SELECT id FROM agents WHERE owner_id = auth.uid()
    )
  );

-- Only agent owners can insert/update/delete permissions.
CREATE POLICY agent_permissions_insert ON agent_permissions
  FOR INSERT WITH CHECK (
    agent_id IN (
      SELECT id FROM agents WHERE owner_id = auth.uid()
    )
  );

CREATE POLICY agent_permissions_update ON agent_permissions
  FOR UPDATE USING (
    agent_id IN (
      SELECT id FROM agents WHERE owner_id = auth.uid()
    )
  );

CREATE POLICY agent_permissions_delete ON agent_permissions
  FOR DELETE USING (
    agent_id IN (
      SELECT id FROM agents WHERE owner_id = auth.uid()
    )
  );
